/*
 * 文件夹 = 目录里的一个**隐藏标识文件**。
 *
 * 为什么不能直接"建个空目录"：git 只存文件，空目录推上去什么都不留；
 * 网盘（坚果云 / OneDrive）虽然支持空目录，但同一个工作副本要在三种后端之间换来换去，
 * 行为必须一致。所以统一成：目录里放一个点开头的标识文件（`.folder`），
 * 左侧列表本来就隐藏所有点开头的路径段（见 visible.ts），用户看不见它，
 * 而它在任何后端上都是一个真实存在的文件 —— 目录因此"真的存在"了。
 * 这跟 Obsidian 在每个库里放一个 `.obsidian` 是同一个思路。
 *
 * 这个模块是「**路径层**」：树怎么长（buildTree）、目录怎么来（createFolder）、
 * 名字怎么改（renameEntry）、东西怎么挪（moveEntry）。全在这里，
 * 因为改名和搬家共用同一件事 —— **把一个前缀换成另一个前缀**（见 remap）。
 *
 * ⚠️ 这个模块**零依赖、不 import 任何其它 lib**：单测用 Node 直接跑 .ts，
 * Node 的 ESM 不做后缀补全，跨 lib import 会当场找不到模块（见 note.ts 的注释）。
 * 所以 `parentOf` / `baseOf` 这两个一行函数在这里**自己留一份**，不从 links.ts 借。
 */

/** 文件夹标识文件的名字。改它等于换一套目录协议，老目录会全部"消失"—— 别随便改。 */
export const FOLDER_FILE = '.folder';

/** 单段目录名里各平台都不接受的字符（`/` 是分隔符，单独处理） */
const SEG_ILLEGAL = /[\\:*?"<>|\u0000-\u001f\u007f]/g;
const MAX_SEG = 60;

/**
 * 单个名字（文件名 / 一层目录名）→ 干净的版本。
 * 返回 `''` 表示"这不能要"：空的、只剩非法字符、或者 `.` `..`。
 *
 * ⚠️ 名字里的 `/` 是**删掉**，不是当分隔符 —— 用户能表达的需求是"叫这个名字"，
 * 而斜杠在文件系统里是分层。要分层请新建文件夹（界面里也拦了，见 renameEntry）。
 */
export function normalizeSeg(input: string): string {
  const s = String(input ?? '')
    .replace(/\//g, '')
    .replace(SEG_ILLEGAL, '')
    .trim();
  // `.` 是废段，`..` 会跳出库 —— 两个都不接受，而不是"净化成别的"
  if (!s || s === '.' || s === '..') return '';
  // 按码点截断，别把 emoji 劈成半个；末尾的点在 Windows 上会被吞掉，先自己去掉
  return Array.from(s)
    .slice(0, MAX_SEG)
    .join('')
    .replace(/[. ]+$/, '');
}

/**
 * 用户输入的目录名 → 干净的目录路径。
 * 返回 `''` 表示"这不能建"：空、全是分隔符、或者只剩 `..` 这种会跳出库的段。
 */
export function normalizeDir(input: string): string {
  return String(input ?? '')
    .replace(/\\/g, '/')
    .split('/')
    // 每段走同一套净化 —— 规则只有 normalizeSeg 一处定义
    .map(normalizeSeg)
    .filter(Boolean)
    .join('/');
}

export const folderFileOf = (dir: string): string => {
  const d = normalizeDir(dir);
  return d ? `${d}/${FOLDER_FILE}` : '';
};

export const isFolderFile = (path: string): boolean =>
  path.split('/').pop() === FOLDER_FILE;

/** 目录的显示名（最后一段） */
export const dirName = (dir: string): string => normalizeDir(dir).split('/').pop() ?? '';

/** 标识文件的正文。它是给用户看的说明，也是给后端的"这里有个目录"的凭据。 */
export function folderBody(name: string): string {
  const n = name.trim() || '未命名';
  return (
    `# ${n}\n\n` +
    '这是「QuitWriteRead」给这个文件夹留的标识文件：它在，这个文件夹就在。\n' +
    '删掉它、且文件夹里没有别的笔记时，下次同步这个文件夹就会消失。\n'
  );
}

/**
 * 从一堆文件路径里推出所有目录（含中间层）。
 * 标识文件本身也是文件路径，所以"只有标识文件的空目录"照样推得出来 —— 这正是它存在的意义。
 */
export function dirsOf(paths: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const p of paths) {
    const segs = p.split('/');
    for (let i = 1; i < segs.length; i++) set.add(segs.slice(0, i).join('/'));
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh'));
}

/** 建文件夹。**已存在就不动**（重复建不该把说明覆盖回初始内容），返回新的 files。 */
export function createFolder(
  files: Record<string, string>,
  input: string,
): { dir: string; path: string; files: Record<string, string> } | null {
  const dir = normalizeDir(input);
  if (!dir) return null;
  const path = `${dir}/${FOLDER_FILE}`;
  const next = { ...files };
  if (!(path in next)) next[path] = folderBody(dirName(dir));
  return { dir, path, files: next };
}

/** 删文件夹 = 删掉这个前缀下的所有文件（含它自己的标识文件）。返回删了哪些。 */
export function removeDir(
  files: Record<string, string>,
  input: string,
): { files: Record<string, string>; removed: string[] } {
  const dir = normalizeDir(input);
  if (!dir) return { files, removed: [] };
  const prefix = `${dir}/`;
  const removed = Object.keys(files).filter((p) => p === dir || p.startsWith(prefix));
  if (removed.length === 0) return { files, removed: [] };
  const next = { ...files };
  for (const p of removed) delete next[p];
  return { files: next, removed: removed.sort((a, b) => a.localeCompare(b, 'zh')) };
}

/** 目录里除标识文件之外还剩几个文件 —— 删目录前的提示要用到 */
export function countInDir(files: Record<string, string>, dir: string): number {
  const d = normalizeDir(dir);
  if (!d) return 0;
  const prefix = `${d}/`;
  return Object.keys(files).filter((p) => p.startsWith(prefix) && !isFolderFile(p)).length;
}

export type TreeNode = {
  /** 显示名（最后一段） */
  name: string;
  /** 完整路径：目录是 `a/b`，文件是 `a/b.md` */
  path: string;
  dirs: TreeNode[];
  files: string[];
};

/**
 * 平铺的路径列表 → 嵌套树。**目录排前面**（跟文件管理器一致，也跟"先分拣再挑文件"的习惯一致）。
 * 传进来的应该是**已经过滤过**的路径（可见性过滤在渲染层做，别在这里做）。
 */
export function buildTree(paths: readonly string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', dirs: [], files: [] };
  const byPath = new Map<string, TreeNode>([['', root]]);

  const nodeFor = (dir: string): TreeNode => {
    const hit = byPath.get(dir);
    if (hit) return hit;
    const segs = dir.split('/');
    const name = segs[segs.length - 1];
    const parentPath = segs.slice(0, -1).join('/');
    const node: TreeNode = { name, path: dir, dirs: [], files: [] };
    byPath.set(dir, node);
    nodeFor(parentPath).dirs.push(node);
    return node;
  };

  for (const p of paths) {
    const i = p.lastIndexOf('/');
    if (i < 0) {
      root.files.push(p);
      continue;
    }
    nodeFor(p.slice(0, i)).files.push(p);
  }

  const cmp = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, 'zh');
  const sort = (n: TreeNode) => {
    n.dirs.sort(cmp);
    n.files.sort((a, b) => a.localeCompare(b, 'zh'));
    for (const d of n.dirs) sort(d);
  };
  sort(root);
  return root;
}

/** 从根目录走到某个目录，路径上的每一层 —— 用来"展开到目标目录" */
export const ancestorsOf = (dir: string): string[] => {
  const segs = normalizeDir(dir).split('/').filter(Boolean);
  return segs.map((_, i) => segs.slice(0, i + 1).join('/'));
};

// ---------------------------------------------------------------- 改名与搬家

/*
 * 改名和搬家是**同一件事**：把一个路径前缀换成另一个前缀。
 *   - 改文件名：`notes/a.md`        → `notes/b.md`
 *   - 改目录名：`读书/2026/**`      → `读书/2027/**`（整棵子树跟着走）
 *   - 拖动搬家：`notes/a.md`        → `thoughts/a.md`（目录名不动，换父级）
 *
 * 都是"旧前缀 → 新前缀"，所以底下共用 `remap`：一次遍历，逐条记下谁去了哪儿。
 * 逐条映射必须带出去 —— 界面里还开着这篇、折叠集合里还记着这个目录、
 * 选中的落点还指着它，都要靠这份映射跟着改，否则文件名改了界面还在指旧路径。
 */

/** 一个东西从哪儿搬到哪儿 */
export type PathMove = { from: string; to: string };

export type RefactorResult =
  | { ok: true; to: string; files: Record<string, string>; moved: PathMove[] }
  | { ok: false; error: string };

/** 路径所在的目录；没有目录就是空串。 */
export const parentOf = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

/** 最后一段（文件名或目录名） */
export const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** 这个路径是不是一个**目录**：有东西以它开头就是。 */
export function isDirPath(files: Record<string, unknown>, path: string): boolean {
  if (!path) return false;
  const prefix = `${path}/`;
  return Object.keys(files).some((p) => p.startsWith(prefix));
}

/** 一个路径位置上有没有东西 —— 文件占着，或者是个目录，都算占着。 */
export function occupied(files: Record<string, string>, path: string): boolean {
  return files[path] !== undefined || isDirPath(files, path);
}

/** 把 `from` 这个前缀整棵换成 `to`，逐条记下映射。不碰别的东西。 */
function remap(
  files: Record<string, string>,
  from: string,
  to: string,
): { files: Record<string, string>; moved: PathMove[] } {
  const next: Record<string, string> = {};
  const moved: PathMove[] = [];
  const prefix = `${from}/`;
  for (const [k, v] of Object.entries(files)) {
    if (k !== from && !k.startsWith(prefix)) {
      next[k] = v;
      continue;
    }
    const nk = to + k.slice(from.length);
    next[nk] = v;
    moved.push({ from: k, to: nk });
  }
  return { files: next, moved };
}

/** 后缀（`.md`、`.png`……）。名字里没后缀时用它沿用原来的。 */
const EXT_RE = /\.[a-z0-9]{1,8}$/i;

/**
 * 改名。`path` 是文件就改文件名，是目录就**连里面所有东西一起**换前缀。
 *
 * 三条定死的规矩：
 *   - **不覆盖。** 目标位置已经有人就叫停（`{ok:false}`），不自动加 `-2` ——
 *     改名时名字是人自己敲的，悄悄加个尾巴比报错更难懂。
 *   - **后缀跟着原样走。** 只敲了「新名」没敲后缀，就沿用原来的 ——
 *     否则 `a.md` 一改名会变成 `新名` 这种没后缀的裸文件。
 *     明确敲了别的后缀（`b.md`）就听人的，那是他自己的决定。
 *   - **标识文件不给单独改。** `.folder` 出现在列表里本身就是 bug；
 *     给文件夹改名要走目录那条路（里面所有路径一起换，标识文件名不动）。
 */
export function renameEntry(
  files: Record<string, string>,
  path: string,
  input: string,
): RefactorResult {
  if (isFolderFile(path)) {
    return { ok: false, error: '标识文件不能单独改名 —— 右键那行文件夹，改的是文件夹名' };
  }
  if (String(input).includes('/')) {
    return { ok: false, error: '名字里不能带 / —— 那是分层，请用「新建文件夹」' };
  }
  const name = normalizeSeg(input);
  if (!name) return { ok: false, error: '名字不能为空' };

  const isDir = isDirPath(files, path);
  const parent = parentOf(path);
  let final = name;
  if (!isDir) {
    // 没敲后缀就沿用原来的：改名的意图是"换个叫法"，不是"换种格式"
    const oExt = baseOf(path).match(EXT_RE)?.[0] ?? '';
    if (oExt && !EXT_RE.test(final)) final += oExt;
  }
  const to = parent ? `${parent}/${final}` : final;
  if (to === path) return { ok: true, to, files, moved: [] };
  if (occupied(files, to)) return { ok: false, error: `这里已经有一个「${final}」` };

  const r = remap(files, path, to);
  return { ok: true, to, files: r.files, moved: r.moved };
}

/**
 * 搬家：把 `path` 挪到 `destInput` 这个目录下（`''` = 根目录）。
 * 名字不变，所以**不需要重写双链** —— `[[某篇]]` 是按名字找的，位置变了照样找得到。
 *
 * ⚠️ 唯一必须挡住的是"拖进自己里面"：目录 `a` 挪到 `a/b` 下，
 * 那是把父节点挂到自己的后代上，前缀替换会当场把整棵子树绕成一个环（自己覆盖自己）。
 */
export function moveEntry(
  files: Record<string, string>,
  path: string,
  destInput: string,
): RefactorResult {
  const dest = normalizeDir(destInput);
  const isDir = isDirPath(files, path);
  if (isDir && (dest === path || dest.startsWith(`${path}/`))) {
    return { ok: false, error: '不能把文件夹挪进它自己里面' };
  }
  const name = baseOf(path);
  const to = dest ? `${dest}/${name}` : name;
  if (to === path) return { ok: true, to, files, moved: [] };
  if (occupied(files, to)) {
    return { ok: false, error: `${dest || '根目录'}里已经有一个「${name}」` };
  }
  const r = remap(files, path, to);
  return { ok: true, to, files: r.files, moved: r.moved };
}

/**
 * 名字在目标目录里能不能用 —— 拖到一半时给"能不能放"的即时反馈（高亮成红的）。
 * 只判冲突，不做净化（净化在 moveEntry 里，重复一套规则迟早对不上）。
 */
export function canDrop(files: Record<string, string>, path: string, destInput: string): boolean {
  const r = moveEntry(files, path, destInput);
  return r.ok;
}
