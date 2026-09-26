import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { blobOf, mimeOf } from '../lib/binary';
import { getBookBytes, getProgress, putProgress } from '../lib/bookdb';
import { chapterText, decodeUtf8, joinPath, readEpub, searchBook } from '../lib/epub';
import type { ParsedBook } from '../lib/epub';
import type { BookNote } from '../lib/bookdb';
import { chapterHostOf, clampAnchor, domRange, offsetInDom, previewOf } from '../lib/anchors';
import ReaderStyleFields from './ReaderStyleFields';
import { Search, Close, Book, ListBullet, Highlighter, Quote, Chevron } from './icons';

/*
 * 阅读器。几件要紧事，每件都踩过坑或绕开了坑：
 *
 * **① 章节怎么进 DOM。** 用 DOMParser 解析成文档，`<body>` 里的内容**消毒后**取 innerHTML，
 * 直接塞进我们自己的容器（不是 iframe）。
 *   不用 iframe 的理由：沙箱化的 iframe 是**跨源**的，父页面读不到它的滚动位置、
 *   也不能让它滚到某一处 —— 而"记住读到哪""点目录跳过去"全靠这两个。
 *   不用沙箱又要防书里的脚本，就只能自己消毒：脚本 / 样式 / 外链 / on* 事件一律剥掉。
 *
 * **② 书里的 CSS 一律不用。** epub 自带的样式千奇百怪（写死字号、写死白底黑字、
 * 写死宽度），照搬的结果是"字号调了没反应""夜间模式一半字看不见" ——
 * 而字号 / 行距 / 背景正是这个阅读器要提供的东西。所以只保留**结构**
 * （标题、段落、引用、列表、图片、表格、加粗斜体），排版归我们。
 *
 * **③ 图片走 blob URL，不走 data URL。** 一本几百张图的书，全转 base64 会让内存
 * 涨三分之一；blob 只是指向同一份字节。代价是**必须记得 revoke**，
 * 换书 / 卸载时统一撤掉，否则每读一本就漏一批。
 */

type Chapter = { href: string; label: string; html: string; text: string };

/** 划出来的那一段（还没决定要不要留下的时候） */
type SelBox = { href: string; start: number; end: number; quote: string; x: number; y: number };

/** 一个矩形，坐标相对**正文左上角** —— 滚着看不用重算 */
type Box = { top: number; left: number; w: number; h: number };

/** 这些标签连内容一起去掉：脚本会跑、样式会盖住我们的排版、外链会跳出去 */
const DROP_TAGS = ['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'form'];

export default function BookPane() {
  const bookId = useStore((s) => s.currentBook);
  const meta = useStore((s) => s.books.find((b) => b.id === s.currentBook) ?? null);
  const jump = useStore((s) => s.bookJump);
  const jumpBook = useStore((s) => s.jumpBook);
  const chapter = useStore((s) => s.bookChapter);
  const closeBook = useStore((s) => s.closeBook);
  const setBookChapter = useStore((s) => s.setBookChapter);
  const notes = useStore((s) => s.bookNotes);
  const loadBookNotes = useStore((s) => s.loadBookNotes);
  const addBookNote = useStore((s) => s.addBookNote);
  const noteJump = useStore((s) => s.noteJump);
  /** 排版。两个入口共用的同一份 —— 详见 ReaderStyleFields 头上的说明 */
  const prefs = useStore((s) => s.readerPrefs);
  const openSettings = useStore((s) => s.openSettings);

  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /**
   * 「Aa」排版面板开没开。
   * 它读写的是 **store 里那份偏好**（家在 IndexedDB），不是本组件的局部状态 ——
   * 设置对话框「阅读」那一节改的是同一份，所以两个入口永远一致，不会各说各话。
   */
  const [showSkin, setShowSkin] = useState(false);

  /** 手机上右栏不渲染，**目录得有另一个入口** —— 抬头那个按钮供养着它 */
  const [tocOpen, setTocOpen] = useState(false);
  /** 划了一段之后浮在字上的那条工具栏 */
  const [sel, setSel] = useState<SelBox | null>(null);
  /** 正在写想法（工具条点了「写想法」） */
  const [draft, setDraft] = useState<(SelBox & { text: string }) | null>(null);
  /** 右栏点了某条批注 → 那一段强调一下，让人知道跳到哪儿了 */
  const [focusId, setFocusId] = useState<string | null>(null);
  /** 批注底色，**相对正文左上角**的矩形（跟滚动无关，所以滚着看不用重算） */
  const [marks, setMarks] = useState<{ id: string; rects: Box[] }[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** 正文那一框（`<article>`）—— 选区落在哪儿要问它 */
  const bodyRef = useRef<HTMLElement>(null);
  /** 正文外面那层定位容器：批注底色和工具条的坐标系就是它的左上角 */
  const frameRef = useRef<HTMLDivElement>(null);
  const blobs = useRef<string[]>([]);
  /** 每章的纯文本下标 → 用于把搜索命中换算成"第几章第几字" */
  const textsRef = useRef<Chapter[]>([]);

  /*
   * 载入：取字节 → 解压解析 → 逐章消毒 → 拼成一整段连续的 HTML。
   * 拼在一起而不是"一章一屏"，是因为选的是**连续滚动**：一章读完接着下一章，
   * 目录和搜索负责跳，不做翻页。
   */
  useEffect(() => {
    if (!bookId) return;
    let alive = true;
    setChapters(null);
    setLoadErr(null);
    void (async () => {
      try {
        const bytes = await getBookBytes(bookId);
        if (!bytes) {
          if (alive) setLoadErr('这本书的数据不在本机了 —— 重新导入一次吧');
          return;
        }
        const parsed = readEpub(new Uint8Array(bytes));
        if (!parsed) {
          if (alive) setLoadErr('这本 epub 读不出来（可能已损坏）');
          return;
        }
        const made = buildChapters(parsed, blobs.current);
        if (!alive) return;
        textsRef.current = made;
        setChapters(made);
        void loadBookNotes(bookId);
        // 恢复上次读到的位置：进度里存的是"哪一章 + 那一章滚过的比例"
        const p = await getProgress(bookId);
        requestAnimationFrame(() => {
          if (!alive) return;
          if (p) restore(p.href, p.ratio);
          else setBookChapter(made[0]?.href ?? null);
        });
      } catch (e) {
        if (alive) setLoadErr(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  /** 换书 / 卸载：把所有 blob URL 撤掉。漏一个就是漏一份整书的字节 */
  useEffect(
    () => () => {
      for (const u of blobs.current) URL.revokeObjectURL(u);
      blobs.current = [];
    },
    [bookId],
  );

  /** 跳到某一章（或那一章里的第 N 个字） */
  const goTo = (href: string, at: number | null) => {
    const box = scrollRef.current;
    if (!box) return;
    const host = href.split('#')[0];
    const el = box.querySelector<HTMLElement>(`[data-chapter="${cssEscape(host)}"]`);
    if (!el) return;
    clearMarks(box);
    if (at === null) {
      box.scrollTop = el.offsetTop;
      setBookChapter(host);
      return;
    }
    const found = markAt(el, at, query.trim().length || 1);
    (found ?? el).scrollIntoView({ block: 'center' });
    setBookChapter(host);
  };

  const restore = (href: string, ratio: number) => {
    const box = scrollRef.current;
    if (!box) return;
    const el = box.querySelector<HTMLElement>(`[data-chapter="${cssEscape(href.split('#')[0])}"]`);
    if (!el) return;
    box.scrollTop = el.offsetTop + ratio * Math.max(0, el.offsetHeight - box.clientHeight);
    setBookChapter(href.split('#')[0]);
  };

  /* 左栏目录 / 搜索结果点过来 */
  useEffect(() => {
    if (!jump || !chapters) return;
    goTo(jump.href, jump.at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.tick]);

  /*
   * 滚动 → 记进度。节流 400ms：这是**唯一会反复写 IndexedDB 的地方**，
   * 每帧写一次会把硬盘写满日志。退出前那一次靠下面的 unmount 兜底。
   */
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || !chapters || !bookId) return;
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => saveProgress(bookId, box), 400);
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      box.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
      void saveProgress(bookId, box); // 关掉之前最后记一次
    };
  }, [chapters, bookId]);

  const hits = useMemo(() => {
    const q = query.trim();
    if (!q || !chapters) return [];
    return searchBook(
      chapters.map((c) => ({ href: c.href, label: c.label, text: c.text })),
      q,
      40,
    );
  }, [query, chapters]);

  /*
   * 批注底色。
   *
 * 为什么是**浮一层绝对定位的方块**，而不是给文字包 `<mark>`：
 * 包 mark 会把一个文本节点撕成三段（`splitText`），批注一多正文就不是原来那个 DOM 了
 * —— 而搜索也在动同一个 DOM，两边互相使绊子。
 * 浮层不改 DOM 一个字节，且坐标相对正文左上角，**滚动时不用重算**。
   * 只在书目 / 排版（字号行距会改变行高）变了之后重算一次。
   */
  useEffect(() => {
    if (!chapters) return;
    const id = requestAnimationFrame(() => setMarks(measureNotes(notes, frameRef.current)));
    return () => cancelAnimationFrame(id);
    // prefs 在依赖里：字号 / 行距 / **字体**一改，每行字的位置就变了，
    // 上次量好的矩形全得重算（同一段字在不同字体下长短不一样，重排后行数也不同）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, chapters, prefs.fontSize, prefs.lineHeight, prefs.font]);

  /*
   * 窗口一改大小，行宽跟着变、文字重排 —— 矩形必须重量。
   * 滚动**不算**：坐标本来就是相对正文内容而言的，内容没动。
   */
  useEffect(() => {
    if (!chapters) return;
    let t = 0;
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setMarks(measureNotes(notes, frameRef.current)), 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(t);
    };
  }, [notes, chapters]);

  /** 右栏点了一条批注 → 滚过去，并把那一段点亮一下（2 秒后自己暗下去） */
  useEffect(() => {
    if (!noteJump || !chapters) return;
    const n = notes.find((x) => x.id === noteJump.id);
    const box = scrollRef.current;
    if (!n || !box) return;
    const host = box.querySelector<HTMLElement>(`[data-chapter="${cssEscape(n.href)}"]`);
    if (!host) return;
    const r = domRange(host, n.start, n.end);
    setBookChapter(n.href);
    if (r) {
      // Range 没有 scrollIntoView —— 拿它的第一个矩形（第一段第一行）当落点，
      // 居中是为了让被划的那句落在视线中间，而不是刚好处在屏幕边缘
      const rect = Array.from(r.getClientRects())[0] ?? host.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      box.scrollTo({
        top: box.scrollTop + (rect.top - boxRect.top) - box.clientHeight / 2 + rect.height / 2,
        behavior: 'smooth',
      });
    } else {
      host.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    setFocusId(n.id);
    const timer = window.setTimeout(() => setFocusId(null), 2200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteJump?.tick]);

  /*
   * 松手（鼠标 / 手指）之后看一眼选区：划了字就浮出工具条。
   *
   * 为什么是 mouseup 而不是 selectionchange：**触屏和双击选词会连续触发** selectionchange，
   * 中间那些半成品状态会让工具条满屏乱跳。松手那一刻选区才定下来。
   */
  const onBodyUp = () => {
    const s = window.getSelection();
    const box = scrollRef.current;
    if (!s || s.isCollapsed || !box || !s.anchorNode || !s.focusNode) {
      setSel(null);
      return;
    }
    const body = bodyRef.current;
    if (!body || !body.contains(s.anchorNode)) {
      setSel(null);
      return;
    }
    const host = chapterHostOf(s.anchorNode, body);
    // 跨章的选区不要：一批注必须钉得住某一处，横跨两章的那"一处"不存在
    if (!host || host !== chapterHostOf(s.focusNode, body)) {
      setSel(null);
      return;
    }
    const href = host.getAttribute('data-chapter') ?? '';
    const a = offsetInDom(host, s.anchorNode, s.anchorOffset);
    const b = offsetInDom(host, s.focusNode, s.focusOffset);
    if (a === null || b === null) {
      setSel(null);
      return;
    }
    const { start, end } = clampAnchor(host.textContent ?? '', a, b);
    const quote = (host.textContent ?? '').slice(start, end);
    if (!quote.trim()) {
      setSel(null);
      return;
    }
    const base = body.getBoundingClientRect();
    const r = s.getRangeAt(0).getBoundingClientRect();
    setSel({
      href,
      start,
      end,
      quote,
      // 工具条在选区**上方**冒出来（下方的话手指/鼠标刚好把要点的按钮压住）
      x: r.left - base.left + r.width / 2,
      y: r.top - base.top,
    });
  };

  /** 留下一笔。`text` 为空 = 只划了重点，没写字 */
  const keep = async (text: string) => {
    const box = draft ?? sel;
    if (!box || !bookId) return;
    await addBookNote({
      bookId,
      href: box.href,
      start: box.start,
      end: box.end,
      quote: box.quote,
      text,
      label: meta?.toc.find((t) => t.href.split('#')[0] === box.href)?.label ?? '',
    });
    setSel(null);
    setDraft(null);
    window.getSelection()?.removeAllRanges();
  };

  if (loadErr) {
    return (
      <div data-book-reader className="grid h-full place-items-center px-6">
        <div className="text-center">
          <Book size={24} className="mx-auto mb-2 text-ink-3" />
          <p className="text-[13px] leading-relaxed text-ink-2">{loadErr}</p>
        </div>
      </div>
    );
  }

  return (
    <div data-book-reader className="flex h-full min-h-0 flex-col">
      {/* 抬头：书名 + 书内搜索 + 排版 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-4 py-2">
        {/*
          合上这本书。以前它在左栏（那时读书时左栏换成了目录），现在左栏留着书架、
          目录去了右栏，所以"不读了"这个动作得换成-button 自己站在这儿 ——
          不然打开一本就再也回不到"书架上什么都没打开"那个状态。
        */}
        <button
          data-book-back
          onClick={() => closeBook()}
          title="合上这本书，回书架"
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] border border-line bg-surface text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Chevron size={12} className="rotate-180" />
        </button>
        {/*
          目录。**手机上右栏不渲染**（那儿在地盘上是笔记的），所以目录必须有一个自己的入口，
          否则手机上看书就只能从头读到尾。桌面上右栏已经有一份，这份留着是给窄窗口用的。
        */}
        <button
          data-book-toc-btn
          onClick={() => setTocOpen((v) => !v)}
          className={`md:hidden rounded-[8px] border px-2 py-[4px] text-[11.5px] transition-colors ${
            tocOpen ? 'border-line-2 bg-surface-2 text-ink' : 'border-line bg-surface text-ink-2'
          }`}
          title="这本书的目录"
        >
          <ListBullet size={12} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
          {meta?.title ?? '…'}
        </span>

        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            data-book-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder="书内搜索"
            className="w-[120px] rounded-[8px] border border-line bg-surface py-[4px] pl-6 pr-6 text-[11.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
          />
          {query && (
            <button
              data-book-search-clear
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-[5px] p-0.5 text-ink-3 hover:text-ink"
            >
              <Close size={10} />
            </button>
          )}
          {query.trim() && (
            <div
              data-book-hits
              className="absolute right-0 top-[calc(100%+4px)] z-20 max-h-[300px] w-[300px] overflow-y-auto rounded-[9px] border border-line bg-surface p-1 shadow-pop"
            >
              {hits.length === 0 ? (
                <p className="px-2 py-2 text-[11.5px] text-ink-3">书里没有「{query.trim()}」</p>
              ) : (
                hits.map((h) => (
                  <button
                    key={`${h.href}#${h.at}`}
                    type="button"
                    data-book-hit
                    onClick={() => goTo(h.href, h.at)}
                    className="block w-full rounded-[7px] px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="block truncate text-[11px] text-ink-3">{h.label}</span>
                    <span className="block text-[12px] leading-snug text-ink-2">{h.snippet}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/*
          排版：字体 / 字号 / 行距 / 纸色。折叠成一颗小按钮 —— 抬头只有一行高，
          把这四摊控件常驻在这儿会把书名挤没。
          ⚠️ 面板做成**挂在按钮下面的浮层**而不是再占一行横条：
          它是临时伸出来的一格，收回去时不该把正文往下推（也不该动已有的滚动位置）。
        */}
        <div className="relative">
          <button
            data-book-skin
            onClick={() => setShowSkin((v) => !v)}
            aria-expanded={showSkin}
            className={`rounded-[8px] border px-2 py-[4px] text-[11.5px] transition-colors ${
              showSkin
                ? 'border-line-2 bg-surface-2 text-ink'
                : 'border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink'
            }`}
            title="字体 / 字号 / 行距 / 纸色"
          >
            Aa
          </button>
          {showSkin && (
            <div
              data-book-skin-panel
              className="absolute right-0 top-[calc(100%+6px)] z-30 w-[318px] rounded-[12px] border border-line bg-surface p-3 shadow-pop max-md:right-auto max-md:left-auto max-md:w-[calc(100vw-32px)]"
            >
              <ReaderStyleFields ns="book" />
              <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
                <button
                  data-book-skin-more
                  onClick={() => {
                    setShowSkin(false);
                    openSettings('reading');
                  }}
                  className="rounded-[7px] border border-line px-2 py-[3px] text-[11px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  设置里还有一份（带预览）
                </button>
                <button
                  data-book-skin-close
                  onClick={() => setShowSkin(false)}
                  className="ml-auto text-[11px] text-ink-3 transition-colors hover:text-ink"
                >
                  收起
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/*
        正文。所有章节拼在一起连续滚动；`data-chapter` 是目录和搜索定位的锚点。
        ⚠️ dangerouslySetInnerHTML 的内容**已经过 buildChapters 消毒**：
        脚本 / 样式 / 外链 / on* 事件都在那儿剥掉了。
      */}
      <div
        ref={scrollRef}
        data-book-scroll
        data-book-theme={prefs.theme}
        data-book-font={prefs.font}
        /*
         * ⚠️ 这个 `relative` 不是装饰：章节的 `offsetTop` 要跟 `scrollTop` 在同一个坐标系里，
         * 而 offsetTop 是相对**最近的定位祖先**算的。少了它，offsetParent 会跑到更外层去，
         * "滚到第三章"和"这一章滚过的比例"两个数字就都对着另一套坐标 —— 表现为跳错章。
         */
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        {/* 手机上点「目录」弹出来的那一份。跟右栏那份是同一棵树，只是换个地方长 */}
        {tocOpen && (
          <div
            data-book-toc-pop
            className="absolute inset-y-0 left-0 z-30 w-[min(280px,78%)] overflow-y-auto border-r border-line bg-paper px-2 py-3 shadow-pop"
          >
            <p className="mb-1.5 truncate px-1.5 text-[12.5px] font-medium text-ink">
              {meta?.title}
            </p>
            {(meta?.toc ?? []).length === 0 ? (
              <p className="px-1.5 py-4 text-center text-[12px] text-ink-3">这本书没有目录</p>
            ) : (
              <div className="space-y-[1px]">
                {(meta?.toc ?? []).map((t, i) => (
                  <button
                    key={`${t.href}#${i}`}
                    type="button"
                    data-book-toc-item={t.href}
                    onClick={() => {
                      jumpBook(t.href);
                      setTocOpen(false);
                    }}
                    style={{ paddingLeft: 6 + t.level * 12 }}
                    className={`block w-full truncate rounded-[7px] py-[5px] pr-1.5 text-left text-[12.5px] transition-colors ${
                      chapter === t.href
                        ? 'bg-surface-2 font-medium text-ink'
                        : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                    }`}
                    title={t.label}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {chapters === null ? (
          <p className="px-6 py-10 text-center text-[12.5px] text-ink-3">正在把这本书摊开…</p>
        ) : (
          /*
           * 外面这层 `relative` 是留给两样东西的：**批注底色**和**选区工具条**。
           * 它跟着正文同一个宽度（max-w / mx-auto），所以浮层的 `left` 可以直接用
           * 相对正文左上角的那个坐标系 —— 差一个的话，所有块都会整体偏过去。
           */
          <div ref={frameRef} className="book-body relative mx-auto max-w-[46em]">
            <article
              ref={bodyRef}
              data-book-body
              onMouseUp={onBodyUp}
              onTouchEnd={onBodyUp}
              style={{
                fontSize: `${prefs.fontSize}px`,
                lineHeight: prefs.lineHeight,
              }}
              className="book-body px-6 py-8"
              dangerouslySetInnerHTML={{
                __html: chapters.map((c) => `<section data-chapter="${escAttr(c.href)}">${c.html}</section>`).join(''),
              }}
            />

            {/*
              批注底色。`pointer-events-none` 是要紧的：它是层浮在字上面的方块，
              要是能接住指针，**选文字就会被它挡住**，划不了第二段。
            */}
            <div data-book-marks className="pointer-events-none absolute inset-0 overflow-hidden">
              {marks.map((m) =>
                m.rects.map((r, i) => (
                  <div
                    key={`${m.id}#${i}`}
                    data-note-box={m.id}
                    data-focus={focusId === m.id ? '1' : undefined}
                    style={{ top: r.top, left: r.left, width: r.w, height: r.h }}
                    className={`book-note-mark absolute rounded-[2px] transition-colors duration-300 ${
                      focusId === m.id ? 'ring-1 ring-line-2' : ''
                    }`}
                  />
                )),
              )}
            </div>

            {/* 划完之后浮出来的工具条：留 / 写想法 */}
            {sel && !draft && (
              <div
                data-book-sel-bar
                style={{ left: sel.x, top: sel.y }}
                className="absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-[9px] border border-line bg-surface px-1 py-1 shadow-pop"
              >
                <button
                  data-book-mark-hl
                  onClick={() => void keep('')}
                  className="flex items-center gap-1 rounded-[7px] px-2 py-1 text-[11.5px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                  title="只划重点，不写字"
                >
                  <Highlighter size={12} />
                  划重点
                </button>
                <button
                  data-book-mark-note
                  onClick={() => setDraft({ ...sel, text: '' })}
                  className="flex items-center gap-1 rounded-[7px] px-2 py-1 text-[11.5px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                  title="给这段写点想法"
                >
                  <Quote size={12} />
                  写想法
                </button>
              </div>
            )}

            {/* 写想法。 Ctrl+Enter 保存，Esc 取消 —— 不然划一段就得去够鼠标 */}
            {draft && (
              <div
                data-book-draft
                style={{ left: draft.x, top: draft.y }}
                className="absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+8px)] w-[260px] rounded-[10px] border border-line bg-surface p-2 shadow-pop"
              >
                <p className="mb-1.5 line-clamp-2 border-l-2 border-warn pl-1.5 text-[11px] leading-snug text-ink-3">
                  {previewOf(draft.quote, 60)}
                </p>
                <textarea
                  data-book-draft-input
                  autoFocus
                  value={draft.text}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setDraft(null);
                      setSel(null);
                    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      void keep(draft.text);
                    }
                  }}
                  placeholder="想到什么就写在这"
                  rows={3}
                  className="w-full resize-none rounded-[7px] border border-line bg-paper px-2 py-1.5 text-[12px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
                />
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    data-book-draft-save
                    onClick={() => void keep(draft.text)}
                    className="rounded-[7px] bg-accent px-2.5 py-[4px] text-[11.5px] font-medium text-white transition-opacity hover:opacity-90"
                  >
                    留下
                  </button>
                  <button
                    data-book-draft-cancel
                    onClick={() => {
                      setDraft(null);
                      setSel(null);
                    }}
                    className="rounded-[7px] border border-line px-2.5 py-[4px] text-[11.5px] text-ink-2 transition-colors hover:bg-surface-2"
                  >
                    取消
                  </button>
                  <span className="ml-auto text-[10.5px] text-ink-3">Ctrl+Enter</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 下面这些是这一层的"杂活"，放在组件外头保持组件本体读得下去 ── */

/** 量一遍每条批注在正文上盖几块矩形。坐标相对**法定容器**（= 底色那一层的左上角） */
function measureNotes(notes: readonly BookNote[], frame: HTMLElement | null) {
  if (!frame) return [];
  const base = frame.getBoundingClientRect();
  const out: { id: string; rects: Box[] }[] = [];
  for (const n of notes) {
    const host = frame.querySelector<HTMLElement>(`[data-chapter="${cssEscape(n.href)}"]`);
    if (!host) continue;
    const r = domRange(host, n.start, n.end);
    if (!r) continue;
    const rects = Array.from(r.getClientRects())
      .filter((x) => x.width > 0.5 && x.height > 0.5)
      .map((x) => ({
        top: x.top - base.top,
        left: x.left - base.left,
        w: x.width,
        h: x.height,
      }));
    if (rects.length) out.push({ id: n.id, rects });
  }
  return out;
}

/** 目录里的 href 可能带 `#` 和中文，进 CSS 选择器要转义 */
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * 逐章消毒 + 把图片换成 blob URL。
 *
 * 消毒清单是有先后的：**先**整块挖掉 script / style（里面的字会打乱解析），
 * **再**处理资源路径，**最后**清 on* 事件和 javascript: 链接 ——
 * 顺序反了会漏（比如被 script 里的 `<img` 骗过）。
 */
function buildChapters(parsed: ParsedBook, blobBag: string[]): Chapter[] {
  const labelOf = new Map(parsed.toc.map((t) => [t.href.split('#')[0], t.label]));
  const out: Chapter[] = [];
  for (const href of parsed.spine) {
    const raw = parsed.files[href];
    if (!raw) continue;
    const xhtml = decodeUtf8(raw);
    out.push({
      href,
      label: labelOf.get(href) ?? '',
      html: sanitizeChapter(xhtml, href, parsed, blobBag),
      text: chapterText(xhtml),
    });
  }
  return out;
}

function sanitizeChapter(
  xhtml: string,
  chapterPath: string,
  parsed: ParsedBook,
  blobBag: string[],
): string {
  const doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
  const body = doc.querySelector('body') ?? doc.documentElement;
  if (!body) return '';

  for (const tag of DROP_TAGS) {
    for (const el of Array.from(body.querySelectorAll(tag))) el.remove();
  }

  // 图片 / svg 引用 → blob URL。路径是**相对这一章**的，不是相对 opf
  const dir = chapterPath.slice(0, Math.max(0, chapterPath.lastIndexOf('/')));
  const resolve = (src: string) => {
    const zipPath = joinPath(dir, src);
    const bytes = parsed.files[zipPath];
    if (!bytes) return null;
    const url = URL.createObjectURL(blobOf(bytes, mimeOf(zipPath)));
    blobBag.push(url);
    return url;
  };
  for (const img of Array.from(body.querySelectorAll('img'))) {
    const src = img.getAttribute('src');
    if (!src || /^(data|blob|https?):/i.test(src)) continue;
    const url = resolve(src);
    if (url) img.setAttribute('src', url);
    else img.remove(); // 取不到的图留着就是个破图标
  }
  for (const im of Array.from(body.querySelectorAll('image'))) {
    for (const attr of ['href', 'xlink:href']) {
      const src = im.getAttribute(attr);
      if (!src || /^(data|blob|https?):/i.test(src)) continue;
      const url = resolve(src);
      if (url) im.setAttribute(attr, url);
    }
  }

  // 事件属性和 javascript: 链接：书是别人做的，不能信
  for (const el of Array.from(body.querySelectorAll('*'))) {
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name)) el.removeAttribute(a.name);
      else if (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) {
        el.removeAttribute(a.name);
      }
    }
  }
  return body.innerHTML;
}

/** 当前读到哪一章 + 那一章滚过的比例 → 存起来 */
async function saveProgress(bookId: string, box: HTMLElement) {
  /*
   * ⚠️ 卸载那一次必须先看元素还在不在文档里。
   * React 跑 effect 清理时节点已经摘掉了，此时 `scrollTop` 和 `clientHeight` **都是 0**，
   * 照算会得到"在第 0 像素、窗口高 0"→ 于是判定成"读到了最后一章、进度 0%"，
   * 把真正的进度盖掉。症状很怪：退出一本书，再打开跳到最后一章。
   */
  if (!box.isConnected || box.clientHeight === 0) return;
  const secs = Array.from(box.querySelectorAll<HTMLElement>('[data-chapter]'));
  if (secs.length === 0) return;
  const top = box.scrollTop;
  const mid = top + box.clientHeight / 2;
  let idx = 0;
  for (let i = 0; i < secs.length; i++) if (secs[i].offsetTop <= mid) idx = i;
  const el = secs[idx];
  const ratio = el.offsetHeight > 0 ? Math.min(1, Math.max(0, (mid - el.offsetTop) / el.offsetHeight)) : 0;
  const href = el.getAttribute('data-chapter') ?? '';
  // 目录标题在书目的 toc 里（存在 IndexedDB，不跟着正文走）
  const label =
    useStore
      .getState()
      .books.find((b) => b.id === bookId)
      ?.toc.find((t) => t.href.split('#')[0] === href)?.label ?? '';
  await putProgress({
    id: bookId,
    href,
    label,
    ratio,
    percent: Math.round(((idx + ratio) / secs.length) * 100),
    at: new Date().toISOString(),
  });
  useStore.getState().setBookChapter(href);
}

/** 清掉上一次的高亮 */
function clearMarks(box: HTMLElement) {
  for (const m of Array.from(box.querySelectorAll('mark[data-book-mark]'))) {
    const parent = m.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(m.textContent ?? ''), m);
    parent.normalize();
  }
}

/**
 * 在某一章里，把纯文本的第 `at` 个字开始的 `len` 个字包成 `<mark>`。
 *
 * 为什么先算纯文本下标再反查 DOM：搜索用的是 `chapterText`（去标签后的文本），
 * 它和 DOM 里的**文本节点序列**是一一对应的 —— 顺着文本节点累加长度就能对上。
 * 直接拿 HTML 字符串去搜会撞进标签里（`class="xx"` 里的 xx 也算命中）。
 */
function markAt(el: HTMLElement, at: number, len: number): HTMLElement | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let node: Text | null = null;
  let offset = -1;
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    const n = t.data.length;
    if (acc + n > at) {
      node = t;
      offset = at - acc;
      break;
    }
    acc += n;
  }
  if (!node || offset < 0) return null;
  const rest = node.splitText(offset);
  const after = rest.data.length > len ? rest.splitText(len) : null;
  const mark = document.createElement('mark');
  mark.setAttribute('data-book-mark', '1');
  mark.className = 'rounded-[2px] bg-warn-soft px-[1px] text-ink';
  mark.textContent = rest.data;
  rest.parentNode?.replaceChild(mark, rest);
  void after;
  return mark;
}
