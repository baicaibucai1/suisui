import { useRef, useState } from 'react';

/*
 * 两侧边栏宽度之间的那条**可拖的分隔条**。
 *
 * 三条规矩，都是从"拖动"这件事本身的性子来的：
 *
 * ① **拖动中不落盘，松手才写 store。**
 *    写一次 store 就触发一次 persist —— 而 persist 里装着整个 files（笔记正文），
 *    拖动一次能跑出上百次 JSON.stringify + localStorage 写入，手感当场变糊。
 *    所以拖的时候父组件拿的是临时宽度，松手才 `setSidebar`。
 *
 * ② **必须吃 pointer 事件，不能用原生 HTML5 拖拽**：后者拖的是"数据"，
 *    中间会有一层浏览器的影子，光标和落点都不受控（文件树里那条拖动已经踩过一次）。
 *
 * ③ **键盘也能调**（← → 各 16px）。分隔条是个真的控件（`role="separator"`），
 *    不是只能用鼠标的装饰 —— 而且键盘这条路正好能当 e2e 的稳定抓手。
 */

export default function Resizer({
  side,
  width,
  min,
  max,
  onResize,
  onCommit,
  onReset,
}: {
  /** 这一条管的是哪一侧的栏。决定"往右拖是变宽还是变窄" */
  side: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  /** 拖动中：只改显示，不落盘 */
  onResize: (px: number) => void;
  /** 松手：这一下才真的写进设置 */
  onCommit: (px: number) => void;
  /** 双击复位到出厂宽度 */
  onReset: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  // 起点两件事一起记：按下时的指针位置和当时的宽度。
  // 用"起点 + 位移"算，而不是"当前位置 - 上一次位置"累加 —— 累加会漂。
  const from = useRef({ x: 0, w: 0, id: -1 });
  const live = useRef(width);

  const clamp = (px: number) => Math.round(Math.min(max, Math.max(min, px)));

  const stop = () => {
    if (!dragging) return;
    setDragging(false);
    // 光标和禁选是加在 body 上的：拖出这条 6px 的范围之后仍然要生效
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    onCommit(live.current);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // 不放行这一下，拖的时候会顺手把旁边的文件名选蓝
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    from.current = { x: e.clientX, w: width, id: e.pointerId };
    live.current = width;
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = e.clientX - from.current.x;
    // 左栏在分隔条左边：往右拖 = 变宽。右栏在右边，正好反过来
    const next = clamp(side === 'left' ? from.current.w + dx : from.current.w - dx);
    live.current = next;
    onResize(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    // 键盘一次跳 16px：一格一格挪太慢，一次跳太多又失了精调的意义
    const next = clamp(width + dir * 16);
    onResize(next);
    onCommit(next);
  };

  return (
    <div
      data-resizer={side}
      data-dragging={dragging ? '1' : undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? '调整左侧栏宽度' : '调整右侧栏宽度'}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      title={`拖动调整宽度（双击复位到 ${width}px）`}
      /*
       * 热区 6px、线只有 2px：线细才好看，热区宽才够得着 ——
       * 这两件事向来是矛盾的，所以分两层（外面这条负责接住指针）。
       * 手机上整条不出现：那一侧是浮上来的抽屉，宽度由视口决定，没有"调"这回事。
       */
      className="group hidden shrink-0 cursor-col-resize touch-none items-center justify-center md:flex md:w-[6px]"
    >
      <span
        className={`h-full w-[2px] transition-colors ${
          dragging ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/45'
        }`}
      />
    </div>
  );
}
