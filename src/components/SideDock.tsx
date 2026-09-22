import type { ReactNode } from 'react';
import { useStore } from '../lib/store';
import { PROVIDERS } from '../lib/providers';
import { Alert, ArrowDown, ArrowUp, Check, Gear, Refresh } from './icons';

/*
 * 左下角那条 dock = **状况** 和 **动手** 上下两行。
 *
 * 为什么都在这儿：
 *   ① 左边这一列是「文件在哪儿」的一列（文件树 + 待同步），把「把这些东西搬动」的
 *      按钮放在这一列的底上，手不用跑到屏幕另一头 —— 改完一堆文件后顺势往下就是同步。
 *   ② 顶栏整条拿掉之后，状况（待推送 / 待拉取 / 一致）也跟着沉到这儿：
 *      它描述的就是下面这颗同步按钮要搬的东西，按钮和它说的数字挨在一起，
 *      「刷新差异」也紧挨着它要刷新的那句话 —— 不用为了看一眼差多少跑到屏幕另一头。
 *   ③ 设置跟同步挨着，是因为设置里第一件事就是选后端 —— 选完就地能同步。

 * ⚠️ 同步按钮里的 `<span>` 只能有一个：端到端靠 `[data-sync] span` 断言
 * 「手机上按钮文字藏干净了」，多一个 span 就是 Playwright 的 strict 冲突。
 * 所以待处理数量用 `<b>` 画，不占用 span。
 */

/** 「刷新差异」：有边框的浅底按钮，悬停时纸面上浮一档 */
const GHOST =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-2 text-[12px] text-ink-2 shadow-xs transition-[background-color,color,box-shadow] duration-150 hover:bg-surface-2 hover:text-ink hover:shadow-sm disabled:opacity-40 disabled:pointer-events-none max-md:h-9 max-md:w-9 max-md:justify-center max-md:px-0';

export default function SideDock() {
  const busy = useStore((s) => s.busy);
  const changes = useStore((s) => s.changes);
  const planStale = useStore((s) => s.planStale);
  const refreshPlan = useStore((s) => s.refreshPlan);
  const doSync = useStore((s) => s.doSync);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const token = useStore((s) => s.token);
  const provider = useStore((s) => s.provider);
  const dav = useStore((s) => s.dav);
  const od = useStore((s) => s.od);

  const pending = changes.length;
  const push = changes.filter((c) => c.kind.startsWith('push')).length;
  const pull = changes.filter((c) => c.kind.startsWith('pull')).length;
  const conflict = changes.filter((c) => c.kind === 'conflict').length;
  // 本地改过之后 changes 就过期了，这时候不能说「与远端一致」
  const clean = !planStale && push + pull + conflict === 0;

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
    <div data-dock className="shrink-0 border-t border-line bg-surface/50">
      {/*
        第一行：状况。
        几段话拼成一枚胶囊 —— 左栏只有 272px，分开画几颗胶囊会在有推送又有拉取时挤到换行。
      */}
      <div className="flex h-9 items-center gap-1.5 px-2.5 pt-0.5">
        <span
          data-plan-state
          className={`flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-full border px-2 py-[3px] text-[11px] font-medium ${
            conflict > 0 || planStale
              ? 'border-warn-line bg-warn-soft text-warn'
              : clean
                ? 'border-line bg-surface-2 text-ink-3'
                : 'border-accent-line bg-accent-soft text-accent'
          }`}
        >
          {planStale ? (
            <>
              <Alert size={11} strokeWidth={2} className="shrink-0" />
              <span className="truncate">有本地改动，还没比对</span>
            </>
          ) : (
            <>
              {push > 0 && (
                <Seg icon={<ArrowUp size={11} strokeWidth={2} />} text={`${push} 待推送`} />
              )}
              {pull > 0 && (
                <Seg icon={<ArrowDown size={11} strokeWidth={2} />} text={`${pull} 待拉取`} />
              )}
              {conflict > 0 && <Seg icon={<Alert size={11} strokeWidth={2} />} text={`${conflict} 冲突`} />}
              {clean && (
                <Seg
                  icon={<Check size={11} strokeWidth={2.4} />}
                  text="与远端一致"
                  className="text-ok"
                />
              )}
            </>
          )}
        </span>

        <button
          data-refresh
          onClick={() => void refreshPlan()}
          disabled={busy !== null}
          title="刷新差异"
          className={GHOST}
        >
          <Refresh size={13} className={busy === 'plan' ? 'animate-spin' : ''} />
          <span className="max-md:hidden">{busy === 'plan' ? '比对中' : '刷新差异'}</span>
        </button>
      </div>

      {/* 第二行：动手。同步是真会改数据的那颗，给它最大的一颗 */}
      <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1.5">
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
    </div>
  );
}

/** 状况胶囊里的一段：「↑ 3 待推送」这样。段之间靠 gap 分开，不画点，窄了也塞得下。 */
function Seg({
  icon,
  text,
  className = '',
}: {
  icon: ReactNode;
  text: string;
  className?: string;
}) {
  return (
    <span className={`flex shrink-0 items-center gap-1 ${className}`}>
      {icon}
      {text}
    </span>
  );
}
