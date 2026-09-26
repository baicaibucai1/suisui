/*
 * 书架的存储。就一个决定要解释清楚：**为什么是 IndexedDB 而不是 localStorage。**
 *
 * 一本书 2~20MB 很平常，localStorage 每源 5MB 且**只能存字符串** ——
 * 塞 base64 还要再涨 33%，一本书就超了，第二本直接 QuotaExceededError。
 * 而 localStorage 是同步的，写一次大字符串会把界面卡住那一下。
 * IndexedDB 能存 ArrayBuffer，异步，容量按磁盘算（几百 MB 起）。
 *
 * 顺带把**原始字节和元数据分两个 store**：书架列表要的是「有哪些书、读到哪」，
 * 如果 metadata 和 bytes 挤在一条记录里，列一次书架就得把几 MB 字节从磁盘读进内存 ——
 * 只为画几行书名。字节只在真打开那本时才取。
 *
 * ⚠️ 这一层**不碰 store 的 files**，也不参与同步 —— 书是本地的，
 * 现在推到远端既没意义（几 MB 的二进制、GitHub 单文件上限 100MB）也拖慢每次同步。
 * 以后要同步书，是单独开口子的事，不该混进笔记那条链路。
 */
import type { TocEntry } from './epub';
import { clampPrefs } from './readerstyle';

export type BookMeta = {
  id: string;
  title: string;
  author: string;
  /** epub 原始大小（字节） */
  size: number;
  addedAt: string;
  toc: TocEntry[];
  spine: string[];
  cover: string | null;
  /**
   * 封面的 data URL。导入时就地算好存着 —— 书架要画缩略图，
   * 如果每次列书架都去把整本书解压一遍取封面，只为画几张小图，太亏。
   * 超过 500KB 的封面不存（那多半是塞了张原图，不值得为它占书架）。
   */
  coverUrl?: string | null;
  opfDir: string;
};

/** 读到哪了。`ratio` 是这一章滚过的比例，0~1 */
export type BookProgress = {
  id: string;
  href: string;
  label: string;
  ratio: number;
  /** 整本书读到百分之多少 —— 书架上那句「读到 32%」用它 */
  percent: number;
  at: string;
};

/*
 * 批注（划出来的一段 + 写在旁边的想法）。
 *
 * 锚点为什么记**纯文本偏移**而不是 DOM 位置：DOM 会被我们自己改 ——
 * 搜索命中时会 `splitText` 插 `<mark>`、"跳过去"时也会，一旦合并/拆分，
 * 节点序号就对不上了，表现为"上次划的地方跳到别的段落去了"。
 * 而这一章的纯文本（`chapterText`）跟 DOM 怎么折腾无关：`<mark>` 里的字还是那些字、
 * 顺序还是那个顺序。所以 {href, start, end} 三个数就能还原位置，且永远稳定。
 *
 * 代价是"定位"时要把纯文本下标换算回 DOM —— 就是顺着文本节点累加长度（markAt 已经在做）。
 */
export type BookNote = {
  id: string;
  bookId: string;
  /** 哪一章（不带 #） */
  href: string;
  /** 在这一章的纯文本里，从第几个字到第几个字 */
  start: number;
  end: number;
  /** 划到的原文。存一份，右栏列表就不用为了显示那句话去查 DOM 了 */
  quote: string;
  /** 人写的想法。空串 = 只是划了重点，没写字 */
  text: string;
  /** 哪一章的标题（用于列表分组；目录本来就应该 dupe 一份，删书时不必留） */
  label: string;
  at: string;
};

/**
 * 正文字体。**只能是系统字体栈**（见 readerstyle.ts 的理由：打包中文字体要十几 MB）。
 * 取值本身在这里定义 —— 它要落库，边界由存它的这一层定。
 */
export type ReaderFontId = 'sans' | 'serif' | 'kai' | 'mono';

/** 纸色（连带字色）五档：纯白 / 米黄 / 夜间 / 豆绿 / 淡青 */
export type ReaderThemeId = 'paper' | 'sepia' | 'night' | 'green' | 'cyan';

/*
 * 阅读器的排版偏好。一条记录存所有书共用的一套（`prefs` 表里键为 'reader'）——
 * 排版跟着**人**走，不跟着某一本书走。
 *
 * ⚠️ 加字段要照顾两件事：
 *   ① 老库里那条记录没有新字段 → getPrefs 用 DEFAULT_PREFS 兜一层（下面做了）；
 *   ② 取值范围要有唯一判定的地方 → 见 lib/readerstyle.ts 的 clampPrefs，
 *      阅读器和设置页两处入口都过它，不让两边各自 clamp 出两套上下限。
 */
export type ReaderPrefs = {
  /** 正文字号（px） */
  fontSize: number;
  /** 行距倍数 */
  lineHeight: number;
  /** 背景 / 纸色。五档，见 readerstyle.ts 的 READER_THEMES */
  theme: ReaderThemeId;
  /** 正文字体。**只能是系统字体栈** —— 打包一个中文字体要十几 MB */
  font: ReaderFontId;
};

/** 出厂排版。真正的定义在 readerstyle.ts（它跟选项表是一回事），这里转出一手给存储层用 */
export { DEFAULT_PREFS } from './readerstyle';

const DB_NAME = 'suisui-books';
/** v2：加了 `notes`（批注）。老库升级时自动建表 + 建 bookId 索引，不用迁移数据 */
const DB_VERSION = 2;
const S_BOOKS = 'books';
const S_BYTES = 'bytes';
const S_PROGRESS = 'progress';
const S_PREFS = 'prefs';
const S_NOTES = 'notes';

let dbPromise: Promise<IDBDatabase> | null = null;

/** 打开（只开一次，之后复用）。隐私模式下 IndexedDB 会被禁用 —— 那种情况报个明白话 */
function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('这个浏览器禁用了本地数据库（隐私模式？），书架用不了'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(S_BOOKS)) d.createObjectStore(S_BOOKS, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(S_BYTES)) d.createObjectStore(S_BYTES);
      if (!d.objectStoreNames.contains(S_PROGRESS)) d.createObjectStore(S_PROGRESS, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(S_PREFS)) d.createObjectStore(S_PREFS);
      if (!d.objectStoreNames.contains(S_NOTES)) {
        const notes = d.createObjectStore(S_NOTES, { keyPath: 'id' });
        // 按书查 —— 打开一本书要列它的全部批注；没有这个索引就得全表扫
        notes.createIndex('byBook', 'bookId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打不开本地书架'));
  });
  return dbPromise;
}

/** 把 IDBRequest 包成 Promise —— 上面那套 onsuccess/onerror 写四遍就没法看了 */
function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('读写书架失败'));
  });
}

function tx(d: IDBDatabase, stores: string[], mode: IDBTransactionMode) {
  return d.transaction(stores, mode);
}

export async function listBooks(): Promise<BookMeta[]> {
  const d = await db();
  const all = (await wrap(tx(d, [S_BOOKS], 'readonly').objectStore(S_BOOKS).getAll())) as BookMeta[];
  // 后加的排前面：新书在书架上找得到，不用滚到底
  return all.sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
}

export async function putBook(meta: BookMeta, bytes: ArrayBuffer): Promise<void> {
  const d = await db();
  const t = tx(d, [S_BOOKS, S_BYTES], 'readwrite');
  t.objectStore(S_BOOKS).put(meta);
  t.objectStore(S_BYTES).put(bytes, meta.id);
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('存书失败'));
    t.onabort = () => reject(t.error ?? new Error('存书失败'));
  });
}

/** 取原始 epub 字节 —— 只在真要打开这本书时才调 */
export async function getBookBytes(id: string): Promise<ArrayBuffer | null> {
  const d = await db();
  const got = await wrap(tx(d, [S_BYTES], 'readonly').objectStore(S_BYTES).get(id));
  return (got as ArrayBuffer | undefined) ?? null;
}

/** 删书：记录、字节、进度、批注四处一起清 —— 留着任何一样都是孤儿数据 */
export async function removeBook(id: string): Promise<void> {
  const d = await db();
  const t = tx(d, [S_BOOKS, S_BYTES, S_PROGRESS, S_NOTES], 'readwrite');
  t.objectStore(S_BOOKS).delete(id);
  t.objectStore(S_BYTES).delete(id);
  t.objectStore(S_PROGRESS).delete(id);
  // 批注跟着书一起走 —— 书没了，它划的那些地方也就没处落了
  const notes = t.objectStore(S_NOTES);
  const keys = (await wrap(notes.index('byBook').getAllKeys(id))) as IDBValidKey[];
  for (const k of keys) notes.delete(k);
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('删书失败'));
  });
}

export async function getProgress(id: string): Promise<BookProgress | null> {
  const d = await db();
  const got = await wrap(tx(d, [S_PROGRESS], 'readonly').objectStore(S_PROGRESS).get(id));
  return (got as BookProgress | undefined) ?? null;
}

export async function putProgress(p: BookProgress): Promise<void> {
  const d = await db();
  const t = tx(d, [S_PROGRESS], 'readwrite');
  t.objectStore(S_PROGRESS).put(p);
  await new Promise<void>((resolve) => {
    t.oncomplete = () => resolve();
  });
}

export async function getPrefs(): Promise<ReaderPrefs> {
  const d = await db();
  const got = await wrap(tx(d, [S_PREFS], 'readonly').objectStore(S_PREFS).get('reader'));
  return clampPrefs(got as Partial<ReaderPrefs> | undefined);
}

export async function putPrefs(p: ReaderPrefs): Promise<void> {
  const d = await db();
  const t = tx(d, [S_PREFS], 'readwrite');
  // 写之前过一遍守卫：存进去的东西下次就要被当成合法值读出来，脏值该拦在门口
  t.objectStore(S_PREFS).put(clampPrefs(p), 'reader');
  await new Promise<void>((resolve) => {
    t.oncomplete = () => resolve();
  });
}

export function newBookId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ── 批注 ── */

/** 一本书的全部批注，按**正文顺序**（ spine 的先后，同一章里按出现位置）排好 */
export async function listNotes(bookId: string): Promise<BookNote[]> {
  const d = await db();
  const all = (await wrap(
    tx(d, [S_NOTES], 'readonly').objectStore(S_NOTES).index('byBook').getAll(bookId),
  )) as BookNote[];
  return sortNotes(all);
}

/**
 * 排序：spineOrder 给出每章在正文里的先后，同一章内起点靠前的排前面。
 *
 * 为什么要有这一层排序：IDB 里记录是按 id 排的，直接吐出来列表会是乱的 ——
 * 右边一列批注东一句西一句，等于没法当清单用。
 */
export function sortNotes(
  notes: readonly BookNote[],
  spineOrder?: readonly string[],
): BookNote[] {
  const order = new Map((spineOrder ?? []).map((h, i) => [h, i]));
  return [...notes].sort((a, b) => {
    const ia = order.get(a.href) ?? Number.MAX_SAFE_INTEGER;
    const ib = order.get(b.href) ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    if (a.start !== b.start) return a.start - b.start;
    return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
  });
}

export async function putNote(n: BookNote): Promise<void> {
  const d = await db();
  const t = tx(d, [S_NOTES], 'readwrite');
  t.objectStore(S_NOTES).put(n);
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('存批注失败'));
    t.onabort = () => reject(t.error ?? new Error('存批注失败'));
  });
}

export async function dropNote(id: string): Promise<void> {
  const d = await db();
  const t = tx(d, [S_NOTES], 'readwrite');
  t.objectStore(S_NOTES).delete(id);
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('删批注失败'));
    t.onabort = () => reject(t.error ?? new Error('删批注失败'));
  });
}

export function newNoteId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
