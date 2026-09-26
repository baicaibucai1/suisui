import { useStore } from '../lib/store';
import { isProgramArtifact } from '../lib/visible';
import { Minus, Menu, Plus } from './icons';

/*
 * 底部状态栏：**现在什么状况**（外加两个全局的小扳手）。
 *
 * ⚠️ **这条栏只报状况，不给同步按钮**。
 * 同步那颗在左栏底上的 dock 里，挨着设置（2026-09-26 用户要求挪过去的）。
 * ⛔ 同一时刻全应用只能有一颗「同步」 —— 这边再留一颗，人就不知道该点哪个。
 * 状况（未同步 / 同步于 … / 出错 / 通信中）照旧在这条栏上：
 * 它说的是"现在什么状况"，跟按钮在哪儿是两件事。
 *
 * 这行剩下的：
 *   ① 状态点 + 一句话（出错 / 通信中 / 未同步 / 就绪）—— 全屏宽度里最不打扰的一行；
 *   ② 手机上的 ☰。它必须在**抽屉外面**：左栏在窄屏是浮上来的抽屉，
 *      把手要是也放进抽屉里，抽屉一关就再也叫不出来了；
 *   ③ ~~桌面上的「右栏」开关~~ —— **已经搬到顶栏去了**（见 TopBar）。两栏的收起
 *      现在都由顶栏右侧那两颗管，那两颗在栏收起之后照样在；状态栏这边不再有第二颗。
 *   ④ 桌面上还有一对 A− / A+：调的是**写笔记界面**的字号（见 store 的 editorFont）。
 *      放这儿是因为它也是全局的 —— 改一次，整个编辑器（正文、标题、列表）一起变，
 *      不属于某一篇笔记；而"眼睛突然吃力"的时刻人在哪儿都在，这条栏永远够得着。
 *   ⑤ 文件数 / 凭据 / 同步时间这几个数（桌面才有地方摆）。
 */

export default function StatusBar() {
  const log = useStore((s) => s.log);
  const error = useStore((s) => s.error);
  const files = useStore((s) => s.files);
  const dirty = useStore((s) => s.dirty);
  const busy = useStore((s) => s.busy);
  const showAll = useStore((s) => s.showAll);
  const token = useStore((s) => s.token);
  const lastSyncAt = useStore((s) => s.lastSyncAt);
  const current = useStore((s) => s.current);
  const drawer = useStore((s) => s.drawer);
  const setDrawer = useStore((s) => s.setDrawer);
  const editorFont = useStore((s) => s.editorFont);
  const setEditorFont = useStore((s) => s.setEditorFont);

  // 日志自带 ✔ 前缀，状态点已经表达了"成功"，这里去掉避免重复
  const tail = (log.slice(-1)[0] ?? '').replace(/^✔\s*/, '');
  const paths = Object.keys(files);
  // 同步始终是全量，所以这里两个数都给：左侧看得见的 / 本地实际持有的
  const shown = showAll ? paths.length : paths.filter((p) => !isProgramArtifact(p)).length;
  const countText = showAll ? `${paths.length} 个文件` : `${shown} / ${paths.length} 个文件`;
  const chars = current ? (files[current] ?? '').replace(/\s/g, '').length : 0;

  // 状态本身做成一枚小胶囊：出错=红、通信中/有未同步=琥珀、就绪=灰。
  // 颜色只表达"要不要紧"，不表达"是不是成功" —— 成功是常态，不该用彩色喊出来。
  const pill = error
    ? 'bg-danger-soft text-danger'
    : busy
      ? 'bg-warn-soft text-warn'
      : dirty
        ? 'bg-warn-soft text-warn'
        : 'bg-surface-2 text-ink-2';
  const dot = error ? 'bg-danger' : busy ? 'bg-warn' : dirty ? 'bg-warn' : 'bg-ok';
  const label = error ? '出错' : busy ? '通信中' : dirty ? '未同步' : '就绪';
  const message = error ? `错误：${error}` : busy ? '正在与远端通信…' : dirty ? '有未同步的改动' : tail;

  return (
    <footer className="status-bar flex h-[32px] shrink-0 items-center gap-3 border-t border-line bg-surface px-4 text-[11.5px] max-md:h-11 max-md:gap-2 max-md:px-2">
      {/* 只有手机需要这颗把手；桌面的左栏常驻在那里，用不着叫它出来 */}
      <button
        data-drawer-toggle
        onClick={() => setDrawer(!drawer)}
        aria-label="文件列表"
        aria-expanded={drawer}
        className="hidden h-9 w-9 shrink-0 place-items-center rounded-[9px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink active:bg-surface-3 max-md:grid"
      >
        <Menu size={17} />
      </button>

      <span
        className={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-[2px] font-medium ${pill}`}
      >
        <span
          className={`h-[6px] w-[6px] shrink-0 rounded-full ${dot} ${busy ? 'animate-pulse' : ''}`}
        />
        <span>{label}</span>
      </span>

      <span className={`min-w-0 flex-1 truncate ${error ? 'text-danger' : 'text-ink-3'}`}>
        {message}
      </span>

      {/*
        编辑器字号。±1px，夹在 12–24（夹紧在 store 那头做）。
        值本身不显示在条上 —— 悬停 title 里有，界面少一个总在变的数字；
        改了立刻生效（正文、标题、列表一起变，全走一个 CSS 变量），设置里记着。
      */}
      <span className="hidden shrink-0 items-center gap-px max-md:hidden md:flex" data-editor-font>
        <button
          data-editor-font-minus
          onClick={() => setEditorFont(editorFont - 1)}
          disabled={editorFont <= 12}
          aria-label="缩小编辑器字号"
          title={`编辑器字号（当前 ${editorFont}px，最小 12）`}
          className="grid h-6 w-6 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-35 disabled:pointer-events-none"
        >
          <Minus size={12} />
        </button>
        <button
          data-editor-font-plus
          onClick={() => setEditorFont(editorFont + 1)}
          disabled={editorFont >= 24}
          aria-label="放大编辑器字号"
          title={`编辑器字号（当前 ${editorFont}px，最大 24）`}
          className="grid h-6 w-6 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-35 disabled:pointer-events-none"
        >
          <Plus size={12} />
        </button>
      </span>

      {/*
        ⚠️ 「右栏」那颗开关**已经搬走了** —— 现在在顶栏右侧（见 TopBar），
        和左栏那颗并排。原先它待在状态栏是因为"收起右栏的按钮长在右栏自己头上，
        栏一收起就没了"；现在开关长在顶栏上，栏收不收它都在，这儿就不必再来一颗 ——
        同一个动作两个入口，人只会不知道该点哪个。

        ⚠️ **「同步」那颗同样搬走了** —— 现在在左栏底上的 dock 里（见 SideDock），
        挨着设置。同一条理由：全应用只能有一颗同步，它现在跟着"待同步清单"走。
      */}

      {/* 下面这几个都是桌面才有地方摆的细节；手机上留状态点和消息就够 */}
      <span className="flex shrink-0 items-center gap-3 text-ink-3 max-md:hidden">
        {current && chars > 0 && <span>{chars} 字</span>}
        <span
          title="左侧可见 / 本地实际持有（程序文件只是不显示，照常同步）"
        >
          {countText}
        </span>
        <span>{token ? '凭据已配置' : '未配置凭据'}</span>
        {lastSyncAt && <span>同步于 {lastSyncAt}</span>}
      </span>
    </footer>
  );
}
