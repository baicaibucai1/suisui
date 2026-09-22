import { useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { isPush } from '../lib/decide';
import { isProgramArtifact } from '../lib/visible';
import { ATTACH_LIMIT, bytesToBase64, isBinaryPath, isImagePath, isPdfPath, isTooBig, prettySize } from '../lib/binary';
import { NOTE_DIRS, notePath } from '../lib/note';
import { NOTE_KINDS, isRichPath } from '../lib/rich';
import type { NoteKind } from '../lib/rich';
import type { ChangeKind } from '../lib/decide';
import {
  buildTree,
  countInDir,
  dirsOf,
  isFolderFile,
  normalizeDir,
  type TreeNode,
} from '../lib/folders';
import { tagsOf } from '../lib/links';
import {
  Chevron,
  Close,
  Eye,
  EyeOff,
  FilePdf,
  FileText,
  Folder,
  FolderPlus,
  Image,
  Paper,
  Pen,
  Plus,
  Tag,
  Trash,
  Upload,
} from './icons';

/** 「添加附件」能选哪些后缀。和 `lib/binary.ts` 认的保持一致，别各写一份。 */
const ATTACH_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,.svg,.ico,.pdf';

/** 中文输入法组字期间按回车是"选词"，不能当成提交 —— 否则打拼音一选字就把笔记建了。 */
function isComposing(e: React.KeyboardEvent) {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

/** 分节线：overline 小标题 + 一条补满剩余宽度的 hairline。 */
function Section({ label, count, children }: { label: string; count?: number; children?: React.ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 pl-4 pr-2.5 max-md:pl-3.5">
      <span className="eyebrow">{label}</span>
      {count !== undefined && (
        <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-px text-[10.5px] font-medium text-ink-2">
          {count}
        </span>
      )}
      <span className="h-px min-w-2 flex-1 bg-line" />
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  );
}

/** 一层缩进 14px；文件比它所在的目录再多 22px（给图标和折叠箭头留位置） */
const dirPad = (depth: number) => 4 + depth * 14;
const filePad = (depth: number) => 4 + depth * 14 + 22;

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
  const createFolder = useStore((s) => s.createFolder);
  const removeFolder = useStore((s) => s.removeFolder);
  const putAttachment = useStore((s) => s.putAttachment);
  const tagFilter = useStore((s) => s.tagFilter);
  const setTagFilter = useStore((s) => s.setTagFilter);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('thoughts/');
  // 「创建笔记」：只问标题和去处，路径由 note.ts 生成
  const [composing, setComposing] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteDir, setNoteDir] = useState<string>('thoughts');
  const [noteKind, setNoteKind] = useState<NoteKind>('md');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // 「新建文件夹」：问一个目录名，支持 a/b/c 一次建多层
  const [foldering, setFoldering] = useState(false);
  const [folderName, setFolderName] = useState('');
  // 删目录要人点头：一个目录里可能有十几篇，而且同步之后远端也会跟着没
  const [pendingDir, setPendingDir] = useState<string | null>(null);
  /** 添加附件：被挡下来的那些（太大 / 不是图片或 PDF）要说清楚为什么 */
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);

  /** 附件落在哪儿：跟着当前打开的那篇走，没有就 thoughts */
  const attachDir = current ? current.slice(0, Math.max(0, current.lastIndexOf('/'))) : 'thoughts';

  const changeMap = useMemo(() => {
    const m = new Map<string, ChangeKind>();
    for (const c of changes) m.set(c.path, c.kind);
    return m;
  }, [changes]);

  const { tree, total, hiddenCount, userDirs, tagHits } = useMemo(() => {
    const all = Object.keys(files).sort((a, b) => a.localeCompare(b, 'zh'));
    /*
     * 按标签筛的时候整棵树都换掉：结果是**一列平铺的篇**，不再是目录树 ——
     * 因为同一个标签下的几篇往往散在不同目录里，硬套回树里只会让人找不到。
     * `null` = 没在筛；空数组 = 在筛但一个都没中（这也要显示，不然像没反应）。
     */
    const tagHits = tagFilter
      ? all.filter((p) => typeof files[p] === 'string' && tagsOf(files[p]).includes(tagFilter))
      : null;
    /*
     * 只在这里过滤 —— 同步用的 files 始终是全量，绝不能被这个规则碰到。
     *
     * ⚠️ 但**文件夹的标识文件必须留着**（它就是 `.folder`）：一个空文件夹里只有这一个文件，
     * 过滤掉它，目录就整棵消失了 —— "建了个文件夹"在界面上等于什么都没发生。
     * 所以这里放行标识文件，改在渲染时跳过它（`shownFiles`）。
     */
    const paths = showAll ? all : all.filter((p) => isFolderFile(p) || !isProgramArtifact(p));
    const known = new Set<string>(NOTE_DIRS.map((d) => d.dir));
    const extra = dirsOf(all).filter((d) => !known.has(d));
    // 「已隐藏 N 个程序文件」照旧只统计真被过滤掉的文件 —— 标识文件是系统文件，
    // 它进树只是为了撑住目录，不算"被藏起来的程序文件"
    const visible = showAll ? all : all.filter((p) => !isProgramArtifact(p));
    return {
      tree: buildTree(paths),
      total: all.length,
      hiddenCount: all.length - visible.length,
      userDirs: extra,
      tagHits,
    };
  }, [files, showAll, tagFilter]);

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
    uncollapse(noteDir);
    setComposing(false);
    setNoteTitle('');
  };

  /*
   * 附件进库：读成本地字节 → base64 → 塞进 files（同步时会以 base64 身份推上去）。
   * ⚠️ 走 `arrayBuffer` 不是 `text`：后者会拿 UTF-8 解二进制，图当场就花。
   */
  const onPickAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    // 清掉 value：不然连着选两次同一个文件，第二次不触发 change
    e.target.value = '';
    if (list.length === 0) return;
    const rejected: string[] = [];
    for (const f of list) {
      if (!isBinaryPath(f.name)) {
        rejected.push(`「${f.name}」不是图片或 PDF`);
        continue;
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (isTooBig(bytes.length)) {
        rejected.push(`「${f.name}」有 ${prettySize(bytes.length)}，超过单个 ${prettySize(ATTACH_LIMIT)} 的上限`);
        continue;
      }
      putAttachment(attachDir, f.name, bytesToBase64(bytes));
      uncollapse(attachDir);
    }
    setAttachErr(rejected.length ? rejected.join('；') : null);
  };

  const submitFolder = () => {
    const dir = normalizeDir(folderName);
    if (!dir) return;
    createFolder(dir);
    uncollapse(dir);
    setFoldering(false);
    setFolderName('');
  };

  /** 建完东西要把路径上的每一层都展开，不然新东西藏在折叠里看不见 */
  const uncollapse = (dir: string) =>
    setCollapsed((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      let hit = false;
      // dir 的每一层前缀都要从折叠集合里拿出来（a/b/c 要展开 a 和 a/b）
      const segs = dir.split('/');
      for (let i = 1; i <= segs.length; i++) {
        const p = segs.slice(0, i).join('/');
        if (next.delete(p)) hit = true;
      }
      return hit ? next : prev;
    });

  const toggle = (dir: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });

  const renderFile = (path: string, depth: number) => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const kind = changeMap.get(path);
    const active = path === current;
    // 稿纸 / 图片 / PDF 各有各的图标，一眼分得开
    const Glyph = isRichPath(path) ? Paper : isImagePath(path) ? Image : isPdfPath(path) ? FilePdf : FileText;
    const tone = isRichPath(path) ? 'text-craft' : isBinaryPath(path) ? 'text-accent' : 'text-ink-3';
    return (
      <div
        key={path}
        data-file={path}
        onClick={() => setCurrent(path)}
        style={{ paddingLeft: filePad(depth) }}
        className={`group relative flex cursor-pointer items-center gap-2 rounded-[7px] py-[6px] pr-1.5 text-[13px] transition-colors duration-100 ${
          /*
           * ⚠️ 选中态的 `bg-surface` 不能换掉。
           * `tests/mobile-e2e.mjs` 靠 `className.includes('bg-surface ')` 把当前行挑出来，
           * 再断言"其余行上没有常显的删除按钮"。改成 bg-accent-soft 之类的，
           * 那条断言就会把当前行也算进去，当场假红。
           * 好在"白纸从台面上浮起来"本来就是这套视觉要的：浅底 + 一道墨色竖条 + 细影。
           */
          active
            ? 'bg-surface font-medium text-ink shadow-xs ring-1 ring-line'
            : 'text-ink hover:bg-surface-2'
        }`}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-[15px] w-[3px] -translate-y-1/2 rounded-r-[2px] bg-accent"
          />
        )}
        <Glyph size={13} className={`shrink-0 ${active ? 'text-accent' : tone}`} />
        <span className="min-w-0 flex-1 truncate">{name}</span>

        {kind && (
          <span
            title={kind}
            className="h-[6px] w-[6px] shrink-0 rounded-full ring-2 ring-transparent"
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
          className={`shrink-0 rounded-[5px] p-0.5 text-ink-3 hover:bg-danger-soft hover:text-danger ${
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

  const renderDir = (node: TreeNode, depth: number) => {
    const open = !collapsed.has(node.path);
    const inner = countInDir(files, node.path);
    return (
      <div key={node.path}>
        <div
          data-dir={node.path}
          className="group relative flex cursor-pointer items-center gap-1.5 rounded-[7px] py-[6px] pr-2 transition-colors hover:bg-surface-2"
          style={{ paddingLeft: dirPad(depth) }}
          onClick={() => toggle(node.path)}
        >
          <Chevron
            size={11}
            strokeWidth={2}
            className={`shrink-0 text-ink-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          />
          <Folder size={13} className="shrink-0 text-craft/70" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{node.name}</span>
          {inner > 0 && (
            <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-px text-[10px] text-ink-3">
              {inner}
            </span>
          )}
          {/*
            删目录的按钮常显（不像文件那样 hover 才出）：目录行本身是"折叠开关"，
            在它上面藏一个只有悬停才出现的按钮，触屏上根本点不到。
          */}
          <button
            data-dir-del={node.path}
            title="删除这个文件夹"
            className="shrink-0 rounded-[5px] p-0.5 text-ink-3 opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              setPendingDir(node.path);
            }}
          >
            <Trash size={12} />
          </button>
        </div>

        {open && (
          // 一道竖的 hairline 把"这一层"圈起来：纯靠缩进看层级，深了就分不清谁属于谁
          <div className="relative space-y-[1px]">
            <span
              aria-hidden
              className="absolute bottom-1 top-0 w-px bg-line"
              style={{ left: dirPad(depth) + 11 }}
            />
            {node.dirs.map((d) => renderDir(d, depth + 1))}
            {/* 标识文件只为"撑住这个目录"而进树，它自己不该出现在列表里 */}
            {node.files.filter((p) => !isFolderFile(p)).map((p) => renderFile(p, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Section label="文件">
        <button
          data-toggle-all
          onClick={() => setShowAll(!showAll)}
          className={`grid h-6 w-6 place-items-center rounded-[7px] transition-colors ${
            showAll ? 'bg-surface-2 text-ink-2' : 'text-ink-3 hover:bg-surface-2 hover:text-ink-2'
          }`}
          title={showAll ? '只显示文字文件' : '显示全部文件（含程序文件）'}
        >
          {showAll ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button
          data-new-folder
          onClick={() => {
            setFoldering((v) => !v);
            setCreating(false);
            setPendingDir(null);
          }}
          className="grid h-6 w-6 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          title="新建文件夹"
        >
          <FolderPlus size={14} />
        </button>
        <button
          data-new
          onClick={() => {
            setCreating((v) => !v);
            setFoldering(false);
            setComposing(false);
          }}
          className="grid h-6 w-6 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          title="新建文件（手写完整路径）"
        >
          <Plus size={14} />
        </button>
        {/*
          添加附件。用一个藏起来的 file input：不自己画文件选择框，
          系统那个对话框本来就是用户最熟的（还能多选、能拖）。
        */}
        <button
          data-attach
          onClick={() => pickRef.current?.click()}
          className="grid h-6 w-6 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          title={`添加附件（图片 / PDF，单个最大 ${prettySize(ATTACH_LIMIT)}）`}
        >
          <Upload size={14} />
        </button>
        <input
          ref={pickRef}
          data-attach-input
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          onChange={(e) => void onPickAttach(e)}
          className="hidden"
        />
      </Section>

      {attachErr && (
        <div
          data-attach-error
          className="mx-2.5 mb-1.5 flex items-start gap-1.5 rounded-[8px] border border-warn-line bg-warn-soft px-2 py-1.5"
        >
          <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-warn">{attachErr}</span>
          <button
            onClick={() => setAttachErr(null)}
            className="shrink-0 rounded-[5px] p-0.5 text-warn transition-colors hover:bg-warn/10"
          >
            <Close size={11} />
          </button>
        </div>
      )}

      {/* 筛选中的时候，这条横幅是「你现在在看的是哪一小撮」的唯一说明 */}
      {tagHits && (
        <div
          data-tag-filter
          className="mx-2.5 mb-1.5 flex shrink-0 items-center gap-1.5 rounded-[8px] border border-craft-line bg-craft-soft px-2 py-1.5"
        >
          <Tag size={11} className="shrink-0 text-craft" />
          <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-craft">
            #{tagFilter}
          </span>
          <span className="shrink-0 text-[10.5px] text-ink-3">{tagHits.length} 篇</span>
          <button
            data-tag-clear
            onClick={() => setTagFilter(null)}
            title="退出筛选"
            className="shrink-0 rounded-[5px] p-0.5 text-craft transition-colors hover:bg-craft/10"
          >
            <Close size={11} />
          </button>
        </div>
      )}

      {foldering && (
        <div data-folder-form className="px-3 pb-2">
          <div className="flex items-center gap-1.5">
            <input
              data-folder-name
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (isComposing(e)) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitFolder();
                }
                if (e.key === 'Escape') setFoldering(false);
              }}
              placeholder="notes/2026-09"
              className="min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2.5 py-[6px] font-mono text-[12px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
            />
            <button
              data-folder-submit
              onClick={submitFolder}
              className="shrink-0 rounded-[8px] bg-accent px-2.5 py-[6px] text-[12px] font-medium text-white transition-opacity hover:brightness-[1.06]"
            >
              建
            </button>
          </div>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">
            用 <span className="font-mono">/</span> 一次建多层。文件夹其实是一个隐藏的标识文件，
            这样它在任何云端都真的存在。
          </p>
        </div>
      )}

      {creating && (
        <div className="px-3 pb-2">
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
            className="w-full rounded-[8px] border border-line bg-surface px-2.5 py-[6px] font-mono text-[12px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
          />
        </div>
      )}

      {pendingDir && (
        <div
          data-folder-del-confirm
          className="mx-3 mb-2 rounded-[9px] border border-danger-line bg-danger-soft px-2.5 py-2"
        >
          <p className="text-[11.5px] leading-relaxed text-danger">
            删掉
            <span className="mx-1 font-mono">{pendingDir}/</span>
            {countInDir(files, pendingDir) > 0
              ? `和里面的 ${countInDir(files, pendingDir)} 个文件？`
              : '？'}
            同步之后云端也会一起没。
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              data-folder-del-ok
              onClick={() => {
                removeFolder(pendingDir);
                setPendingDir(null);
              }}
              className="rounded-[7px] bg-danger px-2 py-[3px] text-[11.5px] font-medium text-white transition-opacity hover:opacity-90"
            >
              删除
            </button>
            <button
              data-folder-del-cancel
              onClick={() => setPendingDir(null)}
              className="rounded-[7px] border border-danger-line bg-surface px-2 py-[3px] text-[11.5px] text-ink-2 transition-colors hover:text-ink"
            >
              先不
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        {!tagHits && total === 0 && (
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

        {tagHits && tagHits.length === 0 && (
          <div data-tag-empty className="px-3 py-6 text-center">
            <p className="text-[12.5px] leading-relaxed text-ink-3">
              没有带 #{tagFilter} 的篇
            </p>
            <button
              onClick={() => setTagFilter(null)}
              className="mt-2 rounded-[8px] border border-line bg-surface px-2.5 py-[5px] text-[12px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              退出筛选
            </button>
          </div>
        )}

        {!tagHits && total > 0 && hiddenCount === total && (
          <div className="px-3 py-6 text-center">
            <p className="text-[12.5px] leading-relaxed text-ink-3">
              这个仓库里没有文字文件
              <br />
              只有 {total} 个程序文件
            </p>
            <button
              onClick={() => setShowAll(true)}
              className="mt-2 rounded-[8px] border border-line bg-surface px-2.5 py-[5px] text-[12px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              显示全部
            </button>
          </div>
        )}

        <div className="space-y-[1px]">
          {tagHits ? (
            tagHits.map((p) => renderFile(p, 0))
          ) : (
            <>
              {tree.files.filter((p) => !isFolderFile(p)).map((p) => renderFile(p, 0))}
              {tree.dirs.map((d) => renderDir(d, 0))}
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-line">
        {hiddenCount > 0 && (
          <div className="flex h-7 items-center justify-between pl-4 pr-2.5">
            <span className="text-[11px] text-ink-3">已隐藏 {hiddenCount} 个程序文件</span>
            <button
              onClick={() => setShowAll(true)}
              className="rounded-[6px] px-1.5 py-0.5 text-[11px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              显示
            </button>
          </div>
        )}

        {composing && (
          <div
            data-note-form
            className="mx-2.5 mb-1.5 overflow-hidden rounded-card border border-line bg-surface shadow-lg"
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
              className="w-full border-b border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:bg-surface-2/40"
            />

            <div className="p-2.5">
              {/* 先选格式，再选去处 —— 后缀跟着格式走，预览那行会立刻反映 */}
              <div className="flex flex-wrap gap-1">
                {NOTE_KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    data-note-kind={k.id}
                    title={k.hint}
                    onClick={() => setNoteKind(k.id)}
                    className={`flex items-center gap-1 rounded-full border px-2 py-[3px] text-[11.5px] transition-colors ${
                      noteKind === k.id
                        ? 'border-transparent bg-ink font-medium text-white'
                        : 'border-line bg-surface-2 text-ink-2 hover:text-ink'
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
                    type="button"
                    data-note-dir={d.dir}
                    title={d.hint}
                    onClick={() => setNoteDir(d.dir)}
                    className={`rounded-full border px-2 py-[3px] text-[11.5px] transition-colors ${
                      noteDir === d.dir
                        ? 'border-accent-line bg-accent-soft font-medium text-accent'
                        : 'border-transparent bg-surface-2 text-ink-2 hover:text-ink'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
                {/* 自己建的文件夹也该能选 —— 不然"建了文件夹"和"写东西进去"是两件事 */}
                {userDirs.map((d) => (
                  <button
                    key={d}
                    type="button"
                    data-note-dir={d}
                    title={d}
                    onClick={() => setNoteDir(d)}
                    className={`rounded-full border px-2 py-[3px] font-mono text-[11.5px] transition-colors ${
                      noteDir === d
                        ? 'border-accent-line bg-accent-soft font-medium text-accent'
                        : 'border-transparent bg-surface-2 text-ink-2 hover:text-ink'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>

              <p
                data-note-preview
                title={notePreview}
                className="mt-2.5 truncate font-mono text-[10.5px] text-ink-3"
              >
                {notePreview}
              </p>

              <div className="mt-2.5 flex items-center gap-1.5">
                <button
                  data-note-submit
                  onClick={submitNote}
                  className="btn-primary rounded-[8px] bg-accent px-3 py-[5px] text-[12px] font-medium text-white transition-[box-shadow,opacity] duration-150 hover:brightness-[1.06]"
                >
                  创建
                </button>
                <button
                  data-note-cancel
                  onClick={() => setComposing(false)}
                  className="rounded-[8px] px-2 py-[5px] text-[12px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  取消
                </button>
                <span className="ml-auto text-[10.5px] text-ink-3">回车即建</span>
              </div>
            </div>
          </div>
        )}

        <div className="px-2.5 pb-2.5 pt-2">
          <button
            data-new-note
            onClick={() => {
              setComposing((v) => !v);
              setCreating(false);
              setFoldering(false);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-line bg-surface py-[8px] text-[12.5px] font-medium text-ink-2 shadow-xs transition-[background-color,color,border-color] duration-150 hover:border-accent-line hover:bg-accent-soft hover:text-accent"
          >
            <Pen size={13} />
            创建笔记
          </button>
        </div>
      </div>
    </div>
  );
}
