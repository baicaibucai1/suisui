import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { commandsCtx, editorStateCtx, editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
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
import { cleanHeading, dirOf, lineOffset, resolveFile, suggestNotes, titleOf, unescapeWiki } from '../lib/links';
import { base64ToBytes, blobOf, isImagePath, mimeOf } from '../lib/binary';
import { flashNode, flashPlugin, insertWiki, refreshWiki, wikiLinkPlugin } from '../lib/pm-links';
import type { EmbedInfo } from '../lib/pm-links';
import type { WikiQuery } from '../lib/pm-links';
import { isRichPath } from '../lib/rich';
import { useMedia, WIDE } from '../lib/media';
import WikiHints from './WikiHints';
import type { HintItem } from './WikiHints';
import BacklinkPane from './BacklinkPane';
import MdToolbar from './MdToolbar';
import RichPane from './RichPane';
import { Badge, EditorShell, ModeSwitch, SheetBody } from './EditorShell';
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

/** 窄屏（手机）没有 Ctrl 键，那边改成单击就跳 —— 见下面的 handleWikiClick */
const NARROW = '(max-width: 768px)';

export default function EditorPane() {
  const current = useStore((s) => s.current);
  const files = useStore((s) => s.files);
  const dirty = useStore((s) => s.dirty);
  const lastSyncAt = useStore((s) => s.lastSyncAt);
  const setContent = useStore((s) => s.setContent);
  const focusTick = useStore((s) => s.focusTick);
  const openWiki = useStore((s) => s.openWiki);
  const setTagFilter = useStore((s) => s.setTagFilter);
  const tagFilter = useStore((s) => s.tagFilter);
  const pendingHeading = useStore((s) => s.pendingHeading);
  const jumpTick = useStore((s) => s.jumpTick);
  const setPendingHeading = useStore((s) => s.setPendingHeading);
  // 桌面上关系面板搬进了右栏（App.tsx），这里只在窄屏（手机）挂在正文底部。
  // 同一组件永远只挂一份 —— 两边都挂的话 Playwright 的 strict 选择器当场冲突。
  const wide = useMedia(WIDE);
  const [mode, setMode] = useState<Mode>('wysiwyg');
  const [fail, setFail] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [snap, setSnap] = useState<Snap>(EMPTY_SNAP);
  const [selTick, setSelTick] = useState(0);
  /** `[[` 之后的补全：光标查询 + 当前选到第几项 */
  const [hint, setHintState] = useState<WikiQuery | null>(null);
  const [hintIdx, setHintIdx] = useState(0);

  const hostRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  const seenFocus = useRef(0);
  const saveRef = useRef<number | undefined>(undefined);
  const draftRef = useRef<number | undefined>(undefined);
  /** 建这个编辑器实例时的 lastSyncAt —— 用来分辨「为什么重建」 */
  const builtAtSync = useRef<string | null>(null);
  /*
   * 补全要用的几样东西，都走 ref：
   * 插件是**建实例那一刻**装进去的，它闭包里抓到的 state 会永远停在那一刻，
   * 而笔记列表、查询词每时每刻都在变。所以插件只认 ref，读到的永远是最新值。
   */
  const pathsRef = useRef<string[]>([]);
  const dirRef = useRef('');
  /** 附件原文（base64）的最新值 —— 插件只认 ref，读到的才是当下的 */
  const filesRef = useRef<Record<string, string>>({});
  /*
   * 正文里嵌的那些图，blob URL 按路径缓存。
   * ⚠️ 必须在卸载时全部 revoke：object URL 不回收，整张图会一直挂在内存里，
   * 切几篇带图的笔记就能吃掉几百 MB。
   */
  const embedCache = useRef(new Map<string, EmbedInfo>());
  /** focusTick 的最新值 —— 编辑器创建那段异步代码要读它，闭包里的会过期 */
  const focusTickRef = useRef(0);
  const hintRef = useRef<WikiQuery | null>(null);
  const hintIdxRef = useRef(0);
  /*
   * Esc 关掉的那一次要**记住**。不记的话，任何一次编辑器更新（哪怕只是光标抖了一下）
   * 都会把浮层又弹回来 —— 光标还停在 `[[` 后面，查询条件照样成立。
   * 只有继续打字（查询词变了或位置变了）才算"又要补全了"，这时才解除。
   */
  const dismissedRef = useRef<{ text: string; from: number } | null>(null);

  const content = current ? (files[current] ?? '') : '';
  const isMd = current ? current.toLowerCase().endsWith('.md') : false;
  // 稿纸是另一套编辑器（contenteditable，非受控），下面这些 md 的逻辑对它全部不适用
  const isRich = current ? isRichPath(current) : false;
  // 所见即所得把裸 HTML / HTML 注释当纯文本，保存会把标记改坏 —— 这类文件提示走源码模式
  const hasRawHtml = isMd && /<!--|<[a-z][a-z0-9]*(\s|\/?>)/i.test(content);

  /** 能当链接目标的只有 md 笔记（稿纸不是 markdown，链过去也没法解析） */
  const mdPaths = useMemo(() => Object.keys(files).filter((p) => p.toLowerCase().endsWith('.md')), [files]);
  // 渲染时顺手刷新：插件读的是这两个 ref，不是渲染闭包里的旧值
  pathsRef.current = mdPaths;
  dirRef.current = dirOf(current ?? '');
  focusTickRef.current = focusTick;
  filesRef.current = files;

  /*
   * `![[附件]]` 要画什么。
   * 返回的 url 是 **blob URL** 而不是 data URL：一张 5MB 的图塞进 src 属性，
   * DOM 里就要多出 6MB 的字符串，DevTools / 内存都扛不住。
   */
  const embedFor = useCallback(
    (target: string): EmbedInfo | null => {
      // ⚠️ 走 resolveFile 不是 resolveWiki：附件是**带着后缀**被引用的（![[dot.png]]），
      // 而 resolveWiki 按笔记的规矩会先把后缀剥掉，那样永远找不到
      const path = resolveFile(target, Object.keys(filesRef.current), dirRef.current);
      if (!path) return null;
      // 只缓存造过 blob URL 的图片：卡片那种没有 URL 可收，缓存它反而会让
      // 「附件后来上传了」这件事看不出来
      const cached = embedCache.current.get(path);
      if (cached) return cached;
      const stored = filesRef.current[path];
      if (typeof stored !== 'string') return null;
      const name = path.slice(path.lastIndexOf('/') + 1);
      // 笔记本身也能被嵌（Obsidian 的规矩）—— 那就画成一张卡片，点开是那篇
      if (!isImagePath(path)) return { url: '', kind: 'file', name };
      try {
        const bytes = base64ToBytes(stored);
        const url = URL.createObjectURL(blobOf(bytes, mimeOf(path)));
        const info: EmbedInfo = { url, kind: 'image', name };
        embedCache.current.set(path, info);
        return info;
      } catch {
        return { url: '', kind: 'file', name };
      }
    },
    [],
  );

  /*
   * `![](./图.png)` 这种标准 markdown 图片：Milkdown 会老老实实渲成
   * `<img src="./图.png">`，而应用里没有这个 HTTP 路径 —— 图是裂的。
   * 这里把 src 换成库里那份内容的 blob URL（和 `![[图.png]]` 走同一个缓存）。
   */
  const patchMdImages = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    for (const el of Array.from(host.querySelectorAll('img'))) {
      if (!(el instanceof HTMLImageElement)) continue;
      // 自己嵌的那批（带 data-embed-img）已经处理过；处理过的打过标记
      if (el.dataset.embedImg || el.dataset.suisuiSrc) continue;
      const raw = el.getAttribute('src') ?? '';
      if (!raw || /^(https?:|data:|blob:)/i.test(raw)) continue;
      const rel = decodeURIComponent(raw).replace(/^\.?\//, '').split('?')[0];
      const path = resolveFile(rel, Object.keys(filesRef.current), dirRef.current);
      if (!path) continue;
      const info = embedFor(path);
      if (info?.url) {
        el.src = info.url;
        el.dataset.suisuiSrc = path;
      }
    }
  }, [embedFor]);

  /** 点非图片的嵌入卡片 → 打开那篇 / 那个附件 */
  const openEmbed = useCallback((target: string) => {
    const path = resolveFile(target, Object.keys(filesRef.current), dirRef.current);
    if (path) useStore.getState().setCurrent(path);
  }, []);

  // 卸载时把造过的 blob URL 全收回去
  useEffect(() => {
    const cache = embedCache.current;
    return () => {
      for (const info of cache.values()) if (info.url) URL.revokeObjectURL(info.url);
      cache.clear();
    };
  }, []);

  /** 补全候选。查询词为空时给最近几篇，最后永远挂着「创建」那一项。 */
  const hintItems = useMemo<HintItem[]>(() => {
    if (!hint) return [];
    const items: HintItem[] = suggestNotes(hint.text, mdPaths, 8).map((p) => ({
      kind: 'open',
      name: titleOf(p),
      path: p,
      sub: p,
    }));
    const q = hint.text.trim();
    const exact = mdPaths.some((p) => titleOf(p).toLowerCase() === q.toLowerCase());
    if (q && !exact) items.push({ kind: 'create', name: `创建《${q}》`, sub: '先建一篇，点链接再过去' });
    return items;
  }, [hint, mdPaths]);

  const setHint = useCallback((q: WikiQuery | null) => {
    hintRef.current = q;
    setHintState(q);
    // 换了一批候选，选中项要回到第一条 —— 否则打字时会选中一个不相干的
    hintIdxRef.current = 0;
    setHintIdx(0);
  }, []);

  /** 插件那边说"该弹了"。刚被 Esc 收掉的那一拨不再弹，除非查询词又变了。 */
  const onQuery = useCallback(
    (q: WikiQuery | null) => {
      if (!q) {
        setHint(null);
        return;
      }
      const d = dismissedRef.current;
      if (d && d.from === q.from && d.text === q.text) {
        hintRef.current = null;
        setHintState(null);
        return;
      }
      if (d) dismissedRef.current = null;
      setHint(q);
    },
    [setHint],
  );

  /** 选中第 i 项：把 `[[已打的字` 换成 `[[笔记名]]` */
  const pickHint = useCallback(
    (i: number) => {
      const h = hintRef.current;
      const crepe = crepeRef.current;
      if (!h || !crepe) return;
      const it = hintItems[i];
      if (!it) return;
      try {
        const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
        const name = it.kind === 'create' ? h.text.trim() : it.name;
        if (name) insertWiki(view, h.from, h.from + h.text.length + 2, name);
      } catch {
        /* 编辑器还没就绪，就当没选 */
      }
      setHint(null);
    },
    [hintItems, setHint],
  );

  /** 浮层开着时，方向键/回车/Esc 归它 —— 回车不能变成换行 */
  const onHintKey = useCallback(
    (e: KeyboardEvent): boolean => {
      const h = hintRef.current;
      if (!h) return false;
      const n = hintItems.length;
      if (e.key === 'Escape') {
        dismissedRef.current = { text: h.text, from: h.from };
        setHint(null);
        return true;
      }
      if (n === 0) return false;
      if (e.key === 'ArrowDown') {
        hintIdxRef.current = (hintIdxRef.current + 1) % n;
        setHintIdx(hintIdxRef.current);
        return true;
      }
      if (e.key === 'ArrowUp') {
        hintIdxRef.current = (hintIdxRef.current - 1 + n) % n;
        setHintIdx(hintIdxRef.current);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        pickHint(hintIdxRef.current);
        return true;
      }
      return false;
    },
    [hintItems, pickHint, setHint],
  );

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
            // ⚠️ 所见即所得把 `[[` 序列化成 `\[\[`，存进去就不是链接了 —— 写回前还原
            saveRef.current = window.setTimeout(() => setContent(current, unescapeWiki(markdown)), 700);
          });
        });
        // ⚠️ 必须在 create() **之前**挂：插件是在编辑器起来那一刻装进去的，晚了就没有
        crepe.editor.use(
          wikiLinkPlugin({
            paths: () => pathsRef.current,
            dir: () => dirRef.current,
            onQuery,
            onKey: onHintKey,
            open: () => hintRef.current !== null,
            embed: embedFor,
            openEmbed,
          }),
        );
        // 跳转高亮（su-flash）—— 装饰版，直接改 DOM 的类会被 PM 重绘抹掉
        crepe.editor.use(flashPlugin());
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
        // 正文里的 `![](./图.png)` 要换成 blob URL，否则是个裂图
        patchMdImages();
        /*
         * 「创建笔记」之后把光标送进正文 —— **就在此刻处理**，不要另外起轮询去等：
         * 仓库一大，重建一个 Crepe 实例要一秒多，轮询等到的时刻比这晚得多，
         * 期间焦点还停在「创建」那颗按钮上（实测：1.2 秒时光标仍在 BUTTON 里）。
         *
         * 两件事：① 末尾只有标题时补个空段落（`# 标题\n\n` 的空行会被 markdown 解析掉）；
         * ② 用 ProseMirror 自己的 selection 把光标放到末尾 —— 塞 DOM Range 会被它下一帧覆盖回去。
         */
        if (focusTickRef.current > seenFocus.current) {
          seenFocus.current = focusTickRef.current;
          try {
            crepe.editor.action((ctx) => {
              const view = ctx.get(editorViewCtx);
              const paragraph = view.state.schema.nodes.paragraph;
              if (paragraph && view.state.doc.lastChild?.type.name === 'heading') {
                view.dispatch(view.state.tr.insert(view.state.doc.content.size, paragraph.create()));
              }
              view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
              view.focus();
            });
          } catch {
            /* 编辑器刚起来就取不到就算了，光标停在开头也不是不能写 */
          }
        }
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
          const md = unescapeWiki(instance.getMarkdown());
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
      const md = unescapeWiki(crepe.getMarkdown());
      if (md !== useStore.getState().files[current]) {
        window.clearTimeout(saveRef.current);
        setContent(current, md);
      }
    } catch {
      /* 编辑器还没就绪，没有东西可冲 */
    }
  }, [current, setContent]);

  /*
   * 源码模式下「创建笔记」之后把光标放进 textarea。
   * 那条路没有 ProseMirror，textarea 是同步渲染的，直接聚焦就行；
   * 所见即所得那条路不在这儿 —— 它要等实例建好，见上面 create() 之后那一段。
   */
  useEffect(() => {
    if (focusTick <= seenFocus.current) return;
    if (mode === 'wysiwyg' && isMd) return;
    seenFocus.current = focusTick;
    const el = taRef.current;
    if (!el) return;
    el.focus();
    try {
      el.setSelectionRange(el.value.length, el.value.length);
    } catch {
      /* 放不进去就算了，聚焦本身已经够用 */
    }
  }, [focusTick, mode, isMd]);

  /*
   * 笔记列表变了（刚建了一篇、刚同步下来一批），已经存在的链接要**从灰变亮**。
   * 装饰默认只在文档改动时重算，而这时文档一个字没动 —— 得手动刷一下。
   */
  useEffect(() => {
    const crepe = crepeRef.current;
    if (!crepe || mode !== 'wysiwyg') return;
    try {
      crepe.editor.action((ctx) => refreshWiki(ctx.get(editorViewCtx)));
    } catch {
      /* 编辑器还没起来，跳过 */
    }
    // 附件可能刚同步下来：嵌着的图和 `![](…)` 都要重新取一次地址
    patchMdImages();
  }, [files, mode, patchMdImages]);

  /*
   * 正文里的 `[[链接]]` / `#标签` 是可点的 —— 但**不是单击就跳**。
   * 这是编辑器不是阅读器：单击是"把光标放进去改字"，跳走会让人丢失正在写的位置。
   * 所以桌面端要 Ctrl / ⌘ + 单击；手机上没有修饰键，那边退化成单击就跳。
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host || mode !== 'wysiwyg' || !isMd) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      const narrow = window.matchMedia(NARROW).matches;
      const go = e.ctrlKey || e.metaKey || narrow;
      if (!go) return;

      const wiki = el.closest('[data-wiki]');
      if (wiki instanceof HTMLElement && wiki.dataset.wiki) {
        e.preventDefault();
        openWiki(wiki.dataset.wiki, wiki.dataset.heading ?? '');
        return;
      }
      const tag = el.closest('[data-tag]');
      if (tag instanceof HTMLElement && tag.dataset.tag) {
        e.preventDefault();
        // 再点一次同一个标签 = 取消筛选
        setTagFilter(tagFilter === tag.dataset.tag ? null : tag.dataset.tag);
      }
    };
    host.addEventListener('click', onClick);
    return () => host.removeEventListener('click', onClick);
  }, [mode, isMd, openWiki, setTagFilter, tagFilter]);

  /*
   * 点大纲（或 `[[某篇#某个小节]]` 跳过去）之后，滚到那个小节。
   * 编辑器是异步建的，所以轮询等它就绪 —— 跟「创建笔记后放光标」那条一个套路。
   * 两种模式各有各的滚法：
   *   所见即所得 —— 找到那个 heading 节点的 DOM，scrollIntoView + 闪一下；
   *   源码 —— textarea 里没有小节可滚，按大纲留的行号算偏移，把那一行滚到视口中间。
   */
  useEffect(() => {
    if (!pendingHeading || !isMd) return;

    if (mode === 'source') {
      const ta = taRef.current;
      if (!ta) return;
      const lines = ta.value.split('\n');
      const want = pendingHeading.trim();
      let line = -1;
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);
        // 跟右栏大纲用同一个净字函数 —— 那边显示什么，这边就按什么找
        if (m && cleanHeading(m[1]) === want) {
          line = i;
          break;
        }
      }
      setPendingHeading(null);
      if (line < 0) return;
      const off = lineOffset(lines, line);
      ta.focus();
      ta.setSelectionRange(off, off);
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 22;
      ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2);
      return;
    }

    let tries = 0;
    const timer = window.setInterval(() => {
      const crepe = crepeRef.current;
      if (!crepe) {
        if (++tries > 25) {
          window.clearInterval(timer);
          setPendingHeading(null);
        }
        return;
      }
      let done = false;
      try {
        done = crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const want = pendingHeading.trim();
          let pos = -1;
          let end = -1;
          view.state.doc.descendants((node, p) => {
            if (pos < 0 && node.type.name === 'heading' && node.textContent.trim() === want) {
              pos = p;
              end = p + node.nodeSize;
            }
          });
          if (pos < 0) return false;
          const dom = view.nodeDOM(pos);
          if (!(dom instanceof HTMLElement)) return false;
          dom.scrollIntoView({ block: 'center', behavior: 'smooth' });
          // 高亮走装饰（flashNode）：直接改 DOM 的类会被 PM 重绘当场抹掉
          flashNode(view, pos, end);
          return true;
        });
      } catch {
        /* 还没排版完，下一拍再试 */
      }
      if (done || ++tries > 25) {
        window.clearInterval(timer);
        setPendingHeading(null);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [pendingHeading, jumpTick, mode, isMd, setPendingHeading]);

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
    <EditorShell
      path={current}
      icon={<FileText size={13} />}
      tag={isMd ? <Badge tone="accent">MD</Badge> : null}
      status={
        <>
          {fail && <span className="shrink-0 text-[11.5px] text-danger">编辑器异常：{fail}</span>}
          {dirty && !fail && (
            <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-warn" title="有未同步的改动" />
          )}
        </>
      }
      actions={
        isMd ? (
          <ModeSwitch
            value={mode}
            onChange={(m) => {
              // 切之前先把所见即所得的缓冲落盘：不然源码框拿到的是旧稿，一改就把新写的顶掉
              if (m !== mode) flushEditor();
              setMode(m);
            }}
            options={[
              { value: 'wysiwyg', label: '所见即所得' },
              { value: 'source', label: '源码' },
            ]}
            attrFor={(m) => ({ 'data-mode': m })}
          />
        ) : null
      }
    >
      {isMd && <MdToolbar active={snap.active} onRun={runTool} currentHref={snap.href} />}

      {hasRawHtml && mode === 'wysiwyg' && (
        <div className="shrink-0 border-b border-warn-line bg-warn-soft py-2.5">
          <div className="mx-auto flex max-w-[46rem] items-start gap-2.5 px-6">
            <Alert size={14} className="mt-[3px] shrink-0 text-warn" />
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-warn">
              这篇含 HTML 标记（如 <code className="font-mono">{'<!-- 注释 -->'}</code>
              ）。所见即所得会把它当纯文本，保存可能改坏它。
            </p>
            <button
              onClick={() => setMode('source')}
              className="shrink-0 rounded-[8px] border border-warn-line bg-surface px-2.5 py-[3px] text-[12px] text-warn transition-colors hover:bg-warn-soft"
            >
              切到源码
            </button>
          </div>
        </div>
      )}

      <SheetBody>
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
      </SheetBody>

      {/*
        反向链接 / 标签 / 还没建的那些篇。没有关系的篇它整块不渲染，
        所以不用给它留一条永远占着位置的边栏。
      */}
      {isMd && !wide && <BacklinkPane path={current} text={content} />}

      {hint && mode === 'wysiwyg' && (
        <WikiHints
          x={hint.x}
          y={hint.y}
          items={hintItems}
          index={hintIdx}
          onPick={pickHint}
          onHover={(i) => {
            hintIdxRef.current = i;
            setHintIdx(i);
          }}
        />
      )}
    </EditorShell>
  );
}
