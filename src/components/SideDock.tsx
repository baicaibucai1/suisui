import { useStore } from '../lib/store';
import { PROVIDERS } from '../lib/providers';
import { Cloud, Gear, Refresh } from './icons';

/*
 * 左下角那条 dock —— **这一列的底**，一行，三颗按钮，**只管动手**。
 *
 * 顺序是「刷新差异 → 同步 → 设置」：
 *   ① 刷新差异和同步是**同一个动作的两步**（先比对，再推），所以挨着、同步紧跟刷新；
 *   ② 同步再挨着**设置** —— 头一回用的人第一次点同步，八成是要先去配凭据，
 *      而设置就在右手边；两个"同步这件事"的入口不该隔着半屏。
 *   ③ 状况（↑待推送 / ↓待拉取 / ⚠冲突）不在这儿，在紧挨着上面的「待同步」抬头里。
 *
 * ⚠️ **按钮带字，不是纯图标**。
 * 早先这几颗是 36px 的方钮（一颗齿轮、一个转圈箭头），结果真有人问
 * "这个按钮到底哪里像设置" —— 图标能猜，猜错就是白点两下。
 * 这一行横着有 272px，放下四个字绰绰有余，没有理由为了省地方把话说没。
 *
 * ⚠️ **同步从状态栏搬回来了**（2026-09-26，用户要求「同步放在设置旁边」）。
 * 搬走那次的理由是"同步是整个库对外的动作，该放全屏共用的状态栏"；但状态栏那颗
 * 太小、离"改了什么"太远 —— 人要同步的念头是从**左栏的待同步清单**来的，
 * 念头在哪儿，按钮就该在哪儿。
 * ⛔ 反过来同样是铁律：搬回来之后**状态栏不能再留第二颗** ——
 * 同一个动作两个入口，人只会不知道该点哪个（`StatusBar` 只报状况，不给按钮）。
 * 钩子 `data-sync` / `data-sync-count` 原样带走 —— 八个 e2e 抓的是这两个名字。
 */

/** 这一行三颗：图标 + 文字，一行装得下（高 32，跟搜索框一个节奏） */
const DOCK_BTN =
  'flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[9px] border px-2 text-[11.5px] transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none';

export default function SideDock() {
  const busy = useStore((s) => s.busy);
  const refreshPlan = useStore((s) => s.refreshPlan);
  const doSync = useStore((s) => s.doSync);
  const changes = useStore((s) => s.changes);
  const planStale = useStore((s) => s.planStale);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const token = useStore((s) => s.token);
  const provider = useStore((s) => s.provider);
  const dav = useStore((s) => s.dav);
  const od = useStore((s) => s.od);

  const pending = changes.length;
  const providerLabel = PROVIDERS.find((p) => p.id === provider)?.label ?? '';
  const syncing = busy === 'sync';

  /*
   * 齿轮上的红点 = 「当前这家还没配凭据」。
   * 凭据搬进设置之后，提示得跟着挪 ——
   * 否则用户看到的会是"齿轮干干净净，但怎么点都不同步"。
   * 现在同步就挨在齿轮旁边，没配凭据时"点同步"和"去设置配"只差一个拳头宽。
   */
  const credReady =
    provider === 'github'
      ? !!token
      : provider === 'nutstore'
        ? !!(dav.user && dav.pass)
        : !!od.token;

  return (
    <div
      data-dock
      className="flex shrink-0 items-center gap-1.5 border-t border-line bg-surface/50 px-2.5 py-2"
    >
      {/*
        「刷新差异」：重新比对本地和远端。
        忙时禁用（免得连点出一串并发请求），比对中转圈。
      */}
      <button
        data-refresh
        onClick={() => void refreshPlan()}
        disabled={busy !== null}
        title={busy === 'plan' ? '正在比对…' : '刷新差异'}
        aria-label="刷新差异"
        className={`${DOCK_BTN} border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink`}
      >
        <Refresh size={13} className={`shrink-0 ${busy === 'plan' ? 'animate-spin' : ''}`} />
        <span className="truncate">{busy === 'plan' ? '比对中' : '刷新差异'}</span>
      </button>

      {/*
        「同步」：把待同步那几项推上去 / 拉下来。忙时禁用，同步中云朵脉动。
        ⚠️ `<span>` 只能有一个（「同步」两个字）：端到端靠 `[data-sync] span`
        数过按钮里的文字，计数用 `<b>`，多一个 span 就是 strict 冲突。

        ⚠️ 待同步的计数做成**图标右上角的角标**（`absolute`），不占文字的位置：
        这一列只有 272px，三颗均分每颗 80px —— 图标 + 文字 + 一枚内联徽标是 84px，
        文字会被挤成「同…」（实测如此）。角标压在云朵上，字就完整了。
      */}
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
        className={`relative ${DOCK_BTN} border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink`}
      >
        <Cloud size={13} className={`shrink-0 ${syncing ? 'animate-pulse' : ''}`} />
        <span className="truncate">同步</span>
        {pending > 0 && (
          <b
            data-sync-count
            className="pointer-events-none absolute left-[15px] top-[3px] min-w-[13px] rounded-full bg-accent px-[3px] text-center text-[9.5px] font-medium leading-[13px] text-white ring-2 ring-surface"
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
        title={`设置${credReady ? `（存在${PROVIDERS.find((p) => p.id === provider)?.label ?? ''}）` : '（还没配凭据）'}`}
        className={`relative ${DOCK_BTN} ${
          settings
            ? 'border-line-2 bg-surface-2 text-ink'
            : 'border-transparent text-ink-3 hover:bg-surface-2 hover:text-ink'
        }`}
      >
        <Gear size={14} className="shrink-0" />
        <span className="truncate">设置</span>
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
