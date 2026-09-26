/**
 * 「这个文件该不该出现在左侧」—— 纯展示层规则。
 *
 * ⚠️ 铁律：**永远不要拿这个函数去过滤同步用的 files。**
 * 三路判定是「本地 files × 上次快照 × 远端 tree」三方对账。若某个文件被过滤掉、
 * 没有进本地列表，判定会得出「基线里有、远端有、本地没有」= 本地删除，
 * 下一次同步就会把仓库里的程序文件真的删掉。
 * 同步一律走全量；这里只管渲染。
 */

/** 纯代码 / 配置 / 构建产物后缀 */
const PROGRAM_EXT = new Set([
  'bat',
  'cmd',
  'ps1',
  'sh',
  'bash',
  'zsh',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'vue',
  'svelte',
  'json',
  'jsonc',
  'yml',
  'yaml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'env',
  'lock',
  'properties',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'node',
  'map',
]);

/** 装代码的目录，整个不展示 */
const PROGRAM_DIR = new Set([
  'scripts',
  'script',
  'node_modules',
  'src',
  'public',
  'dist',
  'build',
  'tests',
  'test',
  'assets',
]);

/** 根目录下的仓库说明文件（索引脚本的工作文件，不是"QuitWriteRead"本身） */
const ROOT_META = new Set(['readme.md', 'readme', 'license', 'changelog.md']);

export function isProgramArtifact(path: string): boolean {
  const segs = path.split('/').filter(Boolean);
  if (segs.length === 0) return true;

  // 任何一段以点开头：.gitignore、.gitkeep、.github/… 一并盖住
  if (segs.some((s) => s.startsWith('.'))) return true;

  // 目录命中
  if (segs.slice(0, -1).some((d) => PROGRAM_DIR.has(d.toLowerCase()))) return true;

  const name = segs[segs.length - 1].toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (ext && PROGRAM_EXT.has(ext)) return true;

  // 根目录的 README / LICENSE 之类
  if (segs.length === 1 && ROOT_META.has(name)) return true;

  return false;
}

export function splitByVisibility<T>(paths: readonly T[], key: (item: T) => string) {
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const item of paths) (isProgramArtifact(key(item)) ? hidden : visible).push(item);
  return { visible, hidden };
}
