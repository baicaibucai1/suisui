import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BRANCH, OWNER, REPO, useStore } from '../lib/store';
import { Alert, ArrowDown, ArrowUp, Branch, Check, Gear, Key, Menu, Refresh } from './icons';

/*
 * 顶栏 = 这一页的"抬头"。
 *
 * 一条规则：**从左到右，信息由稳到变**。
 *   左边（印 + 名字 + 仓库坐标）是这一路都不变的东西；
 *   中间（差异胶囊）是每次比对都会变的；
 *   右边（刷新 / 同步 / 凭据）是会改变上面两样的动作。
 * 所以同步按钮是全页唯一一颗实心主按钮 —— 它能改的东西最多。
 * 别再往顶栏塞第二颗实心按钮，一页里两颗"最重要"等于没有最重要。
 */

/** 次级动作（刷新差异 / 凭据）：有边框的浅底按钮，悬停时纸面上浮一档 */
const GHOST =
  'inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2 shadow-xs transition-[background-color,color,box-shadow] duration-150 hover:bg-surface-2 hover:text-ink hover:shadow-sm disabled:opacity-40 disabled:pointer-events-none max-md:h-9 max-md:w-9 max-md:justify-center max-md:px-0';

function Chip({
  tone,
  icon,
  children,
}: {
  tone: 'push' | 'pull' | 'conflict' | 'clean';
  icon: ReactNode;
  children: ReactNode;
}) {
  const skin = {
    push: 'bg-ok-soft text-ok border-ok-line',
    pull: 'bg-accent-soft text-accent border-accent-line',
    conflict: 'bg-danger-soft text-danger border-danger-line',
    clean: 'bg-surface-2 text-ink-2 border-line',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11.5px] font-medium ${skin}`}
    >
      {icon}
      {children}
    </span>
  );
}

export default function TopBar() {
  const token = useStore((s) => s.token);
  const setToken = useStore((s) => s.setToken);
  const busy = useStore((s) => s.busy);
  const changes = useStore((s) => s.changes);
  const refreshPlan = useStore((s) => s.refreshPlan);
  const doSync = useStore((s) => s.doSync);
  const pendingDeletes = useStore((s) => s.pendingDeletes);
  const cancelDeletes = useStore((s) => s.cancelDeletes);
  const planStale = useStore((s) => s.planStale);
  const drawer = useStore((s) => s.drawer);
  const setDrawer = useStore((s) => s.setDrawer);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [showToken, setShowToken] = useState(false);

  // 设置面板一开，凭据那个小浮层就收起来：它俩都挂在顶栏右侧，叠在一起谁也看不清
  useEffect(() => {
    if (settings) setShowToken(false);
  }, [settings]);

  const push = changes.filter((c) => c.kind.startsWith('push')).length;
  const pull = changes.filter((c) => c.kind.startsWith('pull')).length;
  const conflict = changes.filter((c) => c.kind === 'conflict').length;
  // 本地改过之后 changes 就过期了，这时候不能说「与远端一致」
  const clean = !planStale && push + pull + conflict === 0;

  return (
    <header className="relative shrink-0 border-b border-line bg-surface">
      <div className="flex h-14 items-center gap-3 px-4 max-md:h-[52px] max-md:gap-2 max-md:px-3">
        {/* 手机上文件列表藏在抽屉里，得留个把手 */}
        <button
          data-drawer-toggle
          onClick={() => setDrawer(!drawer)}
          aria-label="文件列表"
          aria-expanded={drawer}
          className="hidden h-9 w-9 shrink-0 place-items-center rounded-[9px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink active:bg-surface-3 max-md:grid"
        >
          <Menu size={17} />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="brand-tile grid h-[30px] w-[30px] place-items-center rounded-[9px] font-serif text-[15px] leading-none font-semibold text-white/95 max-md:h-7 max-md:w-7 max-md:text-[13px]">
            碎
          </div>
          <div className="leading-[1.2]">
            {/* 应用名用衬线：整页只有它和正文标题是衬线，一眼就是"这个本子的名字" */}
            <div className="font-serif text-[16px] font-semibold tracking-[0.16em] max-md:text-[14.5px]">
              碎碎
            </div>
            {/* 仓库坐标是给桌面看的；手机上顶栏每一像素都要省着用 */}
            <div className="flex items-center gap-1 font-mono text-[10.5px] text-ink-3 max-md:hidden">
              <span>
                {OWNER}/{REPO}
              </span>
              <span className="text-line-3">·</span>
              <Branch size={10} className="text-ink-3" />
              <span>{BRANCH}</span>
            </div>
          </div>
        </div>

        <div className="mx-1 hidden h-6 w-px bg-line md:block" />

        {/* 这排胶囊手机上让位给底部状态栏 —— 同一条消息不重复占地方 */}
        <div className="hidden items-center gap-1.5 md:flex">
          {planStale ? (
            <Chip tone="conflict" icon={<Alert size={11} strokeWidth={2} />}>
              有本地改动，还没比对
            </Chip>
          ) : (
            <>
              {push > 0 && (
                <Chip tone="push" icon={<ArrowUp size={11} strokeWidth={2} />}>
                  {push} 待推送
                </Chip>
              )}
              {pull > 0 && (
                <Chip tone="pull" icon={<ArrowDown size={11} strokeWidth={2} />}>
                  {pull} 待拉取
                </Chip>
              )}
              {conflict > 0 && (
                <Chip tone="conflict" icon={<Alert size={11} strokeWidth={2} />}>
                  {conflict} 冲突
                </Chip>
              )}
              {clean && (
                <Chip tone="clean" icon={<Check size={11} strokeWidth={2.4} className="text-ok" />}>
                  与远端一致
                </Chip>
              )}
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            data-refresh
            onClick={() => void refreshPlan()}
            disabled={busy !== null}
            title="刷新差异"
            className={GHOST}
          >
            <Refresh size={13.5} className={busy === 'plan' ? 'animate-spin' : ''} />
            <span className="max-md:hidden">{busy === 'plan' ? '比对中' : '刷新差异'}</span>
          </button>

          <button
            data-sync
            onClick={() => void doSync()}
            disabled={busy !== null}
            title="同步"
            className="btn-primary inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-accent px-3.5 text-[12.5px] font-medium text-white transition-[box-shadow,opacity] duration-150 hover:brightness-[1.06] disabled:opacity-40 disabled:pointer-events-none max-md:h-9 max-md:w-9 max-md:justify-center max-md:px-0"
          >
            <Refresh size={13.5} className={busy === 'sync' ? 'animate-spin' : ''} />
            <span className="max-md:hidden">{busy === 'sync' ? '同步中' : '同步'}</span>
          </button>

          <button
            onClick={() => setShowToken((v) => !v)}
            aria-expanded={showToken}
            className={`relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border transition-colors duration-150 max-md:h-9 max-md:w-9 ${
              showToken
                ? 'border-line-2 bg-surface-2 text-ink'
                : 'border-transparent text-ink-3 hover:bg-surface-2 hover:text-ink-2'
            }`}
            title={token ? '凭据已配置' : '还没配置 token'}
          >
            <Key size={14} />
            {/* 没配凭据时按钮上顶一颗小红点 —— 比在顶栏写一行字省地方，也比什么都不说清楚 */}
            {!token && (
              <span className="pointer-events-none absolute right-[5px] top-[5px] h-1.5 w-1.5 rounded-full bg-danger ring-2 ring-surface" />
            )}
          </button>

          <button
            data-settings
            onClick={() => setSettings(!settings)}
            aria-expanded={settings}
            aria-label="设置"
            title="设置"
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border transition-colors duration-150 max-md:h-9 max-md:w-9 ${
              settings
                ? 'border-line-2 bg-surface-2 text-ink'
                : 'border-transparent text-ink-3 hover:bg-surface-2 hover:text-ink-2'
            }`}
          >
            <Gear size={14} />
          </button>
        </div>
      </div>

      {/* 删远端不可逆：默认只拉不删，把清单摆出来等人点头 */}
      {pendingDeletes && (
        <div
          data-delete-confirm
          className="flex items-center gap-3 border-t border-danger-line bg-danger-soft px-4 py-2.5"
        >
          <Alert size={14} className="shrink-0 text-danger" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-danger">
            这轮同步要从远端删掉 {pendingDeletes.length} 个文件：
            <span className="font-mono">{pendingDeletes.join('、')}</span>
          </span>
          <button
            data-delete-cancel
            onClick={cancelDeletes}
            className="shrink-0 rounded-[8px] border border-danger-line bg-surface px-2.5 py-[4px] text-[12px] text-ink-2 transition-colors hover:text-ink max-md:h-8 max-md:px-3"
          >
            先不删
          </button>
          <button
            data-delete-ok
            onClick={() => void doSync(true)}
            disabled={busy !== null}
            className="shrink-0 rounded-[8px] bg-danger px-3 py-[4px] text-[12px] font-medium text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-40 max-md:h-8 max-md:px-3"
          >
            确认删除
          </button>
        </div>
      )}

      {showToken && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowToken(false)} />
          <div className="absolute right-4 top-[58px] z-40 w-[430px] overflow-hidden rounded-pop border border-line bg-surface shadow-pop">
            <div className="flex items-baseline justify-between border-b border-line bg-surface-2 px-4 py-2.5">
              <span className="font-serif text-[12.5px] font-semibold tracking-[0.08em]">
                访问凭据
              </span>
              <span className="font-mono text-[10.5px] text-ink-3">{OWNER}/{REPO}</span>
            </div>
            <div className="p-3.5">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_… / github_pat_…"
                className="w-full rounded-[8px] border border-line bg-surface-2 px-2.5 py-[7px] font-mono text-[12px] text-ink transition-colors outline-none placeholder:text-ink-3 focus:border-accent focus:bg-surface"
              />
              <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-3">
                需要 fine-grained PAT，权限只给 {OWNER}/{REPO} 的 Contents 读写。
                <br />
                demo 阶段存在本机 localStorage，正式版会进系统凭据库。
              </p>
            </div>
          </div>
        </>
      )}
    </header>
  );
}
