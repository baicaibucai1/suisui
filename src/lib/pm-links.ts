/*
 * 编辑器里让 `[[双链]]` 和 `#标签` **看起来是链接、点得动** 的那一层。
 *
 * 一条总原则：**不动 schema，只加装饰**。
 *
 * `[[笔记]]` 在 markdown 里没有任何语法含义，Milkdown 会老老实实把它当普通文字
 * 存进文件 —— 这正是我们要的（见 lib/links.ts 的第 1 条）。要是为它新造一个
 * mark / node，序列化出来的就不再是纯 `[[笔记]]`，别的 markdown 软件打开会看到
 * 一堆怪东西，同步到 GitHub 也跟着脏。
 * 所以这里只用 ProseMirror 的 **Decoration** 给文字套一层 span：
 * 文档树一个字节没变，只是那几个字变了个颜色、多了个 data 属性。
 *
 * 源码模式（textarea）不走这里 —— 那边是纯文本，没法给一段字套 span。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { parseTags, parseWiki, resolveWiki } from './links';

export const wikiKey = new PluginKey('suisui-wiki');

/** 光标停在一个还没闭合的 `[[` 后面 —— 这时该弹补全。 */
const OPEN_RE = /\[\[([^[\]\n]*)$/;

export type WikiQuery = {
  /** `[[` 之后已经打进去的字 */
  text: string;
  /** `[[` 在文档里的位置 */
  from: number;
  /** 屏幕坐标（浮层照着 `[[` 的位置弹，不是跟着鼠标） */
  x: number;
  y: number;
};

export type WikiOpts = {
  /** 当前有哪些笔记。**每次都重新取** —— 新建一篇之后链接就该变亮 */
  paths: () => string[];
  /** 当前文件所在目录（同名多篇时优先同目录那篇） */
  dir: () => string;
  /** 查询词变了就回调；`null` = 该收起浮层了 */
  onQuery: (q: WikiQuery | null) => void;
  /** 浮层开着时的按键。返回 `true` = 这个键被浮层吃掉了，编辑器别再处理 */
  onKey: (e: KeyboardEvent) => boolean;
  /** 浮层当前是否开着 */
  open: () => boolean;
};

/** 光标处是不是正在写一个 `[[`。不是就返回 null。 */
function readQuery(state: EditorState): { text: string; from: number } | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $from = sel.$from;
  if (!$from.parent.isTextblock) return null;
  // 只看到光标为止（parentOffset 是光标在本段内的偏移），后面的字不该进查询词
  const text = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
  const m = OPEN_RE.exec(text);
  if (!m) return null;
  return { text: m[1], from: $from.pos - m[0].length };
}

function build(state: EditorState, opts: WikiOpts): DecorationSet {
  const paths = opts.paths();
  const dir = opts.dir();
  const decos: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    for (const l of parseWiki(text)) {
      const hit = resolveWiki(l.target, paths, dir);
      const attrs: Record<string, string> = {
        class: hit ? 'su-wiki' : 'su-wiki su-wiki-new',
        'data-wiki': l.target,
        // 桌面是 Ctrl+点击，手机直接点 —— 一句话说不下，提示只写结果
        title: hit ? `打开《${l.target}》` : `《${l.target}》还没建，点一下就建`,
      };
      if (l.heading) attrs['data-heading'] = l.heading;
      decos.push(Decoration.inline(pos + l.from, pos + l.to, attrs));
    }
    for (const t of parseTags(text)) {
      decos.push(
        Decoration.inline(pos + t.from, pos + t.to, {
          class: 'su-tag',
          'data-tag': t.tag,
          title: `只看带 #${t.tag} 的`,
        }),
      );
    }
  });

  return DecorationSet.create(state.doc, decos);
}

/**
 * 装饰只在文档变化时重算 —— 但「笔记列表」变了（刚建了一篇）链接也该变亮，
 * 而那时文档一个字没动。所以对外留一个手动刷新的口子：
 * 派发一个**空 transaction**（不碰 doc），ProseMirror 会重跑一遍 decorations。
 * ⚠️ 空 tr 不会触发 Milkdown 的 markdownUpdated（那个只在 docChanged 时发），
 * 所以这一下不会误写文件、也不会改脏标记。
 */
export function refreshWiki(view: EditorView): void {
  if (view.isDestroyed) return;
  view.dispatch(view.state.tr);
}

/** 把 `[[已打的字` 换成 `[[选中的笔记]]`，光标停在右括号后面。 */
export function insertWiki(view: EditorView, from: number, to: number, target: string): void {
  const text = `[[${target}]]`;
  const tr = view.state.tr.replaceWith(from, to, view.state.schema.text(text));
  tr.setSelection(TextSelection.create(tr.doc, from + text.length));
  view.dispatch(tr);
  view.focus();
}

export function wikiLinkPlugin(opts: WikiOpts) {
  return $prose(
    () =>
      new Plugin({
        key: wikiKey,
        props: {
          decorations: (state) => build(state, opts),
          handleKeyDown: (_view, e) => (opts.open() ? opts.onKey(e) : false),
        },
        view(view) {
          const emit = () => {
            const q = readQuery(view.state);
            if (!q) {
              opts.onQuery(null);
              return;
            }
            try {
              const c = view.coordsAtPos(q.from);
              opts.onQuery({ text: q.text, from: q.from, x: c.left, y: c.bottom + 6 });
            } catch {
              // 位置取不到（编辑器还没排版完）就不弹，下一拍再来
              opts.onQuery(null);
            }
          };
          emit();
          return {
            update: emit,
            destroy: () => opts.onQuery(null),
          };
        },
      }),
  );
}
