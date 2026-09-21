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
 * ⚠️ 这个模块**零依赖、不 import 任何其它 lib**：单测用 Node 直接跑 .ts，
 * Node 的 ESM 不做后缀补全，跨 lib import 会当场找不到模块（见 note.ts 的注释）。
 */

/** 文件夹标识文件的名字。改它等于换一套目录协议，老目录会全部"消失"—— 别随便改。 */
export const FOLDER_FILE = '.folder';

/** 单段目录名里各平台都不接受的字符（`/` 是分隔符，单独处理） */
const SEG_ILLEGAL = /[\\:*?"<>|\u0000-\u001f\u007f]/g;
const MAX_SEG = 60;

/**
 * 用户输入的目录名 → 干净的目录路径。
 * 返回 `''` 表示"这不能建"：空、全是分隔符、或者只剩 `..` 这种会跳出库的段。
 */
export function normalizeDir(input: string): string {
  const segs = String(input ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim().replace(SEG_ILLEGAL, ''))
    // `.` 是废段，`..` 会跳出库 —— 两个都不接受，而不是"净化成别的"
    .filter((s) => s && s !== '.' && s !== '..')
    // 按码点截断，别把 emoji 劈成半个；末尾的点在 Windows 上会被吞掉，先自己去掉
    .map((s) => Array.from(s).slice(0, MAX_SEG).join('').replace(/[. ]+$/, ''))
    .filter(Boolean);
  return segs.join('/');
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
    '这是「碎碎」给这个文件夹留的标识文件：它在，这个文件夹就在。\n' +
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
