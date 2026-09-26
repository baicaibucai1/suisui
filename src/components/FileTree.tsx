import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { isPush } from '../lib/decide';
import { isProgramArtifact } from '../lib/visible';
import { ATTACH_LIMIT, bytesToBase64, isBinaryPath, isImagePath, isPdfPath, isTooBig, prettySize } from '../lib/binary';
import type { ChangeKind } from '../lib/decide';
import {
  baseOf,
  buildTree,
  canDrop,
  countInDir,
  isFolderFile,
  normalizeDir,
  parentOf,
  type TreeNode,
} from '../lib/folders';
import { tagIndex, tagsOf, titleOf } from '../lib/links';
import { MD_EXTS, decodeMarkdown, isMdName } from '../lib/mdimport';
import ContextMenu from './ContextMenu';
import type { MenuEntry } from './ContextMenu';
import EntryInfo from './EntryInfo';
import BooksPane from './BooksPane';
import {
  Check,
  Chevron,
  Close,
  Copy,
  Eye,
  EyeOff,
  FilePdf,
  FileText,
  Folder,
  FolderPlus,
  Image,
  Info,
  Link,
  MoreDots,
  Pencil,
  Pen,
  Plus,
  Search,
  Tag,
  Trash,
  Upload,
  Download,
} from './icons';

/** 「添加附件」能选哪些后缀。和 `lib/binary.ts` 认的保持一致，别各写一份。 */
const ATTACH_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,.svg,.ico,.pdf';

/** 「导入 md」能选哪些后缀。来源同上：就是 `lib/mdimport.ts` 认的那几个。 */
const IMPORT_ACCEPT = MD_EXTS.join(',');

/**
 * 单篇 md 的大小上限。
 * 一本十万字的书也就两三百 KB，8MB 已经远超正常笔记；
 * 给个上限是为了防止误拖一个几百 MB 的日志/导出文件进来把界面卡死。
 */
const MD_LIMIT = 8 * 1024 * 1024;

/** 拖动时压在一个折叠目录上多久才替他展开。太短会一路划一路开，太长显得没反应。 */
const HOVER_EXPAND_MS = 600;

/** 中文输入法组字期间按回车是"选词"，不能当成提交 —— 否则打拼音一选字就把笔记建了。 */
function isComposing(e: React.KeyboardEvent) {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

/**
 * 界面里记着的路径跟着改名 / 搬家走。
 * ⚠️ 目录改名是**整段前缀替换**，不是只换它自己那一条：折叠集合里存着 `读书/2026`，
 * 里面的路径也可能各被记过一份，只换自己会让"展开的目录突然全折上"。
 */
function remapPath(p: string | null, from: string, to: string): string | null {
  if (!p) return p;
  if (p === from) return to;
  return p.startsWith(`${from}/`) ? to + p.slice(from.length) : p;
}

function remapSet(set: Set<string>, from: string, to: string): Set<string> {
  let hit = false;
  const next = new Set<string>();
  for (const p of set) {
    const n = remapPath(p, from, to) as string;
    if (n !== p) hit = true;
    next.add(n);
  }
  return hit ? next : set;
}

/**
 * 复制到剪贴板。安全上下文里用 clipboard API；拿不到就退回老办法 ——
 * 一个按钮点了什么都不发生，比复制失败更让人摸不着头脑。
 */
async function copyText(s: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    /* 落到下面的兜底 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
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
  const createNote = useStore((s) => s.createNote);
  const importMarkdown = useStore((s) => s.importMarkdown);
  const removeFile = useStore((s) => s.removeFile);
  const createFolder = useStore((s) => s.createFolder);
  const removeFolder = useStore((s) => s.removeFolder);
  const putAttachment = useStore((s) => s.putAttachment);
  const tagFilter = useStore((s) => s.tagFilter);
  const setTagFilter = useStore((s) => s.setTagFilter);
  const side = useStore((s) => s.side);
  /** 左栏归书架：这时没有标题栏、没有搜索、没有新建 —— 那一排都是书写这边的事 */
  const readMode = side === 'read';
  /**
   * 「新笔记建在哪个文件夹」—— 点目录行即选中（高亮），工具条那颗 + 就用它。
   * 没点过就跟着当前打开的那篇走，再没有才回落到 thoughts。
   *
   * ⚠️ 这份状态**在 store 里**（`pickedDir`），不在组件里：
   * 顶栏的面包屑也能点目录，两处点的是同一个东西 —— 各存一份就会
   * "顶栏点了目录、左栏的高亮没动"。只是会话内的偏好，不持久化。
   */
  const selectedDir = useStore((s) => s.pickedDir);
  const setSelectedDir = useStore((s) => s.setPickedDir);

  /**
   * 新笔记的落点：点选的文件夹 → 当前那篇所在的目录 → thoughts。
   * ⚠️ 用 `||` 不是 `??` —— 笔记直接躺在根目录时 fromCurrent 是**空串**，`??` 拦不住它。
   */
  const fromCurrent = current ? current.slice(0, Math.max(0, current.lastIndexOf('/'))) : '';
  const newNoteDir = selectedDir || fromCurrent || 'thoughts';
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // 「新建文件夹」：问一个目录名，支持 a/b/c 一次建多层
  const [foldering, setFoldering] = useState(false);
  const [folderName, setFolderName] = useState('');
  // 删目录要人点头：一个目录里可能有十几篇，而且同步之后远端也会跟着没
  const [pendingDir, setPendingDir] = useState<string | null>(null);
  /** 添加附件：被挡下来的那些（太大 / 不是图片或 PDF）要说清楚为什么 */
  const [attachErr, setAttachErr] = useState<string | null>(null);
  /** 顶部搜索框：按文件名 / 笔记标题过滤。空串 = 没在搜，照常显示整棵树。 */
  const [query, setQuery] = useState('');
  /**
   * 标签视图：整棵树换成「全库标签 + 篇数」。
   * 跟搜索、标签筛选一样是**临时视图**，不持久化 —— 下次打开若列表莫名其妙
   * 变成一堆标签，第一反应是坏了而不是"我上次点开的"。
   */
  const [tagView, setTagView] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  /** 正在读文件（多选一大摞时那一两秒要给个说法，不然像是点了没反应） */
  const [importing, setImporting] = useState(false);
  /** 有文件正被拖在左栏上方：给整块区域描一道边，让人看清"松手会落进来" */
  const [dropFiles, setDropFiles] = useState(false);

  /** 附件落在哪儿：跟着当前打开的那篇走，没有就 thoughts */
  const attachDir = current ? current.slice(0, Math.max(0, current.lastIndexOf('/'))) : 'thoughts';

  /*
   * ────────────────── 右键菜单 · 就地改名 · 拖动换层级 ──────────────────
   * 三件事都是"对某一行做点什么"，共用一套"现在操作的是谁"的状态。
   * 落地全在 store 的两个新动作上（`renameEntry` / `moveEntry`），
   * 这里只管交互和"改完之后界面里那些记着路径的地方跟着走"。
   */
  const renameEntry = useStore((s) => s.renameEntry);
  const moveEntry = useStore((s) => s.moveEntry);

  /** 右键菜单：坐标 + 作用对象。`path === ''` = 点在列表空白处（往根目录建东西） */
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; isDir: boolean } | null>(null);
  /** 「⋯」菜单：贴着那颗按钮打开，跟右键菜单不同时出现 */
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  /** 「属性」在看谁 */
  const [info, setInfo] = useState<string | null>(null);
  /** 就地改名：正在改的那一行。输入值另存一份 ref —— Enter 提交完 blur 还会再来一次，不能提交两遍 */
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const renameBox = useRef<{ path: string; value: string } | null>(null);
  /** 一句话反馈（改了名 / 已复制）和错误（重名、不能拖进自己里面） */
  const [notice, setNotice] = useState<string | null>(null);
  const [opErr, setOpErr] = useState<string | null>(null);
  /** 拖动中：从哪儿拖的、指针在哪；以及现在压在谁身上（`dir === ''` 是根目录） */
  const [drag, setDrag] = useState<{ from: string; name: string; x: number; y: number } | null>(null);
  /**
   * 落点：`same` 是"拖回原处"，那是空操作 —— 既不给"能放"的圈，也不能画成红的
   * （红圈是在说"放不下"，可这儿放得下，只是没必要）。
   */
  const [drop, setDrop] = useState<{ dir: string; ok: boolean; same: boolean } | null>(null);

  const pendingRef = useRef<{ path: string; name: string; x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  // 下面那些监听器只注册一次，所以里面要调的函数得走 ref 拿最新的那个
  const moveRef = useRef<(from: string, dest: string) => void>(() => {});
  // 「哪些目录是折叠的」同理：监听器活在只跑一次的那个 effect 里，得有份最新副本可读
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  /** 悬停自动展开：压在同一个折叠目录上待够 600ms 就把它展开，方便往里放 */
  const hoverRef = useRef<{ dir: string; timer: number } | null>(null);
  const clearHover = () => {
    if (!hoverRef.current) return;
    clearTimeout(hoverRef.current.timer);
    hoverRef.current = null;
  };

  /** 真的挪一下。失败就把话说清楚 —— 拖动最容易踩的就是重名和"拖进自己里面" */
  const doMove = (from: string, dest: string) => {
    // 落回原处：什么都不做。也别顺手记一次"有本地改动"，那会让状态栏白亮一下
    if (parentOf(from) === dest) return;
    const res = moveEntry(from, dest);
    if (!res.ok) {
      setOpErr(res.error);
      return;
    }
    setOpErr(null);
    setCollapsed((prev) => remapSet(prev, from, res.to));
    setSelectedDir(remapPath(selectedDir, from, res.to));
    setNotice(`已移到 ${parentOf(res.to) || '根目录'}/`);
    // 目标目录可能是折叠的 —— 展开，否则刚拖过去的东西当场看不见
    uncollapse(parentOf(res.to));
  };
  moveRef.current = doMove;

  /*
   * 拖动用指针事件手写，没用 HTML5 的 `draggable`：
   * 那套要接管 dataTransfer 才能知道落点，而且拖到一半时的"压在哪个目录上"
   * 得自己 elementFromPoint 算 —— 既然都要算，不如一开始就用指针，
   * 顺带把"6px 以内算点击"这种手感控制也拿到手里。
   *
   * ⚠️ **只认鼠标和触控笔，手指不参与拖动**：Android 上长按会先弹系统菜单
   * （contextmenu），拖动和它抢同一个手势，两个都会半死不活。
   * 手机上用长按菜单，不用拖。
   */
  useEffect(() => {
    /** 落点判定：目录行 → 那个目录；文件行 → 它所在的目录；空白处 → 根目录。`ok` 决定高亮成什么色 */
    const hitTest = (x: number, y: number, from: string) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!el?.closest) return null;
      const dirRow = el.closest('[data-dir]');
      const fileRow = dirRow ? null : el.closest('[data-file]');
      let dir: string;
      if (dirRow) dir = dirRow.getAttribute('data-dir') ?? '';
      else if (fileRow) dir = parentOf(fileRow.getAttribute('data-file') ?? '');
      else if (el.closest('[data-drop-root]')) dir = '';
      else return null;
      // 落回原处既不是"能放"也不是"放不下"，是**空操作** —— 单独一个态，界面不给任何高亮
      const same = parentOf(from) === dir;
      return { dir, same, ok: !same && canDrop(useStore.getState().files, from, dir) };
    };

    /*
     * 悬停展开：目标目录折叠着的时候，等着人"压住不动"再展开 ——
     * 不然一路划过去会把沿途目录全展开一遍，那不是帮忙是添乱。
     * 换目标 / 离开 / 松手都要把上一份计时掐掉（clearHover）。
     */
    const armHoverExpand = (at: { dir: string; ok: boolean; same: boolean } | null) => {
      const dir = at?.dir ?? '';
      // 只给"放得进去、且不是原处"的目录展开：放不进去的展开它没意义
      if (!dir || !at!.ok || at!.same || !collapsedRef.current.has(dir)) return clearHover();
      if (hoverRef.current?.dir === dir) return; // 还在同一个目录上，让它继续倒数
      clearHover();
      hoverRef.current = {
        dir,
        timer: window.setTimeout(() => {
          hoverRef.current = null;
          setCollapsed((prev) => {
            if (!prev.has(dir)) return prev;
            const next = new Set(prev);
            next.delete(dir);
            return next;
          });
        }, HOVER_EXPAND_MS),
      };
    };

    const onMove = (e: PointerEvent) => {
      const p = pendingRef.current;
      if (!p) return;
      if (!draggingRef.current) {
        // 6px 以内当"手抖"，仍然算点击 —— 否则轻微一动就把文件挪去别的目录了
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
        draggingRef.current = true;
      }
      setDrag({ from: p.path, name: p.name, x: e.clientX, y: e.clientY });
      const at = hitTest(e.clientX, e.clientY, p.path);
      setDrop(at);
      armHoverExpand(at);
    };

    const onUp = (e: PointerEvent) => {
      const p = pendingRef.current;
      const dragged = draggingRef.current;
      pendingRef.current = null;
      draggingRef.current = false;
      clearHover();
      setDrag(null);
      setDrop(null);
      if (!p || !dragged) return; // 没越过阈值 = 就是一次普通点击，交给 onClick
      const at = hitTest(e.clientX, e.clientY, p.path);
      if (at) moveRef.current(p.path, at.dir);
    };

    const onCancel = () => {
      pendingRef.current = null;
      draggingRef.current = false;
      clearHover();
      setDrag(null);
      setDrop(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, []);

  // 反馈条自己会走，不用人关 —— 它只是"刚才那一下做了什么"，不是待办
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  /** 在某一行上按下：先记住起点，越过阈值才算拖动 */
  const startDrag = (e: React.PointerEvent, path: string) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    if (renameBox.current) return;
    // 行里那些按钮（删除、折叠箭头）上按下的不是"拖动这一行"
    if ((e.target as HTMLElement).closest('button,input')) return;
    pendingRef.current = { path, name: baseOf(path), x: e.clientX, y: e.clientY };
  };

  const openMenu = (e: React.MouseEvent, path: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setOpErr(null);
    setMenu({ x: e.clientX, y: e.clientY, path, isDir });
  };

  const beginRename = (path: string) => {
    const value = baseOf(path);
    renameBox.current = { path, value };
    setRenaming({ path, value });
  };

  /** 提交改名。Enter 和失焦都走这里，`renameBox` 是唯一真相，所以不会提交两遍 */
  const commitRename = () => {
    const r = renameBox.current;
    renameBox.current = null;
    setRenaming(null);
    if (!r) return;
    const after = r.value.trim();
    // 一个字没改就别动 —— 会白记一次"有本地改动"，同步时还多推一次
    if (!after || after === baseOf(r.path)) return;
    const res = renameEntry(r.path, r.value);
    if (!res.ok) {
      setOpErr(res.error);
      return;
    }
    setOpErr(null);
    setCollapsed((prev) => remapSet(prev, r.path, res.to));
    setSelectedDir(remapPath(selectedDir, r.path, res.to));
    const n = res.links.reduce((a, b) => a + b.count, 0);
    setNotice(
      `已改名为 ${baseOf(res.to)}` +
        (n ? ` · ${n} 处引用跟着改了` : '') +
        (res.retitled ? ' · 正文标题也改了' : ''),
    );
  };

  const sayCopied = (what: string, text: string) => {
    void copyText(text).then((ok) => setNotice(ok ? `已复制${what}` : '剪贴板用不了，没复制成'));
  };

  /** 菜单项按对象拼：文件能复制双链，目录能建子文件夹 */
  /*
   * 工具条上那颗「⋯」里的内容 —— **一周用一次的那几样**。
   *
   * 它们曾经跟 +、文件夹、标签挤在同一排（七颗），排完的结果是"每颗都认识、
   * 每颗都不敢点"：一模一样的大小和灰度，只能靠逐个悬停去猜。
   * 现在这里只有两样 └ 它们配得上多一次点击，配不上占掉一行里最好的位置。
   *
   * ⚠️ id 一律加 `tools-` 前缀：右键菜单里也有「新建笔记」（id 就叫 'new-note'），
   * 两个菜单理论上能同时挂着，`[data-ctx-item]` 撞名就是 Playwright strict 事故。
   */
  const toolsMenu: MenuEntry[] = [
    {
      id: 'tools-attach',
      label: '添加附件',
      icon: <Upload size={13} />,
      hint: `单个最大 ${prettySize(ATTACH_LIMIT)}`,
    },
    {
      id: 'tools-import',
      label: '导入 md',
      icon: <Download size={13} />,
      hint: `${newNoteDir}/`,
      disabled: importing,
    },
  ];

  /** 「⋯」里点出来之后干什么。两个 input 是各自那道的真身，按钮只是替身。 */
  const runTool = (id: string) => {
    if (id === 'tools-attach') pickRef.current?.click();
    else if (id === 'tools-import') importRef.current?.click();
  };

  const menuItems = (m: { path: string; isDir: boolean }): MenuEntry[] => {
    const dir = m.isDir ? m.path : parentOf(m.path);
    const items: MenuEntry[] = [];
    if (m.path) {
      items.push({ id: 'rename', label: '重命名', icon: <Pencil size={13} /> });
      items.push({ sep: true });
    }
    items.push({
      id: 'new-note',
      label: '新建笔记',
      icon: <Plus size={13} />,
      hint: `${dir || '根目录'}${dir ? '/' : ''}`,
    });
    items.push({
      id: 'new-folder',
      label: m.isDir ? '新建子文件夹' : '新建文件夹',
      icon: <FolderPlus size={13} />,
    });
    items.push({ sep: true });
    items.push({ id: 'copy-path', label: '复制路径', icon: <Copy size={13} /> });
    if (m.path && !m.isDir) {
      items.push({
        id: 'copy-wiki',
        label: '复制双链',
        icon: <Link size={13} />,
        hint: `[[${titleOf(m.path)}]]`,
      });
    }
    if (m.path) {
      items.push({ sep: true });
      items.push({ id: 'info', label: '属性', icon: <Info size={13} /> });
      items.push({
        id: 'delete',
        label: m.isDir ? '删除文件夹' : '删除',
        icon: <Trash size={13} />,
        danger: true,
      });
    }
    return items;
  };

  const onMenuPick = (id: string) => {
    const m = menu;
    if (!m) return;
    /*
     * 菜单是在**哪一行**上开的，新建就落在那一行旁边：
     *   文件 → 它所在的目录（根目录下的文件落到 thoughts，根目录不放笔记）
     *   目录 → 它里面
     *   空白处 → 当前落点（点选过的文件夹 / 当前那篇的目录）
     */
    const dir = m.path ? (m.isDir ? m.path : parentOf(m.path) || 'thoughts') : newNoteDir;
    switch (id) {
      case 'rename':
        beginRename(m.path);
        break;
      // 菜单是在**某一行**上开的，新建就落在那一行旁边：文件 → 它所在的目录，目录 → 它里面
      case 'new-note':
        quickCreate(dir || 'thoughts');
        break;
      case 'new-folder':
        // 预填好父目录，接着敲名字就行
        setFolderName(dir ? `${dir}/` : '');
        setFoldering(true);
        break;
      case 'copy-path':
        sayCopied('路径', m.path);
        break;
      case 'copy-wiki':
        sayCopied('双链', `[[${titleOf(m.path)}]]`);
        break;
      case 'info':
        setInfo(m.path);
        break;
      case 'delete':
        // 删目录要人点头（可能十几篇，同步之后远端也一起没）；删文件跟行上那颗垃圾桶一致
        if (m.isDir) setPendingDir(m.path);
        else removeFile(m.path);
        break;
    }
  };

  const changeMap = useMemo(() => {
    const m = new Map<string, ChangeKind>();
    for (const c of changes) m.set(c.path, c.kind);
    return m;
  }, [changes]);

  const { tree, total, hiddenCount, programCount, tagHits } = useMemo(() => {
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
    // 「隐藏 N」照旧只统计真被过滤掉的文件（`showAll` 开着时是 0）—— 标识文件是系统文件，
    // 它进树只是为了撑住目录，不算"被藏起来的程序文件"。
    // ⚠️ 那就得**另给一个数**：`programCount` 不管开不开都算，给下面那枚「隐藏 N」的小钮用 ——
    // 它开着的时候也要在（不然就没得切回去了），而 `hiddenCount` 那时候是 0。
    const visible = showAll ? all : all.filter((p) => !isProgramArtifact(p));
    return {
      tree: buildTree(paths),
      total: all.length,
      hiddenCount: all.length - visible.length,
      programCount: all.filter((p) => isProgramArtifact(p)).length,
      tagHits,
    };
  }, [files, showAll, tagFilter]);

  /*
   * 标签视图：全库标签按**用量**从多到少排（用得多的才是这个库的主线），
   * 同量按名字排。点一个就进筛（复用上面那条 tagFilter 的通路）。
   * 程序文件里的 `#` 不算 —— 那是代码注释 / 色值，跟上面文件列表同一套过滤。
   */
  const allTags = useMemo(() => {
    const idx = tagIndex(files);
    const out: { tag: string; count: number; paths: string[] }[] = [];
    for (const [tag, paths] of idx) {
      const keep = showAll ? paths : paths.filter((p) => !isProgramArtifact(p));
      if (keep.length > 0) out.push({ tag, count: keep.length, paths: keep });
    }
    out.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'));
    return out;
  }, [files, showAll]);

  /*
   * 搜索：只认**文件名和标题**（ Obsidian 顶栏那个搜索框的轻量版 —— 全文搜索
   * 是另一档工程，这里先让"我知道那篇叫什么，就是懒得在树里找"够用）。
   * 命中时整棵树换成平铺的一列 —— 同一个标签筛选的道理：命中散在不同目录里，
   * 硬套回树里只会让人找不到。`null` = 没在搜。
   */
  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return Object.keys(files)
      .filter(
        (p) =>
          typeof files[p] === 'string' &&
          !isFolderFile(p) &&
          (showAll || !isProgramArtifact(p)) &&
          (p.slice(p.lastIndexOf('/') + 1).toLowerCase().includes(q) ||
            titleOf(p).toLowerCase().includes(q)),
      )
      .sort((a, b) => a.localeCompare(b, 'zh'));
  }, [files, query, showAll]);

  /**
   * 一键建笔记：不问路径，也不打断你输标题。
   * 标题先给「未命名」，store 的 focusTick 会把光标送进正文，在那儿改就行。
   * `dir` 只在右键菜单里传（在那一行旁边建），平常用默认的落点。
   */
  const quickCreate = (dir = newNoteDir) => {
    const p = createNote(dir, '未命名');
    // 目标目录可能是折叠的 —— 展开，否则刚建的笔记当场看不见
    uncollapse(p.slice(0, Math.max(0, p.lastIndexOf('/'))));
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

  /*
   * 导入 md：本机文件 → 库里的一篇笔记。
   *
   * 两处入口（工具条按钮、拖进左栏）都走这一个函数 —— 读字节、解码、落库
   * 是一整套，分开写两份迟早有一份会忘了兜 GBK 或者忘了报重名。
   *
   * 落点跟「新建笔记」一致（`newNoteDir`）：底下那行小字写着新笔记落在哪儿，
   * 导入要是落到别处去，那行小字就成了假话。
   */
  const takeFiles = async (list: File[]) => {
    const picked = list.filter((f) => isMdName(f.name));
    const rejected = list.length - picked.length;
    if (picked.length === 0) {
      setNotice(
        rejected
          ? `这些不是 md（只认 ${MD_EXTS.join(' / ')}）`
          : '没选到文件',
      );
      return;
    }
    setImporting(true);
    try {
      const items: { dir: string; name: string; text: string }[] = [];
      const tooBig: string[] = [];
      for (const f of picked) {
        if (f.size > MD_LIMIT) {
          tooBig.push(f.name);
          continue;
        }
        const bytes = new Uint8Array(await f.arrayBuffer());
        items.push({ dir: newNoteDir, name: f.name, text: decodeMarkdown(bytes) });
      }
      const r = importMarkdown(items);
      uncollapse(newNoteDir);
      const parts: string[] = [];
      if (r.made.length) parts.push(`导入 ${r.made.length} 篇`);
      if (r.renamed.length) parts.push(`${r.renamed.length} 篇因重名改了名`);
      if (tooBig.length) parts.push(`${tooBig.length} 个太大，跳过`);
      if (rejected) parts.push(`${rejected} 个不是 md，跳过`);
      setNotice(parts.length ? parts.join('，') : '没导入任何文件');
    } finally {
      setImporting(false);
    }
  };

  /** 文件选择器那一头。清掉 value：连着选两次同一批文件，第二次也要触发 */
  const onPickImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (list.length) await takeFiles(list);
  };

  /** 拖到左栏上：`files` 里有东西才算"从外面拖进来的"，否则是行自己的拖动 */
  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes('Files');

  const onDropFiles = async (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDropFiles(false);
    const list = Array.from(e.dataTransfer.files);
    if (list.length) await takeFiles(list);
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
    const editing = renaming?.path === path;
    // 图片 / PDF 各有各的图标，跟笔记一眼分得开
    const Glyph = isImagePath(path) ? Image : isPdfPath(path) ? FilePdf : FileText;
    const tone = isBinaryPath(path) ? 'text-accent' : 'text-ink-3';
    /*
     * 拖动时高亮"落在哪个目录"：拖到一个**文件**上等于放进它所在的目录
     * （宽容一点，别逼人非得瞄准目录行），所以这里跟着父目录一起亮。
     */
    const over = drop?.dir === parentOf(path);
    return (
      <div
        key={path}
        data-file={path}
        data-ctx-target={menu?.path === path ? '1' : undefined}
        onPointerDown={(e) => startDrag(e, path)}
        /*
         * ⚠️ `onDragStart` 那句不是装饰：行里的文字在拖动时会被浏览器**选中**，
         * 下一次在这段选中文本上按下再拖，浏览器就当成"拖动这段文字"发起**原生拖拽**，
         * 于是 pointercancel 把我们的手势掐断 —— 症状是"拖完一个，再拖第二个就没反应了"。
         * 行不是给人选文字的地方（配合 select-none），原生拖拽一律掐掉。
         */
        onDragStart={(e) => e.preventDefault()}
        onClick={() => {
          if (renaming) return; // 正在改名时点别处 = 提交，别顺手把别篇选中
          setCurrent(path);
        }}
        // 双击直接改名字，跟资源管理器一个手感（右键菜单里也有）
        onDoubleClick={() => beginRename(path)}
        onContextMenu={(e) => openMenu(e, path, false)}
        style={{ paddingLeft: filePad(depth) }}
        className={`group relative flex cursor-pointer select-none items-center gap-2 rounded-[7px] py-[6px] pr-1.5 text-[13px] transition-colors duration-100 ${
          /*
           * ⚠️ 选中态的 `bg-surface` 不能换掉。
           * `tests/mobile-e2e.mjs` 靠 `className.includes('bg-surface ')` 把当前行挑出来，
           * 再断言"其余行上没有常显的删除按钮"。改成 bg-accent-soft 之类的，
           * 那条断言就会把当前行也算进去，当场假红。
           * 好在"白纸从台面上浮起来"本来就是这套视觉要的：浅底 + 一道墨色竖条 + 细影。
           */
          active
            ? 'bg-surface font-medium text-ink shadow-xs ring-1 ring-line'
            : menu?.path === path
              ? 'bg-surface-2 text-ink'
              : 'text-ink hover:bg-surface-2'
        } ${over ? 'outline outline-1 outline-accent/40' : ''}`}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-[15px] w-[3px] -translate-y-1/2 rounded-r-[2px] bg-accent"
          />
        )}
        <Glyph size={13} className={`shrink-0 ${active ? 'text-accent' : tone}`} />
        {editing ? (
          <input
            data-rename-input
            autoFocus
            value={renaming.value}
            onChange={(e) => {
              // 输入值同时写进 ref —— 提交时以它为准，免得 Enter 和 blur 各提交一份
              if (renameBox.current) renameBox.current.value = e.target.value;
              setRenaming({ path, value: e.target.value });
            }}
            onFocus={(e) => {
              // 只选中主名，后缀留着：改名多半是换个叫法，不是换格式
              const v = e.currentTarget.value;
              const dot = v.lastIndexOf('.');
              e.currentTarget.setSelectionRange(0, dot > 0 ? dot : v.length);
            }}
            onKeyDown={(e) => {
              if (isComposing(e)) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                renameBox.current = null;
                setRenaming(null);
              }
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 select-text rounded-[5px] border border-accent bg-surface px-1 py-px text-[13px] text-ink outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{name}</span>
        )}

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
    const editing = renaming?.path === node.path;
    // 拖到这一行上：能放就墨色圈，放不下（重名 / 拖进自己里面）就红圈，拖回原处不给高亮
    const over = drop?.dir === node.path ? drop : null;
    return (
      <div key={node.path}>
        <div
          data-dir={node.path}
          data-dir-open={open ? '1' : '0'}
          data-dir-selected={selectedDir === node.path ? '1' : undefined}
          data-ctx-target={menu?.path === node.path ? '1' : undefined}
          data-drop-target={over ? (over.same ? 'same' : over.ok ? 'ok' : 'bad') : undefined}
          onPointerDown={(e) => startDrag(e, node.path)}
          // 同上：行不是选文字的地方，原生拖拽一律掐掉
          onDragStart={(e) => e.preventDefault()}
          onContextMenu={(e) => openMenu(e, node.path, true)}
          className={`group relative flex cursor-pointer select-none items-center gap-1.5 rounded-[7px] py-[6px] pr-2 transition-colors ${
            over && !over.same
              ? over.ok
                ? 'bg-surface-3 ring-1 ring-accent'
                : 'bg-danger-soft ring-1 ring-danger'
              : menu?.path === node.path
                ? 'bg-surface-2'
                : selectedDir === node.path
                  ? 'bg-surface-3'
                  : 'hover:bg-surface-2'
          }`}
          style={{ paddingLeft: dirPad(depth) }}
          onClick={() => {
            if (renaming) return;
            // 点目录行干两件事：① 把它设成新笔记的落点 ② 照常折叠 / 展开（老习惯不动）
            setSelectedDir(node.path);
            toggle(node.path);
          }}
        >
          {/* 选中的那条竖杠：光靠底色深浅不好认，加一条实心的 */}
          {selectedDir === node.path && (
            <span
              aria-hidden
              className="absolute top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-ink"
              style={{ left: dirPad(depth) - 6 }}
            />
          )}
          <Chevron
            size={11}
            strokeWidth={2}
            className={`shrink-0 text-ink-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          />
          <Folder size={13} className="shrink-0 text-craft/70" />
          {editing ? (
            <input
              data-rename-input
              autoFocus
              value={renaming.value}
              onChange={(e) => {
                if (renameBox.current) renameBox.current.value = e.target.value;
                setRenaming({ path: node.path, value: e.target.value });
              }}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (isComposing(e)) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  renameBox.current = null;
                  setRenaming(null);
                }
              }}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.stopPropagation()}
              className="min-w-0 flex-1 select-text rounded-[5px] border border-accent bg-surface px-1 py-px text-[12.5px] text-ink outline-none"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{node.name}</span>
          )}
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

  /**
   * F2 给当前打开的那篇改名 —— 资源管理器 / Obsidian 的老习惯。
   * 认的是"当前打开的那一篇"：这个列表没有独立的高亮选中态，点一下就是打开它。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2') return;
      const s = useStore.getState();
      if (!s.current || !(s.current in s.files)) return;
      e.preventDefault();
      beginRename(s.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        书写这一边的工具条。阅读那边整条都不显示 —— 「新建文件夹 / 建笔记 / 标签 /
        显示全部」说的是文件库，摆在一个书架上面全是废按钮。
        ⚠️ 「书写 / 阅读」的切换**不在这儿**了：它归顶栏最左（见 TopBar）——
        那是这一屏的身份位，左栏收起来之后它还得在。

        ⚠️ **只留三颗**（+ 建笔记 / 建文件夹 / 标签），其余都进右边那颗「⋯」。
        早先七颗一字排开，结果是"每颗都认识、每颗都不敢点" ——
        一排同样大小、同样灰度的图标里，人只能靠逐个悬停猜；
        而真正天天用的就那两颗（写一篇、归一个目录）。
        放进菜单的那几样是**一周用一次的**（传附件、导 md），
        它们配得上多一次点击，配不上占掉一行里最好的位置。
      */}
      {!readMode && (
      <Section label="文件">
        {/*
          建笔记：一颗加号，一条路。点了就建，不问路径也不问标题 ——
          落点由「点选的文件夹」决定，悬停时 title 里写清是哪个目录。
        */}
        <button
          data-new-note
          onClick={() => quickCreate()}
          className="grid h-6 w-6 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          title={`新建笔记 → ${newNoteDir}/`}
        >
          <Plus size={14} />
        </button>
        <button
          data-new-folder
          onClick={() => {
            setFoldering((v) => !v);
            setPendingDir(null);
          }}
          className="grid h-6 w-6 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          title="新建文件夹"
        >
          <FolderPlus size={14} />
        </button>
        {/* 标签视图：整棵树换成「全库标签 + 篇数」。没打标签时按钮也留着 ——
            点进去看到"还没有标签"，比按钮凭空消失好懂 */}
        <button
          data-tag-view
          onClick={() => {
            setTagView((v) => !v);
            setFoldering(false);
          }}
          className={`grid h-6 w-6 place-items-center rounded-[7px] transition-colors ${
            tagView ? 'bg-surface-2 text-craft' : 'text-ink-3 hover:bg-surface-2 hover:text-ink'
          }`}
          title={tagView ? '回到文件列表' : '标签（全库）'}
        >
          <Tag size={13.5} />
        </button>

        {/*
          「⋯」：不常动手的那几样都在这儿（菜单项见 toolsMenu）。
          ⚠️ `data-menu-anchor` 是给 ContextMenu 认人的 —— 挂了它，
          点这颗按钮不再算"点到了菜单外面"，否则二次点击永远关不掉（见 ContextMenu 那段注释）。
        */}
        <button
          data-more
          data-menu-anchor
          aria-label="更多操作"
          aria-expanded={more !== null}
          onClick={(e) => {
            setMenu(null); // 右键菜单还挂着的话先收，别两个菜单叠在一起
            if (more) {
              setMore(null);
              return;
            }
            const r = e.currentTarget.getBoundingClientRect();
            // 贴着按钮左下角打开：这一列本来就在最左边，往右展开不会出界
            setMore({ x: r.left, y: r.bottom + 6 });
          }}
          className={`grid h-6 w-6 place-items-center rounded-[7px] transition-colors ${
            more ? 'bg-surface-2 text-ink' : 'text-ink-3 hover:bg-surface-2 hover:text-ink'
          }`}
          title="更多（附件 / 导入 md）"
        >
          <MoreDots size={14} />
        </button>

        {/* 下面两个 file input 必须在 DOM 里 —— 它们是各自那道的真身，按钮只是替身 */}
        <input
          ref={pickRef}
          data-attach-input
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          onChange={(e) => void onPickAttach(e)}
          className="hidden"
        />
        <input
          ref={importRef}
          data-import-input
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          onChange={(e) => void onPickImport(e)}
          className="hidden"
        />
      </Section>
      )}

      {/*
        搜索框：工具条正下方。Esc 清掉，× 也行。书架模式下藏起来 —— 它搜的是文件名，书不在里面。

        ⚠️ 这一块（工具条 + 搜索 + 落点）是左栏的**头顶**，下面一条 hairline 把它和列表分开：
        上面是"我能对这一列做什么"，下面是"这一列里有什么"。
      */}
      {!readMode && (
      <div className="border-b border-line px-2.5 pb-2">
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            data-note-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder="搜索文件名或标题"
            className="w-full rounded-[8px] border border-line bg-surface py-[5px] pl-7 pr-6 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
          />
          {query && (
            <button
              data-note-search-clear
              onClick={() => setQuery('')}
              title="清空搜索"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-[5px] p-0.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Close size={10} />
            </button>
          )}
        </div>

        {/*
          一行交代两件事（**别拉成两行** —— 顶上这块每多一行，列表就少一行）：
            ① 左半：新笔记落在哪儿。它说的是工具条那颗 + 会建在哪儿 ——
               解释谁就挨着谁，隔着一整屏列表去解释等于没解释；
            ② 右半（有程序文件时才有）：一枚小钮，当前的显示与否 + 还有几个没显示。
               点它就切换 —— 它**就是**那个开关，工具条上不再有第二颗眼睛
               （两个入口 = 人不知道该点哪个，这条亏吃过）。
               ⚠️ 计数用 `programCount` 而不是 `hiddenCount`：后者在"全都显示"时是 0，
               那会儿小钮会凭空消失，人就再也切不回来了。
        */}
        <div
          data-new-note-target
          className="mt-1.5 flex min-w-0 items-center gap-1.5 px-1 text-[11px] text-ink-3"
        >
          <Pen size={11} className="shrink-0" />
          <span className="shrink-0">新笔记落在</span>
          <span className="min-w-0 flex-1 truncate font-mono text-ink-2" title={newNoteDir}>
            {newNoteDir}/
          </span>
          {programCount > 0 && (
            <button
              data-toggle-all
              onClick={() => setShowAll(!showAll)}
              aria-pressed={showAll}
              title={
                showAll
                  ? '藏起程序文件（miside / rss 这类）'
                  : `显示全部（还有 ${programCount} 个程序文件没显示）`
              }
              className={`flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-px text-[10.5px] transition-colors ${
                showAll
                  ? 'bg-surface-2 text-ink-2 hover:text-ink'
                  : 'text-ink-3 hover:bg-surface-2 hover:text-ink'
              }`}
            >
              {showAll ? <Eye size={10.5} /> : <EyeOff size={10.5} />}
              {showAll ? `含 ${programCount} 个程序文件` : `隐藏 ${programCount}`}
            </button>
          )}
        </div>
      </div>
      )}

      {searchHits !== null && (
        <div
          data-search-banner
          className="mx-2.5 mb-1.5 flex shrink-0 items-center gap-1.5 rounded-[8px] border border-line bg-surface-2 px-2 py-1.5"
        >
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">
            文件名 / 标题含「{query.trim()}」
          </span>
          <span className="shrink-0 text-[10.5px] text-ink-3">{searchHits.length} 篇</span>
        </div>
      )}

      {/* 刚做完那一下的反馈（改了名 / 已复制）。自己会走，不用人关 */}
      {notice && (
        <div
          data-op-notice
          className="mx-2.5 mb-1.5 flex shrink-0 items-center gap-1.5 rounded-[8px] border border-line bg-surface-2 px-2 py-1.5"
        >
          <Check size={11} className="shrink-0 text-ink-2" />
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{notice}</span>
        </div>
      )}

      {/* 失败（重名、名字带斜杠、拖进自己里面）必须说出来 —— 不然就是"拖了一下没反应" */}
      {opErr && (
        <div
          data-op-error
          className="mx-2.5 mb-1.5 flex shrink-0 items-start gap-1.5 rounded-[8px] border border-danger-line bg-danger-soft px-2 py-1.5"
        >
          <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-danger">{opErr}</span>
          <button
            data-op-error-close
            onClick={() => setOpErr(null)}
            className="shrink-0 rounded-[5px] p-0.5 text-danger transition-colors hover:bg-danger/10"
          >
            <Close size={11} />
          </button>
        </div>
      )}

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
              className="shrink-0 rounded-[8px] bg-accent px-2.5 py-[6px] text-[12px] font-medium text-white transition-opacity hover:opacity-90"
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
                const gone = pendingDir;
                removeFolder(gone);
                // 选中的目录被删了 → 落点悬空，退回"跟着当前笔记"
                if (selectedDir === gone || selectedDir?.startsWith(gone + '/')) setSelectedDir(null);
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

      {/*
        列表本体。它同时是**根目录的落点**：
          · 拖到空白处 = 挪到根目录
          · 空白处右键 = 往根目录建东西
        行的 contextmenu 都 stopPropagation 了，所以这里只会在真的空白处触发。
      */}
      <div
        data-drop-root
        data-import-dropzone
        data-import-dragover={dropFiles ? '1' : undefined}
        data-drop-target={drop && drop.dir === '' ? (drop.same ? 'same' : drop.ok ? 'ok' : 'bad') : undefined}
        onContextMenu={(e) => openMenu(e, '', false)}
        /*
          从外面拖文件进来：跟行自己的拖动（pointer 事件那一套）是两条路，
          靠 `dataTransfer` 里有没有 Files 区分 —— 拖行时那儿是空的。
          ⚠️ onDragOver 里必须 preventDefault，否则浏览器不会在这一片触发 drop。
        */
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDropFiles(true);
        }}
        onDragLeave={() => setDropFiles(false)}
        onDrop={(e) => void onDropFiles(e)}
        className={`min-h-0 flex-1 overflow-y-auto px-2.5 pb-4 ${
          dropFiles
            ? 'outline outline-1 outline-accent'
            : drop && drop.dir === '' && !drop.same
              ? drop.ok
                ? 'outline outline-1 outline-accent'
                : 'outline outline-1 outline-danger'
              : ''
        }`}
      >
        {/*
          书架 / 目录接管整片列表：书不在 files 里，让它们和文件树混排只会两边都不像。
          读书时（`currentBook` 非空）左栏是那本书的目录 —— 目录本来就该长在边上。
        */}
        {readMode ? (
          <BooksPane />
        ) : (
          <>
        {!tagHits && searchHits === null && !tagView && total === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-[12.5px] leading-relaxed text-ink-3">
              还没有文件
              <br />
              点上面工具条里的 + 写第一篇
              <br />
              或按状态栏的「同步」拉取仓库
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

        {!tagHits && !tagView && total > 0 && hiddenCount === total && (
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

        {searchHits !== null && searchHits.length === 0 && (
          <div data-search-empty className="px-3 py-6 text-center">
            <p className="text-[12.5px] leading-relaxed text-ink-3">
              没有文件名或标题含「{query.trim()}」的篇
            </p>
            <button
              onClick={() => setQuery('')}
              className="mt-2 rounded-[8px] border border-line bg-surface px-2.5 py-[5px] text-[12px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              清空搜索
            </button>
          </div>
        )}

        {/*
          标签视图：一列标签，每个带篇数。点一下进筛选（tagHits 那条路），
          于是"看全库有哪些标签"和"看某个标签下有哪些篇"是连贯的两步。
          ⚠️ 只在没在搜 / 没在筛的时候接管列表，否则三套视图会互相盖。
        */}
        {tagView && searchHits === null && !tagHits && (
          <div data-tag-list className="space-y-[1px]">
            {allTags.length === 0 ? (
              <div data-tag-list-empty className="px-3 py-6 text-center">
                <p className="text-[12.5px] leading-relaxed text-ink-3">
                  还没有标签
                  <br />
                  在正文里写 <span className="font-mono">#读书</span> 就有了
                </p>
              </div>
            ) : (
              allTags.map((t) => (
                <button
                  key={t.tag}
                  type="button"
                  data-tag-item={t.tag}
                  onClick={() => {
                    setTagFilter(t.tag);
                    setTagView(false);
                  }}
                  style={{ paddingLeft: filePad(0) }}
                  className="group flex w-full items-center gap-2 rounded-[7px] py-[6px] pr-1.5 text-left transition-colors hover:bg-surface-2"
                >
                  <Tag size={13} className="shrink-0 text-craft" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {t.tag}
                  </span>
                  <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-px text-[10.5px] text-ink-3">
                    {t.count}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        <div className="space-y-[1px]">
          {searchHits !== null ? (
            searchHits.map((p) => renderFile(p, 0))
          ) : tagHits ? (
            tagHits.map((p) => renderFile(p, 0))
          ) : tagView ? null : (
            <>
              {tree.files.filter((p) => !isFolderFile(p)).map((p) => renderFile(p, 0))}
              {tree.dirs.map((d) => renderDir(d, 0))}
            </>
          )}
        </div>
          </>
        )}
      </div>

      {/*
        ⚠️ 列表下面**不再挂东西**了 —— 「新笔记落点」和「已隐藏 N 个」都挪到了搜索框下面
        （见上面那段），这一列的底整块留给 SideDock（刷新差异 / 设置）。
        一条列只能有一个底；底下堆两截，人就看不出哪儿是底了。
      */}

      {/* 跟着指针走的那张小纸：写清"拖的是谁、会落到哪儿"。没有它，拖动全程没有任何反馈 */}
      {drag && (
        <div
          data-drag-ghost
          style={{ left: drag.x + 12, top: drag.y + 10 }}
          className="pointer-events-none fixed z-[55] flex max-w-[240px] items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2 py-1 text-[12px] text-ink shadow-pop"
        >
          {drag.from in files ? (
            <FileText size={12} className="shrink-0 text-ink-3" />
          ) : (
            <Folder size={12} className="shrink-0 text-craft/70" />
          )}
          <span className="min-w-0 truncate">{drag.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-ink-3">
            → {drop ? `${drop.dir || '根目录'}${drop.dir ? '/' : ''}` : '…'}
          </span>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu)}
          onPick={onMenuPick}
          onClose={() => setMenu(null)}
        />
      )}

      {/* 「⋯」那颗的工具菜单：同一套菜单组件，只是锚点换成了按钮 */}
      {more && (
        <ContextMenu
          x={more.x}
          y={more.y}
          items={toolsMenu}
          onPick={runTool}
          onClose={() => setMore(null)}
        />
      )}

      {info && <EntryInfo path={info} onClose={() => setInfo(null)} />}
    </div>
  );
}
