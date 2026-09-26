import { useState } from 'react';
import { useStore } from '../lib/store';
import { previewOf } from '../lib/anchors';
import { ListBullet, Quote, Trash, Pencil, BookOpen } from './icons';

/*
 * 阅读这一边的右栏：**目录** + **笔记（批注）**，上下两节。
 *
 * 为什么这两样要并列在这儿：读书的时候手边要用的就这两样 ——
 * 「这本书长什么样」（地图）和「我在这本书里留下了什么」（痕迹）。
 * 左栏留着书架（换书），正文是正文，**row 右栏就了该是这两件事**。
 *
 * 它们比另一边（大纲 / 关系 / 待建）跟眼前这本书贴得更近，
 * 所以读书时右栏整个换成这一份 —— 而不是把两种东西拼在一栏里让人自己分辨哪个跟现在有关。
 */

/** 一节的小标题。跟 RightPane 里那份是同一个样式，只是舍不得不抄过来 */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex h-8 items-center gap-2 pl-1 pr-0.5">
        <span className="eyebrow">{label}</span>
        <span className="h-px min-w-2 flex-1 bg-line" />
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-1.5 text-[11.5px] leading-relaxed text-ink-3">{children}</p>;
}

/** ── 目录 ── */
function Toc() {
  const meta = useStore((s) => s.books.find((b) => b.id === s.currentBook) ?? null);
  const chapter = useStore((s) => s.bookChapter);
  const jumpBook = useStore((s) => s.jumpBook);

  const toc = meta?.toc ?? [];
  return (
    <Section label="目录">
      {toc.length === 0 ? (
        <Hint>这本书没有目录 —— epub 里没带 toc.ncx / nav.xhtml。</Hint>
      ) : (
        <nav data-book-aside-toc className="space-y-px pb-1">
          {toc.map((t, i) => {
            const here = chapter === t.href;
            return (
              <button
                key={`${t.href}#${i}`}
                type="button"
                data-toc-item={t.href}
                onClick={() => jumpBook(t.href)}
                style={{ paddingLeft: 4 + t.level * 10 }}
                className={`block w-full truncate rounded-[6px] py-[4px] pr-1.5 text-left text-[12px] transition-colors hover:bg-surface-2 hover:text-ink ${
                  here ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2'
                }`}
                title={t.label}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      )}
    </Section>
  );
}

/** ── 笔记（这本书的批注） ── */
function Notes() {
  const notes = useStore((s) => s.bookNotes);
  const jumpNote = useStore((s) => s.jumpNote);
  const dropBookNote = useStore((s) => s.dropBookNote);
  const editBookNote = useStore((s) => s.editBookNote);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');

  return (
    <Section label={`笔记${notes.length > 0 ? ` ${notes.length}` : ''}`}>
      {notes.length === 0 ? (
        <Hint>在正文里划一段字，就可以留一笔。</Hint>
      ) : (
        <div data-book-note-list className="space-y-1 pb-1">
          {notes.map((n) => (
            <div
              key={n.id}
              data-book-note={n.id}
              className="group/note relative rounded-[7px] px-1 py-1 transition-colors hover:bg-surface-2"
            >
              <button
                type="button"
                data-book-note-goto={n.id}
                onClick={() => jumpNote(n.id)}
                className="block w-full text-left"
                title="跳到这一段"
              >
                {/* 划中的那句原话 —— 左边那条黄线呼应正文里的底色 */}
                <span className="mb-[2px] block border-l-2 border-warn pl-1.5 text-[11.5px] leading-snug text-ink-2">
                  {previewOf(n.quote, 52)}
                </span>
                {n.text && (
                  <span className="block whitespace-pre-wrap pl-1.5 text-[11.5px] leading-snug text-ink">
                    {n.text}
                  </span>
                )}
                {n.label && (
                  <span className="mt-[2px] block truncate pl-1.5 text-[10px] text-ink-3">
                    {n.label}
                  </span>
                )}
              </button>

              {editing === n.id ? (
                <div className="mt-1 px-1">
                  <textarea
                    data-book-note-input={n.id}
                    autoFocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditing(null);
                      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        void editBookNote(n.id, text).then(() => setEditing(null));
                      }
                    }}
                    rows={3}
                    className="w-full resize-none rounded-[7px] border border-line bg-paper px-1.5 py-1 text-[11.5px] leading-snug text-ink outline-none focus:border-accent"
                  />
                  <div className="mt-1 flex gap-1">
                    <button
                      data-book-note-save={n.id}
                      onClick={() => void editBookNote(n.id, text).then(() => setEditing(null))}
                      className="rounded-[6px] bg-accent px-2 py-[3px] text-[11px] font-medium text-white"
                    >
                      改好
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="rounded-[6px] border border-line px-2 py-[3px] text-[11px] text-ink-2"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                /* 悬停才露出来：这一栏本来就窄，常驻两个按钮会把正文挤没 */
                <div className="absolute right-1 top-1 hidden gap-0.5 group-hover/note:flex">
                  <button
                    data-book-note-edit={n.id}
                    onClick={() => {
                      setEditing(n.id);
                      setText(n.text);
                    }}
                    title={n.text ? '改想法' : '写点想法'}
                    className="rounded-[5px] bg-surface p-1 text-ink-3 shadow-sm transition-colors hover:text-ink"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    data-book-note-del={n.id}
                    onClick={() => void dropBookNote(n.id)}
                    title="删掉这一笔"
                    className="rounded-[5px] bg-surface p-1 text-ink-3 shadow-sm transition-colors hover:text-danger"
                  >
                    <Trash size={11} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

export default function BookAside() {
  const title = useStore(
    (s) => s.books.find((b) => b.id === s.currentBook)?.title ?? '这本书',
  );

  /*
   * ⚠️ 收起按钮不在这儿 —— 顶栏那颗 `data-right-toggle` 是唯一的一颗
   * （栏里有第二颗就会跟它撞选择器，而且栏一收按钮也跟着没了）。
   */
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 pl-1 text-[11px] text-ink-3">
            <BookOpen size={12} className="shrink-0" />
            <span className="truncate" title={title}>
              {title}
            </span>
          </div>
        </div>

        <Toc />
        <Notes />

        <div className="mt-auto flex items-center gap-1.5 pl-1 pt-2 text-[10.5px] text-ink-3">
          <ListBullet size={11} />
          划一段字就能留一笔
        </div>
        <div className="flex items-center gap-1.5 pl-1 text-[10.5px] text-ink-3">
          <Quote size={11} />
          点笔记跳回那一句
        </div>
      </div>
    </div>
  );
}
