/*
 * EPUB 解析。epub 本质就是一个 zip：里面有一份 `container.xml` 指路、
 * 一份 `.opf` 清单（manifest + spine）、一份目录（nav.xhtml 或 toc.ncx），
 * 其余是一堆 xhtml 章节和图片。所以这一层干的是**把 zip 读成一份书目**。
 *
 * 三条硬规矩，跟这个项目别处保持一致：
 *
 *   · **不碰 DOMParser。** 单测在 Node 里跑，那里没有 DOMParser；
 *     为一小段 XML 引 jsdom 不值得（davxml.ts 已经这么取舍过一次）。
 *     代价是**只认标准形状**的标签 —— 各家生成器（Sigil / Calibre / 掌阅）都是这个形状。
 *   · **零 UI 依赖。** 这里只产出"这本书长什么样"，渲染那摊在 BookPane 里。
 *   · **解压用 fflate**（8KB，零依赖）。zip 里的条目一般是 deflate，
 *     自己写 inflate 不划算；而浏览器原生的 DecompressionStream 在
 *     Android WebView 上兼容性还不够稳（Chrome 103 才支持 deflate-raw）。
 *
 * ⚠️ 路径一律换算成 **zip 内的完整路径**（`OEBPS/Text/ch1.xhtml`）：
 * opf 里的 href 是**相对 opf 自己**的，spine 和 toc 用的又是 manifest 的 id，
 * 三套坐标系不统一，混用会表现为"能列出章节但打开一片空白"。
 */

import { unzipSync } from 'fflate';

/** 目录里的一条。`href` 是 zip 内完整路径，可能带 `#锚点` */
export type TocEntry = { href: string; label: string; level: number };

export type ParsedBook = {
  title: string;
  author: string;
  /** opf 所在目录（`''` 表示就在根上）—— 书里所有相对路径都拿它换算 */
  opfDir: string;
  /** 正文顺序：zip 内完整路径 */
  spine: string[];
  toc: TocEntry[];
  /** 封面图片在 zip 里的完整路径；没有就是 null */
  cover: string | null;
  /** 整本书解压后的全部条目。渲染时按需取 */
  files: Record<string, Uint8Array>;
};

const decoder = new TextDecoder('utf-8');

export function decodeUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/**
 * 解压。只留**文件**条目 —— zip 里还有目录项（键以 `/` 结尾），
 * 它们的值为 0 字节，混进来会让"取一个不存在的资源"变成取到空串而非 undefined。
 */
export function unzipEpub(bytes: Uint8Array): Record<string, Uint8Array> {
  const all = unzipSync(bytes);
  const out: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.endsWith('/')) continue;
    out[k] = v;
  }
  return out;
}

/*
 * 相对路径换算。`../` 要真跳一级 —— epub 里 opf 常放在 `OEBPS/`，
 * 而有些生成器会写 `../Images/cover.jpg`，不处理就会去一个不存在的路径取图。
 */
export function joinPath(dir: string, href: string): string {
  const raw = (href || '').split('#')[0].trim();
  if (!raw) return '';
  const parts = (dir ? dir.split('/') : []).filter(Boolean);
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** 取一个属性的值。属性里可能有单引号，也可能有换行 */
function attr(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

/** 抓一对标签中间的内容。`ns:` 前缀可有可无 —— dc:title / title 都认 */
function tagText(xml: string, name: string): string {
  const m = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i').exec(xml);
  return clean(m?.[1] ?? '');
}

const ENT: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

/** 实体还原。带标签的内容要先剥标签再走这里，否则 `&lt;p&gt;` 会被还原成真的 `<p>` */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** 去标签 + 去实体 + 压空白。目录名、书名这些地方都要用 */
export function clean(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** container.xml → opf 的路径。有些书给的是 `full-path`，极老的给 `full_path` */
function opfPathOf(files: Record<string, Uint8Array>): string {
  const raw = files['META-INF/container.xml'];
  if (!raw) return '';
  const xml = decodeUtf8(raw);
  const m = /<rootfile\b[^>]*\b(?:full-path|full_path)\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(xml);
  const hit = (m?.[1] ?? m?.[2] ?? '').trim();
  if (hit) return hit;
  // 兜底：zip 里扫一份 .opf 出来。生成器写错 container 的书不是没有
  return Object.keys(files).find((p) => p.toLowerCase().endsWith('.opf')) ?? '';
}

type Item = { id: string; href: string; media: string; props: string };

function manifestOf(opf: string): Item[] {
  const block = /<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i.exec(opf)?.[1] ?? '';
  const out: Item[] = [];
  for (const m of block.matchAll(/<item\b([^>]*?)\/?>/gi)) {
    const id = attr(m[1], 'id');
    const href = attr(m[1], 'href');
    if (!id || !href) continue;
    out.push({ id, href, media: attr(m[1], 'media-type'), props: attr(m[1], 'properties') });
  }
  return out;
}

/** spine 里只收 `linear` 不是 `no` 的 —— 标了 no 的是封面页、目录页，不是正文 */
function spineOf(opf: string, items: Item[], opfDir: string): string[] {
  const block = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(opf)?.[1] ?? '';
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: string[] = [];
  for (const m of block.matchAll(/<itemref\b([^>]*?)\/?>/gi)) {
    if (/^\s*no\s*$/i.test(attr(m[1], 'linear'))) continue;
    const it = byId.get(attr(m[1], 'idref'));
    if (!it) continue;
    const full = joinPath(opfDir, it.href);
    if (full && !out.includes(full)) out.push(full);
  }
  return out;
}

/**
 * 封面。三条路依次退让：`properties="cover-image"` → `<meta name="cover">` →
 * zip 里名字带 cover / 封面的图片。最后那条兜底是因为真有生成器只把图塞进去、
 * 什么标记都不写 —— 没有封面只是不好看，不该因此整本书读不出来。
 */
function coverOf(opf: string, items: Item[], opfDir: string, files: Record<string, Uint8Array>): string | null {
  const flagged = items.find((i) => /\bcover-image\b/i.test(i.props));
  if (flagged) return joinPath(opfDir, flagged.href);
  const metaId =
    /<meta\b[^>]*\bname\s*=\s*["']cover["'][^>]*\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(opf) ??
    /<meta\b[^>]*\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*\bname\s*=\s*["']cover["']/i.exec(opf);
  const id = metaId?.[1] ?? metaId?.[2] ?? '';
  const hit = id ? items.find((i) => i.id === id) : null;
  if (hit) return joinPath(opfDir, hit.href);
  return (
    Object.keys(files).find((p) => /^image\//i.test(mimeOf(p)) && /(cover|封面)/i.test(p)) ?? null
  );
}

/** 图片后缀 → mime。只给封面挑选用，不追求全 */
function mimeOf(p: string): string {
  const e = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'png') return 'image/png';
  if (e === 'gif') return 'image/gif';
  if (e === 'webp') return 'image/webp';
  if (e === 'svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

/**
 * 目录。三条路依次退让，缺哪条都不至于让整本书没目录：
 *   ① `nav.xhtml`（EPUB3，manifest 里 properties 带 `nav`）—— 有层级
 *   ② `toc.ncx`（EPUB2）—— 有层级
 *   ③ 按 spine 顺序，章节标题取正文里的第一个 h1~h3（没标题就用"第 N 章"）
 */
function tocOf(
  files: Record<string, Uint8Array>,
  items: Item[],
  opfDir: string,
  spine: string[],
): TocEntry[] {
  const navItem = items.find((i) => /(?:^|\s)nav(?:\s|$)/i.test(i.props) || /nav/i.test(i.media));
  if (navItem) {
    const raw = files[joinPath(opfDir, navItem.href)];
    if (raw) {
      const toc = parseNavXhtml(decodeUtf8(raw), opfDir);
      if (toc.length) return toc;
    }
  }
  const ncx = items.find((i) => /ncx/i.test(i.media)) ?? items.find((i) => /\.ncx$/i.test(i.href));
  if (ncx) {
    const raw = files[joinPath(opfDir, ncx.href)];
    if (raw) {
      const toc = parseNcx(decodeUtf8(raw), opfDir);
      if (toc.length) return toc;
    }
  }
  // 兜底：spine 自己就是顺序，标题去正文里取
  const out: TocEntry[] = [];
  spine.forEach((p, i) => {
    const raw = files[p];
    const t = raw ? firstHeading(decodeUtf8(raw)) : '';
    out.push({ href: p, label: t || `第 ${i + 1} 章`, level: 0 });
  });
  return out;
}

/*
 * nav.xhtml 的目录是一棵嵌套的 `<ol><li><a>`。
 * 用正则切 `<li>` 会在嵌套处断掉，所以改成**顺序扫标记**：
 * 见 `<ol>` 进一层、见 `</ol>` 退一层，见 `<a href>` 就按当前层数记一条。
 */
function parseNavXhtml(xhtml: string, opfDir: string): TocEntry[] {
  const block =
    /<nav\b[^>]*(?:epub:type|type)\s*=\s*["']toc["'][^>]*>([\s\S]*?)<\/nav>/i.exec(xhtml)?.[1] ??
    /<nav\b[^>]*>([\s\S]*?)<\/nav>/i.exec(xhtml)?.[1] ??
    '';
  if (!block) return [];
  const out: TocEntry[] = [];
  let level = 0;
  const re =
    /<ol\b[^>]*>|<\/ol>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const m of block.matchAll(re)) {
    const tok = m[0];
    if (/^<ol\b/i.test(tok)) level++;
    else if (/^<\/ol>/i.test(tok)) level = Math.max(0, level - 1);
    else {
      const href = attr(m[1] ?? '', 'href');
      const label = clean(m[2] ?? '');
      const full = withFragment(opfDir, href);
      if (full && label) out.push({ href: full, label, level: Math.max(0, level - 1) });
    }
  }
  return out;
}

/** href 里的 `#锚点` 要留着 —— 同一章里跳小节靠它 */
function withFragment(opfDir: string, href: string): string {
  const full = joinPath(opfDir, href);
  const frag = href.split('#')[1];
  return frag ? `${full}#${frag}` : full;
}

/** toc.ncx：`<navPoint>` 也是嵌套的，同样按开闭标记扫 */
function parseNcx(xml: string, opfDir: string): TocEntry[] {
  const out: TocEntry[] = [];
  const stack: TocEntry[] = [];
  const re =
    /<navPoint\b[^>]*>|<\/navPoint>|<navLabel\b[^>]*>([\s\S]*?)<\/navLabel>|<content\b([^>]*?)\/?>/gi;
  for (const m of xml.matchAll(re)) {
    const tok = m[0];
    if (/^<navPoint\b/i.test(tok)) {
      /*
       * ⚠️ **在开标签处就放进结果**，不是在 `</navPoint>` 处。
       * navPoint 是嵌套的，子级先闭合 —— 按闭合顺序收的话，子章节会排到父章节前面，
       * 目录就变成"第一节 / 第一章 / 第二章"，看着像解析错了。
       * 先占位、后补 href 和标题：这两样都在开标签之后才出现。
       */
      const e: TocEntry = { href: '', label: '', level: stack.length };
      out.push(e);
      stack.push(e);
    } else if (/^<\/navPoint>/i.test(tok)) {
      stack.pop();
    } else if (m[1] !== undefined) {
      const top = stack[stack.length - 1];
      if (top && !top.label) top.label = clean(m[1]);
    } else if (m[2] !== undefined) {
      const top = stack[stack.length - 1];
      if (top && !top.href) top.href = withFragment(opfDir, attr(m[2], 'src'));
    }
  }
  // 没 href 的（坏 ncx）留着没意义，扔掉；没标题的补一个，别显示成空白一行
  return out
    .filter((e) => e.href)
    .map((e) => ({ ...e, label: e.label || '未命名' }));
}

function firstHeading(xhtml: string): string {
  const m = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(xhtml);
  if (m) return clean(m[2]);
  const t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(xhtml);
  return t ? clean(t[1]) : '';
}

/**
 * 把一份 epub 字节读成书目。
 * 坏书（不是 zip / 没有 opf / 没有正文）返回 null —— 让界面去说"这书读不出来"，
 * 不要让它在书架里留一条打不开的空壳。
 */
export function readEpub(bytes: Uint8Array): ParsedBook | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipEpub(bytes);
  } catch {
    return null;
  }
  const opfPath = opfPathOf(files);
  const rawOpf = opfPath ? files[opfPath] : undefined;
  if (!rawOpf) return null;
  const opf = decodeUtf8(rawOpf);
  const opfDir = opfPath.slice(0, Math.max(0, opfPath.lastIndexOf('/')));
  const items = manifestOf(opf);
  const spine = spineOf(opf, items, opfDir);
  if (spine.length === 0) return null;
  return {
    title: tagText(opf, 'title') || fileNameOf(opfPath),
    author: tagText(opf, 'creator'),
    opfDir,
    spine,
    toc: tocOf(files, items, opfDir, spine),
    cover: coverOf(opf, items, opfDir, files),
    files,
  };
}

const fileNameOf = (p: string) => {
  const b = p.slice(p.lastIndexOf('/') + 1).replace(/\.opf$/i, '');
  return b || '未命名';
};

/*
 * 章节 xhtml → 纯文本。搜索和"这本书一共有多少字"都吃这一份。
 *
 * 顺序有讲究：**先**整块挖掉 script / style / 注释（里面常有 `if (a<b)` 这种
 * 会打乱标签配对的东西），**再**把块级标签换成换行，最后才剥剩下的标签并还原实体。
 */
export function chapterText(xhtml: string): string {
  let s = xhtml;
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<\?[\s\S]*?\?>/g, ' ');
  s = s.replace(/<!DOCTYPE[^>]*>/gi, ' ');
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  // 块级标签换行，否则两段之间会粘成一个词
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]*>/g, '');
  return decodeEntities(s)
    .split('\n')
    .map((l) => l.replace(/[ \t　]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export type BookHit = {
  /** 命中的章节（zip 内完整路径） */
  href: string;
  /** 出处：该章在目录里的标题 */
  label: string;
  /** 命中位置前后的一小段，给用户看"是不是我要找的那处" */
  snippet: string;
  /** 命中处在该章纯文本里的第几个字 —— 跳过去定位用 */
  at: number;
};

/**
 * 全书搜索。大小写不敏感，中文自然也不分大小写。
 * `at` 给的是**纯文本**里的下标（不是 HTML 里的），跳过去时靠它反查到那个文本节点。
 */
export function searchBook(
  chapters: { href: string; label: string; text: string }[],
  query: string,
  limit = 60,
): BookHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: BookHit[] = [];
  for (const c of chapters) {
    const hay = c.text.toLowerCase();
    let from = 0;
    while (out.length < limit) {
      const at = hay.indexOf(q, from);
      if (at < 0) break;
      out.push({ href: c.href, label: c.label, snippet: snippetOf(c.text, at, q.length), at });
      from = at + q.length;
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** 前后各取一段，太长了中间截掉 —— 一整段贴上去看不出命中在哪 */
function snippetOf(text: string, at: number, len: number): string {
  const PAD = 24;
  const a = Math.max(0, at - PAD);
  const b = Math.min(text.length, at + len + PAD);
  return `${a > 0 ? '…' : ''}${text.slice(a, b).replace(/\n/g, ' ')}${b < text.length ? '…' : ''}`;
}
