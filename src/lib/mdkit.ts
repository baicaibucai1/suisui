/**
 * md 工具栏的「源码模式」实现 —— 纯字符串改写，零依赖，可单测。
 *
 * 所见即所得模式不走这里（那边直接调 Milkdown 的命令），但两边共用同一份
 * `ToolId` / `Active` 定义，工具栏的高亮状态才能一致。
 *
 * 唯一原则：**只动语法标记，不碰正文**。任何操作都不能丢掉用户写的字。
 */

export type ToolId =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inlineCode'
  | 'link'
  | 'bullet'
  | 'ordered'
  | 'quote'
  | 'codeBlock'
  | 'hr';

export type Edit = {
  text: string;
  /** 编辑后应该落在哪 —— 受控 textarea 必须把光标还回去，否则跳到末尾 */
  start: number;
  end: number;
};

export type Active = {
  /** 0 = 正文；1~3 = 对应标题级别 */
  h: number;
  quote: boolean;
  bullet: boolean;
  ordered: boolean;
  codeBlock: boolean;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  inlineCode: boolean;
  link: boolean;
};

export const EMPTY_ACTIVE: Active = {
  h: 0,
  quote: false,
  bullet: false,
  ordered: false,
  codeBlock: false,
  bold: false,
  italic: false,
  strike: false,
  inlineCode: false,
  link: false,
};

export type BlockKind = 'text' | 'heading' | 'quote' | 'bullet' | 'ordered';

export type LineInfo = {
  kind: BlockKind;
  /** 标题级别；非标题为 0 */
  level: number;
  /** 行首缩进（空白） */
  indent: string;
  /** 块级标记原文（`## ` / `- ` / `1. ` / `> `），纯文本行为空串 */
  marker: string;
  /** 正文在这行里的起点 */
  contentStart: number;
};

// 行内标记的配对符
const MARKER = {
  bold: '**',
  italic: '*',
  strike: '~~',
  inlineCode: '`',
} as const;

// 块级：顺序要紧 —— 有序列表得先于无序（`1. ` 不会被 `- ` 匹配，但 `- ` 会吃掉任务项）
const RE_HEADING = /^ {0,3}(#{1,6})([ \t]+)(.*)$/;
const RE_BULLET = /^([ \t]*)([-*+])([ \t]+)/;
const RE_ORDERED = /^([ \t]*)(\d{1,9})([.)])([ \t]+)/;
const RE_QUOTE = /^ {0,3}(>)([ \t]?)/;

export function lineStartOf(text: string, pos: number): number {
  const i = text.lastIndexOf('\n', Math.max(0, pos - 1));
  return i < 0 ? 0 : i + 1;
}

export function lineEndOf(text: string, pos: number): number {
  const i = text.indexOf('\n', pos);
  return i < 0 ? text.length : i;
}

export function parseLine(line: string): LineInfo {
  let m = line.match(RE_HEADING);
  if (m) {
    const contentStart = m[1].length + m[2].length;
    return { kind: 'heading', level: m[1].length, indent: '', marker: m[1] + m[2], contentStart };
  }
  m = line.match(RE_BULLET);
  if (m) {
    const contentStart = m[1].length + m[2].length + m[3].length;
    return { kind: 'bullet', level: 0, indent: m[1], marker: m[2] + m[3], contentStart };
  }
  m = line.match(RE_ORDERED);
  if (m) {
    const contentStart = m[1].length + m[2].length + m[3].length + m[4].length;
    return { kind: 'ordered', level: 0, indent: m[1], marker: m[2] + m[3] + m[4], contentStart };
  }
  m = line.match(RE_QUOTE);
  if (m) {
    const contentStart = m[1].length + m[2].length;
    return { kind: 'quote', level: 0, indent: '', marker: m[1] + m[2], contentStart };
  }
  const indent = line.match(/^[ \t]*/)?.[0] ?? '';
  return { kind: 'text', level: 0, indent, marker: '', contentStart: indent.length };
}

/** 选区覆盖到的行区间 [blockStart, blockEnd)，不含末尾换行。 */
export function blockRange(text: string, start: number, end: number): [number, number] {
  return [lineStartOf(text, start), lineEndOf(text, end)];
}

/**
 * 把选区覆盖到的每一行交给 fn 改写，再把选区映射回新位置。
 * 映射按「逐行累计长度差」算 —— 前缀加长了选区就整体右移，删掉了就左移。
 */
function editBlock(
  text: string,
  start: number,
  end: number,
  fn: (lines: string[], infos: LineInfo[]) => string[],
): Edit {
  const [blockStart, blockEnd] = blockRange(text, start, end);
  const lines = text.slice(blockStart, blockEnd).split('\n');
  const infos = lines.map(parseLine);
  const next = fn(lines, infos);
  if (next.length !== lines.length) throw new Error('editBlock：行数不能变，否则选区没法映射');
  const out = text.slice(0, blockStart) + next.join('\n') + text.slice(blockEnd);
  return {
    text: out,
    start: mapOffset(lines, next, blockStart, start),
    end: mapOffset(lines, next, blockStart, end),
  };
}

/**
 * 把旧位置映射到新位置。
 *
 * 不能只用「本行长度差」：多行一起加前缀时，第 2 行的起点会因为第 1 行变长而整体右移，
 * 那部分位移必须累计进来。所以按「**相对本行正文起点的偏移**」映射 ——
 * 前缀怎么变都不影响正文里的字，光标也就稳稳落在同一个字上。
 */
function mapOffset(
  oldLines: string[],
  newLines: string[],
  blockStart: number,
  pos: number,
): number {
  let oldAcc = blockStart;
  let newAcc = blockStart;
  for (let i = 0; i < oldLines.length; i++) {
    const oldStart = oldAcc;
    const oldEnd = oldAcc + oldLines[i].length;
    if (pos <= oldEnd) {
      const newStart = newAcc;
      const newEnd = newAcc + newLines[i].length;
      const oldContent = oldStart + parseLine(oldLines[i]).contentStart;
      const newContent = newStart + parseLine(newLines[i]).contentStart;
      if (pos >= oldContent) {
        // 正文区：跟着正文起点走
        return Math.max(newStart, Math.min(pos + (newContent - oldContent), newEnd));
      }
      // 落在前缀区（缩进/标记）里：跟着行首走，但不越过新的正文起点
      return Math.min(oldStart === pos ? newStart : pos - oldStart + newStart, newContent);
    }
    oldAcc = oldEnd + 1;
    newAcc = newAcc + newLines[i].length + 1;
  }
  return Math.max(blockStart, pos + (newAcc - oldAcc));
}

// ---------- 块级 ----------

/** 设置标题级别；level <= 0 表示回到正文。作用到选区覆盖的所有行。 */
export function setHeading(text: string, start: number, end: number, level: number): Edit {
  return editBlock(text, start, end, (lines, infos) =>
    lines.map((raw, i) => {
      const info = infos[i];
      if (!raw.trim()) return raw;
      if (level <= 0) {
        return info.kind === 'heading' ? info.indent + raw.slice(info.contentStart) : raw;
      }
      const body = raw.slice(info.contentStart);
      return `${info.indent}${'#'.repeat(level)} ${body}`;
    }),
  );
}

type BlockTarget = 'quote' | 'bullet' | 'ordered';

const PREFIX: Record<BlockTarget, string> = { quote: '> ', bullet: '- ', ordered: '1. ' };

/** 整块都是该类型就取消，否则整块转成该类型（不做「一半有一半没有」的翻烙饼）。 */
export function toggleBlock(
  text: string,
  start: number,
  end: number,
  target: BlockTarget,
): Edit {
  return editBlock(text, start, end, (lines, infos) => {
    const all = infos.every((info, i) => !lines[i].trim() || info.kind === target);
    let n = 1;
    return lines.map((raw, i) => {
      const info = infos[i];
      if (!raw.trim()) return raw;
      const body = raw.slice(info.contentStart);
      if (all) return info.kind === target ? info.indent + body : raw;
      const prefix = target === 'ordered' ? `${n++}. ` : PREFIX[target];
      return `${info.indent}${prefix}${body}`;
    });
  });
}

// ---------- 行内 ----------

/**
 * 用 marker 包住选区。已经是包裹状态就去掉（再点一次取消）。
 * 空选区插入一对 marker，光标停在中间。
 */
export function wrapInline(
  text: string,
  start: number,
  end: number,
  marker: string,
): Edit {
  const len = marker.length;
  const before = text.slice(Math.max(0, start - len), start);
  const after = text.slice(end, end + len);
  const sel = text.slice(start, end);

  // 已是 **a** 这种「选区外侧就是 marker」—— 去掉
  if (before === marker && after === marker && !(len === 1 && text[start - 2] === marker)) {
    const head = text.slice(0, start - len);
    const tail = text.slice(end + len);
    return { text: head + sel + tail, start: start - len, end: end - len };
  }

  // 选区自带 marker（用户把 `**a**` 一起选上了）—— 去掉
  if (sel.length >= 2 * len && sel.startsWith(marker) && sel.endsWith(marker)) {
    const inner = sel.slice(len, -len);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }

  if (start === end) {
    const at = start + len;
    return { text: text.slice(0, start) + marker + marker + text.slice(end), start: at, end: at };
  }

  return {
    text: text.slice(0, start) + marker + sel + marker + text.slice(end),
    start: start + len,
    end: end + len,
  };
}

/** 插入链接。没选中文字时插 `[](url)` 并选中写标题的位置。 */
export function insertLink(text: string, start: number, end: number, href: string): Edit {
  const url = href.trim();
  const sel = text.slice(start, end);
  if (!sel) {
    const snippet = `[](${url})`;
    const at = start + 1;
    return { text: text.slice(0, start) + snippet + text.slice(end), start: at, end: at };
  }
  // 选区本身是个链接 → 只换地址
  const around = text.slice(Math.max(0, start - 1), start);
  const after = text.slice(end, end + 1);
  if (around === '[' && after === ']') {
    const closeParen = text.indexOf(')', end + 1);
    if (closeParen > -1) {
      return {
        text: text.slice(0, end + 1) + `(${url})` + text.slice(closeParen + 1),
        start,
        end,
      };
    }
  }
  const snippet = `[${sel}](${url})`;
  return { text: text.slice(0, start) + snippet + text.slice(end), start, end: start + snippet.length };
}

// ---------- 块级插入 ----------

/** 独立成段的插入：前后各留一个空行，避免黏在上一段尾巴上。 */
function insertBlock(
  text: string,
  start: number,
  end: number,
  snippet: string,
): { text: string; at: number; endPos: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const pre = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  // 插到文档末尾也要补空行，否则光标会卡在 `---` 那一行里出不来
  const post = after === '' || after.startsWith('\n\n') ? '\n\n' : after.startsWith('\n') ? '\n' : '\n\n';
  const at = start + pre.length;
  return {
    text: before + pre + snippet + post + after,
    at,
    endPos: at + snippet.length + post.length,
  };
}

/** 光标落到插入块之后的空行上，接着写就行。 */
export function insertHr(text: string, start: number, end: number): Edit {
  const r = insertBlock(text, start, end, '---');
  return { text: r.text, start: r.endPos, end: r.endPos };
}

export function insertCodeBlock(text: string, start: number, end: number): Edit {
  const sel = text.slice(start, end);
  const r = insertBlock(text, start, end, '```\n' + sel + '\n```');
  // 空选区：光标放进围栏中间那行，不然用户还得自己回车
  const caret = sel ? r.endPos : r.at + '```\n'.length;
  return { text: r.text, start: caret, end: caret };
}

// ---------- 状态读取（源码模式） ----------

/** 从纯文本 + 光标位置推出工具栏该高亮什么。 */
export function activeFromText(text: string, pos: number): Active {
  const line = text.slice(lineStartOf(text, pos), lineEndOf(text, pos));
  const info = parseLine(line);
  const active: Active = { ...EMPTY_ACTIVE };
  if (info.kind === 'heading') active.h = info.level;
  if (info.kind === 'quote') active.quote = true;
  if (info.kind === 'bullet') active.bullet = true;
  if (info.kind === 'ordered') active.ordered = true;
  return active;
}

/** 光标落在某个 `[文字](地址)` 里就返回地址，否则空串。用于预填链接输入框。 */
export function linkAt(text: string, pos: number): string {
  const re = /\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (pos >= m.index && pos <= m.index + m[0].length) return m[2];
  }
  return '';
}

// ---------- 分发 ----------

/** 源码模式：工具 id → 文本编辑。返回 null 表示这个工具在源码模式没意义。 */
export function applyTool(
  text: string,
  start: number,
  end: number,
  id: ToolId,
  payload?: string,
): Edit | null {
  switch (id) {
    case 'text':
      return setHeading(text, start, end, 0);
    case 'h1':
      return setHeading(text, start, end, 1);
    case 'h2':
      return setHeading(text, start, end, 2);
    case 'h3':
      return setHeading(text, start, end, 3);
    case 'bold':
      return wrapInline(text, start, end, MARKER.bold);
    case 'italic':
      return wrapInline(text, start, end, MARKER.italic);
    case 'strike':
      return wrapInline(text, start, end, MARKER.strike);
    case 'inlineCode':
      return wrapInline(text, start, end, MARKER.inlineCode);
    case 'link':
      return insertLink(text, start, end, payload ?? '');
    case 'bullet':
      return toggleBlock(text, start, end, 'bullet');
    case 'ordered':
      return toggleBlock(text, start, end, 'ordered');
    case 'quote':
      return toggleBlock(text, start, end, 'quote');
    case 'codeBlock':
      return insertCodeBlock(text, start, end);
    case 'hr':
      return insertHr(text, start, end);
    default:
      return null;
  }
}
