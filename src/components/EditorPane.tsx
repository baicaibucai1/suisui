import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { commandsCtx, editorStateCtx, editorViewCtx } from '@milkdown/kit/core';
import { lift } from '@milkdown/kit/prose/commands';
import {
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  updateLinkCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { useStore } from '../lib/store';
import { EMPTY_ACTIVE, activeFromText, applyTool, linkAt } from '../lib/mdkit';
import type { Active, ToolId } from '../lib/mdkit';
import { isRichPath } from '../lib/rich';
import MdToolbar from './MdToolbar';
import RichPane from './RichPane';
import { Alert, FileText } from './icons';

type Mode = 'wysiwyg' | 'source';

/** 工具栏高亮 + 链接预填，一次读回来的 */
type Snap = { active: Active; href: string };

const EMPTY_SNAP: Snap = { active: EMPTY_ACTIVE, href: '' };

/** 光标所在的容器链 / 行内标记 → 工具栏该亮哪几个。 */
function snapFromEditor(crepe: Crepe): Snap {
  return crepe.editor.action((ctx) => {
    const state = ctx.get(editorStateCtx);
    if (!state?.doc) return EMPTY_SNAP;
    const { $from } = state.selection;
    const active: Active = { ...EMPTY_ACTIVE };
    let href = '';

    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      switch (n.type.name) {
        case 'heading':
          active.h = n.attrs.level;
          break;
        case 'blockquote':
          active.quote = true;
          break;
        case 'bullet_list':
          active.bullet = true;
          break;
        case 'ordered_list':
          active.ordered = true;
          break;
        case 'code_block':
          active.codeBlock = true;
          break;
      }
    }

    // 空选区看 storedMarks（输入法/工具栏刚打过标记时在这儿），否则看光标起点的 marks
    const marks = state.selection.empty ? (state.storedMarks ?? $from.marks()) : $from.marks();
    for (const m of marks) {
      switch (m.type.name) {
        case 'strong':
          active.bold = true;
          break;
        case 'emphasis':
          active.italic = true;
          break;
        case 'strike_through':
          active.strike = true;
          break;
        case 'inlineCode':
          active.inlineCode = true;
          break;
        case 'link':
          active.link = true;
          href = String(m.attrs.href ?? '');
          break;
      }
    }
    return { active, href };
  });
}

export default function EditorPane() {
  const current = useStore((s) => s.current);
  const files = useStore((s) => s.files);
  const dirty = useStore((s) => s.dirty);
  const lastSyncAt = useStore((s) => s.lastSyncAt);
  const setContent = useStore((s) => s.setContent);
  const focusTick = useStore((s) => s.focusTick);
  const [mode, setMode] = useState<Mode>('wysiwyg');
  const [fail, setFail] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [snap, setSnap] = useState<Snap>(EMPTY_SNAP);
  const [selTick, setSelTick] = useState(0);

  const hostRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  const seenFocus = useRef(0);
  const saveRef = useRef<number | undefined>(undefined);
  const draftRef = useRef<number | undefined>(undefined);
  /** 建这个编辑器实例时的 lastSyncAt —— 用来分辨「为什么重建」 */
  const builtAtSync = useRef<string | null>(null);

  const content = current ? (files[current] ?? '') : '';
  const isMd = current ? current.toLowerCase().endsWith('.md') : false;
  // 稿纸是另一套编辑器（contenteditable，非受控），下面这些 md 的逻辑对它全部不适用
  const isRich = current ? isRichPath(current) : false;
  // 所见即所得把裸 HTML / HTML 注释当纯文本，保存会把标记改坏 —— 这类文件提示走源码模式
  const hasRawHtml = isMd && /<!--|<[a-z][a-z0-9]*(\s|\/?>)/i.test(content);

  const readSnap = useCallback((): Snap => {
    if (mode === 'source') {
      const pos = taRef.current?.selectionStart ?? 0;
      return { active: activeFromText(draft, pos), href: linkAt(draft, pos) };
    }
    const crepe = crepeRef.current;
    if (!crepe) return EMPTY_SNAP;
    try {
      return snapFromEditor(crepe);
    } catch {
      return EMPTY_SNAP;
    }
  }, [mode, draft]);

  // 光标一动，工具栏高亮就跟着变。document 级别的 selectionchange 对
  // contenteditable（ProseMirror）和 textarea 都有效，一条监听管两种模式。
  useEffect(() => {
    const sync = () => setSnap(readSnap());
    document.addEventListener('selectionchange', sync);
    return () => document.removeEventListener('selectionchange', sync);
  }, [readSnap]);

  useEffect(() => {
    setSnap(readSnap());
  }, [readSnap, current, mode, lastSyncAt]);

  useEffect(() => {
    if (!current || mode !== 'wysiwyg' || !isMd) return;
    const host = hostRef.current;
    if (!host) return;

    let instance: Crepe | null = null;
    let disposed = false;
    let ready = false;
    let last = '';
    builtAtSync.current = lastSyncAt;

    (async () => {
      try {
        const crepe = new Crepe({
          root: host,
          defaultValue: content,
          features: { [Crepe.Feature.AI]: false },
        });
        crepe.on((api) => {
          api.markdownUpdated((_ctx, markdown) => {
            if (!ready || markdown === last) return;
            last = markdown;
            window.clearTimeout(saveRef.current);
            saveRef.current = window.setTimeout(() => setContent(current, markdown), 700);
          });
        });
        await crepe.create();
        if (disposed) {
          await crepe.destroy();
          return;
        }
        instance = crepe;
        crepeRef.current = crepe;
        last = crepe.getMarkdown();
        ready = true;
        setFail(null);
      } catch (e) {
        setFail((e as Error).message);
      }
    })();

    return () => {
      disposed = true;
      window.clearTimeout(saveRef.current);
      // 拆之前把没落盘的字冲回去。两种情况要跳过：
      // ① 同步拉完那次重建 —— 缓冲区是拉取前的旧文本，冲回去等于把刚拉下来的顶掉；
      // ② 文件已经被删了 —— 否则「删除当前文件」会当场把它救回来。
      const store = useStore.getState();
      const rebuildingForSync = store.lastSyncAt !== builtAtSync.current;
      if (instance && !rebuildingForSync && current in store.files) {
        try {
          const md = instance.getMarkdown();
          if (md !== store.files[current]) setContent(current, md);
        } catch {
          /* 取不到就算了，别让清理逻辑炸掉整棵树 */
        }
      }
      crepeRef.current = null;
      void instance?.destroy();
      host.innerHTML = '';
    };
    // 只在切换文件 / 切模式 / 同步完成时重建编辑器，输入过程不重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, mode, isMd, lastSyncAt]);

  useEffect(() => {
    setDraft(content);
    // mode 也要盯着：从所见即所得切过来时，源码框必须拿到刚敲的内容，否则改的是旧稿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, lastSyncAt, mode]);

  /**
   * 把所见即所得还没落盘的缓冲区立刻写回 store。
   * 切模式/切文件时手动调一次 —— 不然那 700ms 防抖窗口里的字就没了。
   */
  const flushEditor = useCallback(() => {
    const crepe = crepeRef.current;
    if (!crepe || !current) return;
    try {
      const md = crepe.getMarkdown();
      if (md !== useStore.getState().files[current]) {
        window.clearTimeout(saveRef.current);
        setContent(current, md);
      }
    } catch {
      /* 编辑器还没就绪，没有东西可冲 */
    }
  }, [current, setContent]);

  /** 文档末尾只有标题时，markdown 的 `\n\n` 会被解析掉 —— 补个空段落，光标才落得进去。 */
  const ensureTrailingParagraph = useCallback(() => {
    const crepe = crepeRef.current;
    if (!crepe) return;
    try {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const last = view.state.doc.lastChild;
        if (!last || last.type.name !== 'heading') return;
        const paragraph = view.state.schema.nodes.paragraph;
        if (!paragraph) return;
        view.dispatch(view.state.tr.insert(view.state.doc.content.size, paragraph.create()));
      });
    } catch {
      /* 编辑器还没就绪，下一轮轮询再试 */
    }
  }, []);

  // 「创建笔记」之后把光标送进正文。WYSIWYG 实例是异步建的，所以轮询等它就绪。
  useEffect(() => {
    if (focusTick <= seenFocus.current) return;
    seenFocus.current = focusTick;
    let tries = 0;
    const timer = window.setInterval(() => {
      if (mode === 'wysiwyg' && isMd) ensureTrailingParagraph();
      const el = hostRef.current?.querySelector<HTMLElement>('.ProseMirror') ?? taRef.current ?? null;
      if (!el) {
        if (++tries > 25) window.clearInterval(timer);
        return;
      }
      el.focus();
      // 光标放到末尾：默认停在开头，一打字就插到标题前面
      try {
        const sel = window.getSelection();
        if (sel && el.lastChild) {
          const r = document.createRange();
          r.selectNodeContents(el.lastChild);
          r.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      } catch {
        /* 放不进去就算了，聚焦本身已经够用 */
      }
      window.clearInterval(timer);
    }, 80);
    return () => window.clearInterval(timer);
  }, [focusTick, current, mode, isMd, ensureTrailingParagraph]);

  // 源码模式：受控 textarea 每次重渲染都会把光标扔到末尾，必须手动还回去
  useLayoutEffect(() => {
    const p = pendingSel.current;
    pendingSel.current = null;
    const ta = taRef.current;
    if (!p || !ta) return;
    ta.focus();
    ta.setSelectionRange(p[0], p[1]);
  }, [draft, selTick]);

  /** 源码模式：改 draft，延后落 store（和手动输入同一条路径，不会绕过脏标记） */
  const writeDraft = useCallback(
    (next: string) => {
      setDraft(next);
      window.clearTimeout(draftRef.current);
      draftRef.current = window.setTimeout(() => setContent(current!, next), 400);
    },
    [current, setContent],
  );

  const runTool = useCallback(
    (id: ToolId, payload?: string) => {
      if (mode === 'source' || !isMd) {
        const ta = taRef.current;
        if (!ta) return;
        const edit = applyTool(draft, ta.selectionStart ?? 0, ta.selectionEnd ?? 0, id, payload);
        if (!edit) return;
        pendingSel.current = [edit.start, edit.end];
        writeDraft(edit.text);
        setSelTick((t) => t + 1);
        setSnap({ active: activeFromText(edit.text, edit.start), href: '' });
        return;
      }

      const crepe = crepeRef.current;
      if (!crepe) return;
      try {
        crepe.editor.action((ctx) => {
          const commands = ctx.get(commandsCtx);
          const state = ctx.get(editorStateCtx);
          const { $from } = state.selection;
          const inList = (name: string) => {
            for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === name) return true;
            return false;
          };

          switch (id) {
            case 'text':
              commands.call(wrapInHeadingCommand.key, 0);
              break;
            case 'h1':
              commands.call(wrapInHeadingCommand.key, 1);
              break;
            case 'h2':
              commands.call(wrapInHeadingCommand.key, 2);
              break;
            case 'h3':
              commands.call(wrapInHeadingCommand.key, 3);
              break;
            case 'bold':
              commands.call(toggleStrongCommand.key);
              break;
            case 'italic':
              commands.call(toggleEmphasisCommand.key);
              break;
            case 'strike':
              commands.call(toggleStrikethroughCommand.key);
              break;
            case 'inlineCode':
              commands.call(toggleInlineCodeCommand.key);
              break;
            case 'link': {
              const href = (payload ?? '').trim();
              if (!href) break;
              const already = $from.marks().some((m) => m.type.name === 'link');
              if (already) commands.call(updateLinkCommand.key, { href });
              else commands.call(toggleLinkCommand.key, { href });
              break;
            }
            case 'bullet':
              // 再点一次要能取消：wrapInList 只负责「包起来」，出栈得走 lift
              if (inList('bullet_list')) commands.inline(lift);
              else commands.call(wrapInBulletListCommand.key);
              break;
            case 'ordered':
              if (inList('ordered_list')) commands.inline(lift);
              else commands.call(wrapInOrderedListCommand.key);
              break;
            case 'quote':
              if (inList('blockquote')) commands.inline(lift);
              else commands.call(wrapInBlockquoteCommand.key);
              break;
            case 'codeBlock':
              // 再点一次回到正文
              if (inList('code_block')) commands.call(wrapInHeadingCommand.key, 0);
              else commands.call(createCodeBlockCommand.key);
              break;
            case 'hr':
              commands.call(insertHrCommand.key);
              break;
          }
          // 点按钮会抢走焦点，得还给编辑器，否则光标没了
          ctx.get(editorViewCtx).focus();
        });
        setSnap(readSnap());
        setFail(null);
      } catch (e) {
        setFail((e as Error).message);
      }
    },
    [draft, isMd, mode, readSnap, writeDraft],
  );

  /*
   * 空态不在这儿 —— 它住在 `components/EmptyState.tsx`，由 `App.tsx` 在没选文件时直接渲染。
   * 原因见那个文件的注释：这个模块带着 1.4MB 的编辑器依赖，不该为了显示一句提示而被拉下来。
   * 这里只留一道类型收窄（下面每处都要用 `current` 是 string）。
   */
  if (!current) return null;

  // 稿纸整个交给 RichPane —— 上面那些 hook 对它都是空转（isMd 为 false，会提前 return），
  // 但必须挂在 hook 之后，不能条件性地少跑几个 hook
  if (isRich) return <RichPane key={current} path={current} />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-2.5 border-b border-line px-4 max-md:gap-2 max-md:px-3">
        <FileText size={13} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">{current}</span>

        {fail && <span className="shrink-0 text-[11.5px] text-danger">编辑器异常：{fail}</span>}
        {dirty && !fail && (
          <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-warn" title="有未同步的改动" />
        )}

        {isMd && (
          <div className="flex shrink-0 rounded-[7px] bg-surface-2 p-[3px]">
            {(['wysiwyg', 'source'] as Mode[]).map((m) => (
              <button
                key={m}
                data-mode={m}
                // 切之前先把所见即所得的缓冲落盘：不然源码框拿到的是旧稿，一改就把新写的顶掉
                onClick={() => {
                  if (m !== mode) flushEditor();
                  setMode(m);
                }}
                className={`rounded-[5px] px-2.5 py-[2px] text-[12px] transition-colors duration-150 max-md:px-2 max-md:py-[5px] ${
                  mode === m
                    ? 'bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(34,31,28,0.09)]'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                {m === 'wysiwyg' ? '所见即所得' : '源码'}
              </button>
            ))}
          </div>
        )}
      </div>

      {isMd && <MdToolbar active={snap.active} onRun={runTool} currentHref={snap.href} />}

      {hasRawHtml && mode === 'wysiwyg' && (
        <div className="shrink-0 border-b border-warn-line bg-warn-soft py-2.5">
          <div className="mx-auto flex max-w-[44rem] items-start gap-2.5 px-6">
            <Alert size={14} className="mt-[3px] shrink-0 text-warn" />
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-warn">
              这篇含 HTML 标记（如 <code className="font-mono">{'<!-- 注释 -->'}</code>
              ）。所见即所得会把它当纯文本，保存可能改坏它。
            </p>
            <button
              onClick={() => setMode('source')}
              className="shrink-0 rounded-md border border-warn-line bg-surface px-2.5 py-[3px] text-[12px] text-warn transition-colors hover:bg-warn-soft"
            >
              切到源码
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="editor-sheet">
          {isMd && mode === 'wysiwyg' ? (
            <div ref={hostRef} className="milkdown-wrap" />
          ) : (
            <textarea
              ref={taRef}
              data-source
              value={draft}
              onChange={(e) => writeDraft(e.target.value)}
              spellCheck={false}
              className="src-editor min-h-[60vh] w-full resize-none bg-transparent font-mono text-[13px] leading-[1.85] text-ink outline-none"
            />
          )}
        </div>
      </div>
    </div>
  );
}
