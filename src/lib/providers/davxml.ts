/*
 * WebDAV 的 PROPFIND 响应解析 —— 零依赖纯函数，Node 可直接 import 做单测。
 *
 * 用正则而不是 DOMParser：单测在 Node 里跑，那里没有 DOMParser，
 * 为一小段 XML 引 jsdom 不值得。代价是**只认标准形状**的响应
 * （坚果云 / nginx / Apache 都是这个形状）。
 *
 * 目录和文件的区别在 `resourcetype`：里面有 `<d:collection/>` 才是目录。
 * 我们的列表里**只要文件** —— 目录由路径里的 `/` 表达。
 */

export type DavItem = { path: string; dir: boolean };

const RESP = /<(?:\w+:)?response\b[\s\S]*?<\/(?:\w+:)?response>/gi;
const HREF = /<(?:\w+:)?href\b[^>]*>([\s\S]*?)<\/(?:\w+:)?href>/i;
const COLLECTION = /<(?:\w+:)?collection\s*\/>/i;

/** href 是 URL 编码过的（`/dav/%E7%A2%8E%E7%A2%8E/notes/a.md`），要解回中文 */
function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href; // 解不出来就原样用，别让一段坏 href 把整个列表搞没了
  }
}

/**
 * 把 PROPFIND 的响应解析成相对路径列表。
 *
 * @param basePath 库在服务器上的根（比如 `/dav/碎碎`）。
 *   href 会带上它，必须剥掉；**第一项就是根目录自己**，也要一起去掉。
 */
export function parsePropfind(xml: string, basePath: string): DavItem[] {
  const root = normalizeBase(basePath);
  const out: DavItem[] = [];
  const seen = new Set<string>();

  for (const block of xml.match(RESP) ?? []) {
    const href = HREF.exec(block)?.[1]?.trim();
    if (!href) continue;
    const full = decodeHref(href).replace(/\/+$/, '');
    // 有些服务器给绝对 URL（https://dav.jianguoyun.com/dav/x），有些只给路径
    const path = stripScheme(full);
    const rel = relativeTo(path, root);
    if (!rel) continue; // 根目录自己（或者库之外的东西）
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push({ path: rel, dir: COLLECTION.test(block) });
  }
  return out;
}

/** `/dav/碎碎` → `/碎碎` 之类；末尾的斜杠一律去掉 */
function normalizeBase(basePath: string): string {
  const p = stripScheme(decodeHref((basePath ?? '').trim())).replace(/\/+$/, '');
  return p;
}

/** 去掉 `https://host` 和可能的双重编码前缀，只留路径部分 */
function stripScheme(s: string): string {
  const m = /^[a-z]+:\/\/[^/]+(\/.*)?$/i.exec(s);
  return m ? (m[1] ?? '/') : s;
}

/** 从完整路径里剥掉库根，得到相对路径；不在库里（或就是根目录）返回 '' */
function relativeTo(path: string, root: string): string {
  if (!root) return path.replace(/^\/+/, '');
  if (path === root) return '';
  const pre = root + '/';
  if (!path.startsWith(pre)) return '';
  return path.slice(pre.length);
}
