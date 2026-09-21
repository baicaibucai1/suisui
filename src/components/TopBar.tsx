import { useState } from 'react';
import type { ReactNode } from 'react';
import { BRANCH, OWNER, REPO, useStore } from '../lib/store';
import { Alert, ArrowDown, ArrowUp, Check, Key, Menu, Refresh } from './icons';

const BTN =
  'inline-flex h-7 items-center gap-1.5 rounded-md text-[12.5px] transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none';

function Chip({
  tone,
  icon,
  children,
}: {
  tone: 'push' | 'pull' | 'conflict';
  icon: ReactNode;
  children: ReactNode;
}) {
  const skin = {
    push: 'bg-ok-soft text-ok border-ok-line',
    pull: 'bg-accent-soft text-accent border-line',
    conflict: 'bg-danger-soft text-danger border-danger-line',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11.5px] font-medium ${skin}`}
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
  const [showToken, setShowToken] = useState(false);

  const push = changes.filter((c) => c.kind.startsWith('push')).length;
  const pull = changes.filter((c) => c.kind.startsWith('pull')).length;
  const conflict = changes.filter((c) => c.kind === 'conflict').length;
  // 本地改过之后 changes 就过期了，这时候不能说「与远端一致」
  const clean = !planStale && push + pull + conflict === 0;

  return (
    <header className="relative shrink-0 border-b border-line bg-surface">
      <div className="flex h-[52px] items-center gap-3 px-4 max-md:h-[50px] max-md:gap-2 max-md:px-3">
      {/* 手机上文件列表藏在抽屉里，得留个把手 */}
      <button
        data-drawer-toggle
        onClick={() => setDrawer(!drawer)}
        aria-label="文件列表"
        aria-expanded={drawer}
        className="hidden h-9 w-9 shrink-0 place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink active:bg-surface-3 max-md:grid"
      >
        <Menu size={17} />
      </button>

      <div className="flex items-center gap-2.5">
        <div className="grid h-7 w-7 place-items-center rounded-[8px] bg-ink text-[13px] font-medium text-white">
          碎
        </div>
        <div className="leading-[1.15]">
          <div className="text-[13.5px] font-semibold tracking-[0.06em]">碎碎</div>
          {/* 仓库坐标是给桌面看的；手机上顶栏每一像素都要省着用 */}
          <div className="font-mono text-[10.5px] text-ink-3 max-md:hidden">
            {OWNER}/{REPO}
            <span className="mx-[3px] text-line-2">·</span>
            {BRANCH}
          </div>
        </div>
      </div>

      <div className="mx-1 hidden h-5 w-px bg-line md:block" />

      {/* 这排胶囊手机上让位给底部状态栏 —— 同一条消息不重复占地方 */}
      <div className="hidden items-center gap-1.5 md:flex">
        {planStale ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-warn-line bg-warn-soft px-2 py-[2px] text-[11.5px] text-warn">
            <Alert size={11} strokeWidth={2} />
            有本地改动，还没比对
          </span>
        ) : (
          <>
            {push > 0 && <Chip tone="push" icon={<ArrowUp size={11} strokeWidth={2} />}>{push} 待推送</Chip>}
            {pull > 0 && <Chip tone="pull" icon={<ArrowDown size={11} strokeWidth={2} />}>{pull} 待拉取</Chip>}
            {conflict > 0 && (
              <Chip tone="conflict" icon={<Alert size={11} strokeWidth={2} />}>{conflict} 冲突</Chip>
            )}
            {clean && (
              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-[2px] text-[11.5px] text-ink-2">
                <Check size={11} strokeWidth={2.2} className="text-ok" />
                与远端一致
              </span>
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
          className={`${BTN} border border-line bg-surface px-2.5 text-ink-2 hover:bg-surface-2 hover:text-ink max-md:h-9 max-md:w-9 max-md:justify-center max-md:px-0`}
        >
          <Refresh size={13} className={busy === 'plan' ? 'animate-spin' : ''} />
          <span className="max-md:hidden">{busy === 'plan' ? '比对中' : '刷新差异'}</span>
        </button>

        <button
          data-sync
          onClick={() => void doSync()}
          disabled={busy !== null}
          title="同步"
          className={`${BTN} bg-accent px-3 font-medium text-white shadow-[0_1px_2px_rgba(34,31,28,0.16)] hover:bg-accent-2 max-md:h-9 max-md:w-9 max-md:justify-center max-md:px-0`}
        >
          <Refresh size={13} className={busy === 'sync' ? 'animate-spin' : ''} />
          <span className="max-md:hidden">{busy === 'sync' ? '同步中' : '同步'}</span>
        </button>

        <button
          onClick={() => setShowToken((v) => !v)}
          className={`${BTN} relative w-7 justify-center border max-md:h-9 max-md:w-9 ${
            showToken
              ? 'border-line-2 bg-surface-2 text-ink'
              : 'border-transparent text-ink-3 hover:bg-surface-2 hover:text-ink-2'
          }`}
          title={token ? '凭据已配置' : '还没配置 token'}
        >
          <Key size={14} />
          {!token && <span className="absolute right-[13px] top-[13px] h-1.5 w-1.5 rounded-full bg-danger max-md:right-[19px] max-md:top-[19px]" />}
        </button>
      </div>

      </div>

      {/* 删远端不可逆：默认只拉不删，把清单摆出来等人点头 */}
      {pendingDeletes && (
        <div
          data-delete-confirm
          className="flex items-center gap-2 border-t border-danger-line bg-danger-soft px-4 py-2"
        >
          <Alert size={14} className="shrink-0 text-danger" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-danger">
            这轮同步要从远端删掉 {pendingDeletes.length} 个文件：
            <span className="font-mono">{pendingDeletes.join('、')}</span>
          </span>
          <button
            data-delete-cancel
            onClick={cancelDeletes}
            className="shrink-0 rounded-md px-2 py-[3px] text-[12px] text-ink-2 transition-colors hover:bg-surface hover:text-ink max-md:h-8 max-md:px-3"
          >
            先不删
          </button>
          <button
            data-delete-ok
            onClick={() => void doSync(true)}
            disabled={busy !== null}
            className="shrink-0 rounded-md bg-danger px-2.5 py-[3px] text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 max-md:h-8 max-md:px-3"
          >
            确认删除
          </button>
        </div>
      )}

      {showToken && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowToken(false)} />
          <div className="absolute right-4 top-[48px] z-40 w-[430px] rounded-[10px] border border-line bg-surface p-3.5 shadow-[0_10px_34px_rgba(34,31,28,0.13)]">
            <div className="mb-2 text-[12.5px] font-medium">访问凭据</div>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_… / github_pat_…"
              className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:bg-surface"
            />
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
              需要 fine-grained PAT，权限只给 {OWNER}/{REPO} 的 Contents 读写。
              <br />
              demo 阶段存在本机 localStorage，正式版会进系统凭据库。
            </p>
          </div>
        </>
      )}
    </header>
  );
}
