import { Pen, FileText } from './icons';

/*
 * `[[` 之后弹出的候选浮层。
 *
 * 两条容易踩的：
 *
 * 1. **必须用 `onMouseDown` + `preventDefault`，不能用 `onClick`。**
 *    mousedown 的默认动作会把焦点从编辑器上摘走，ProseMirror 一失焦就认为
 *    「用户去点别的东西了」，补全查询随之作废 —— 等 click 冒泡上来时，
 *    要插字的位置已经没了。先掐掉默认动作，焦点留在编辑器里。
 * 2. 位置跟着 `[[` 那个字符走（不是跟着鼠标）：打字时眼睛在光标上，
 *    浮层跟着字跑才不用来回找。
 *    超出视口右边/下边就翻到另一侧，别被截断。
 */

export type HintItem =
  | { kind: 'open'; name: string; path: string; sub: string }
  | { kind: 'create'; name: string; sub: string };

const W = 268;
const H = 232;

export default function WikiHints({
  x,
  y,
  items,
  index,
  onPick,
  onHover,
}: {
  x: number;
  y: number;
  items: HintItem[];
  index: number;
  onPick: (i: number) => void;
  onHover: (i: number) => void;
}) {
  if (items.length === 0) return null;
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const left = Math.max(8, Math.min(x, vw - W - 8));
  const top = y + H > vh ? Math.max(8, y - H - 26) : y;

  return (
    <div
      data-wiki-hints
      role="listbox"
      className="fixed z-50 overflow-hidden rounded-pop border border-line bg-surface shadow-pop"
      style={{ left, top, width: W }}
    >
      <div className="flex h-6 items-center px-2.5">
        <span className="eyebrow">链接到</span>
      </div>
      <div className="max-h-[190px] overflow-y-auto pb-1">
        {items.map((it, i) => (
          <button
            key={it.kind === 'open' ? it.path : 'new'}
            type="button"
            role="option"
            aria-selected={i === index}
            data-wiki-hint={i}
            data-wiki-kind={it.kind}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(i);
            }}
            onMouseEnter={() => onHover(i)}
            className={`flex w-full items-center gap-2 px-2.5 py-[5px] text-left transition-colors ${
              i === index ? 'bg-accent-soft' : 'hover:bg-surface-2'
            }`}
          >
            {it.kind === 'open' ? (
              <FileText size={12} className="shrink-0 text-ink-3" />
            ) : (
              <Pen size={12} className="shrink-0 text-accent" />
            )}
            <span className="min-w-0 flex-1">
              <span
                className={`block truncate text-[12.5px] ${it.kind === 'create' ? 'text-accent' : 'text-ink'}`}
              >
                {it.name}
              </span>
              <span className="block truncate font-mono text-[10px] text-ink-3">{it.sub}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="flex h-5 items-center gap-2 border-t border-line bg-surface-2 px-2.5 text-[10px] text-ink-3">
        <span>↑↓ 选</span>
        <span>回车 确认</span>
        <span className="ml-auto">Esc 收起</span>
      </div>
    </div>
  );
}
