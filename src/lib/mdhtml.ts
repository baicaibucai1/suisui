/*
 * md → HTML（只给 `![[某篇]]` 嵌正文用）。
 *
 * ⚠️ **必须懒加载，所以这个文件里不许有顶部的 `import ... from 'micromark'`。**
 * micromark + gfm 那套压完还有几十 KB，而"嵌一篇笔记的正文"是大多数会话用不到的功能 ——
 * 静态 import 会让每个打开应用的人都为它付首屏体积。
 * 所以只有 `loadMdRenderer()` 里的动态 import，第一次真碰到"嵌的是笔记"才去拉。
 * 拉回来之后缓在模块作用域，后续同步调用（装饰重算是同步的，等不了 await）。
 *
 * 用 micromark 而不是引 marked / markdown-it：它本来就是 Milkdown 的传递依赖，
 * 已经在 node_modules 里躺着，不新增任何一个包。默认行为也正合需要 ——
 * 原样 HTML 被转义、`javascript:` 协议被清空，嵌进来的正文不可能带脚本。
 */

type Renderer = (md: string) => string;

/** 渲染好之后缓在这儿。装饰重算是同步的，只能吃这个缓存。 */
let renderer: Renderer | null = null;
/** 拉过一次就别重复拉（哪怕失败也别每次都试，否则每敲一个字都发一次请求） */
let loading: Promise<void> | null = null;

export function mdRendererReady(): boolean {
  return renderer !== null;
}

/** 把 micromark 拉起来。resolve 之后 `mdToHtml` 就能用了。 */
export function loadMdRenderer(): Promise<void> {
  if (renderer) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      const [{ micromark }, { gfm, gfmHtml }] = await Promise.all([
        import('micromark'),
        import('micromark-extension-gfm'),
      ]);
      const ext = gfm();
      const htmlExt = gfmHtml();
      renderer = (md) => micromark(md, { extensions: [ext], htmlExtensions: [htmlExt] });
    })().catch(() => {
      // 拉失败就退回"什么都不渲染"：嵌入区显示抬头 + 一行提示，比让整篇炸掉好
      renderer = () => '';
    });
  }
  return loading;
}

/**
 * 同步渲染。没就绪（还没 load）时返回空串 ——
 * 调用方在 `loadMdRenderer()` 完成后要 `refreshWiki(view)` 一次，让装饰重算补上。
 */
export function mdToHtml(md: string): string {
  return renderer ? renderer(md) : '';
}

/** HTML 属性 / 文本里要转义的五个字符。我们自己拼片段时用。 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}