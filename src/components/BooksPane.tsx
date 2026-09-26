import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { getProgress } from '../lib/bookdb';
import type { BookProgress } from '../lib/bookdb';
import { prettySize } from '../lib/binary';
import { Book, BookOpen, Close, Trash, Upload, Chevron } from './icons';

/*
 * 左栏的「书籍」：**书架** 和 **目录** 是同一个位置的两种形态。
 *
 * 读书的时候左栏换成那本书的目录 —— 目录长在边上（而不是塞进正文顶部）
 * 是因为它是"这本书长什么样"的地图，随时要看随时点，跟文件树是同一个位置、
 * 同一个手势。退回书架只要一下。
 *
 * ⚠️ 书目在 IndexedDB、书本身不进 `files` 也不参与同步（见 lib/bookdb.ts）。
 * 所以书架上的书和左边的笔记是**两码事**：它们不会出现在待同步里，
 * 也不会被推到远端。这是刻意的 —— 现在推几 MB 的二进制上去既没意义也拖慢每次同步。
 */

/** 书封面的小方块。没有封面就画一个书名首字的牌子 —— 空方块看着像图没加载出来 */
function Cover({ title, url }: { title: string; url?: string | null }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-[38px] w-[27px] shrink-0 rounded-[3px] object-cover ring-1 ring-line"
      />
    );
  }
  return (
    <span className="grid h-[38px] w-[27px] shrink-0 place-items-center rounded-[3px] bg-surface-2 text-[13px] font-medium text-ink-3 ring-1 ring-line">
      {title.slice(0, 1) || '书'}
    </span>
  );
}

export default function BooksPane() {
  const books = useStore((s) => s.books);
  const currentBook = useStore((s) => s.currentBook);
  const lastBookId = useStore((s) => s.lastBookId);
  const busy = useStore((s) => s.bookBusy);
  const err = useStore((s) => s.bookError);
  const importBook = useStore((s) => s.importBook);
  const dropBook = useStore((s) => s.dropBook);
  const openBook = useStore((s) => s.openBook);
  const setBookError = useStore((s) => s.setBookError);

  /** 上次在读的那本 —— 只为「继续读」那张卡存在。正在读的那本不配这张卡（它就在列表里高亮着） */
  const last = books.find((b) => b.id === lastBookId && b.id !== currentBook) ?? null;

  /*
   * 每本书读到哪了：进度存在 IndexedDB（跟字节分开），书目一变就重读一遍。
   * 书目不长（几十本），逐个取不值得建索引。
   */
  const [prog, setProg] = useState<Record<string, BookProgress>>({});
  /*
   * ⚠️ `currentBook` 必须在依赖里：读完一本书退回书架时，`books` 数组并没变，
   * 光靠它不会重跑 —— 书架上那个「读到 32%」就会停在进门那次读到的旧值上。
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Record<string, BookProgress> = {};
      for (const b of books) {
        const p = await getProgress(b.id);
        if (p) out[b.id] = p;
      }
      if (alive) setProg(out);
    })();
    return () => {
      alive = false;
    };
  }, [books, currentBook]);

  /** 删书要问一句 —— 书是几 MB 的东西，删了就得重新导入 */
  const [pendingDel, setPendingDel] = useState<string | null>(null);
  /** 拖着 epub 悬在书架上时的高亮 */
  const [over, setOver] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);

  const takeFiles = (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) {
      if (/\.epub$/i.test(f.name)) void importBook(f);
      else setBookError(`《${f.name}》不是 epub，书架只收 epub`);
    }
  };

  /* ── 书架 ──
   *
   * ⚠️ 以前读书的时候这一栏会换成那本书的目录，现在**不换了**：
   * 目录挪到右栏（跟笔记、批注挨着，那才是"读书时手边要用的东西"），
   * 左栏留着书架 —— 读着这本随手翻下一本，不用先退回书架再挑。
   */
  return (
    <div
      data-bookshelf
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        takeFiles(e.dataTransfer.files);
      }}
      className={`min-h-0 rounded-[9px] ${over ? 'outline outline-1 outline-accent' : ''}`}
    >
      {/*
        「继续读」：拿起上次那本。
        只在**真的读过**的时候出现 —— 从没打开过的书不配占这个位置，
        它跟下面列表里的其他书没有区别。计数来自 IndexedDB 里的进度，
        没有进度就不显示百分比（"继续读《X》"仍然有用）。
      */}
      {last && (
        <button
          type="button"
          data-book-resume
          onClick={() => openBook(last.id)}
          className="mb-1.5 flex w-full items-center gap-2 rounded-[9px] border border-line bg-surface px-1.5 py-1.5 text-left transition-colors hover:bg-surface-2"
          title={`继续读《${last.title}》`}
        >
          <Cover title={last.title} url={last.coverUrl} />
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] leading-snug text-ink-3">继续读</span>
            <span className="block truncate text-[12.5px] leading-snug text-ink">
              {last.title}
            </span>
            <span className="block text-[10.5px] leading-snug text-ink-3">
              {prog[last.id] ? `读到 ${Math.round(prog[last.id].percent)}%` : '还没开始'}
            </span>
          </span>
          <Chevron size={12} className="shrink-0 text-ink-3" />
        </button>
      )}

      <div className="mb-1.5 flex items-center gap-1.5 px-1.5">
        <button
          data-book-import
          onClick={() => pickRef.current?.click()}
          disabled={busy}
          className="flex h-[26px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-line bg-surface px-2 text-[11.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          title="把 epub 加进书架（也可以直接拖进来）"
        >
          <Upload size={12} className="shrink-0" />
          {busy ? '正在导入…' : '导入 epub'}
        </button>
      </div>
      <input
        ref={pickRef}
        data-book-import-input
        type="file"
        multiple
        accept=".epub,application/epub+zip"
        onChange={(e) => {
          takeFiles(e.target.files);
          e.target.value = ''; // 清空，否则同一本再选一次不触发 change
        }}
        className="hidden"
      />

      {err && (
        <div
          data-book-error
          className="mb-1.5 flex items-start gap-1.5 rounded-[8px] border border-danger-line bg-danger-soft px-2 py-1.5"
        >
          <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-danger">{err}</span>
          <button
            data-book-error-close
            onClick={() => setBookError(null)}
            className="shrink-0 rounded-[5px] p-0.5 text-danger transition-colors hover:bg-danger/10"
          >
            <Close size={11} />
          </button>
        </div>
      )}

      {books.length === 0 ? (
        <div data-bookshelf-empty className="px-2 py-6 text-center">
          <Book size={22} className="mx-auto mb-2 text-ink-3" />
          <p className="text-[12.5px] leading-relaxed text-ink-3">
            书架上还没有书
            <br />
            点「导入 epub」，或把书拖进来
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            书存在本机，不进笔记库、不参与同步
          </p>
        </div>
      ) : (
        <div className="space-y-[1px]">
          {books.map((b) => {
            const p = prog[b.id];
            /** 手上正读着的那本：给个色条 + 「正在读」，人才知道"我在哪儿" */
            const now = b.id === currentBook;
            return (
              <div key={b.id} className="group relative">
                <button
                  type="button"
                  data-book-item={b.id}
                  data-book-now={now ? '1' : undefined}
                  onClick={() => openBook(b.id)}
                  className={`flex w-full items-center gap-2 rounded-[7px] px-1.5 py-[5px] text-left transition-colors ${
                    now ? 'bg-surface-2 hover:bg-surface-2' : 'hover:bg-surface-2'
                  }`}
                >
                  <span className={`shrink-0 ${now ? 'text-accent' : 'text-ink-3'}`}>
                    {now ? <BookOpen size={13} /> : <Cover title={b.title} url={b.coverUrl} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[12.5px] leading-snug ${
                        now ? 'font-medium text-ink' : 'text-ink'
                      }`}
                    >
                      {b.title}
                    </span>
                    <span className="block truncate text-[10.5px] leading-snug text-ink-3">
                      {now ? '正在读 · ' : ''}
                      {b.author || '佚名'}
                      {p ? ` · 读到 ${Math.round(p.percent)}%` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-3">{prettySize(b.size)}</span>
                </button>
                <button
                  data-book-del={b.id}
                  onClick={() => setPendingDel(b.id)}
                  title="从书架移除（文件本身不动）"
                  // 桌面悬停才露出来；**手机上没有悬停**，所以窄屏一律显示 ——
                  // 否则手机上根本删不掉书（那个按钮永远 display:none）
                  className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-[5px] p-1 text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger group-hover:block max-md:block"
                >
                  <Trash size={12} />
                </button>

                {pendingDel === b.id && (
                  <div
                    data-book-del-confirm
                    className="mt-1 rounded-[9px] border border-danger-line bg-danger-soft px-2.5 py-2"
                  >
                    <p className="text-[11.5px] leading-relaxed text-danger">
                      把《{b.title}》从书架移除？书文件本身不动，但阅读进度会一起清掉。
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <button
                        data-book-del-yes
                        onClick={() => {
                          void dropBook(b.id);
                          setPendingDel(null);
                        }}
                        className="rounded-[7px] bg-danger px-2.5 py-[5px] text-[11.5px] font-medium text-white transition-opacity hover:opacity-90"
                      >
                        移除
                      </button>
                      <button
                        data-book-del-no
                        onClick={() => setPendingDel(null)}
                        className="rounded-[7px] border border-line bg-surface px-2.5 py-[5px] text-[11.5px] text-ink-2 transition-colors hover:bg-surface-2"
                      >
                        先不
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
