import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { BRANCH, OWNER, REPO, useStore } from '../lib/store';
import { PROVIDERS } from '../lib/providers';
import type { ProviderId } from '../lib/providers';
import { hasDavTransport } from '../lib/providers';
import { Close, Refresh } from './icons';

/*
 * 设置面板：从**左侧**推出的一张纸。
 *
 * 入口在左下角（同步旁边那颗齿轮），面板就得跟着它走 —— 从右边飞过来一张纸
 * 是"另一个地方"，从左边缘长出来才是"齿轮后面那叠东西"。
 *
 * 内容按「改了之后影响多大的一片地方」排序：
 *   同步（东西存在哪儿）→ 文件列表（半页）→ 关于（只是说明）。
 * 同一条设置**不在这里和别处各放一份开关** —— 两处状态同源但视觉不同步时，
 * 用户会以为自己改了没生效（文件列表那个眼睛图标是快捷方式，它俩共用同一个 store 值）。
 *
 * ⚠️ 每一家的凭据都跟它自己的后端放在一起：选 GitHub 才出现 token，
 * 选坚果云才出现账号/应用密码。凭据是"连到这家"的一部分，不该单独成一节
 * 让人先决定"我要配什么"，再决定"我配的是给谁的"。
 */

export default function SettingsSheet() {
  const open = useStore((s) => s.settings);
  const setOpen = useStore((s) => s.setSettings);
  const showAll = useStore((s) => s.showAll);
  const setShowAll = useStore((s) => s.setShowAll);
  const provider = useStore((s) => s.provider);
  const setProvider = useStore((s) => s.setProvider);
  const dav = useStore((s) => s.dav);
  const setDav = useStore((s) => s.setDav);
  const od = useStore((s) => s.od);
  const setOd = useStore((s) => s.setOd);
  const token = useStore((s) => s.token);
  const setToken = useStore((s) => s.setToken);
  const busy = useStore((s) => s.busy);
  const doSync = useStore((s) => s.doSync);
  const lastSyncAt = useStore((s) => s.lastSyncAt);
  const changes = useStore((s) => s.changes);

  // Esc 关面板。跟抽屉那条一致：浮层就得能被 Esc 收掉
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const davReachable = hasDavTransport();
  const meta = PROVIDERS.find((p) => p.id === provider);

  return (
    <>
      <div
        data-settings-mask
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[1px]"
      />
      <aside
        data-settings-panel
        className="sheet-in fixed left-0 top-0 z-50 flex h-full w-[400px] flex-col border-r border-line bg-surface shadow-pop max-md:w-full"
      >
        <div className="flex shrink-0 items-baseline justify-between border-b border-line bg-surface-2 px-4 py-3">
          <span className="font-serif text-[13.5px] font-semibold tracking-[0.1em]">设置</span>
          <button
            data-settings-close
            onClick={() => setOpen(false)}
            aria-label="关闭设置"
            className="grid h-7 w-7 place-items-center rounded-[8px] text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Close size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {/*
            同步排最前：它决定这些东西存在哪儿，是这一页里唯一"选错了会换地方"的设置。
            ⚠️ 没做完的后端一律 disabled + 标「待接入」—— 给一个按了没反应的按钮，
            比不给更糟（用户会以为是自己填错了）。
          */}
          <Section title="同步">
            <div data-provider-list className="flex flex-wrap gap-1.5">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-provider={p.id}
                  disabled={!p.ready}
                  onClick={() => setProvider(p.id as ProviderId)}
                  title={p.hint}
                  className={`flex items-center gap-1 rounded-full border px-2.5 py-[4px] text-[12px] transition-colors ${
                    provider === p.id
                      ? 'border-accent-line bg-accent-soft font-medium text-accent'
                      : 'border-line bg-surface-2 text-ink-2'
                  } ${p.ready ? 'hover:text-ink' : 'cursor-not-allowed opacity-45'}`}
                >
                  {p.label}
                  {!p.ready && <span className="text-[10px] text-ink-3">待接入</span>}
                </button>
              ))}
            </div>

            {provider === 'github' && (
              <div className="mt-2.5 space-y-1.5">
                {/* 凭据跟着后端走：选了 GitHub，这里就是 GitHub 的 token */}
                <input
                  data-token
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ghp_… / github_pat_…"
                  className="w-full rounded-[8px] border border-line bg-surface-2 px-2.5 py-[6px] font-mono text-[11.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:bg-surface"
                />
                <p className="text-[11px] leading-relaxed text-ink-3">
                  需要 fine-grained PAT，权限只给{' '}
                  <span className="font-mono">
                    {OWNER}/{REPO}
                  </span>{' '}
                  的 Contents 读写，分支 <span className="font-mono">{BRANCH}</span>。
                  demo 阶段存在本机 localStorage，正式版会进系统凭据库。
                </p>
              </div>
            )}

            {provider === 'nutstore' && (
              <div className="mt-2.5 space-y-1.5">
                <input
                  data-dav-url
                  value={dav.url}
                  onChange={(e) => setDav({ url: e.target.value })}
                  placeholder="https://dav.jianguoyun.com/dav/碎碎"
                  className="w-full rounded-[8px] border border-line bg-surface-2 px-2.5 py-[6px] font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:bg-surface"
                />
                <div className="flex gap-1.5">
                  <input
                    data-dav-user
                    value={dav.user}
                    onChange={(e) => setDav({ user: e.target.value })}
                    placeholder="坚果云账号（邮箱）"
                    className="min-w-0 flex-1 rounded-[8px] border border-line bg-surface-2 px-2.5 py-[6px] text-[11.5px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:bg-surface"
                  />
                  <input
                    data-dav-pass
                    type="password"
                    value={dav.pass}
                    onChange={(e) => setDav({ pass: e.target.value })}
                    placeholder="应用密码"
                    className="min-w-0 flex-1 rounded-[8px] border border-line bg-surface-2 px-2.5 py-[6px] text-[11.5px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:bg-surface"
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-ink-3">
                  应用密码不是登录密码：坚果云 → 账户信息 → 安全选项 → 第三方应用管理里单独生成。
                </p>
                {!davReachable && (
                  <p
                    data-dav-warn
                    className="rounded-[8px] border border-warn-line bg-warn-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-warn"
                  >
                    现在是网页版：坚果云的 WebDAV 不返回 CORS 头，浏览器直连一定被拦。
                    凭据可以先把着，真正能同步要等桌面端（那里请求走原生，没有同源策略）。
                  </p>
                )}
              </div>
            )}

            {provider === 'onedrive' && (
              <div className="mt-2.5 space-y-1.5">
                <p
                  data-od-warn
                  className="rounded-[8px] border border-line bg-surface-2 px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-2"
                >
                  读写的代码已经就位（Microsoft Graph），缺的是<b className="font-medium">授权</b>：
                  OAuth 要一个 Azure 应用的 client_id，得由账号主人去 Azure 门户注册（免费）。
                  拿到之后走 PKCE 换 token，填进下面这个框就能用。
                </p>
                <input
                  data-od-token
                  type="password"
                  value={od.token}
                  onChange={(e) => setOd({ token: e.target.value })}
                  placeholder="access token（留空 = 还没接上）"
                  className="w-full rounded-[8px] border border-line bg-surface-2 px-2.5 py-[6px] font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:bg-surface"
                />
                <input
                  data-od-base
                  value={od.basePath}
                  onChange={(e) => setOd({ basePath: e.target.value })}
                  placeholder="库在 OneDrive 里的目录（留空 = 根目录）"
                  className="w-full rounded-[8px] border border-line bg-surface-2 px-2.5 py-[6px] font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:bg-surface"
                />
              </div>
            )}

            {/*
              配完就地同步：选后端 → 填凭据 → 同步，三步都在这一屏里，
              不用关掉面板再去找按钮（那个按钮在左下角 dock 上，刻意的，两边都能到）。
            */}
            <div className="mt-3 flex items-center gap-2 border-t border-line pt-2.5">
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">
                {lastSyncAt ? `上次同步 ${lastSyncAt}` : '还没同步过'}
                {changes.length > 0 && ` · ${changes.length} 项差异待处理`}
              </span>
              <button
                data-sync-now
                onClick={() => void doSync()}
                disabled={busy !== null}
                className="inline-flex shrink-0 items-center gap-1 rounded-[8px] border border-line bg-surface-2 px-2 py-[4px] text-[11.5px] text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
              >
                <Refresh size={11.5} className={busy === 'sync' ? 'animate-spin' : ''} />
                {busy === 'sync' ? '同步中' : '立即同步'}
              </button>
            </div>

            {meta && (
              <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">{meta.hint}</p>
            )}
          </Section>

          <Section title="文件列表">
            <Toggle
              id="showall"
              label="显示全部文件"
              hint="连脚本、配置这些程序文件一起列出来（只是显示，同步照旧）"
              on={showAll}
              onChange={setShowAll}
            />
          </Section>

          <Section title="关于">
            <div className="space-y-1.5 text-[11.5px] leading-relaxed text-ink-3">
              <p>
                碎碎读的是<b className="font-medium text-ink-2">真的 markdown 文件</b>：
                笔记落盘成 <span className="font-mono">.md</span>，同步是拿这些文件去和远端对账，
                没有中间格式、也没有私有数据库。
              </p>
              <p>
                当前库：<span className="font-mono">{OWNER}/{REPO}</span>，分支{' '}
                <span className="font-mono">{BRANCH}</span>。demo 阶段凭据存在本机 localStorage。
              </p>
            </div>
          </Section>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="eyebrow mb-2.5 flex items-center gap-2">
        <span className="shrink-0">{title}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      {children}
    </section>
  );
}

function Toggle({
  id,
  label,
  hint,
  on,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-toggle={id}
      onClick={() => onChange(!on)}
      className="flex w-full items-start gap-3 rounded-[9px] text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-ink">{label}</span>
        {hint && <span className="mt-[1px] block text-[11px] leading-snug text-ink-3">{hint}</span>}
      </span>
      <span
        className={`relative mt-[2px] h-[18px] w-[32px] shrink-0 rounded-full transition-colors duration-150 ${
          on ? 'bg-accent' : 'bg-line-2'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-surface shadow-xs transition-[left] duration-150 ${
            on ? 'left-[16px]' : 'left-[2px]'
          }`}
        />
      </span>
    </button>
  );
}
