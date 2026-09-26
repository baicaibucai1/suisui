/*
 * 批注的位置怎么表示。
 *
 * 一句话：**记纯文本里的第几个字，不记 DOM 里的第几个节点。**
 *
 * DOM 会被我们自己改：搜索命中要 `splitText` 插 `<mark>`、"跳过去"时要清掉再合并。
 * 一旦拆了合了，节点序号就变了 —— 后果是"上次划的那段，下次打开跳到别的段落去了"。
 * 而某一章的**纯文本**跟 DOM 怎么折腾无关：`<mark>` 里的字还是那些字、顺序还是那个顺序。
 * 所以 {href, start, end} 三个数足够还原位置，而且跨会话、跨排版（改字号改行距）都对得上。
 *
 * 代价是每次要用都要把纯文本下标换算回 DOM —— 就是顺着文本节点累加长度。
 * 这个换算是 O(这一章的文本节点数)，一章几百个节点，毫秒级，够用。
 */
import type { BookNote } from './bookdb';

/** 一段范围在这一章纯文本里的位置 */
export type TextAnchor = { start: number; end: number };

/** 越界的（书换了版本、文本变短了）夹回来，反过来渲（start > end）掉个头 */
export function clampAnchor(text: string, start: number, end: number): TextAnchor {
  const max = text.length;
  const a = Math.min(Math.max(0, Math.min(start, end)), max);
  const b = Math.min(Math.max(0, Math.max(start, end)), max);
  return { start: a, end: b };
}

/** 列表里那句"划了什么"。长的一段掐头去尾都不如**留头**，所以从开头截 */
export function previewOf(s: string, max = 70): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** 一条批注在右栏显示的正文：没写想法就只显示划的那句，写了就把两句都给出来 */
export function notePreview(n: BookNote, max = 70): string {
  return previewOf(n.quote, max);
}

/* ── 下面这些要碰 DOM，跑不了 Node 单测 ── */

/**
 * `(node, nodeOffset)` 是 DOM 里的一个点，问它在 `host` 的纯文本里是第几个字。
 *
 * 顺着文本节点累加长度，累到目标节点就加上它内部的偏移 —— 这就是上面那个
 * "纯文本 ↔ DOM" 的正向换算。**中途遭上 `<mark>` 不影响**：它同样是个文本节点，
 * 字数照加。
 */
export function offsetInDom(host: HTMLElement, node: Node, nodeOffset: number): number | null {
  if (node === host) {
    // 落在容器自己身上：把它当作"前面所有子节点都过去了"来理解（选区压到边上时会这样）
    const kids = Array.from(host.childNodes).slice(0, nodeOffset);
    return kids.reduce((n, k) => n + (k.textContent ?? '').length, 0);
  }
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let acc = 0;
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (t === node) return acc + Math.min(nodeOffset, (t as Text).data.length);
    if (t.nodeType === Node.TEXT_NODE) acc += (t as Text).data.length;
  }
  return null;
}

/** `node` 坐在哪个 `[data-chapter]` 里。不在任何一章（比如点了抬头）返回 null */
export function chapterHostOf(node: Node | null, root: HTMLElement): HTMLElement | null {
  let el = node instanceof Element ? node : (node?.parentElement ?? null);
  while (el && el !== root) {
    if (el.hasAttribute('data-chapter')) return el as HTMLElement;
    el = el.parentElement;
  }
  return null;
}

/**
 * 纯文本里的 [start, end) → DOM Range。反向换算。
 *
 * 先给起点：`locateAt` 顺着找带长度跨过 `at` 的那个节点，`splitText` 断在那里
 * 拿一个干净的起点。**注意 `splitText` 会真的把节点撕成两个** —— 用完必须
 * 让宿主把这一章重新渲染（或至少 `normalize()`），否则同一段的第二次定点会漂。
 */
function locateAt(host: HTMLElement, at: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let last: Text | null = null;
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    if (acc + t.data.length >= at) return { node: t, offset: at - acc };
    last = t;
    acc += t.data.length;
  }
  if (last) return { node: last, offset: last.data.length };
  return null;
}

/** 拿出这一段对应的 Range（只读用途：算位置、算矩形、滚过去） */
export function domRange(host: HTMLElement, start: number, end: number): Range | null {
  const a = locateAt(host, start);
  const b = locateAt(host, end);
  if (!a || !b) return null;
  const r = document.createRange();
  try {
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
  } catch {
    return null; // 跨了不可能的边界（比如 start 落在一个已分离的节点上）
  }
  return r;
}
