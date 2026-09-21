import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { isPush, kindLabel } from '../lib/decide';
import { isProgramArtifact } from '../lib/visible';
import type { ChangeKind } from '../lib/decide';
import { Alert, ArrowDown, ArrowUp, Check, EyeOff } from './icons';

function kindIcon(kind: ChangeKind) {
  if (kind === 'conflict') return <Alert size={12} strokeWidth={2} />;
  return isPush(kind) ? <ArrowUp size={12} strokeWidth={2} /> : <ArrowDown size={12} strokeWidth={2} />;
}

function kindColor(kind: ChangeKind) {
  if (kind === 'conflict') return 'text-danger';
  return isPush(kind) ? 'text-ok' : 'text-accent';
}

/** 左侧那枚小方片：把"上/下/冲突"做成三种浅色底，比一个裸图标好认 */
function kindTile(kind: ChangeKind) {
  if (kind === 'conflict') return 'bg-danger-soft';
  return isPush(kind) ? 'bg-ok-soft' : 'bg-accent-soft';
}

export default function ChangeList() {
  const changes = useStore((s) => s.changes);
  const showAll = useStore((s) => s.showAll);
  const setShowAll = useStore((s) => s.setShowAll);
  const setCurrent = useStore((s) => s.setCurrent);

  const { visible, hidden } = useMemo(() => {
    if (showAll) return { visible: changes, hidden: 0 };
    const visible = changes.filter((c) => !isProgramArtifact(c.path));
    return { visible, hidden: changes.length - visible.length };
  }, [changes, showAll]);

  return (
    <div className="flex max-h-[38%] min-h-0 shrink-0 flex-col border-t border-line">
      <div className="flex h-9 shrink-0 items-center gap-2 pl-4 pr-2.5">
        <span className="eyebrow">待同步</span>
        {visible.length > 0 && (
          <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-px text-[10.5px] font-medium text-ink-2">
            {visible.length}
          </span>
        )}
        <span className="h-px min-w-2 flex-1 bg-line" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {changes.length === 0 ? (
          <div className="flex items-center gap-2 rounded-[7px] bg-ok-soft px-2 py-[6px] text-[12px] text-ok">
            <Check size={13} strokeWidth={2} className="shrink-0" />
            <span className="font-medium">本地和远端一致</span>
          </div>
        ) : (
          <>
            {visible.length === 0 ? (
              <p className="px-1.5 pb-1 text-[12px] leading-relaxed text-ink-3">
                变更都在程序文件里，已隐藏。
              </p>
            ) : (
              <div className="space-y-[1px]">
                {visible.map((c) => (
                  <button
                    key={`${c.kind}:${c.path}`}
                    onClick={() => setCurrent(c.path)}
                    className="flex w-full items-center gap-2 overflow-hidden rounded-[7px] px-1.5 py-[5px] text-left transition-colors hover:bg-surface-2"
                  >
                    <span
                      className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-[5px] ${kindTile(c.kind)} ${kindColor(c.kind)}`}
                    >
                      {kindIcon(c.kind)}
                    </span>
                    <span className="min-w-0 flex-1 truncate whitespace-nowrap font-mono text-[11px] text-ink-2">
                      {c.path}
                    </span>
                    <span className={`shrink-0 text-[10.5px] ${kindColor(c.kind)}`}>
                      {kindLabel(c.kind)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {hidden > 0 && (
              <button
                data-hidden-changes
                onClick={() => setShowAll(true)}
                className="mt-1 flex w-full items-center gap-1.5 rounded-[7px] px-1.5 py-[5px] text-left text-[11px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
                title="程序文件的变更同样会同步，只是这里不显示"
              >
                <EyeOff size={12} className="shrink-0" />
                另有 {hidden} 项程序文件变更（照常同步）
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
