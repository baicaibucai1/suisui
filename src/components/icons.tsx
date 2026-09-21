// 统一的线性图标集。全部 16x16、currentColor、1.5 描边，跟正文同色系。
import type { ReactNode } from 'react';

export type IconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

function Svg({
  size = 16,
  className,
  strokeWidth = 1.5,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Chevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.1 3.4 10.7 8l-4.6 4.6" />
  </Svg>
);

export const FileText = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.1 1.9H5.3a1.5 1.5 0 0 0-1.5 1.5v9.2a1.5 1.5 0 0 0 1.5 1.5h5.4a1.5 1.5 0 0 0 1.5-1.5V4.9L9.1 1.9Z" />
    <path d="M9 1.9v3.1h3.2" />
    <path d="M5.9 8.7h4.2M5.9 11h2.7" />
  </Svg>
);

export const Folder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.1 5.2a1.3 1.3 0 0 1 1.3-1.3h2.4l1.3 1.6h5.5a1.3 1.3 0 0 1 1.3 1.3v4.9a1.3 1.3 0 0 1-1.3 1.3H3.4a1.3 1.3 0 0 1-1.3-1.3V5.2Z" />
  </Svg>
);

export const Plus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.4v9.2M3.4 8h9.2" />
  </Svg>
);

export const Refresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9" />
    <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9" />
    <path d="M12.3 1.9v3.2H9.1" />
    <path d="M3.7 14.1v-3.2h3.2" />
  </Svg>
);

export const ArrowUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 13V3.2" />
    <path d="M4.3 6.9 8 3.2l3.7 3.7" />
  </Svg>
);

export const ArrowDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v9.8" />
    <path d="M4.3 9.1 8 12.8l3.7-3.7" />
  </Svg>
);

export const Alert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.4 14.4 13.2H1.6L8 2.4Z" />
    <path d="M8 6.4v2.9" />
    <path d="M8 11.3h.01" />
  </Svg>
);

export const Key = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5.4" cy="10.6" r="2.7" />
    <path d="M7.3 8.7 13.2 2.8" />
    <path d="M11 5l1.5 1.5" />
  </Svg>
);

export const Close = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" />
  </Svg>
);

export const Trash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.9 4.4h10.2" />
    <path d="M6.3 4.4V3.3a1 1 0 0 1 1-1h1.4a1 1 0 0 1 1 1v1.1" />
    <path d="M4.3 4.4l.6 8.1a1.2 1.2 0 0 0 1.2 1.1h3.8a1.2 1.2 0 0 0 1.2-1.1l.6-8.1" />
  </Svg>
);

export const Check = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.3 8.4 6.5 11.6 12.7 4.8" />
  </Svg>
);

export const Cloud = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.6 12.2h7.1a2.6 2.6 0 0 0 .3-5.2 3.6 3.6 0 0 0-7-1 2.8 2.8 0 0 0-.4 6.2Z" />
  </Svg>
);

export const Eye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.7 8c1.4-2.6 3.6-4.2 6.3-4.2S12.9 5.4 14.3 8c-1.4 2.6-3.6 4.2-6.3 4.2S3.1 10.6 1.7 8Z" />
    <circle cx="8" cy="8" r="2.1" />
  </Svg>
);

export const EyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.7 4.1a7 7 0 0 1 1.3-.1c2.7 0 4.9 1.6 6.3 4.2a10.7 10.7 0 0 1-2.3 2.9" />
    <path d="M4.4 5A10.6 10.6 0 0 0 1.7 8c1.4 2.6 3.6 4.2 6.3 4.2 1 0 1.9-.2 2.8-.7" />
    <path d="M6.7 6.7a2 2 0 0 0 2.7 2.7" />
    <path d="M2.6 2.6l10.8 10.8" />
  </Svg>
);

export const Pen = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.1 12.9l.7-2.8 6.4-6.4a1.35 1.35 0 0 1 1.9 1.9L5.9 12.2l-2.8.7Z" />
    <path d="M9.4 4.5l2.1 2.1" />
  </Svg>
);

/** 窄屏顶栏的抽屉开关 */
export const Menu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.4 4.3h11.2M2.4 8h11.2M2.4 11.7h11.2" />
  </Svg>
);

/** 顶栏那个分支名前面挂的小钩子 —— 让「分支」不需要再用文字解释一遍 */
export const Branch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="4.6" cy="3.6" r="1.5" />
    <circle cx="4.6" cy="12.4" r="1.5" />
    <path d="M4.6 5.1v5.8" />
    <circle cx="11.4" cy="12.4" r="1.5" />
    <path d="M11.4 10.9V8.4a2.3 2.3 0 0 0-2.3-2.3H8.1" />
  </Svg>
);

/* ---------- 编辑器工具栏 ---------- */

export const Bold = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.6 2.7h3.7a2.55 2.55 0 0 1 0 5.1H4.6z" />
    <path d="M4.6 7.8h4.3a2.75 2.75 0 0 1 0 5.5H4.6z" />
  </Svg>
);

export const Italic = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.4 2.9h4.2M5.4 13.1h4.2M9.7 2.9 6.3 13.1" />
  </Svg>
);

export const Strike = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11.5 4.4C10.8 3.4 9.7 2.9 8 2.9c-2 0-3.4.9-3.4 2.2 0 .7.4 1.2 1 1.6" />
    <path d="M4.4 11.6c.7 1 1.9 1.5 3.7 1.5 2.2 0 3.6-.9 3.6-2.3 0-.7-.3-1.2-.9-1.6" />
    <path d="M2.4 8h11.2" />
  </Svg>
);

export const InlineCode = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.7 4.9 2.4 8l3.3 3.1" />
    <path d="M10.3 4.9 13.6 8l-3.3 3.1" />
  </Svg>
);

export const Link = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.7 9.3a2.6 2.6 0 0 0 3.7 0l2.3-2.3a2.62 2.62 0 0 0-3.7-3.7l-1 1" />
    <path d="M9.3 6.7a2.6 2.6 0 0 0-3.7 0l-2.3 2.3a2.62 2.62 0 0 0 3.7 3.7l1-1" />
  </Svg>
);

export const ListBullet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.2 4.2h7.2M6.2 8h7.2M6.2 11.8h7.2" />
    {/* 圆点靠 linecap 画，2.6 才够显眼 —— 1.5 的时候缩到 16px 就看不见了 */}
    <path d="M2.8 4.2h.01M2.8 8h.01M2.8 11.8h.01" strokeWidth={2.6} />
  </Svg>
);

export const ListOrdered = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.6 4.2h6.8M6.6 8h6.8M6.6 11.8h6.8" />
    <path d="M2.3 3.3l.9-.6v3" strokeWidth={1.3} />
    <path d="M2.2 7.6c.5-.5 1.4-.4 1.4.3 0 .6-1.4 1.1-1.4 2h1.6" strokeWidth={1.3} />
  </Svg>
);

export const Quote = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.9 3.2v9.6" />
    <path d="M6.4 5.4h6.8M6.4 8h6.8M6.4 10.6h4" />
  </Svg>
);

export const CodeBlock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.7" y="3.1" width="12.6" height="9.8" rx="1.7" />
    <path d="M6.9 6.7 5.5 8.1l1.4 1.4" />
    <path d="M9.1 6.7l1.4 1.4-1.4 1.4" />
  </Svg>
);

export const Divider = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.9 8h3.4M10.7 8h3.4" />
    <path d="M8 8h.01" strokeWidth={2.2} />
  </Svg>
);

/* ---------- 稿纸（富文本）工具栏 ---------- */

export const Underline = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.7 2.8v5.1a3.3 3.3 0 0 0 6.6 0V2.8" />
    <path d="M3.4 13.5h9.2" />
  </Svg>
);

export const AlignLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.4 3.9h11.2M2.4 8h7.2M2.4 12.1h9.6" />
  </Svg>
);

export const AlignCenter = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.4 3.9h11.2M4.4 8h7.2M3.2 12.1h9.6" />
  </Svg>
);

export const AlignRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.4 3.9h11.2M6.4 8h7.2M4 12.1h9.6" />
  </Svg>
);

/**
 * 「文字颜色」。底下的粗横线是**色块**，会跟着当前选的颜色变 ——
 * 所以它不吃 Svg 的 currentColor，得单独接一个 swatch。
 */
export const TextColor = ({ swatch = 'currentColor', ...p }: IconProps & { swatch?: string }) => (
  <Svg {...p}>
    <path d="M3.6 10.9 7.2 3.2h1.6l3.6 7.7" />
    <path d="M5.2 8.3h5.6" />
    <path d="M3.1 13.5h9.8" stroke={swatch} strokeWidth={2.6} />
  </Svg>
);

/** 「底色高亮」。和 TextColor 一样，底部色块吃 swatch。 */
export const Highlighter = ({ swatch = 'currentColor', ...p }: IconProps & { swatch?: string }) => (
  <Svg {...p}>
    <path d="M3.5 9.6 9.9 3.2a1.4 1.4 0 0 1 2 2l-6.4 6.4-2.9.7.9-2.7Z" />
    <path d="M3.1 13.5h9.8" stroke={swatch} strokeWidth={2.6} />
  </Svg>
);

/** 「字号」：一大一小两个 A */
export const TextSize = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 12.3 4.2 5.5h1l2.7 6.8" />
    <path d="M2.6 9.9h5.2" />
    <path d="M9.2 12.3 11 8.1h.8l1.8 4.2" />
    <path d="M9.8 10.8h3.2" />
  </Svg>
);

/** 「卡片」：带标题条的圆角块 */
export const Card = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.2" y="3.7" width="11.6" height="8.6" rx="1.9" />
    <path d="M2.2 6.6h11.6" />
  </Svg>
);

export const Indent = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.6 3.4h10.8M6.8 8h6.6M2.6 12.6h10.8" />
    <path d="M2.7 6.3 5.2 8l-2.5 1.7V6.3Z" />
  </Svg>
);

export const Outdent = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.6 3.4h10.8M6.8 8h6.6M2.6 12.6h10.8" />
    <path d="M5.2 6.3 2.7 8l2.5 1.7V6.3Z" />
  </Svg>
);

/** 「这篇的 CSS」：一对花括号 */
export const Braces = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.4 2.6c-1.6 0-2 .9-2 2.2 0 1.6-.5 2.5-1.8 3.2 1.3.7 1.8 1.6 1.8 3.2 0 1.3.4 2.2 2 2.2" />
    <path d="M9.6 2.6c1.6 0 2 .9 2 2.2 0 1.6.5 2.5 1.8 3.2-1.3.7-1.8 1.6-1.8 3.2 0 1.3-.4 2.2-2 2.2" />
  </Svg>
);

/** 「稿纸」文件图标：稿纸那格一格的网格，和 md 的 FileText 一眼分得开 */
export const Paper = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.7" />
    <path d="M2.5 6.2h11M2.5 9.8h11" />
    <path d="M6.2 2.5v11M9.8 2.5v11" />
  </Svg>
);
