import { useStore } from '../lib/store';
import { isProgramArtifact } from '../lib/visible';
import { Menu } from './icons';

/*
 * 底部状态栏：**现在什么状况**，外加手机上打开文件列表的把手。
 *
 * 顶栏整条拿掉之后，这行就剩两件事：
 *   ① 状态点 + 一句话（出错 / 通信中 / 未同步 / 就绪）—— 全屏宽度里最不打扰的一行；
 *   ② 手机上的 ☰。它必须在**抽屉外面**：左栏在窄屏是浮上来的抽屉，
 *      把手要是也放进抽屉里，抽屉一关就再也叫不出来了。
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
