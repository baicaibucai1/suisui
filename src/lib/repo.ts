/*
 * 仓库：本机的一个文件夹，笔记和书都住在里面。
 *
 * ## 为什么要有这一层
 *
 * 之前笔记是 localStorage 里的一大坨 JSON —— 写是写进去了，但**它不在用户的磁盘上**：
 * 换台机器没有、清缓存没有、想拿别的编辑器改一个字也够不着。
 * 「QuitWriteRead」要的是用户自己能看见、能备份、能用别的工具打开的一堆 .md 文件，
 * 所以内容的家必须是一个**真实的文件夹**，程序只是它的一个视图。
 *
 * ## 三套驱动，同一张脸
 *
 *   · `tauri`  桌面端。走 Rust 那组 `repo_*` 命令（真文件系统，没有同源策略这一说）。
 *   · `fsa`    浏览器。用 File System Access 向用户要一个目录句柄（Chrome / Edge 有，
 *              Safari / Firefox 没有 —— 那儿只能往下退一档）。
 *   · `memory` 暂存。写进 localStorage 的一个键里。**不是真仓库**，只是"还能用"，
 *              界面上必须照实说出来，不能让人以为已经落盘了。
 *
 * 三条路对上层的形状完全一样，切换仓库 = 换一个实现，其余代码不动。
 *
 * ## 三条硬规矩
 *
 *   ① 路径是**仓库内的相对路径**，正斜杠分隔（Windows 的 `\` 在这一层就归一成 `/`）。
 *      绝对路径不许进这个接口 —— 那是 Rust 侧的事，前端拿到的永远是相对名。
 *   ② **二进制走字节，文本走字符串**。判断只看后缀（binary.ts 的 isBinaryPath），
 *      因为 FileMap 是一张 `Record<string, string>`（附件存 base64），
 *      而磁盘上它该是**真的 png / pdf**，不能把 base64 当正文写进文件。
 *   ③ 出错必须说人话（"这个文件夹写不进去，换一个吧"），
 *      因为仓库选错了后面的每一步都会失败，用户得知道该改什么。
 */

import { bytesToBase64, isBinaryPath, tryBase64ToBytes } from './binary';

/** 仓库的一种实现方式。`memory` 是兜底，不是真仓库 */
export type RepoKind = 'tauri' | 'fsa' | 'memory';

/**
 * 仓库的**引用**（能塞进 localStorage 的那一份）。
 * 活句柄（目录句柄）不能序列化，所以 `fsa` 只记名字，句柄另存 IndexedDB。
 */
export type RepoRef =
  | { kind: 'tauri'; dir: string }
  | { kind: 'fsa'; name: string }
  | { kind: 'memory' };

/** 仓库里一个条目。`path` 是相对仓库根的正斜杠路径 */
export type RepoEntry = { path: string; size: number };

export type Repo = {
  kind: RepoKind;
  /** 显示用的短名字（文件夹名） */
  label: string;
  /** 给人看的完整位置。桌面端是绝对路径；浏览器只有一个名字；暂存是空串 */
  where: string;
  ref: RepoRef;
  list(): Promise<RepoEntry[]>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  /**
   * 改名 / 搬家。
   * ⚠️ **上层目前不走它**：存盘是按 `files` 与上次快照的**差异**写的，
   * 而改名在 diff 里天然就是"写一个新的 + 删掉旧的"，结果完全等价
   * （store 那边连双链都改完了才轮到存盘）。留着这条是因为它是文件层该有的动作，
   * 且浏览器那条路的 `move` 只能搬文件 —— 整目录搬家迟早得专门处理。
   */
  move(from: string, to: string): Promise<void>;
};

/** 桌面端窗口才有这个内部对象 —— 拿它判"我现在跑在桌面端还是浏览器里" */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 这个环境能不能真的挑一个文件夹。不能的话就得老实说"现在只是暂存" */
export function canPickDir(): boolean {
  if (isTauri()) return true;
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/*
 * 仓库里不列出来的东西。
 * `books/` 是书的存放处（书不是笔记，不该进左边的树）；
 * 点开头的是程序自己的隐藏文件（.suisui 之类）。
 * ⚠️ 三套驱动都要按同一份标准筛 —— 不然换一个驱动，左栏就多出一堆不该出现的东西。
 */
function hidden(p: string): boolean {
  const segs = p.split('/');
  if (segs[0] === 'books') return true;
  /*
   * ⚠️ `.folder` 是**我们自己的目录标识文件**（folders.ts：空目录靠它留下来），
   * 它必须能原样进出仓库 —— 按"点开头的都是隐藏文件"滤掉它，
   * 表现是"刷新之后自建的空目录全没了"。别把它和 `.suisui` / `.DS_Store` 混为一谈。
   */
  return segs.some((seg) => seg.startsWith('.') && seg !== '.folder');
}

/* ─────────────────────────── 桌面端 ─────────────────────────── */

/** 动态 import：浏览器版不该为了一个用不上的通道去拉 @tauri-apps/api */
async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const m = await import('@tauri-apps/api/core');
  return (await m.invoke(cmd, args)) as T;
}

function tauriRepo(dir: string): Repo {
  const label = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
  return {
    kind: 'tauri',
    label,
    where: dir,
    ref: { kind: 'tauri', dir },
    list: async () => {
      const all = await invoke<RepoEntry[]>('repo_list', { root: dir });
      return all.filter((e) => !hidden(e.path));
    },
    read: (path) => invoke<string>('repo_read', { root: dir, path }),
    write: (path, text) => invoke<void>('repo_write', { root: dir, path, text }),
    readBytes: async (path) => {
      const b64 = await invoke<string>('repo_read_bytes', { root: dir, path });
      return tryBase64ToBytes(b64) ?? new Uint8Array(0);
    },
    writeBytes: (path, bytes) =>
      invoke<void>('repo_write_bytes', { root: dir, path, base64: bytesToBase64(bytes) }),
    remove: (path) => invoke<void>('repo_remove', { root: dir, path }),
    move: (from, to) => invoke<void>('repo_move', { root: dir, from, to }),
  };
}

/** 桌面端弹系统文件夹选择框。用户取消返回 null */
async function tauriPickDir(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    directory: true,
    multiple: false,
    title: '选一个文件夹当仓库',
  });
  return typeof picked === 'string' ? picked : null;
}

/* ─────────────────────────── 浏览器（File System Access） ─────────────────────────── */

/*
 * 只声明用到的那几个成员：TS 的 lib.dom 里这几个类型版本不齐，
 * 而我们要的也就这么点，自己写一份比跟内置类型打架省事。
 */
type FsaEntry = {
  name: string;
  kind: 'file' | 'directory';
  getFile(): Promise<File>;
};
type FsaDir = {
  name: string;
  values(): AsyncIterableIterator<FsaEntry>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<unknown>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsaDir>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  queryPermission(opts?: { mode: string }): Promise<string>;
  requestPermission(opts?: { mode: string }): Promise<string>;
};
type FsaFile = {
  createWritable(): Promise<{
    write(data: Blob | string | ArrayBuffer): Promise<void>;
    close(): Promise<void>;
  }>;
};

const IDB_NAME = 'suisui.repo';
const IDB_STORE = 'dirs';

/** 目录句柄存这儿 —— localStorage 装不下活句柄，IndexedDB 才收 */
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error ?? new Error('打不开 IndexedDB'));
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error ?? new Error('写 IndexedDB 失败'));
  });
  db.close();
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await idbOpen();
  const v = await new Promise<T | null>((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => res((req.result as T) ?? null);
    req.onerror = () => rej(req.error ?? new Error('读 IndexedDB 失败'));
  });
  db.close();
  return v;
}

/** 一层层下去拿子目录句柄（`a/b/c`）。写新笔记落在新建文件夹里是常事 */
async function fsaSub(dir: FsaDir, parts: string[], create: boolean): Promise<FsaDir> {
  let cur = dir;
  for (const seg of parts) {
    cur = await cur.getDirectoryHandle(seg, create ? { create: true } : undefined);
  }
  return cur;
}

function fsaRepo(handle: FsaDir): Repo {
  const ref: RepoRef = { kind: 'fsa', name: handle.name };

  async function walk(dir: FsaDir, prefix: string, out: RepoEntry[]): Promise<void> {
    for await (const entry of dir.values()) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (hidden(rel)) continue;
      if (entry.kind === 'directory') {
        await walk(await dir.getDirectoryHandle(entry.name), rel, out);
      } else {
        const f = await entry.getFile();
        out.push({ path: rel, size: f.size });
      }
    }
  }

  return {
    kind: 'fsa',
    label: handle.name,
    where: handle.name,
    ref,
    list: async () => {
      const out: RepoEntry[] = [];
      await walk(handle, '', out);
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },
    read: async (path) => {
      const parts = path.split('/');
      const name = parts.pop() ?? path;
      const dir = await fsaSub(handle, parts, false);
      const fh = (await dir.getFileHandle(name)) as unknown as FsaFile & {
        getFile(): Promise<File>;
      };
      return await (await fh.getFile()).text();
    },
    write: async (path, text) => {
      const parts = path.split('/');
      const name = parts.pop() ?? path;
      const dir = await fsaSub(handle, parts, true);
      const fh = (await dir.getFileHandle(name, { create: true })) as unknown as FsaFile;
      const w = await fh.createWritable();
      try {
        await w.write(text);
      } finally {
        await w.close();
      }
    },
    readBytes: async (path) => {
      const parts = path.split('/');
      const name = parts.pop() ?? path;
      const dir = await fsaSub(handle, parts, false);
      const fh = (await dir.getFileHandle(name)) as unknown as {
        getFile(): Promise<File>;
      };
      return new Uint8Array(await (await fh.getFile()).arrayBuffer());
    },
    writeBytes: async (path, bytes) => {
      const parts = path.split('/');
      const name = parts.pop() ?? path;
      const dir = await fsaSub(handle, parts, true);
      const fh = (await dir.getFileHandle(name, { create: true })) as unknown as FsaFile;
      const w = await fh.createWritable();
      try {
        await w.write(new Blob([bytes as unknown as BlobPart]));
      } finally {
        await w.close();
      }
    },
    remove: async (path) => {
      const parts = path.split('/');
      const name = parts.pop() ?? path;
      const dir = await fsaSub(handle, parts, false);
      await dir.removeEntry(name, { recursive: true });
    },
    // FSA 没有 rename：只能"读出来 → 写到新名字 → 删旧的"。
    // 目录改名要整棵子树这么搬一遍，所以这里只保证文件级正确 ——
    // 目录改名在浏览器里本来就是罕见操作，走不通会报错，不会静默丢数据。
    move: async (from, to) => {
      const fp = from.split('/');
      const fname = fp.pop() ?? from;
      const fromDir = await fsaSub(handle, fp, false);
      const fh = (await fromDir.getFileHandle(fname)) as unknown as {
        getFile(): Promise<File>;
      };
      const blob = await (await fh.getFile()).arrayBuffer();
      const tp = to.split('/');
      const tname = tp.pop() ?? to;
      const toDir = await fsaSub(handle, tp, true);
      const nh = (await toDir.getFileHandle(tname, { create: true })) as unknown as FsaFile;
      const w = await nh.createWritable();
      try {
        await w.write(blob);
      } finally {
        await w.close();
      }
      await fromDir.removeEntry(fname);
    },
  };
}

async function fsaPickDir(): Promise<FsaDir | null> {
  const w = window as unknown as {
    showDirectoryPicker(opts?: { mode?: string }): Promise<FsaDir>;
  };
  try {
    return await w.showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    // 用户点了取消（AbortError）—— 那不算错误，安静地什么都不做
    return null;
  }
}

/* ─────────────────────────── 暂存（兜底） ─────────────────────────── */

/*
 * 没有文件系统可用时的最后一条路：写进 localStorage。
 * ⚠️ 这不是仓库 —— 它受 5~10MB 配额限制，换浏览器就没了。
 * 界面必须把「暂存」两个字说在明处，别让人以为已经存到磁盘上。
 */
const MEM_KEY = 'suisui.repo.memory.v1';

function memAll(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MEM_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    // 手改坏了 / 别的版本写的：当作空仓库，总比整个应用打不开强
    return {};
  }
}

function memPut(all: Record<string, string>): void {
  localStorage.setItem(MEM_KEY, JSON.stringify(all));
}

function memoryRepo(): Repo {
  return {
    kind: 'memory',
    label: '浏览器暂存',
    where: '',
    ref: { kind: 'memory' },
    list: async () =>
      Object.entries(memAll())
        .filter(([p]) => !hidden(p))
        .map(([path, v]) => ({ path, size: v.length }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    read: async (path) => memAll()[path] ?? '',
    write: async (path, text) => {
      const all = memAll();
      all[path] = text;
      memPut(all);
    },
    readBytes: async (path) => {
      const v = memAll()[path] ?? '';
      return tryBase64ToBytes(v) ?? new Uint8Array(0);
    },
    writeBytes: async (path, bytes) => {
      const all = memAll();
      all[path] = bytesToBase64(bytes);
      memPut(all);
    },
    remove: async (path) => {
      const all = memAll();
      delete all[path];
      memPut(all);
    },
    move: async (from, to) => {
      const all = memAll();
      if (!(from in all)) return;
      all[to] = all[from];
      delete all[from];
      memPut(all);
    },
  };
}

/* ─────────────────────────── 打开 / 挑选 ─────────────────────────── */

/**
 * 按引用打开仓库。**打不开会抛**（目录没了 / 没权限 / 句柄失效），
 * 错误文案直接来自驱动，交给界面显示 —— 用户得知道该改什么。
 */
export async function openRepo(ref: RepoRef): Promise<Repo> {
  if (ref.kind === 'tauri') {
    // 真写一下探针：目录被删了、只读盘、权限不足都会在这一步现形，
    // 比"打开之后才发现存不进去"要好得多
    await invoke<void>('repo_check', { root: ref.dir });
    return tauriRepo(ref.dir);
  }
  if (ref.kind === 'fsa') {
    const h = await idbGet<FsaDir>(ref.name);
    if (!h) throw new Error('上次选的文件夹已经授权过期了 —— 重新选一次');
    // 刷新之后权限默认回到 prompt，得再要一次（要用户手势，所以这一步可能失败）
    const q = await h.queryPermission({ mode: 'readwrite' });
    const granted = q === 'granted' ? 'granted' : await h.requestPermission({ mode: 'readwrite' });
    if (granted !== 'granted') throw new Error('没拿到这个文件夹的写权限 —— 重新选一次');
    return fsaRepo(h);
  }
  return memoryRepo();
}

/**
 * 让用户挑一个文件夹当仓库。取消 / 环境不支持都返回 null。
 * **必须在用户手势里调**（弹窗这一条是浏览器的硬规矩），不能放在启动流程里偷偷跑。
 */
export async function pickRepo(): Promise<Repo | null> {
  if (isTauri()) {
    const dir = await tauriPickDir();
    if (!dir) return null;
    await invoke<void>('repo_check', { root: dir });
    return tauriRepo(dir);
  }
  if (canPickDir()) {
    const h = await fsaPickDir();
    if (!h) return null;
    await idbSet(h.name, h);
    return fsaRepo(h);
  }
  return null;
}

/** 出厂仓库：程序自己的数据目录下的 `repo`。只有桌面端有这个概念 */
export async function defaultRepo(): Promise<Repo | null> {
  if (!isTauri()) return null;
  const dir = await invoke<string>('repo_default_dir', {});
  return tauriRepo(dir);
}

/** 一句话描述这个引用（设置页那张卡片上显示的） */
export function describeRef(ref: RepoRef | null): string {
  if (!ref) return '还没选仓库';
  if (ref.kind === 'tauri') return ref.dir;
  if (ref.kind === 'fsa') return ref.name;
  return '浏览器暂存（不在磁盘上）';
}

/*
 * FileMap 与磁盘之间的那道翻译：
 * 同一张 `Record<string, string>` 里，文字是文字、附件是 base64（见 binary.ts 的规矩），
 * 而磁盘上附件该是**真的字节**。判断只看后缀 —— 这是全应用唯一的分派点。
 */

/** 仓库里的一个条目 → FileMap 里的值 */
export async function readInto(repo: Repo, path: string): Promise<string> {
  if (isBinaryPath(path)) return bytesToBase64(await repo.readBytes(path));
  return await repo.read(path);
}

/** FileMap 里的一个值 → 仓库里的一个文件 */
export async function writeFrom(repo: Repo, path: string, value: string): Promise<void> {
  if (!isBinaryPath(path)) {
    await repo.write(path, value);
    return;
  }
  const bytes = tryBase64ToBytes(value);
  // 解不开说明这一条本来就是脏的（手工粘进去的半个 base64）—— 按文字写下去，
  // 总比抛异常把整个保存卡住好；它本来也显示不出来。
  if (bytes) await repo.writeBytes(path, bytes);
  else await repo.write(path, value);
}
