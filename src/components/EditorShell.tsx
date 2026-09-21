import type { ReactNode } from 'react';

/*
 * 编辑器区的**外壳**：台面 → 一张纸 → 路径栏 → （工具栏、正文……）。
 *
 * 为什么单独拆一个文件：md（EditorPane）和稿纸（RichPane）的路径栏、模式开关、
 * 纸面留白曾经是两份各写各的 flex 树，改一处忘一处就漂了 —— 两边会长得越来越不像。
 * 现在这里只有一套，两个编辑器只是往里填不同的内容。
 *
 * 三条约束，改之前先看一眼：
 *
 * 1. **本文件必须留在主包里。** 它只 import 图标和类型，不带任何编辑器依赖；
 *    `EmptyState.tsx` 的加载骨架也用它，所以它一旦 import 了 EditorPane / RichPane，
 *    那 1.1MB 就会跟着首屏一起下来（`tests/lazy-e2e.mjs` 会当场红）。
 * 2. 桌面是"台面上的一张纸"（四周露出底色 + 圆角 + 落影），手机是满屏铺开。
 *    分界由 styles.css 的 `.sheet` 在 `width < 48rem` 里接管，别在这儿用 max-md: 叠一遍。
 * 3. 路径栏上的 `data-*` 一个都别动：`[data-mode]` / `[data-rich-mode]` 是 e2e 的抓手。
 */

type DataAttr = { [K in `data-${string}`]?: string };

/** 路径拆成「目录 + 文件名」两截：目录退到背景里，文件名才是这一页的名字。 */
export function PathCrumb({ path, className = '' }: { path: string; className?: string }) {
  const i = path.lastIndexOf('/');
  const dir = i < 0 ? '' : path.slice(0, i + 1);
  const name = i < 0 ? path : path.slice(i + 1);
  return (
    <span className={`min-w-0 flex-1 truncate font-mono text-[12.5px] ${className}`} title={path}>
      {dir && <span className="text-ink-3">{dir}</span>}
      <span className="font-medium text-ink">{name}</span>
    </span>
  );
}

/**
 * 「所见即所得 / 源码」这种二选一的模式开关。
 * 选中态是**浮起来的一小块**（白底 + ring + 细影），不是换个字色 —— 一眼看得出当前在哪档。
 */
export function ModeSwitch<T extends string>({
  value,
  onChange,
  options,
  attrFor,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  /** 每个按钮挂哪个 data-* —— md 用 data-mode，稿纸用 data-rich-mode */
  attrFor: (v: T) => DataAttr;
}) {
  return (
    <div className="flex shrink-0 items-center gap-[2px] rounded-[9px] border border-line bg-paper-2 p-[3px]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            {...attrFor(o.value)}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`rounded-[6px] px-2.5 py-[3px] text-[12px] transition-[background-color,color,box-shadow] duration-150 max-md:px-2.5 max-md:py-[5px] ${
              on
                ? 'bg-surface font-medium text-ink shadow-xs ring-1 ring-line-2'
                : 'text-ink-2 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 路径栏右侧那种小徽标：MD / 稿纸 / 字数……同一个壳，换个色系。 */
export function Badge({
  tone = 'plain',
  children,
}: {
  tone?: 'plain' | 'accent' | 'craft' | 'warn';
  children: ReactNode;
}) {
  const skin = {
    plain: 'border-line bg-surface-2 text-ink-3',
    accent: 'border-accent-line bg-accent-soft text-accent',
    craft: 'border-craft-line bg-craft-soft text-craft',
    warn: 'border-warn-line bg-warn-soft text-warn',
  }[tone];
  return (
    // 徽标是"给桌面看的分类提示"，手机上路径本身就够长，让它先让位
    <span
      className={`shrink-0 rounded-full border px-2 py-[1px] text-[10.5px] font-medium tracking-[0.02em] max-md:hidden ${skin}`}
    >
      {children}
    </span>
  );
}

type Props = {
  path: string;
  icon: ReactNode;
  /** 路径右边的小徽标（MD / 稿纸……） */
  tag?: ReactNode;
  /** 紧挨着徽标的状态（脏标记、异常提示） */
  status?: ReactNode;
  /** 路径栏最右侧：模式开关、字数等 */
  actions?: ReactNode;
  children: ReactNode;
} & DataAttr;

export function EditorShell({ path, icon, tag, status, actions, children, ...data }: Props) {
  return (
    <div className="desk flex h-full min-h-0 flex-col md:px-4 md:py-4 lg:px-7 lg:py-6" {...data}>
      <div className="sheet flex h-full min-h-0 flex-col overflow-hidden rounded-none md:rounded-card">
        <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4 max-md:h-10 max-md:gap-2 max-md:px-3">
          <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] bg-surface-2 text-ink-3 max-md:hidden">
            {icon}
          </span>
          <span className="hidden shrink-0 text-ink-3 max-md:block">{icon}</span>
          <PathCrumb path={path} />
          {tag}
          {status}
          {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * 正文的滚动区。留白和最大宽度由 `.editor-sheet` 统一给 ——
 * 这里只负责"能在中间滚"这件事。
 */
export function SheetBody({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="editor-sheet">{children}</div>
    </div>
  );
}
