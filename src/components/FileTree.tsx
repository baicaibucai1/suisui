import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { isPush } from '../lib/decide';
import { isProgramArtifact } from '../lib/visible';
import { NOTE_DIRS, notePath } from '../lib/note';
import type { NoteDir } from '../lib/note';
import { NOTE_KINDS, isRichPath } from '../lib/rich';
import type { NoteKind } from '../lib/rich';
import type { ChangeKind } from '../lib/decide';
import { Chevron, Eye, EyeOff, FileText, Folder, Paper, Pen, Plus, Trash } from './icons';

/** 中文输入法组字期间按回车是"选词"，不能当成提交 —— 否则打拼音一选字就把笔记建了。 */
function isComposing(e: React.KeyboardEvent) {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

export default function FileTree() {
  const files = useStore((s) => s.files);
  const current = useStore((s) => s.current);
  const changes = useStore((s) => s.changes);
  const showAll = useStore((s) => s.showAll);
  const setShowAll = useStore((s) => s.setShowAll);
  const setCurrent = useStore((s) => s.setCurrent);
  const createFile = useStore((s) => s.createFile);
  const createNote = useStore((s) => s.createNote);
  const removeFile = useStore((s) => s.removeFile);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('thoughts/');
  // 「创建笔记」：只问标题和去处，路径由 note.ts 生成
  const [composing, setComposing] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteDir, setNoteDir] = useState<NoteDir>('thoughts');
  const [noteKind, setNoteKind] = useState<NoteKind>('md');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const changeMap = useMemo(() => {
    const m = new Map<string, ChangeKind>();
    for (const c of changes) m.set(c.path, c.kind);
    return m;
  }, [changes]);

  const { rootFiles, groups, total, hiddenCount } = useMemo(() => {
    const all = Object.keys(files).sort((a, b) => a.localeCompare(b, 'zh'));
    // 只在这里过滤 —— 同步用的 files 始终是全量，绝不能被这个规则碰到
    const paths = showAll ? all : all.filter((p) => !isProgramArtifact(p));

    const rootFiles: string[] = [];
    const g = new Map<string, string[]>();
    for (const path of paths) {
      const i = path.indexOf('/');
      if (i < 0) {
        rootFiles.push(path);
        continue;
      }
      const dir = path.slice(0, i);
      const arr = g.get(dir) ?? [];
      arr.push(path);
      g.set(dir, arr);
    }
    return {
      rootFiles,
      groups: [...g.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      total: all.length,
      hiddenCount: all.length - paths.length,
    };
  }, [files, showAll]);

  const kindExt = NOTE_KINDS.find((k) => k.id === noteKind)?.ext ?? 'md';
  const notePreview = notePath(noteDir, noteTitle, undefined, kindExt);

  const submit = () => {
    if (!draft.trim()) return;
    let p = draft.trim();
    if (!/\.[a-z0-9]+$/i.test(p)) p += '.md';
    // 新建的要是程序文件，就把视图切到"显示全部"，否则它刚建出来就消失
    if (isProgramArtifact(p)) setShowAll(true);
    createFile(p);
    setCreating(false);
    setDraft('thoughts/');
  };

  const submitNote = () => {
    createNote(noteDir, noteTitle, noteKind);
    // 目标目录可能是折叠的 —— 展开，否则刚建的笔记当场看不见
    setCollapsed((prev) => {
      if (!prev.has(noteDir)) return prev;
      const next = new Set(prev);
      next.delete(noteDir);
      return next;
    });
    setComposing(false);
    setNoteTitle('');
  };

  const toggle = (dir: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });

  const renderFile = (path: string, indent: boolean) => {
    const name = indent ? path.slice(path.indexOf('/') + 1) : path;
    const kind = changeMap.get(path);
    const active = path === current;
    // 稿纸换个图标，一眼分得开
    const rich = isRichPath(path);
    const Glyph = rich ? Paper : FileText;
    return (
      <div
        key={path}
        data-file={path}
        onClick={() => setCurrent(path)}
        className={`group flex cursor-pointer items-center gap-2 rounded-[6px] py-[5px] pr-1.5 text-[13px] transition-colors duration-100 ${
          indent ? 'pl-[26px]' : 'pl-2'
        } ${
          active
            ? 'bg-surface font-medium text-accent shadow-[0_1px_2px_rgba(34,31,28,0.05)] ring-1 ring-line'
            : 'text-ink hover:bg-surface-2'
        }`}
      >
        <Glyph size={13} className={`shrink-0 ${active ? 'text-accent' : 'text-ink-3'}`} />
        <span className="min-w-0 flex-1 truncate">{name}</span>

        {kind && (
          <span
            title={kind}
            className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{
              background:
                kind === 'conflict'
                  ? 'var(--color-danger)'
                  : isPush(kind)
                    ? 'var(--color-ok)'
                    : 'var(--color-accent)',
            }}
          />
        )}

        <button
          className={`shrink-0 rounded p-0.5 text-ink-3 hover:bg-danger-soft hover:text-danger ${
            active ? '' : 'hidden group-hover:block'
          }`}
          title="从本地删除（同步时一并提交）"
          onClick={(e) => {
            e.stopPropagation();
            removeFile(path);
          }}
        >
          <Trash size={12} />
        </button>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between pl-4 pr-2.5">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-ink-3">文件</span>
        <div className="flex items-center gap-0.5">
          <button
            data-toggle-all
            onClick={() => setShowAll(!showAll)}
            className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${
              showAll ? 'bg-surface-2 text-ink-2' : 'text-ink-3 hover:bg-surface-2 hover:text-ink-2'
            }`}
            title={showAll ? '只显示文字文件' : '显示全部文件（含程序文件）'}
          >
            {showAll ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            data-new
            onClick={() => {
              setCreating((v) => !v);
              setComposing(false);
            }}
            className="grid h-6 w-6 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            title="新建文件（手写完整路径）"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {creating && (
        <div className="px-2.5 pb-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isComposing(e)) return;
              if (e.key === 'Enter') {
                // ⚠️ 必须掐掉默认动作。回车会同步触发提交 → 新文件当场打开、正文编辑器
                // 立刻抢走焦点，而这个按键的默认动作是在之后才执行的 —— 它会落进刚挂载的
                // 编辑器里，在文首插一个空块（稿纸真实踩过：新建的稿纸凭空多出 <h1><br></h1>）
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') setCreating(false);
            }}
            onBlur={() => setCreating(false)}
            placeholder="thoughts/2026-09-21-xxx.md"
            className="w-full rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-[12px] outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        {total === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-[12.5px] leading-relaxed text-ink-3">
              还没有文件
              <br />
              点下面「创建笔记」写第一篇
              <br />
              或按「同步」拉取仓库
            </p>
          </div>
        )}

        {total > 0 && hiddenCount === total && (
          <div className="px-3 py-6 text-center">
            <p className="text-[12.5px] leading-relaxed text-ink-3">
              这个仓库里没有文字文件
              <br />
              只有 {total} 个程序文件
            </p>
            <button
              onClick={() => setShowAll(true)}
              className="mt-2 rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:bg-surface-2"
            >
              显示全部
            </button>
          </div>
        )}

        <div className="space-y-[1px]">{rootFiles.map((p) => renderFile(p, false))}</div>

        {groups.map(([dir, paths]) => {
          const open = !collapsed.has(dir);
          return (
            <div key={dir} className="mt-1.5">
              <button
                onClick={() => toggle(dir)}
                className="flex w-full items-center gap-1.5 rounded-[6px] py-[5px] pl-1 pr-2 text-left transition-colors hover:bg-surface-2"
              >
                <Chevron
                  size={11}
                  strokeWidth={2}
                  className={`shrink-0 text-ink-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
                />
                <Folder size={13} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{dir}</span>
                <span className="shrink-0 text-[10.5px] tabular-nums text-ink-3">{paths.length}</span>
              </button>
              {open && <div className="space-y-[1px]">{paths.map((p) => renderFile(p, true))}</div>}
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-line">
        {hiddenCount > 0 && (
          <div className="flex h-7 items-center justify-between pl-4 pr-2.5">
            <span className="text-[11px] text-ink-3">已隐藏 {hiddenCount} 个程序文件</span>
            <button
              onClick={() => setShowAll(true)}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              显示
            </button>
          </div>
        )}

        {composing && (
          <div
            data-note-form
            className="mx-2.5 mb-1.5 rounded-[10px] border border-line bg-surface p-2.5 shadow-[0_3px_12px_rgba(34,31,28,0.07)]"
          >
            <input
              data-note-title
              autoFocus
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              onKeyDown={(e) => {
                if (isComposing(e)) return;
                if (e.key === 'Enter') {
                  // 同上面那个输入框：不掐默认动作，这个回车会漏进刚打开的正文里
                  e.preventDefault();
                  submitNote();
                }
                if (e.key === 'Escape') setComposing(false);
              }}
              placeholder="今天想写点什么"
              className="w-full rounded-md border border-line bg-paper px-2 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
            />

            {/* 先选格式，再选去处 —— 后缀跟着格式走，预览那行会立刻反映 */}
            <div className="mt-2 flex flex-wrap gap-1">
              {NOTE_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  data-note-kind={k.id}
                  title={k.hint}
                  onClick={() => setNoteKind(k.id)}
                  className={`flex items-center gap-1 rounded-full px-2 py-[3px] text-[11.5px] transition-colors ${
                    noteKind === k.id
                      ? 'bg-ink font-medium text-white'
                      : 'bg-surface-2 text-ink-2 hover:text-ink'
                  }`}
                >
                  {k.id === 'rich' ? <Paper size={11} /> : <FileText size={11} />}
                  {k.label}
                </button>
              ))}
            </div>

            <div className="mt-1.5 flex flex-wrap gap-1">
              {NOTE_DIRS.map((d) => (
                <button
                  key={d.dir}
                  data-note-dir={d.dir}
                  title={d.hint}
                  onClick={() => setNoteDir(d.dir)}
                  className={`rounded-full px-2 py-[3px] text-[11.5px] transition-colors ${
                    noteDir === d.dir
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'bg-surface-2 text-ink-2 hover:text-ink'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            <p
              data-note-preview
              title={notePreview}
              className="mt-2 truncate font-mono text-[10.5px] text-ink-3"
            >
              {notePreview}
            </p>

            <div className="mt-2 flex items-center gap-1.5">
              <button
                data-note-submit
                onClick={submitNote}
                className="rounded-md bg-accent px-2.5 py-[5px] text-[12px] font-medium text-white transition-opacity hover:opacity-90"
              >
                创建
              </button>
              <button
                data-note-cancel
                onClick={() => setComposing(false)}
                className="rounded-md px-2 py-[5px] text-[12px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                取消
              </button>
              <span className="ml-auto text-[10.5px] text-ink-3">回车即建</span>
            </div>
          </div>
        )}

        <div className="px-2.5 pb-2.5 pt-1">
          <button
            data-new-note
            onClick={() => {
              setComposing((v) => !v);
              setCreating(false);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-[8px] border border-line bg-surface py-[7px] text-[12.5px] font-medium text-ink-2 transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
          >
            <Pen size={13} />
            创建笔记
          </button>
        </div>
      </div>
    </div>
  );
}
