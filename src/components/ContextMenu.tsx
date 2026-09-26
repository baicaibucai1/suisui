import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/*
 * 右键菜单。
 *
 * 刻意不用 `<dialog>` 或 popover API：它要贴在**光标**上，位置是鼠标给的坐标，
 * 而不是"屏幕中间"或"某个锚点下面"。所以是 fixed 定位 + 打开时量一次尺寸做翻转。
 *
 * 关闭的路径比打开的多 —— 一个关不掉的浮层比没有浮层更烦，所以：
 *   · 点菜单外面（pointerdown 捕获，比 click 早一步，点在别处当场收）
 *   · Esc
 *   · 页面滚动 / 窗口改变大小 / 窗口失焦
 * 键盘能走：上下键移动、回车选中、Esc 关。
 */
export type MenuEntry =
  | {
      id: string;
      label: string;
      icon?: ReactNode;
      /** 右边一列灰色小字：这一项作用在哪儿（`thoughts/`、路径之类） */
      hint?: string;
      /** 危险动作（删除）—— 红字 */
      danger?: boolean;
      disabled?: boolean;
    }
  | { sep: true };

const isSep = (e: MenuEntry): e is { sep: true } => 'sep' in e;
type Item = Exclude<MenuEntry, { sep: true }>;

export default function ContextMenu({
  x,
  y,
  items,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuEntry[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [active, setActive] = useState(-1);

  const usable = items.filter((it): it is Item => !isSep(it) && !it.disabled);
  // 事件里要读最新的这两个，但监听器只注册一次 —— 所以走 ref
  const usableRef = useRef<Item[]>(usable);
  usableRef.current = usable;
  const activeRef = useRef(-1);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  // 贴边翻转：菜单比屏幕右下角还宽/高时往里收，别让最后一项跑到屏幕外点不到
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const nx = Math.min(x, Math.max(pad, window.innerWidth - r.width - pad));
    const ny = Math.min(y, Math.max(pad, window.innerHeight - r.height - pad));
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny });
  }, [x, y, pos.x, pos.y]);

  useEffect(() => {
    ref.current?.focus();
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) {
        /*
         * ⚠️ 从**打开它的那颗按钮**上来的 pointerdown 要放过。
         * 「⋯」是靠 onClick 开关的：若这一次也算"点外面"，它会先被这里关掉、
         * 紧接着又被按钮的 click 重新打开 —— 点第二下永远关不掉。
         * **锚点自己不算外面**（挂着 `data-menu-anchor` 的那颗就是开关）。
         */
        const t = e.target;
        if (!(t instanceof Element && t.closest('[data-menu-anchor]'))) closeRef.current();
      }
    };
    const key = (e: KeyboardEvent) => {
      const list = usableRef.current;
      const n = list.length;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (n === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (step) {
        e.preventDefault();
        const next = (activeRef.current + step + n) % n;
        activeRef.current = next;
        setActive(next);
        return;
      }
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : n - 1;
        activeRef.current = next;
        setActive(next);
        return;
      }
      if (e.key === 'Enter') {
        const hit = list[activeRef.current];
        if (!hit) return;
        e.preventDefault();
        closeRef.current();
        pickRef.current(hit.id);
      }
    };
    const away = () => closeRef.current();

    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-ctx-menu
      role="menu"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => {
        // 在菜单上再点右键不该弹出系统菜单（否则菜单叠菜单）
        e.preventDefault();
        e.stopPropagation();
      }}
      className="fixed z-[60] min-w-[196px] rounded-[10px] border border-line bg-surface py-1 shadow-pop outline-none"
    >
      {items.map((it, i) => {
        if (isSep(it)) return <div key={`s${i}`} className="my-1 h-px bg-line" />;
        const at = usable.findIndex((u) => u.id === it.id);
        const on = at >= 0 && at === active;
        return (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            data-ctx-item={it.id}
            disabled={it.disabled}
            onMouseEnter={() => {
              activeRef.current = at;
              setActive(at);
            }}
            onClick={() => {
              if (it.disabled) return;
              closeRef.current();
              pickRef.current(it.id);
            }}
            className={`flex w-full items-center gap-2 px-2.5 py-[6px] text-left text-[12.5px] transition-colors ${
              it.disabled
                ? 'cursor-default text-ink-3 opacity-45'
                : it.danger
                  ? `text-danger ${on ? 'bg-danger-soft' : 'hover:bg-danger-soft'}`
                  : `text-ink-2 ${on ? 'bg-surface-2 text-ink' : 'hover:bg-surface-2 hover:text-ink'}`
            }`}
          >
            <span className="grid h-[14px] w-[14px] shrink-0 place-items-center">
              {it.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.hint && (
              <span className="max-w-[86px] shrink-0 truncate pl-2 font-mono text-[10.5px] text-ink-3">
                {it.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
