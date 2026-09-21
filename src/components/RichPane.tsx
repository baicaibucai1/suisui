// 「稿纸」（.rich）的编辑器。
//
// 和 md 那边（Milkdown）最大的不同：**正文用 contenteditable 直接做，非受控。**
// 受控的话每敲一个字 React 就重写一遍 innerHTML，光标会飞走、中文输入法会断。
// 所以：DOM 是正文的唯一真相，React 只管工具栏和「这篇的 CSS」。
//
// 四条容易踩的线，改代码前先看这里：
//
// 1. **落盘一律读 ref 快照，绝不事后读 DOM。** React 的 effect 清理顺序是
//    「先 layout 后 passive」；切文件时 DOM 已经被新文件覆盖，这时候再去读
//    host.innerHTML 拿到的是**新文件**，一写就把旧文件改成新文件的内容。
//    所以 onInput 里先把 innerHTML 存进 htmlRef，落盘只认 htmlRef。
// 2. **靠 dirtyRef 闸门，不靠「内容变了没」。** 浏览器解析 innerHTML 时会做规范化
//    （属性引号、实体转义），载入后原样回写就可能凭空产生一次 diff。只有用户真的
//    动过（敲字 / 命令 / 改 CSS）才允许落盘。这条同时解决了下面第 3 条。
// 3. **同步重建不 flush。** 拉取完成后 lastSyncAt 会变、这里会重载。那次重载前
//    绝不能把缓冲写回去，否则刚拉下来的内容被本地旧稿顶掉。
// 4. **删除不复活。** 文件被删掉后，卸载时的兜底 flush 必须放过它。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import {
  CSS_HINT,
  EMPTY_RICH_ACTIVE,
  RICH_PRESETS,
  emptyDoc,
  escapeHtml,
  joinRich,
  sanitizeHtml,
  scopedCss,
  splitRich,
} from '../lib/rich';
import type { RichActive, RichCmd } from '../lib/rich';
import RichToolbar from './RichToolbar';
import { Badge, EditorShell, ModeSwitch, SheetBody } from './EditorShell';
import { Paper } from './icons';

type Mode = 'rich' | 'source';

/** 光标所在的块级元素。缩进 / 卡片 / 对齐都作用在这一层。 */
const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,blockquote,pre,li,div';

/** 卡片压在块上的那几个属性 */
const CARD_PROPS = ['background', 'border', 'border-radius', 'padding', 'box-shadow'];
const INDENT_STEP = 1.6;

/** 工具栏高亮只在真的变了的时候才 setState —— 每次光标移动都重渲染太浪费 */
function sameActive(a: RichActive, b: RichActive): boolean {
  return (
    a.block === b.block &&
    a.align === b.align &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.inlineCode === b.inlineCode &&
    a.link === b.link &&
    a.ul === b.ul &&
    a.ol === b.ol &&
    a.card === b.card &&
    a.color === b.color &&
    a.bg === b.bg
  );
}

export default function RichPane({ path }: { path: string }) {
  const lastSyncAt = useStore((s) => s.lastSyncAt);
  const focusTick = useStore((s) => s.focusTick);
  const dirty = useStore((s) => s.dirty);

  const [mode, setMode] = useState<Mode>('rich');
  const [css, setCss] = useState('');
  const [draft, setDraft] = useState('');
  const [active, setActive] = useState<RichActive>(EMPTY_RICH_ACTIVE);
  const [cssOpen, setCssOpen] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const saveRef = useRef<number | undefined>(undefined);

  /** 正文 / CSS / 源码的即时快照 —— 落盘只认它们（第 1 条） */
  const htmlRef = useRef('');
  const cssRef = useRef('');
  const draftRef = useRef('');
  /** 用户真的动过没有（第 2 条） */
  const dirtyRef = useRef(false);
  /** 光标所在链接的地址，给工具栏预填 */
  const hrefRef = useRef('');
  /** 当前铺在屏幕上的是哪个文件的哪种模式 */
  const loadedRef = useRef<{ path: string; mode: Mode } | null>(null);
  const seenFocus = useRef(0);

  const readActive = useCallback((): RichActive => {
    const host = hostRef.current;
    hrefRef.current = '';
    const sel = window.getSelection();
    if (!host || !sel || sel.rangeCount === 0) return EMPTY_RICH_ACTIVE;
    const anchor = sel.anchorNode;
    if (!anchor || !host.contains(anchor)) return EMPTY_RICH_ACTIVE;

    const el = anchor.nodeType === 1 ? (anchor as HTMLElement) : anchor.parentElement;
    if (!el) return EMPTY_RICH_ACTIVE;

    const a: RichActive = { ...EMPTY_RICH_ACTIVE };
    const block = el.closest(BLOCK_SEL) as HTMLElement | null;
    const tag = block?.tagName.toLowerCase() ?? 'p';
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') a.block = tag;
    else if (tag === 'blockquote') a.block = 'quote';
    else if (tag === 'pre') a.block = 'pre';
    else a.block = 'p';

    a.ul = !!el.closest('ul');
    a.ol = !!el.closest('ol');
    a.card = !!block?.dataset.richCard;
    a.inlineCode = !!el.closest('code') && !el.closest('pre');
    const link = el.closest('a');
    a.link = !!link;
    if (link) hrefRef.current = link.getAttribute('href') ?? '';

    const q = (c: string) => {
      try {
        return document.queryCommandState(c);
      } catch {
        return false;
      }
    };
    a.bold = q('bold');
    a.italic = q('italic');
    a.underline = q('underline');
    a.strike = q('strikeThrough');

    if (block) {
      const al = getComputedStyle(block).textAlign;
      a.align = al === 'center' ? 'center' : al === 'right' ? 'right' : 'left';
    }
    const cs = getComputedStyle(el);
    a.color = cs.color;
    const bg = cs.backgroundColor;
    a.bg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? bg : '';
    return a;
  }, []);

  const refresh = useCallback(() => {
    const next = readActive();
    setActive((cur) => (sameActive(cur, next) ? cur : next));
  }, [readActive]);

  /** 光标一动工具栏就跟着变。一条 selectionchange 管住点击和键盘两条路径。 */
  useEffect(() => {
    const sync = () => {
      if (loadedRef.current?.mode === 'rich') refresh();
    };
    document.addEventListener('selectionchange', sync);
    return () => document.removeEventListener('selectionchange', sync);
  }, [refresh]);

  /** 拼出当前应该写进 store 的内容 */
  const snapshot = useCallback(
    (m: Mode) => (m === 'source' ? draftRef.current : joinRich(cssRef.current, htmlRef.current)),
    [],
  );

  const scheduleSave = useCallback(
    (delay = 500) => {
      if (!dirtyRef.current) return;
      window.clearTimeout(saveRef.current);
      saveRef.current = window.setTimeout(() => {
        const l = loadedRef.current;
        if (!l || !dirtyRef.current) return;
        const st = useStore.getState();
        // 文件已经被删了就放过它，别把删掉的东西救回来（第 4 条）
        if (!(l.path in st.files)) return;
        const next = snapshot(l.mode);
        if (next !== st.files[l.path]) st.setContent(l.path, next);
      }, delay);
    },
    [snapshot],
  );

  const flushNow = useCallback(
    (p: string, m: Mode) => {
      window.clearTimeout(saveRef.current);
      if (!dirtyRef.current) return;
      const st = useStore.getState();
      if (!(p in st.files)) return;
      const next = snapshot(m);
      if (next !== st.files[p]) st.setContent(p, next);
    },
    [snapshot],
  );

  // 铺内容。path / 模式 / 同步完成 三者任一变化都重来一遍。
  useLayoutEffect(() => {
    const prev = loadedRef.current;
    const same = !!prev && prev.path === path && prev.mode === mode;
    // 切文件 / 切模式：先把上一份落盘，再换 DOM。顺序反了就会用新内容覆写旧文件。
    // 「同步引起的重载」不在这里挡 —— dirtyRef 在下面被清掉，flushNow 自己会放过。
    if (prev && !same) {
      flushNow(prev.path, prev.mode);
      dirtyRef.current = false;
    }

    const raw = useStore.getState().files[path] ?? '';
    const parts = splitRich(raw);
    cssRef.current = parts.css;
    draftRef.current = raw;
    htmlRef.current = parts.html || emptyDoc();
    setCss(parts.css);
    setDraft(raw);

    if (mode === 'rich' && hostRef.current) hostRef.current.innerHTML = htmlRef.current;
    loadedRef.current = { path, mode };
    setActive(EMPTY_RICH_ACTIVE);
    // flushNow / mode 之外的都刻意不进依赖：只要这几个变了才该重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, mode, lastSyncAt]);

  // 卸载兜底：把还在防抖窗口里的字冲回去。用 ref 快照，不碰已经拆掉的 DOM。
  useEffect(() => () => {
    const l = loadedRef.current;
    if (l) flushNow(l.path, l.mode);
  }, [flushNow]);

  // 「创建笔记」之后把光标送进正文
  useEffect(() => {
    if (focusTick <= seenFocus.current) return;
    seenFocus.current = focusTick;
    if (mode === 'source') {
      taRef.current?.focus();
      return;
    }
    const host = hostRef.current;
    if (!host) return;
    host.focus();
    try {
      const sel = window.getSelection();
      if (!sel) return;
      const r = document.createRange();
      r.selectNodeContents(host);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch {
      /* 放不进去就算了，聚焦本身够用 */
    }
  }, [focusTick, path, mode]);

  // ---------- 命令 ----------

  const exec = (cmd: string, value?: string) => {
    try {
      document.execCommand(cmd, false, value);
    } catch {
      /* 命令不被支持就算了，别让它炸掉整棵树 */
    }
  };

  /** 保证选区在正文里 —— 用户点过面板之后焦点可能已经跑了 */
  const focusHost = (): HTMLElement | null => {
    const host = hostRef.current;
    if (!host) return null;
    host.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !host.contains(sel.anchorNode)) {
      const r = document.createRange();
      r.selectNodeContents(host);
      r.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
    return host;
  };

  /** 当前光标所在的块级元素 */
  const currentBlock = (host: HTMLElement): HTMLElement | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const n = sel.getRangeAt(0).startContainer;
    const el = n.nodeType === 1 ? (n as HTMLElement) : n.parentElement;
    if (!el || !host.contains(el)) return null;
    const b = el.closest(BLOCK_SEL) as HTMLElement | null;
    return b && host.contains(b) ? b : null;
  };

  /** 用一层 span / code 包住选区并带上行内样式。空选区什么也不做。 */
  const wrapSelection = (styles?: Record<string, string>, tag = 'span'): boolean => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return false;
    const el = document.createElement(tag);
    if (styles) for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, v);
    try {
      el.appendChild(range.extractContents());
      range.insertNode(el);
      const back = document.createRange();
      back.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(back);
      return true;
    } catch {
      return false;
    }
  };

  /** 把某个样式属性从选区上摘掉。空掉的壳一并拆掉，别留一地空 span。 */
  const clearProp = (host: HTMLElement, prop: string) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const scopeNode = range.commonAncestorContainer;
    const scopeEl = scopeNode.nodeType === 1 ? (scopeNode as Element) : scopeNode.parentElement;
    if (!scopeEl) return;

    const targets = new Set<HTMLElement>();
    for (const el of Array.from(scopeEl.querySelectorAll<HTMLElement>('*'))) {
      // intersectsNode 是精确的：只碰真的落在选区里的元素，不会误伤整篇
      if (range.intersectsNode(el)) targets.add(el);
    }
    for (const n of [range.startContainer, range.endContainer]) {
      let el = n.nodeType === 1 ? (n as HTMLElement) : n.parentElement;
      while (el && el !== host) {
        targets.add(el);
        el = el.parentElement;
      }
    }

    for (const el of targets) {
      if (el === host || !el.style?.getPropertyValue(prop)) continue;
      el.style.removeProperty(prop);
      if (!el.getAttribute('style')) el.replaceWith(...Array.from(el.childNodes));
    }
  };

  const runCmd = (cmd: RichCmd, payload?: string) => {
    const host = focusHost();
    if (!host) return;
    // 开这个之后 bold 之类生成的是 <span style>，不是 <b> / <font>——
    // 「用 CSS 渲染」得从头到尾一致，别一半内联样式一半老标签
    exec('styleWithCSS', 'true');

    const cur = readActive();
    const target = payload?.trim() ?? '';

    switch (cmd) {
      case 'p':
        exec('formatBlock', '<p>');
        break;
      case 'h1':
      case 'h2':
      case 'h3':
        // 再点一次回到正文，和 md 工具栏一个手感
        exec('formatBlock', cur.block === cmd ? '<p>' : `<${cmd}>`);
        break;
      case 'quote':
        exec('formatBlock', cur.block === 'quote' ? '<p>' : '<blockquote>');
        break;
      case 'code':
        exec('formatBlock', cur.block === 'pre' ? '<p>' : '<pre>');
        break;
      case 'hr':
        exec('insertHorizontalRule');
        break;
      case 'bold':
        exec('bold');
        break;
      case 'italic':
        exec('italic');
        break;
      case 'underline':
        exec('underline');
        break;
      case 'strike':
        exec('strikeThrough');
        break;
      case 'inlineCode':
        wrapSelection(undefined, 'code');
        break;
      case 'link': {
        if (!target) break;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) break;
        const range = sel.getRangeAt(0);
        const anchorEl = sel.anchorNode?.parentElement?.closest('a') ?? null;
        if (cur.link && anchorEl) {
          anchorEl.setAttribute('href', target);
          break;
        }
        const a = document.createElement('a');
        a.setAttribute('href', target);
        if (range.collapsed) {
          a.textContent = target;
          range.insertNode(a);
        } else {
          a.appendChild(range.extractContents());
          range.insertNode(a);
        }
        break;
      }
      case 'left':
      case 'center':
      case 'right':
        exec(`justify${cmd[0].toUpperCase()}${cmd.slice(1)}`);
        break;
      case 'ul':
        exec('insertUnorderedList');
        break;
      case 'ol':
        exec('insertOrderedList');
        break;
      case 'indent':
      case 'outdent': {
        const block = currentBlock(host);
        if (!block) break;
        const step = Number(block.dataset.richIndent ?? '0') + (cmd === 'indent' ? 1 : -1);
        const next = Math.max(0, Math.min(8, step));
        if (next === 0) {
          block.style.removeProperty('padding-left');
          delete block.dataset.richIndent;
        } else {
          block.dataset.richIndent = String(next);
          block.style.paddingLeft = `${(next * INDENT_STEP).toFixed(2)}em`;
        }
        break;
      }
      case 'color':
        if (target) exec('foreColor', target);
        else clearProp(host, 'color');
        break;
      case 'bg':
        if (target) exec('hiliteColor', target);
        else clearProp(host, 'background-color');
        break;
      case 'size':
        if (target) wrapSelection({ 'font-size': target });
        else clearProp(host, 'font-size');
        break;
      case 'font':
        if (target) wrapSelection({ 'font-family': target });
        else clearProp(host, 'font-family');
        break;
      case 'card': {
        const block = currentBlock(host);
        if (!block) break;
        if (block.dataset.richCard) {
          for (const p of CARD_PROPS) block.style.removeProperty(p);
          delete block.dataset.richCard;
        } else {
          // 写成行内样式而不是 class：文件得能离开这个程序单独活着
          block.dataset.richCard = '1';
          block.style.background = '#fffefd';
          block.style.border = '1px solid #e7e2db';
          block.style.borderRadius = '10px';
          block.style.padding = '0.85em 1.1em';
          block.style.boxShadow = '0 2px 10px -6px rgba(34,31,28,0.25)';
        }
        break;
      }
    }

    // 命令改的是 DOM 自己，我们只能从 DOM 读回来当快照
    htmlRef.current = host.innerHTML;
    dirtyRef.current = true;
    scheduleSave(200);
    refresh();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const host = hostRef.current;
    if (!host) return;
    const rich = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain');
    if (!rich && !plain) return;
    e.preventDefault();
    host.focus();
    // 外面粘进来的东西一律先洗一遍 —— innerHTML 挡不住 <img onerror=…>
    exec('insertHTML', rich ? sanitizeHtml(rich) : escapeHtml(plain).replace(/\r?\n/g, '<br>'));
    htmlRef.current = host.innerHTML;
    dirtyRef.current = true;
    scheduleSave(200);
    refresh();
  };

  const applyPreset = (id: string) => {
    const preset = RICH_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    cssRef.current = preset.css;
    setCss(preset.css);
    dirtyRef.current = true;
    scheduleSave(120);
  };

  const scoped = scopedCss(css);

  return (
    <EditorShell
      path={path}
      icon={<Paper size={13} />}
      tag={<Badge tone="craft">稿纸</Badge>}
      status={
        dirty ? (
          <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-warn" title="有未同步的改动" />
        ) : null
      }
      actions={
        <ModeSwitch
          value={mode}
          // 不用手动 flush：载入那个 effect 会先落盘再换 DOM
          onChange={setMode}
          options={[
            { value: 'rich', label: '稿纸' },
            { value: 'source', label: '源码' },
          ]}
          attrFor={(m) => ({ 'data-rich-mode': m })}
        />
      }
    >
      {/* 这篇的 CSS。@scope 把范围钉在正文容器上，一行都漏不到界面里 */}
      <style data-rich-style={path}>{scoped}</style>

      {mode === 'rich' && (
        <RichToolbar
          active={active}
          onRun={runCmd}
          cssOpen={cssOpen}
          onToggleCss={() => setCssOpen((v) => !v)}
          currentHref={hrefRef.current}
        />
      )}

      {mode === 'rich' && cssOpen && (
        <div data-rich-css-panel className="shrink-0 border-b border-line bg-paper">
          <div className="mx-auto max-w-[46rem] px-6 py-3 max-md:px-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="eyebrow mr-1">主题</span>
              {RICH_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-rich-preset={p.id}
                  title={p.hint}
                  onClick={() => applyPreset(p.id)}
                  className="rounded-full border border-line bg-surface px-2.5 py-[3px] text-[11.5px] text-ink-2 transition-colors hover:border-accent-line hover:bg-accent-soft hover:text-accent"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <textarea
              data-rich-css
              value={css}
              spellCheck={false}
              placeholder={CSS_HINT}
              onChange={(e) => {
                cssRef.current = e.target.value;
                setCss(e.target.value);
                dirtyRef.current = true;
                scheduleSave(400);
              }}
              className="mt-2.5 h-44 w-full resize-y rounded-[10px] border border-line bg-surface px-3 py-2.5 font-mono text-[12px] leading-[1.7] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent max-md:h-32"
            />
          </div>
        </div>
      )}

      <SheetBody>
        {mode === 'rich' ? (
          <div
            ref={hostRef}
            data-rich-doc
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onInput={(e) => {
              htmlRef.current = (e.target as HTMLElement).innerHTML;
              dirtyRef.current = true;
              scheduleSave();
              refresh();
            }}
            onBlur={() => {
              const host = hostRef.current;
              if (host) htmlRef.current = host.innerHTML;
              scheduleSave(0);
            }}
            onPaste={onPaste}
            className="rich-scope min-h-[60vh] outline-none"
          />
        ) : (
          <textarea
            ref={taRef}
            data-rich-source
            value={draft}
            spellCheck={false}
            onChange={(e) => {
              draftRef.current = e.target.value;
              setDraft(e.target.value);
              dirtyRef.current = true;
              scheduleSave(400);
            }}
            className="src-editor min-h-[60vh] w-full resize-none bg-transparent font-mono text-[13px] leading-[1.85] text-ink outline-none"
          />
        )}
      </SheetBody>
    </EditorShell>
  );
}
