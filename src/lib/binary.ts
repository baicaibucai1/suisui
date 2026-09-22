/*
 * 附件（图片 / PDF）—— **二进制怎么在这个纯文本的应用里活着**。
 *
 * ## 一条总线
 *
 * `files` 是 `Record<string, string>`，本来只装文字。附件也塞进同一个 map，
 * 但存的是 **base64**（没有换行、没有 `data:` 前缀）。判断"这一条是文字还是附件"
 * 只看**路径后缀**，不额外加字段 —— 理由：FileMap / Snapshot 的形状不能变，
 * 快照是要跨版本持久化到 localStorage / 同步到远端的，多一个字段等于多一种历史格式。
 *
 * ## 三条不能破的规矩
 *
 * 1. **附件绝不能过 `normalizeText`**。它只动 BOM 和 CR，对 base64 其实无害，
 *    但一旦有人以后往里加 trim 之类，附件就悄悄坏了。所以同步链路里对附件
 *    **压根不调它**（sync.ts 里是按路径分派的）。
 * 2. **附件的指纹必须按**解码后的原始字节**算**。远端（GitHub）算的是文件字节的
 *    git blob sha，我们要是按 base64 字符串算，两边永远不等 → 每次同步都判成
 *    "本地改了"，附件会被无限来回推。
 * 3. **读附件必须走字节，不能走 `res.text()`**。浏览器会拿 UTF-8 去解二进制，
 *    解不出来的字节直接变成 U+FFFD —— 那不是"有点脏"，是文件彻底毁了，
 *    而且不可逆（推上去就把远端那份也覆盖了）。
 */

/** 图片后缀。svg 也算：它是文本，但按二进制存最省事，且能防 XSS（见 dataUrl）。 */
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico']);
/** PDF 只有一种后缀，单独留一个集合是为了 `isPdfPath` 不用去比对一堆字符串。 */
const PDF_EXT = new Set(['pdf']);

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  // svg 不写成 image/svg+xml + base64 之外的方式：data: 里的 svg 能被脚本注入，
  // 而我们这里是"仓库里别人放的文件"，不能假设它干净。base64 化之后浏览器仍会当
  // svg 解析，但它被隔离在 img 标签里（img 里的 svg 不执行脚本），足够安全。
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

/** 单个附件的上限。GitHub 的 blob 实际能到 100MB，但 base64 会让体积涨 1/3，
 *  而且它进 localStorage（一般 5~10MB 配额）—— 8MB 是"能同步又不炸本地存储"的折中。 */
export const ATTACH_LIMIT = 8 * 1024 * 1024;

export function extOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1) : '';
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.has(extOf(path));
}

export function isPdfPath(path: string): boolean {
  return PDF_EXT.has(extOf(path));
}

/** 「这个路径该按二进制处理吗」。同步、预览、指纹全靠它分派。 */
export function isBinaryPath(path: string): boolean {
  return isImagePath(path) || isPdfPath(path);
}

/** 文件的 MIME。认不出来就退回 octet-stream —— 比撒谎说它是 text/plain 强。 */
export function mimeOf(path: string): string {
  return MIME[extOf(path)] ?? 'application/octet-stream';
}

/**
 * 字节 → Blob。单独包一个函数就为绕开一处类型噪音：
 * TS 的 `Uint8Array` 带 `ArrayBufferLike`（可能是 SharedArrayBuffer），
 * 而 `BlobPart` 只收 `ArrayBuffer`。运行时毫无区别，别在调用点到处写 as。
 */
export function blobOf(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes as unknown as BlobPart], { type });
}

/** 给 `<img src>` / `<a href>` 用的 data URL。 */
export function dataUrl(path: string, base64: string): string {
  return `data:${mimeOf(path)};base64,${base64.replace(/\s+/g, '')}`;
}

/**
 * 字节 → base64。分块拼字串：`String.fromCharCode(...bytes)` 一次性展开几十万个数
 * 会直接爆栈（RangeError: Maximum call stack size exceeded），8MB 的图必炸。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/**
 * base64 → 字节。先把空白吃掉：手工粘进来的 base64 常有换行，
 * `atob` 对换行是直接抛错的（不是忽略）。
 */
export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(String(base64 ?? '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 解码失败返回 null，让调用方自己决定怎么办（指纹算不出来就退回按文字算）。 */
export function tryBase64ToBytes(base64: string): Uint8Array | null {
  try {
    return base64ToBytes(base64);
  } catch {
    return null;
  }
}

/** base64 串对应多少**原始字节** —— 显示"这个附件多大"要用的是这个，不是字符串长度。 */
export function base64Bytes(base64: string): number {
  const s = String(base64 ?? '').replace(/[\s=]+$/g, '').replace(/\s+/g, '');
  return Math.floor((s.length * 3) / 4);
}

/** git 的 blob 哈希：sha1("blob " + 字节数 + "\0" + 字节)。和远端 sha 可直接比。 */
export async function bytesSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode('blob ' + bytes.length + '\0');
  const buf = new Uint8Array(header.length + bytes.length);
  buf.set(header, 0);
  buf.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 存的那个 base64 的指纹。解不开就返回 null —— 别静默按字符串算，那会一直"脏"。 */
export async function storedSha(base64: string): Promise<string | null> {
  const bytes = tryBase64ToBytes(base64);
  return bytes ? await bytesSha(bytes) : null;
}

export function isTooBig(bytes: number): boolean {
  return bytes > ATTACH_LIMIT;
}

/** 1.2 MB / 340 KB 这种。中文环境按 1024 进，别用 kB。 */
export function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
