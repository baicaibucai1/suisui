/*
 * 把本机的一批 .md 文件**读成能进库的东西**。
 *
 * 这一层只做两件不含界面的事：
 *   ① **解码**：文件是一堆字节，utf-8 读不通就换 gb18030（Windows 上大量老 md 是 GBK，
 *      不兜底就是满屏问号）；
 *   ② **命名**：文件名 → 库里的路径。
 *
 * 为什么单独一个文件：这两件事都是**会被写错、错了还不容易看出来**的 ——
 * 乱码只在打开那一篇时才暴露，重名覆盖更是直接丢东西。它们该待在一个能被
 * 单元测试直接 import 的地方（`tests/mdimport.test.mjs`），而不是埋在组件里。
 *
 * **命名**不在这里 —— 那归 `note.ts`（`importBase` / `importPath`），因为落库路径的规矩
 * （非法字符、重名 -2）是它定的，再写一份就会走散。这里只管"这个文件收不收、
 * 字节怎么变文字"。
 *
 * ⚠️ 这里不碰 DOM、不碰 store、不读 IndexedDB，也不 import 别的 lib ——
 * 单测是拿 Node 直接跑 .ts 的，Node 的 ESM 不做后缀补全（见 note.ts 顶上的说明）。
 */

/** 认这些后缀。`txt` 也认：很多人拿它当草稿，内容就是纯文本 */
export const MD_EXTS = ['.md', '.markdown', '.mdown', '.txt'];

/**
 * 是不是要收的文件。
 *
 * 只按**后缀**判，不看 MIME —— 浏览器给 .md 的 type 各家都不一样（'' / text/markdown /
 * text/plain），拿它当门槛会把文件拦在门外，而且用户看不懂为什么。
 */
export function isMdName(name: string): boolean {
  const lower = name.toLowerCase();
  return MD_EXTS.some((e) => lower.endsWith(e));
}

/** 去掉已知后缀。`我的笔记.md` → `我的笔记`；没有后缀就原样返回 */
export function stripExt(name: string): string {
  const lower = name.toLowerCase();
  for (const e of MD_EXTS) {
    if (lower.endsWith(e)) return name.slice(0, name.length - e.length);
  }
  return name;
}

/*
 * 字节 → 文本。三段，顺序是刻意的：
 *
 *   ① 先按 **严格** utf-8 解。带 BOM 的文件会解出开头的 U+FEFF，剥掉。
 *   ② 解不动（fatal 抛错）→ 它肯定不是 utf-8 → 换 gb18030。
 *   ③ 连 gb18030 都出替换字符（U+FFFD）→ 那就真不是文本（或者是别的编码），
 *      退回**非严格** utf-8：至少不丢字节，界面上能看出"这篇不对劲"，
 *      而不是直接变成一篇空白。
 *
 * ⚠️ 判据用"有没有 U+FFFD"而不是"解没解出来"：gb18030 几乎能把任何字节序列
 * 解出字来（所以它永远"成功"），只有替换字符能说明它其实没解对。
 */
export function decodeMarkdown(bytes: Uint8Array): string {
  const utf8 = tryUtf8(bytes);
  if (utf8 !== null) return utf8;

  const gbk = tryDecode(bytes, 'gb18030');
  if (gbk !== null && !gbk.includes('\uFFFD')) return gbk;

  // 兜底：非严格 utf-8。解不出的字节会变成 U+FFFD，人眼看得见
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

/** 严格 utf-8：解不通返回 null（而不是返回一堆 U+FFFD 让调用方猜） */
function tryUtf8(bytes: Uint8Array): string | null {
  const s = tryDecode(bytes, 'utf-8', true);
  if (s === null) return null;
  const clean = s.replace(/^\uFEFF/, '');
  // 能解通但里面全是替换字符 = 多半不是 utf-8，交给下一档
  return clean.includes('\uFFFD') ? null : clean;
}

function tryDecode(bytes: Uint8Array, enc: string, fatal = false): string | null {
  try {
    return new TextDecoder(enc, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}

/** 一次导入的账：建出来哪些、其中哪些是因为重名才换了名字的 */
export type ImportReport = { made: string[]; renamed: string[] };
