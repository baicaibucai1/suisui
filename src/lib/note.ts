// 「创建笔记」的命名规则 —— 零依赖纯函数，Node 24 可直接 import 做单测：
//   node tests/note.test.mjs
// 中文标题原样进文件名（仓库里已有 thoughts/2026-09-21-开张.md 这种），
// 只挡各平台的文件名非法字符、超长、以及和已有文件重名。
//
// ⚠️ **别在这里 import rich.ts。** 单测是拿 Node 直接跑 .ts 的，Node 的 ESM 不做
// 后缀补全，`from './rich'` 会当场找不到模块；写成 `'./rich.ts'` 又要开
// allowImportingTsExtensions。所以两个 lib 之间不许互相 import，
// 「选哪种正文」的一行分发放在 store 里（那里走 bundler，没有这个限制）。

/** 笔记会落进的目录。drafts 不进 README 目录（见 碎碎/scripts/update-index.mjs 的 SCAN_DIRS）。 */
export const NOTE_DIRS = [
  { dir: 'thoughts', label: '碎念', hint: 'thoughts/ · 日常碎念' },
  { dir: 'notes', label: '随笔', hint: 'notes/ · 随手记' },
  { dir: 'excerpts', label: '摘抄', hint: 'excerpts/ · 别人的话，抄下来' },
  { dir: 'drafts', label: '草稿', hint: 'drafts/ · 没写完的，不进 README 目录' },
] as const;

export type NoteDir = (typeof NOTE_DIRS)[number]['dir'];

// Windows / Android 都不接受这些字符；控制字符一并清掉
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const MAX_SLUG = 40;

const pad = (n: number) => String(n).padStart(2, '0');

/** 本地时区的 YYYY-MM-DD。**别用 toISOString** —— 那是 UTC，晚上会差一天。 */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 本地时区的 HH-mm（文件名里不能有冒号）。 */
export function localTime(d: Date = new Date()): string {
  return `${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

/** 标题 → 文件名片段。空白收成 `-`，非法字符删掉，首尾的 `-` / `.` 去掉。 */
export function slugifyNoteTitle(title: string): string {
  const s = title
    .replace(ILLEGAL, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '');
  // 按码点截断，别把 emoji 劈成半个
  return Array.from(s).slice(0, MAX_SLUG).join('').replace(/[-.]+$/, '');
}

/**
 * 落库路径。标题为空时退化成 `日期-时刻`，保证永远能建出一篇。
 *
 * `ext` 由调用方给（md / rich），**不在这里写死** —— 否则加了新格式还得改命名逻辑。
 */
export function notePath(dir: string, title: string, d: Date = new Date(), ext = 'md'): string {
  const slug = slugifyNoteTitle(title);
  const name = slug ? `${localDate(d)}-${slug}` : `${localDate(d)}-${localTime(d)}`;
  return `${dir.replace(/[/\\]+$/, '')}/${name}.${ext.replace(/^\./, '')}`;
}

/** 重名就加 `-2` `-3`…，**绝不覆盖已有笔记**。后缀按原样保留。 */
export function dedupePath(path: string, exists: (p: string) => boolean): string {
  if (!exists(path)) return path;
  // 后缀必须从原路径里取，不能写死 .md —— 否则 notes/a.rich 会被去重成 notes/a-2.md，
  // 格式当场换了一种
  const m = path.match(/^(.*?)(\.[a-z0-9]+)$/i);
  const base = m ? m[1] : path;
  const ext = m ? m[2] : '';
  for (let i = 2; i <= 999; i++) {
    const p = `${base}-${i}${ext}`;
    if (!exists(p)) return p;
  }
  return `${base}-${Date.now()}${ext}`;
}

/** 新 md 笔记的初始正文：标题当 H1，光标之后留给用户。（稿纸的正文在 rich.ts） */
export function noteBody(title: string): string {
  const t = title.trim();
  return t ? `# ${t}\n\n` : '';
}
