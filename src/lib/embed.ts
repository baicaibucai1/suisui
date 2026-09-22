/*
 * `![[某篇笔记]]` 怎么变成一段看得见的正文 —— 零依赖纯函数，Node 可直接 import 做单测：
 *   node tests/embed.test.mjs
 *
 * ⚠️ **别在这里 import 任何东西**（理由同 links.ts / note.ts）：单测是拿 Node 直接跑 .ts 的，
 * Node 的 ESM 不做后缀补全，`from './links'` 会当场找不到模块。
 * 所以解析、读文件、md→html 全部从外面**注入**进来（`ctx`），这个文件只负责拼装。
 *
 * 三条定死的规则：
 *
 * 1. **渲染出来的是纯 DOM 片段，不回写文档树。** 嵌入画在 decoration 的 widget 里，
 *    文档里那几个字（`![[某篇]]`）一个字节没动 —— 跟 `[[双链]]` 同一条原则：
 *    落盘还是纯文本，别的 markdown 软件打开不会看到怪东西（见 lib/links.ts 第 1 条）。
 * 2. **串行渲染到 depth 上限就停，而且认「这一条链上已经出现过的篇」。**
 *    两种防法缺一不可：只看深度的话 A→B→A 会撑满两层才停（读起来像卡了），
 *    只看环的话 A→B→C→D→…→A 这种长环还是挡不住。
 * 3. **被嵌那篇的 `#标题` 会降级成加粗一行，不是真标题。** 不然嵌进来的 h1
 *    和本文的 h1 长得一模一样，层级当场乱掉。
 */

/** 最多往下展开几层。0 = 直接嵌的那一篇；到上限就不再展开它里面的嵌入。 */
export const MAX_EMBED_DEPTH = 2;

/** 一个嵌入目标解析出来的东西 —— 由调用方查库得到（这个文件不认识 files）。 */
export type Resolved = {
  /** 库里那份的真实路径 */
  path: string;
  /** 显示名（文件名去后缀） */
  name: string;
  /** 图片给一个能直接塞 `<img src>` 的地址；不是图片给 null */
  url: string | null;
  /** 附件（图片 / PDF）：点一下打开预览，而不是嵌正文 */
  isAsset: boolean;
  isImage: boolean;
  /** 那篇的正文（只有 md 笔记才有；附件是 base64，不给） */
  body?: string;
};

export type EmbedCtx = {
  /** 名字 → 解析结果；库里没有就返回 null（画虚线占位） */
  resolve: (target: string) => Resolved | null;
  /** 当前深度，0 = 直接嵌的那一篇 */
  depth: number;
  /**
   * 这条链上**已经展开过**的路径。A 嵌 B、B 又嵌 A 时，第二回到 A 就不再展开 ——
   * 只靠深度上限会白渲染一层，读起来像"这段怎么又出现一遍"。
   */
  chain: string[];
  /** md 正文 → HTML。注入进来是为了单测能塞一个假的（不引 micromark）。 */
  mdToHtml: (md: string) => string;
  /** 名字 → 行内显示文字（`|别名` 已经由调用方处理掉） */
  escape: (s: string) => string;
};

/**
 * 被嵌那篇的正文里，**行内**的嵌入 / 链接要画成什么。
 *
 * ⚠️ 这里必须走**占位符**，不能直接把 HTML 塞回正文再交给 md 渲染器。
 * 原因：micromark 默认把"原样 HTML"转义（安全默认），我们拼的 `<img src=...>` /
 * `<span class="su-note">` 会被它输出成 `&lt;img ...&gt;` —— 嵌进去的图当场变一行源码。
 * 真实踩过（单测那条「尖括号不变标签」就是这么抓出来的）。
 *
 * 所以流程是：先把嵌入换成纯字母数字的占位符（不会被转义）→ 交给渲染器 →
 * 再把占位符换回 HTML。段落级别的嵌入（独成一行）连外面那层 `<p>` 一起换掉，
 * 免得块级内容塞在 `<p>` 里。
 *
 * ⚠️ 前提是进来的文本**已经剥掉代码段**（`stripCode`）：代码块里的 `![[x]]` 是例子，
 * 不该被展开。
 */
function expandInline(md: string, ctx: EmbedCtx): string {
  const parts: string[] = [];
  const hold = (html: string) => {
    parts.push(html);
    return `%%SUEMBED${parts.length - 1}%%`;
  };

  // `![[a]]` → 图 / 卡片 / 递归展开的正文
  let src = md.replace(/!\[\[([^[\]\n]+?)\]\]/g, (raw, inner: string) => {
    const target = inner.split('|')[0].trim();
    if (!target) return raw;
    const r = ctx.resolve(target);
    if (!r) return hold(`<span class="su-note-miss">${ctx.escape(target)}</span>`);
    if (r.isImage && r.url) {
      return hold(`<img src="${ctx.escape(r.url)}" alt="${ctx.escape(r.name)}" class="su-embed-img">`);
    }
    if (r.isAsset || !r.body) {
      return hold(`<span class="su-note-file" data-note-open="${ctx.escape(r.path)}">▣ ${ctx.escape(r.name)}</span>`);
    }
    // 笔记：能展开就展开，超出上限 / 成环就退回一张卡片
    const stop = ctx.depth >= MAX_EMBED_DEPTH || ctx.chain.includes(r.path);
    if (stop) {
      return hold(`<span class="su-note-file" data-note-open="${ctx.escape(r.path)}">▤ ${ctx.escape(r.name)}</span>`);
    }
    return hold(renderNote(r, ctx));
  });

  // `[[a]]` 在嵌进来的正文里只是个名字 —— 点不动（只读片段），画成链接色
  src = src.replace(/\[\[([^[\]\n]+?)\]\]/g, (raw, inner: string) => {
    const { target, display } = splitInline(inner);
    if (!target) return raw;
    const r = ctx.resolve(target);
    const label = display || r?.name || target;
    if (!r) return hold(`<span class="su-note-link su-note-link-new">${ctx.escape(label)}</span>`);
    return hold(`<span class="su-note-link" data-note-open="${ctx.escape(r.path)}">${ctx.escape(label)}</span>`);
  });

  let html = ctx.mdToHtml(src);

  // 独成一段的嵌入：连 `<p>` 一起换，别把块级内容留在段落里
  html = html.replace(/<p>\s*%%SUEMBED(\d+)%%\s*<\/p>/g, (_m, i: string) => parts[Number(i)] ?? '');
  // 段落中间的：就地换成行内片段
  html = html.replace(/%%SUEMBED(\d+)%%/g, (_m, i: string) => parts[Number(i)] ?? '');
  // 标题降级：嵌进来的 h1 不能跟本文的打架。放在最后 —— 占位符换回来的片段里
  // 也可能有标题（更深的层级），一把降完。
  return demoteHeadings(html);
}

/** `[[笔记#小节|显示]]` → 拆三截。跟 links.ts 的 splitWiki 同一套规矩，但那边不能 import。 */
function splitInline(inner: string): { target: string; heading: string; display: string } {
  let t = inner;
  let display = '';
  const bar = t.indexOf('|');
  if (bar >= 0) {
    display = t.slice(bar + 1).trim();
    t = t.slice(0, bar);
  }
  let heading = '';
  const hash = t.indexOf('#');
  if (hash >= 0) {
    heading = t.slice(hash + 1).trim();
    t = t.slice(0, hash);
  }
  return { target: t.trim(), heading, display };
}

/** 把标题层级降一级：`#` 变加粗一行，免得嵌进来的大标题跟本文的打架。 */
function demoteHeadings(html: string): string {
  return html.replace(/<h([1-6])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g, (_m, _lvl, attrs = '', text: string) => {
    return `<p class="su-note-h"${attrs}>${text}</p>`;
  });
}

/** 一篇笔记展开出来的整块：抬头（名字 + 打开原文）+ 正文。 */
function renderNote(r: Resolved, ctx: EmbedCtx): string {
  const inner: EmbedCtx = { ...ctx, depth: ctx.depth + 1, chain: [...ctx.chain, r.path] };
  // 正文自己也走一遍 expandInline（里面可能还有 `![[ ]]`）—— 递归在这里收敛
  const html = expandInline(r.body ?? '', inner);
  return (
    `<span class="su-note" data-note-embed="${ctx.escape(r.path)}">` +
    `<span class="su-note-head">` +
    `<span class="su-note-title">${ctx.escape(r.name)}</span>` +
    `<span class="su-note-open" data-note-open="${ctx.escape(r.path)}">打开原文</span>` +
    `</span>` +
    `<span class="su-note-body">${html}</span>` +
    `</span>`
  );
}

/**
 * 入口：把一个 `![[目标]]` 渲染成 DOM 片段。
 *
 * 返回 null = 库里还没这个文件 —— 调用方画虚线占位（跟附件那条路一致）。
 * 顶层（depth 0）的**附件**由调用方自己处理：图片要 blob URL，卡片要接点击，
 * 那些都要拿到真 DOM 才好办，不在这个纯函数里做。
 */
export function renderEmbed(target: string, ctx: EmbedCtx): string | null {
  const r = ctx.resolve(target);
  if (!r) return null;
  if (r.isAsset || !r.body) return null;
  if (ctx.depth >= MAX_EMBED_DEPTH || ctx.chain.includes(r.path)) return null;
  return renderNote(r, ctx);
}