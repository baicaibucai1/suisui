/**
 * 「稿纸」—— 碎碎里的第二种文字格式，和 md 并列，不互转。
 *
 * md 是纯文本、随处置；稿纸是 **HTML 片段 + 一段属于这篇自己的 CSS**，用来排版。
 * 文件（`.rich`）长这样：
 *
 *     <style>
 *     :scope { --note-accent: #8a6f45; }
 *     h1 { letter-spacing: 0.02em; }
 *     </style>
 *     <h1>标题</h1>
 *     <p>正文</p>
 *
 * 几条不肯让步的约定：
 *
 * 1. **文件本身就是合法 HTML。** 把它改名成 `.html` 丢进浏览器，应该长得跟在这里
 *    看到的一模一样。别加私有标记、别包 JSON —— 那样文件就只属于这个程序了。
 * 2. 顶部那个 `<style>` 是**这篇的私有样式**。渲染时整段包进 `@scope (.rich-scope)`，
 *    漏不到界面别处去。所以用户可以放心写 `h1 { ... }` 而不用管界面里的 h1。
 * 3. 默认排版样式必须写在 `@layer base` 里。`@scope` 内的选择器**不加特异性**，
 *    用户的 `h1{}` 只有 (0,0,1)，压不过 `.rich-scope h1`；靠图层顺序才能让用户赢。
 *    改 styles.css 时别忘了这条。
 * 4. **只动结构，不碰正文。** 和 mdkit 同一条原则。
 */

/** 文件后缀。刻意不用 `.html` —— 那会被 visible.ts 当成程序文件藏起来 */
export const RICH_EXT = 'rich';

/** 渲染容器的类名，同时是 @scope 的锚点和默认排版样式的挂载点 */
export const RICH_SCOPE = 'rich-scope';

export type NoteKind = 'md' | 'rich';
export const NOTE_KINDS: { id: NoteKind; label: string; ext: string; hint: string }[] = [
  { id: 'md', label: 'Markdown', ext: 'md', hint: '纯文本 · 随处置，换个编辑器也能读' },
  { id: 'rich', label: '稿纸', ext: RICH_EXT, hint: '富文本 · 用 CSS 排版，能改颜色字号' },
];

export function isRichPath(path: string): boolean {
  return path.toLowerCase().endsWith('.' + RICH_EXT);
}

export function isMdPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/** 「这篇的 CSS」—— 编辑器里也用它当占位提示，别写死两处 */
export const CSS_HINT = '写的样式只作用于这一篇。:scope 指整篇文档。';

// ---------- 拆 / 合 ----------

const STYLE_TAG = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

/**
 * 文件 → { 这篇的 CSS, 正文 HTML }。
 *
 * 顶部（其实任意位置）的 `<style>` 一律抽走当私有样式；剩下的就是正文。
 * 代价是正文里若贴了一段含 `</style>` 的代码示例会被误抽 —— 认了，
 * 比在文件里塞私有标记要好。
 */
export function splitRich(src: string): { css: string; html: string } {
  const parts: string[] = [];
  const html = src.replace(STYLE_TAG, (_all, css: string) => {
    parts.push(css);
    return '';
  });
  return { css: parts.join('\n').trim(), html: html.trim() };
}

/** splitRich 的逆：拼回文件内容。没有 CSS 时不写空的 `<style>`，文件干净些。 */
export function joinRich(css: string, html: string): string {
  const c = css.trim();
  const h = html.trim();
  if (!c) return h ? h + '\n' : '';
  return `<style>\n${c}\n</style>\n${h ? h + '\n' : ''}`;
}

/** 空白文档 —— 空 `<p><br></p>` 是 contenteditable 里唯一「点得进去」的空段落。 */
export function emptyDoc(): string {
  return '<p><br></p>\n';
}

/** 新稿纸的初始正文：标题当 H1。 */
export function richBody(title: string): string {
  const t = title.trim();
  return t ? `<h1>${escapeHtml(t)}</h1>\n${emptyDoc()}` : emptyDoc();
}

// ---------- 渲染 ----------

/**
 * 把用户写的 CSS 圈进本篇的作用域。
 *
 * `@scope` 是 Chrome 118+ 的能力（Tauri 的 WebView2 / 安卓 WebView 都是常青
 * Chromium，够用）。选它是因为 **它不给选择器加特异性** —— 用户写 `h1{}` 就是
 * `h1{}` 的分量，配合 styles.css 里的 `@layer base` 默认样式，用户永远压得住默认值。
 * 换成 `.rich-scope h1` 那种前缀法，用户不写 `!important` 就改不动默认样式了。
 */
export function scopedCss(css: string, scope = '.' + RICH_SCOPE): string {
  const body = css.trim();
  if (!body) return '';
  return `@scope (${scope}) {\n${body}\n}\n`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * HTML 清洗。用在两个地方：粘贴进来的内容、以及从远端拉下来的 `.rich`。
 *
 * ⚠️ 必须是 DOM 版的，别改成正则 —— 正则洗 HTML 是出了名的洗不干净。
 * Node 下（单测）没有 DOMParser，直接放过：那条路径不会渲染任何东西。
 */
const DROP_TAGS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
]);

export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<div id="rich-root">${html}</div>`, 'text/html');
  const root = doc.getElementById('rich-root');
  if (!root) return html;

  // 先取快照再删 —— 边遍历边改 DOM 会漏掉节点
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (DROP_TAGS.has(el.tagName.toLowerCase())) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on')) {
        // 粘贴进来的 <img onerror=…> 是真会跑的，innerHTML 挡不住
        el.removeAttribute(attr.name);
      } else if (/^\s*(javascript|vbscript):/i.test(value)) {
        el.removeAttribute(attr.name);
      } else if (name === 'style' && /expression\s*\(|javascript:/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return root.innerHTML;
}

// ---------- 主题预设 ----------

/**
 * 一键套用的 CSS。这不是「程序样式」，是**写进用户文档里的内容**，
 * 所以用裸 hex 是对的 —— 它得跟着文件走，不能依赖界面的设计令牌。
 */
export const RICH_PRESETS: { id: string; label: string; hint: string; css: string }[] = [
  { id: 'plain', label: '原纸', hint: '清空，回到默认排版', css: '' },
  {
    id: 'book',
    label: '书卷',
    hint: '衬线、首行缩进、居中标题',
    css: `:scope {
  font-family: Georgia, 'Songti SC', 'SimSun', serif;
  font-size: 16px;
  line-height: 2;
  color: #2f2a24;
  background: #fdfbf6;
  padding: 2.5rem 2.75rem;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(60, 48, 32, 0.08);
}
:scope h1 {
  text-align: center;
  font-size: 1.55em;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin-bottom: 1.6em;
}
:scope p {
  text-indent: 2em;
  margin: 0.5em 0;
}
:scope blockquote {
  text-indent: 0;
  border-left: 3px solid #d9c9a8;
  color: #6b5f4d;
  background: #f7f2e6;
}`,
  },
  {
    id: 'sticky',
    label: '便签',
    hint: '黄纸、圆角、像贴在显示器边上',
    css: `:scope {
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.9;
  color: #4a3f18;
  background: #fdf6d8;
  padding: 2rem 2.25rem;
  border-radius: 4px 4px 14px 4px;
  box-shadow: 3px 4px 0 #e8dfae, 0 10px 22px -10px rgba(80, 68, 20, 0.35);
}
:scope h1 {
  font-size: 1.35em;
  font-weight: 700;
  border-bottom: 2px dashed #d8cd96;
  padding-bottom: 0.4em;
}`,
  },
  {
    id: 'night',
    label: '夜读',
    hint: '深底浅字，行距放宽',
    css: `:scope {
  color: #d7d3cc;
  background: #1c1b19;
  padding: 2.5rem 2.75rem;
  border-radius: 12px;
  line-height: 2;
}
:scope h1,
:scope h2,
:scope h3 {
  color: #f2efe9;
}
:scope a {
  color: #8fb3d9;
}
:scope blockquote {
  border-left-color: #4a463f;
  color: #a5a099;
}
:scope code {
  background: #2a2825;
  border-color: #3a3733;
  color: #e0b088;
}`,
  },
  {
    id: 'card',
    label: '卡片',
    hint: '每段各成一张卡',
    css: `:scope p {
  background: #fffefd;
  border: 1px solid #e7e2db;
  border-radius: 10px;
  padding: 0.9em 1.1em;
  margin: 0.7em 0;
  box-shadow: 0 2px 8px -5px rgba(34, 31, 28, 0.22);
}
:scope h1 {
  font-size: 1.5em;
  letter-spacing: -0.01em;
}`,
  },
];

// ---------- 工具栏用到的命令与色板 ----------

/** 工具栏能下的命令。真正的 DOM 操作在 RichPane，这里只定义「有哪些」。 */
export type RichCmd =
  // 块级
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'quote'
  | 'code'
  | 'hr'
  // 行内
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'inlineCode'
  | 'link'
  // 段落
  | 'left'
  | 'center'
  | 'right'
  | 'ul'
  | 'ol'
  | 'indent'
  | 'outdent'
  // 样式
  | 'color'
  | 'bg'
  | 'size'
  | 'font'
  | 'card';

/** 光标处的状态快照，工具栏据此高亮。 */
export type RichActive = {
  block: 'p' | 'h1' | 'h2' | 'h3' | 'quote' | 'pre';
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  inlineCode: boolean;
  link: boolean;
  ul: boolean;
  ol: boolean;
  card: boolean;
  /** 生效中的颜色（computed，可能是 rgb(...) 也可能是空串） */
  color: string;
  bg: string;
};

export const EMPTY_RICH_ACTIVE: RichActive = {
  block: 'p',
  align: 'left',
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  inlineCode: false,
  link: false,
  ul: false,
  ol: false,
  card: false,
  color: '',
  bg: '',
};

/** 文字色。`''` = 恢复默认（交给这篇的 CSS 决定），不是"白色"。 */
export const INK_SWATCHES = [
  '#221f1c',
  '#6e6760',
  '#a39c94',
  '#ac4a3e',
  '#c2703a',
  '#96682a',
  '#4a7a5c',
  '#2f7f86',
  '#3d5d7d',
  '#5b4a7d',
  '#8a5a7a',
  '#8f8a2f',
];

export const BG_SWATCHES = [
  '#fff0a8',
  '#ffd9c8',
  '#d9f0d0',
  '#cfe4f7',
  '#e6dcf7',
  '#fbd7e6',
  '#e8e4de',
  '#efe9c8',
];

export const RICH_SIZES: { label: string; value: string }[] = [
  { label: '小', value: '13px' },
  { label: '正常', value: '' },
  { label: '大', value: '18px' },
  { label: '特大', value: '24px' },
  { label: '章标题', value: '30px' },
];

export const RICH_FONTS: { label: string; value: string }[] = [
  { label: '默认', value: '' },
  { label: '衬线', value: "Georgia, 'Songti SC', 'SimSun', serif" },
  { label: '无衬线', value: "'Segoe UI', system-ui, sans-serif" },
  { label: '楷体', value: "'Kaiti SC', 'KaiTi', 'STKaiti', serif" },
  { label: '等宽', value: "'Cascadia Mono', Consolas, 'Courier New', monospace" },
];

/**
 * `#abc` / `#aabbcc` → `rgb(r, g, b)`。
 * 用来把色板里的写法和 `getComputedStyle` 回来的值对上 —— 两边格式不一样，
 * 不归一化的话"当前是哪个颜色"永远高亮不出来。对不上就原样返回。
 */
export function toRgb(color: string): string {
  const s = color.trim().toLowerCase();
  if (!s.startsWith('#')) return s;
  let hex = s.slice(1);
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length !== 6) return s;
  const n = Number.parseInt(hex, 16);
  if (Number.isNaN(n)) return s;
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
