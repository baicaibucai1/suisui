import { useStore } from '../lib/store';
import { PROVIDERS } from '../lib/providers';
import { Gear, Refresh } from './icons';

/*
 * 左下角那条 dock：**同步** 和 **设置**。
 *
 * 为什么是这儿：
 *   ① 左边这一列是「文件在哪儿」的一列（文件树 + 待同步），把「把这些东西搬动」的
 *      按钮放在这一列的底上，手不用跑到屏幕另一头 —— 改完一堆文件后顺势往下就是同步。
 *   ② 顶栏留着抬头（仓库、差异），它只负责说清楚"现在什么状况"；
 *      真正会改变状况的动作沉到左下角，抬头的那排字才不会被一堆按钮挤到失重。
 *   ③ 设置跟同步挨着，是因为设置里第一件事就是选后端 —— 选完就地能同步，
 *      不用跑回顶栏找按钮。
 *
 * ⚠️ 同步按钮里的 `<span>` 只能有一个：端到端靠 `[data-sync] span` 断言
 * 「手机上按钮文字藏干净了」，多一个 span 就是 Playwright 的 strict 冲突。
 * 所以待处理数量用 `<b>` 画，不占用 span。
 */

export default function SideDock() {
  const busy = useStore((s) => s.busy);
  const changes = useStore((s) => s.changes);
  const planStale = useStore((s) => s.planStale);
  const doSync = useStore((s) => s.doSync);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const token = useStore((s) => s.token);
  const provider = useStore((s) => s.provider);
  const dav = useStore((s) => s.dav);
  const od = useStore((s) => s.od);

  const pending = changes.length;
  /*
   * 齿轮上的红点 = 「当前这家还没配凭据」。
   * 以前这颗点在顶栏的钥匙按钮上；凭据搬进设置之后，提示得跟着挪 ——
   * 否则用户看到的会是"齿轮干干净净，但怎么点都不同步"。
   */
  const credReady =
    provider === 'github'
      ? !!token
      : provider === 'nutstore'
        ? !!(dav.user && dav.pass)
        : !!od.token;
  const providerLabel = PROVIDERS.find((p) => p.id === provider)?.label ?? '';

  const spinning = busy === 'sync';

  return (
    <div
      data-dock
      className="flex shrink-0 items-center gap-1.5 border-t border-line bg-surface/50 px-2.5 py-2"
    >
      <button
        data-sync
        onClick={() => void doSync()}
        disabled={busy !== null}
        title={
          busy !== null
            ? '正在忙'
            : planStale
              ? '本地还没比对，同步时会先比对一次'
              : pending > 0
                ? `同步 ${pending} 项差异到${providerLabel}`
                : `与${providerLabel}再比一次`
        }
        className="btn-primary flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[12.5px] font-medium text-white transition-[box-shadow,opacity] duration-150 hover:brightness-[1.06] disabled:opacity-40 disabled:pointer-events-none max-md:h-9 max-md:w-9 max-md:flex-none max-md:px-0"
      >
        <Refresh size={14} className={`shrink-0 ${spinning ? 'animate-spin' : ''}`} />
        {/* 手机上按钮收成一枚 36px 的方钮：这一列在窄屏是抽屉，宽度要留给文件树 */}
        <span className="truncate max-md:hidden">{spinning ? '同步中' : '同步'}</span>
        {pending > 0 && (
          <b
            data-sync-count
            className="shrink-0 rounded-full bg-white/25 px-1.5 py-px text-[10.5px] font-normal leading-[1.3] text-white"
          >
            {pending}
          </b>
        )}
      </button>

      <button
        data-settings
        onClick={() => setSettings(!settings)}
        aria-expanded={settings}
        aria-label="设置"
        title={`设置${credReady ? `（存在${providerLabel}）` : '（还没配凭据）'}`}
        className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border transition-colors duration-150 ${
          settings
            ? 'border-line-2 bg-surface-2 text-ink'
            : 'border-transparent text-ink-3 hover:bg-surface-2 hover:text-ink'
        }`}
      >
        <Gear size={15} />
        {!credReady && (
          <span
            data-cred-dot
            className="pointer-events-none absolute right-[5px] top-[5px] h-1.5 w-1.5 rounded-full bg-danger ring-2 ring-surface"
          />
        )}
      </button>
    </div>
  );
}
