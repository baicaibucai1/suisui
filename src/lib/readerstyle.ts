/*
 * 阅读排版的**选项表与取值守卫**。
 *
 * 这一层单独存在的理由：同一个偏好现在有两个入口 —— 阅读器抬头那个「Aa」面板
 * （读的时候顺手调）和设置里的「阅读」一小节（一次性调齐）。两处若各自写一套
 * 「字体列表」「字号上下限」，早晚有一个地方会跑出另一种范围：
 * 面板里能放到 32px，设置里卡在 28px，用户只是在描述不同的两件事。
 * 所以名单和边界都只在这一处，两个入口都只是读它。
 *
 * ⚠️ 这里**不引任何组件**，也不碰 IndexedDB 的读写（那是 bookdb 的事）：
 * 它是纯数据 + 纯函数，`tests/readerstyle.test.mjs` 能在没有浏览器、没有 DOM
 * 的情况下直接 import 它 —— 取值守卫这种东西正该落在这种能被单独测的地方。
 */
import type { ReaderFontId, ReaderPrefs, ReaderThemeId } from './bookdb';

/** 出厂排版：第一次打开任何一本书、以及归一失败时的兜底值 */
export const DEFAULT_PREFS: ReaderPrefs = {
  fontSize: 17,
  lineHeight: 1.85,
  theme: 'paper',
  font: 'sans',
};

/*
 * 字号的上下限。
 * 下限 13px：再小中文就开始发糊（宋体在 12px 以下会被系统切成点阵字形）。
 * 上限 28px：再大就没这个必要了 —— 那是给弱视读屏的手持设备准备的档位，
 * 而这个软件的正文宽度是固定的 46em，字号再涨只是把一页拆成更多屏。
 */
export const FONT_MIN = 13;
export const FONT_MAX = 28;

/** 行距上下限。低于 1.4 中文成行贴行看着累；高于 2.4 就散了，找不到行首 */
export const LINE_MIN = 1.4;
export const LINE_MAX = 2.4;

/**
 * 字体四档。**全是系统字体栈** —— 一个中文字体压缩之后还是十几 MB
 * （思源黑体完整包 ~16MB，就算子集化常用的 3500 字也要 3MB 往上），
 * 而阅读器按需加载那一层努力了半天才把包压到十几 KB。
 * 代价是"这台机器上没有这个字体"时会退到下一档 —— 这正是列表里 `css`
 * 写**一整串候选**而不是一个字体名的原因。
 */
export const READER_FONTS: { id: ReaderFontId; label: string; hint: string; css: string }[] = [
  { id: 'sans', label: '黑体', hint: '跟界面同一套，看着最服帖', css: 'var(--font-read-sans)' },
  { id: 'serif', label: '宋体', hint: '有衬线，长文读起来稳', css: 'var(--font-read-serif)' },
  { id: 'kai', label: '楷体', hint: '手写气，读散文随笔合适', css: 'var(--font-read-kai)' },
  { id: 'mono', label: '等宽', hint: '技术书里代码和表格对得齐', css: 'var(--font-read-mono)' },
];

/*
 * 纸色五档。`bg` / `ink` / `link` 都取自 styles.css 的令牌（不在此写裸 hex）——
 * 这样三组颜色只在样式表里落一次：正文那一边由选择器套上去，设置页的预览方块内联引它。
 *
 * ⚠️ 每一档都必须自己带着字色：背景**变了而字色不变**的组合至少有一种会看不见
 * （白纸上的 #121212 放到夜间那块 #17181a 上就是黑字黑底）。这条当初是用
 * 「夜间模式下批注底色消失了」的 bug 换来的教训。
 */
export const READER_THEMES: {
  id: ReaderThemeId;
  label: string;
  /** 纸色 */
  bg: string;
  /** 正文墨色 */
  ink: string;
  /** 书里链接的颜色 */
  link: string;
}[] = [
  {
    id: 'paper',
    label: '纯白',
    bg: 'var(--color-read-paper)',
    ink: 'var(--color-read-paper-ink)',
    link: 'var(--color-read-paper-link)',
  },
  {
    id: 'sepia',
    label: '米黄',
    bg: 'var(--color-read-sepia)',
    ink: 'var(--color-read-sepia-ink)',
    link: 'var(--color-read-sepia-link)',
  },
  {
    id: 'night',
    label: '夜间',
    bg: 'var(--color-read-night)',
    ink: 'var(--color-read-night-ink)',
    link: 'var(--color-read-night-link)',
  },
  {
    id: 'green',
    label: '豆绿',
    bg: 'var(--color-read-green)',
    ink: 'var(--color-read-green-ink)',
    link: 'var(--color-read-green-link)',
  },
  {
    id: 'cyan',
    label: '淡青',
    bg: 'var(--color-read-cyan)',
    ink: 'var(--color-read-cyan-ink)',
    link: 'var(--color-read-cyan-link)',
  },
];

const FONT_IDS = new Set(READER_FONTS.map((f) => f.id));
const THEME_IDS = new Set(READER_THEMES.map((t) => t.id));

/** 取一档的配置，认不出来就给第一档 —— 让坏值退化成"选中最靠前那一项"而不是白屏 */
export function themeOf(id: ReaderThemeId | undefined | null) {
  return READER_THEMES.find((t) => t.id === id) ?? READER_THEMES[0];
}

export function fontOf(id: ReaderFontId | undefined | null) {
  return READER_FONTS.find((f) => f.id === id) ?? READER_FONTS[0];
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 把**任何来源**的偏好归一成一份合法值：旧版本的库记录（没有 font）、
 * 被人手改过的数据、都不该当场炸掉。
 *
 * 为什么非要有这一道：阅读器和设置页读的是同一份 store 状态，但那份状态
 * 最初是从 IndexedDB 里捡回来的 —— 那儿存的东西可能是上一个版本写下的。
 */
export function clampPrefs(p: Partial<ReaderPrefs> | null | undefined): ReaderPrefs {
  const raw = p ?? {};
  return {
    fontSize: Math.round(num(raw.fontSize, DEFAULT_PREFS.fontSize, FONT_MIN, FONT_MAX)),
    lineHeight: num(raw.lineHeight, DEFAULT_PREFS.lineHeight, LINE_MIN, LINE_MAX),
    theme: THEME_IDS.has(raw.theme as ReaderThemeId)
      ? (raw.theme as ReaderThemeId)
      : DEFAULT_PREFS.theme,
    font: FONT_IDS.has(raw.font as ReaderFontId)
      ? (raw.font as ReaderFontId)
      : DEFAULT_PREFS.font,
  };
}

/** 正负一档地调字号 / 行距，顺手夹边界 —— 面板上的 +/- 两个按钮用它 */
export function stepFontSize(cur: number, delta: number): number {
  return clampPrefs({ ...DEFAULT_PREFS, fontSize: cur + delta }).fontSize;
}
