/*
 * [[双链]] 和 #标签 的解析 —— 零依赖纯函数，Node 可直接 import 做单测：
 *   node tests/links.test.mjs
 *
 * ⚠️ **别在这里 import 任何东西**（理由同 note.ts）：单测是拿 Node 直接跑 .ts 的，
 * Node 的 ESM 不做后缀补全，`from './rich'` 会当场找不到模块。
 *
 * 三条定死的规则：
 *
 * 1. **落盘格式就是纯文本。** `[[笔记]]` 在 markdown 里没有任何语法含义，
 *    所见即所得编辑器（Milkdown）和别的 markdown 软件都把它当普通文字存 ——
 *    所以这个文件不会因为被别的工具打开而损坏，同步到 GitHub 也照样能读。
 *    「能不能跳」是**读出来之后**的事，不写进文件。
 * 2. **`#` 必须紧跟文字才是标签**。`# 标题` 有空格 → 是标题不是标签；
 *    `##标题` 前面挨着 `#` → 也不是。这跟 Obsidian 一致，写法上不给人出难题。
 * 3. **代码块里不长链接。** 示例、模板里的 `[[xxx]]` 只是字，不是真的指向谁；
 *    解析前先把代码段涂成空格（**保持长度不变**，位置的偏移量才对得上）。
 */

export type WikiLink = {
  /** 原文，含两边方括号 */
  raw: string;
  /** 指向的笔记名（不含 `#小节` 和 `|显示`） */
  target: string;
  /** `#` 后面的小节名；没有就是空串 */
  heading: string;
  /** `|` 后面自定义的显示文字；没有就是空串 */
  display: string;
  /** 在正文里的字符区间 [from, to) */
  from: number;
  to: number;
};

export type TagHit = {
  /** 不含 `#` */
  tag: string;
  /** 含 `#` 的区间 [from, to) */
  from: number;
  to: number;
};

/** `[[...]]`。中间不许再出现方括号或换行 —— 跨行的那不叫链接。 */
const WIKI_RE = /\[\[([^[\]\n]+?)\]\]/g;

/**
 * `![[附件]]` —— **嵌入**（把那张图直接画在正文里）。
 * 同样只是纯文本：多出来的那个叹号在 markdown 里也没有语法含义。
 */
const EMBED_RE = /!\[\[([^[\]\n]+?)\]\]/g;

export type EmbedHit = {
  raw: string;
  /** 指向的名字（`|` 后面的显示文字不算） */
  target: string;
  /** 在正文里的字符区间 [from, to)，**含那个叹号** */
  from: number;
  to: number;
};

/**
 * `#标签`。
 *
 * - 前面（`(?<!...)`）不能是文字、数字或 `#`：挡掉 `http://a#片段`、
 *   `abc#def`，以及 markdown 标题 `##标题`（第二个 `#` 前面就是 `#`）。
 *   顺带把 `[[笔记#小节]]` 里的小节也挡掉了 —— 它前面是"记"这个字。
 * - 后面第一个字符必须是文字/数字/下划线，所以 `# 标题`（带空格）不是标签。
 * - 允许 `/` 做层级（`#读书/笔记`），和 Obsidian 一样。
 */
const TAG_RE = /(?<![\p{L}\p{N}_/#-])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

/** 纯 hex 色值（#fff / #f0f0f0）长得像标签，但它不是 */
const HEX_RE = /^[0-9a-f]{3}$|^[0-9a-f]{6}$/i;
/** 纯数字（#2026）也不是标签 —— 跟 Obsidian 一条规矩：标签里得有不是数字的字 */
const NUM_RE = /^\p{N}+$/u;

/** 把代码段涂成空格，长度不变 —— 这样匹配到的位置还是正文里的真实位置。 */
export function stripCode(text: string): string {
  let out = text.replace(/```[\s\S]*?(?:```|$)/g, (m) => m.replace(/[^\n]/g, ' '));
  out = out.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
  return out;
}

/** `[[笔记#小节|显示]]` → 拆成三截。`|` 优先于 `#`（和 Obsidian 一致）。 */
export function splitWiki(inner: string): { target: string; heading: string; display: string } {
  let target = inner;
  let display = '';
  const bar = target.indexOf('|');
  if (bar >= 0) {
    display = target.slice(bar + 1).trim();
    target = target.slice(0, bar);
  }
  let heading = '';
  const hash = target.indexOf('#');
  if (hash >= 0) {
    heading = target.slice(hash + 1).trim();
    target = target.slice(0, hash);
  }
  return { target: target.trim(), heading, display };
}

export function parseWiki(text: string): WikiLink[] {
  // 只有一处的代码能省：正文里一个反引号都没有时，stripCode 就是它自己
  const src = text.includes('`') ? stripCode(text) : text;
  const out: WikiLink[] = [];
  for (const m of src.matchAll(WIKI_RE)) {
    const { target, heading, display } = splitWiki(m[1]);
    if (!target) continue;
    const from = m.index ?? 0;
    // `![[图.png]]` 里那截也是 `[[...]]`，但它是嵌入 —— 不能再当链接画一遍
    if (from > 0 && src[from - 1] === '!') continue;
    out.push({ raw: m[0], target, heading, display, from, to: from + m[0].length });
  }
  return out;
}

/**
 * 正文里的 `![[附件]]`。
 *
 * 和 `parseWiki` 是**互斥**的：`![[a.png]]` 里那截 `[[a.png]]` 本身也符合链接的样子，
 * 但它前面有个叹号 —— 那是嵌入，不能再被当链接画一遍（否则一段字既是图又是链接）。
 */
export function parseEmbed(text: string): EmbedHit[] {
  const src = text.includes('`') ? stripCode(text) : text;
  const out: EmbedHit[] = [];
  for (const m of src.matchAll(EMBED_RE)) {
    const { target } = splitWiki(m[1]);
    if (!target) continue;
    const from = m.index ?? 0;
    out.push({ raw: m[0], target, from, to: from + m[0].length });
  }
  return out;
}

export function parseTags(text: string): TagHit[] {
  const src = text.includes('`') ? stripCode(text) : text;
  const out: TagHit[] = [];
  // # 后面可能紧跟链接，链接里的 #小节 不该被算成标签 —— 先圈出链接 / 嵌入区间
  const spans: [number, number][] = [];
  for (const m of src.matchAll(WIKI_RE)) {
    const from = m.index ?? 0;
    spans.push([from, from + m[0].length]);
  }
  for (const m of src.matchAll(EMBED_RE)) {
    const from = m.index ?? 0;
    spans.push([from, from + m[0].length]);
  }
  for (const m of src.matchAll(TAG_RE)) {
    const tag = m[1];
    // 纯 hex 色值和纯数字（#2026）都长得像标签，但它们不是
    if (HEX_RE.test(tag) || NUM_RE.test(tag)) continue;
    // m[0] 自己就带着那个 `#`（lookbehind 是零宽的，不占长度），所以起点就是 m.index
    const from = m.index ?? 0;
    const to = from + 1 + m[1].length;
    if (spans.some(([a, b]) => from >= a && from < b)) continue;
    out.push({ tag, from, to });
  }
  return out;
}

/** 一篇里出现过的标签（去重，按出现顺序）。 */
export function tagsOf(text: string): string[] {
  const seen = new Set<string>();
  for (const h of parseTags(text)) seen.add(h.tag);
  return [...seen];
}

const stripExt = (p: string) => p.replace(/\.[a-z0-9]+$/i, '');
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** 笔记的「名字」= 文件名去掉后缀。 */
export function noteNameOf(path: string): string {
  return stripExt(baseName(path));
}

/*
 * 「标题」= 名字再去掉开头的日期前缀。
 *
 * 建笔记时文件名是 `2026-09-21-开张`（note.ts 的规则），但**人写链接只会写 `[[开张]]`** ——
 * 没人记得住自己是几号写的那篇。所以解析要多这一档：先按全名找，找不到再按标题找。
 * ⚠️ 副作用是同标题的两篇会撞（`2026-09-21-开张` 和 `2026-09-22-开张` 都叫「开张」），
 * 这时由 resolveWiki 的「同目录优先」兜底，实在分不出就取排序在前那篇。
 */
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;

export function titleOf(path: string): string {
  return noteNameOf(path).replace(DATE_PREFIX, '');
}

/** 路径所在的目录；没有目录就是空串。 */
export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/**
 * 笔记名 → 路径。三档依次放宽，先严后松：
 *
 *   ① 全路径（带后缀）：`[[notes/开张.md]]` 也认
 *   ② 路径去后缀：`[[notes/开张]]`
 *   ③ 文件名（去后缀）：`[[开张]]`
 *
 * 同名多篇时**优先同目录的那篇**（`preferDir`）—— 从 notes/ 里链「开张」，
 * 想指的当然是 notes/ 那篇，不是 thoughts/ 里同名的另一篇。
 * 大小写不敏感：中文没这事，但英文标题大小写写歪了不该断链。
 */
export function resolveWiki(target: string, paths: string[], preferDir = ''): string | null {
  const t = target.trim().toLowerCase();
  if (!t) return null;
  const norm = (p: string) => p.toLowerCase();

  const exact = paths.find((p) => norm(p) === t);
  if (exact) return exact;

  const hit = (fn: (p: string) => string) => {
    const all = paths.filter((p) => fn(p) === t);
    if (all.length === 0) return null;
    if (all.length === 1) return all[0];
    const near = all.find((p) => dirOf(p) === preferDir);
    return near ?? all[0];
  };

  return (
    hit((p) => norm(stripExt(p))) ??
    hit((p) => norm(noteNameOf(p))) ??
    hit((p) => norm(titleOf(p)))
  );
}

/**
 * 名字 → **任意文件**的路径（`![[图.png]]` / `![](图.png)` 用）。
 *
 * 为什么不给 `resolveWiki` 加一档了事：那一套是给**笔记**用的，它会把后缀剥掉
 * （`[[开张]]` 要能指到 `2026-09-21-开张.md`）。而附件恰恰相反 ——
 * 人写 `![[dot.png]]` 时**带着后缀**，剥掉它就找不到了。
 * 所以这里按**全名（含后缀）**匹配：全路径 → 同目录优先 → 全库同名。
 */
export function resolveFile(target: string, paths: string[], preferDir = ''): string | null {
  const t = target.trim().toLowerCase().replace(/^\.?\//, '');
  if (!t) return null;
  const lower = (p: string) => p.toLowerCase();

  const exact = paths.find((p) => lower(p) === t);
  if (exact) return exact;

  const all = paths.filter((p) => {
    const l = lower(p);
    return l === t || l.endsWith('/' + t);
  });
  if (all.length === 0) return null;
  if (all.length === 1) return all[0];
  const near = all.find((p) => dirOf(p) === preferDir);
  return near ?? all[0];
}

/** 一篇里所有出链，附带上「指没指到」—— `path` 为 null 就是那篇还不存在。 */
export function outgoingOf(text: string, paths: string[], preferDir = ''): { link: WikiLink; path: string | null }[] {
  const seen = new Map<string, { link: WikiLink; path: string | null }>();
  for (const link of parseWiki(text)) {
    if (seen.has(link.target)) continue;
    seen.set(link.target, { link, path: resolveWiki(link.target, paths, preferDir) });
  }
  return [...seen.values()];
}

/**
 * 全库扫一遍：**引用了但还没建的笔记**。
 *
 * 去重是这里最要紧的事 —— 同一个 `[[读书笔记]]` 可能被十篇引用，
 * 人只想看见它一次（"这一篇还没建"），而不是十个一模一样的待办。
 * 所以按「目标」归并，把引用它的篇都收着（界面好显示"被 3 篇引用"）。
 *
 * 落点目录的规则：**哪篇引的就建在哪篇旁边**是最符合直觉的，但一个目标
 * 可能被散在不同目录的几篇同时引用 —— 这时取**引用最多的那个目录**，
 * 一样多就按目录名排。全部都在根目录就用 `fallbackDir`。
 */
export function missingNotes(
  files: Record<string, string>,
  fallbackDir = 'thoughts',
): { target: string; from: string[]; dir: string }[] {
  const paths = Object.keys(files);
  const byTarget = new Map<string, string[]>();
  for (const [from, text] of Object.entries(files)) {
    if (typeof text !== 'string') continue;
    for (const { link, path } of outgoingOf(text, paths, dirOf(from))) {
      if (path) continue; // 指到了就不算"没建"
      const list = byTarget.get(link.target);
      if (list) {
        if (!list.includes(from)) list.push(from);
      } else byTarget.set(link.target, [from]);
    }
  }

  const out: { target: string; from: string[]; dir: string }[] = [];
  for (const [target, from] of byTarget) {
    // 每个引用者所在目录投一票，得票最多的目录就是落点
    const votes = new Map<string, number>();
    for (const f of from) {
      const d = dirOf(f);
      votes.set(d, (votes.get(d) ?? 0) + 1);
    }
    let best = fallbackDir;
    let bestN = -1;
    for (const [d, n] of [...votes].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
      if (n > bestN) {
        bestN = n;
        best = d;
      }
    }
    out.push({ target, from: from.sort((a, b) => a.localeCompare(b, 'zh')), dir: best || fallbackDir });
  }
  return out.sort((a, b) => b.from.length - a.from.length || a.target.localeCompare(b.target, 'zh'));
}

/** 谁引用了这篇 —— 反向链接。同一篇里引了多次只算一条，但次数带着。 */
export function backlinksOf(
  files: Record<string, string>,
  path: string,
): { from: string; hits: WikiLink[] }[] {
  // 三种写法都算指向它：全路径、文件名、去掉日期前缀的标题
  const names = new Set<string>(
    [path, stripExt(path), noteNameOf(path), titleOf(path)].map((s) => s.toLowerCase()),
  );
  const out: { from: string; hits: WikiLink[] }[] = [];
  for (const [from, text] of Object.entries(files)) {
    if (from === path) continue;
    if (typeof text !== 'string') continue;
    const hits = parseWiki(text).filter((l) => names.has(l.target.toLowerCase()));
    if (hits.length) out.push({ from, hits });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from, 'zh'));
}

/** 全库的标签索引：标签 → 哪些篇用过。 */
export function tagIndex(files: Record<string, string>): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [path, text] of Object.entries(files)) {
    if (typeof text !== 'string') continue;
    for (const tag of tagsOf(text)) {
      const list = m.get(tag);
      if (list) list.push(path);
      else m.set(tag, [path]);
    }
  }
  return m;
}

/**
 * `[[` 之后的补全候选。
 *
 * 只按**名字包含**来筛（不做模糊拼音），因为笔记名本身是中文短词，
 * 打两三个字就够定位了。空查询给前 8 篇 —— 刚打完 `[[` 时最想看见的
 * 是「有哪些可以链」，而不是一片空白。
 */
function rankOf(name: string, q: string): number {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  return 9; // 没命中
}
export function suggestNotes(query: string, paths: string[], limit = 8): string[] {
  const q = query.trim().toLowerCase();
  const scored: { path: string; rank: number }[] = [];
  for (const p of paths) {
    // 名字和标题任一命中就算数：文件名带着日期前缀，但人是按标题想的
    const name = noteNameOf(p).toLowerCase();
    const title = titleOf(p).toLowerCase();
    if (!q) {
      scored.push({ path: p, rank: 1 });
      continue;
    }
    const best = Math.min(rankOf(name, q), rankOf(title, q));
    if (best < 9) scored.push({ path: p, rank: best });
  }
  scored.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path, 'zh'));
  return scored.slice(0, limit).map((s) => s.path);
}

/**
 * 所见即所得保存回来时把 `[[` 还原掉。
 *
 * ⚠️ 这是必需的一步，不是洁癖：markdown 序列化器会把行首之外的 `[` 转义成 `\[`，
 * 于是 `[[开张]]` 存进文件变成 `\[\[开张]]` —— 磁盘上那串字已经不再是双链了，
 * 反向链接会整片失效，别的软件打开也只看到一串反斜杠。
 * 所以在**写回文件之前**把转义吃回去。
 *
 * 只认成对的那一种（`\[\[` / `\]\]`），单个 `\[` 不动 —— 用户真想写反斜杠时别乱改。
 */
export function unescapeWiki(md: string): string {
  return md.replace(/\\\[\\\[/g, '[[').replace(/\\\]\\\]/g, ']]');
}

/** 引用所在的那一小段上下文，给反向链接面板用（两边各取 30 字）。 */
export function contextOf(text: string, link: WikiLink, span = 30): string {
  const a = Math.max(0, link.from - span);
  const b = Math.min(text.length, link.to + span);
  return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\n+/g, ' ') + (b < text.length ? '…' : '');
}

/*
 * 本页大纲（右栏那份标题目录，Obsidian 叫 On this page）。
 *
 * 放在 links.ts 而不是单开一个文件，是刻意的：它要用 stripCode，
 * 而这个文件的原则是「零依赖纯函数，Node 直接 import 就能测」——
 * 单开一个 `outline.ts` 就得 import './links'（无扩展名），单测当场跑不起来。
 */

export type OutlineItem = { level: number; text: string; line: number };

/**
 * 标题文字的「净版」：
 * - `[[笔记#小节]]` 只留名字 —— 大纲显示的不是链接语法
 * - `*` `_` `` ` `` 这些行内记号剥掉 —— 右栏是目录不是源码
 *
 * 大纲解析和源码模式跳转**必须用同一个函数**：一边拿它显示，
 * 一边拿它匹配 `# 原文`，两处各写一份迟早对不上。
 */
export function cleanHeading(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/[*_`]+/g, '')
    .trim();
}

const HEAD_RE = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;

/** 正文 → 大纲。只认 ATX 标题；代码块里的 `# 注释` 不是标题（stripCode 把围栏涂空，行数不变）。 */
export function outlineOf(text: string): OutlineItem[] {
  if (!text) return [];
  const lines = (text.includes('```') ? stripCode(text) : text).split('\n');
  const items: OutlineItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEAD_RE);
    if (!m) continue;
    const t = cleanHeading(m[2]);
    if (t) items.push({ level: m[1].length, text: t, line: i });
  }
  return items;
}

/** 源码模式跳转用：第 line 行在整篇文本里的字符偏移。 */
export function lineOffset(lines: string[], line: number): number {
  let off = 0;
  for (let i = 0; i < line; i++) off += lines[i].length + 1;
  return off;
}
