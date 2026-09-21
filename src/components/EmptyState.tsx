import { FileText } from './icons';
import { EditorShell, SheetBody } from './EditorShell';

/*
 * 编辑器区的两种「还没有编辑器」状态。
 *
 * 为什么不写在 EditorPane 里：编辑器带着 Milkdown / Crepe / KaTeX，压缩后 1.1MB。
 * 只要 EditorPane 参与首屏渲染，这 1.1MB 就得在主包之后再下一遍 ——
 * 而只想看一眼文件列表的人根本用不上。所以编辑区改成按需加载（`App.tsx` 里的 `lazy`），
 * 这两种状态必须留在主包里，由 App 直接渲染。
 *
 * ⚠️ 往这里加东西时注意别把编辑器的依赖引进来。
 *    `EditorShell` 是安全的（只画个壳 + 图标），其余编辑器模块一个都不许碰。
 */

/**
 * 摊在台面上的一叠纸和一支笔。
 *
 * 不引图片文件：一是首屏不该为一张插图再发一次请求，二是它得跟着主题色走 ——
 * 颜色全部取 CSS 变量，改令牌时插图自动跟着变。
 */
function DeskArt() {
  return (
    <svg
      width="176"
      height="126"
      viewBox="0 0 176 126"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        {/* 纸的落影：一张小高斯模糊，比硬椭圆柔和得多 */}
        <filter id="desk-art-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <ellipse cx="88" cy="112" rx="56" ry="7" fill="var(--color-ink)" opacity="0.1" filter="url(#desk-art-blur)" />
      {/* 后一张纸：稍微歪一点，才像手放上去的 */}
      <g transform="rotate(-7 88 54)">
        <rect
          x="38"
          y="12"
          width="100"
          height="86"
          rx="7"
          fill="var(--color-surface-2)"
          stroke="var(--color-line-2)"
        />
      </g>
      {/* 前一张纸 */}
      <g transform="rotate(4 96 60)">
        <rect x="49" y="24" width="100" height="86" rx="7" fill="var(--color-ink)" opacity="0.07" filter="url(#desk-art-blur)" />
        <rect
          x="46"
          y="18"
          width="100"
          height="86"
          rx="7"
          fill="var(--color-surface)"
          stroke="var(--color-line-2)"
        />
        {/* 标题那行比正文深一档，剩下的都是"还没落的墨" */}
        <rect x="59" y="34" width="44" height="5" rx="2.5" fill="var(--color-ink-3)" opacity="0.5" />
        <rect x="59" y="47" width="72" height="4" rx="2" fill="var(--color-line-2)" />
        <rect x="59" y="57" width="64" height="4" rx="2" fill="var(--color-line-2)" />
        <rect x="59" y="67" width="70" height="4" rx="2" fill="var(--color-line-2)" />
        <rect x="59" y="77" width="40" height="4" rx="2" fill="var(--color-line-2)" />
      </g>
      {/* 笔：黄铜那支，正好落在纸上 */}
      <g transform="rotate(-38 128 96)">
        <rect x="104" y="91" width="58" height="10" rx="5" fill="var(--color-craft)" />
        <path d="M104 91l-11 5 11 5z" fill="var(--color-ink-2)" />
        <rect x="150" y="91" width="12" height="10" rx="5" fill="var(--color-craft-line)" />
      </g>
    </svg>
  );
}

/** 还没选文件。不说「左边」—— 手机上文件列表在抽屉里，说方位会让人找不到。 */
export function EmptyState() {
  return (
    <div
      data-editor-empty
      className="desk flex h-full min-h-0 flex-col items-center justify-center gap-5 px-6 text-center"
    >
      <DeskArt />
      <div className="max-w-[22rem]">
        {/* 主句用衬线：这是空态里唯一该被"读"的一句话 */}
        <p className="font-serif text-[16px] font-semibold tracking-[0.06em] text-ink">
          摊开一张纸，先写一句
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
          从文件列表里选一篇开始改，或点「创建笔记」写新的
          <br />
          第一次用可以先按「同步」把仓库拉下来
        </p>
      </div>
    </div>
  );
}

/**
 * 点了文件、编辑器那个包还在路上。
 *
 * 整个壳（路径栏 + 纸面）用 EditorShell 照着真编辑器画一遍：**别让点击看起来没反应** ——
 * 手机上第一次打开要下 1.1MB，真机上这段空窗是能感觉到的。
 * 骨架本身是三条宽度不等的灰条，比转圈更能说明"东西在这儿，马上出来"。
 */
export function EditorLoading({ path }: { path: string }) {
  return (
    <EditorShell
      data-editor-loading=""
      path={path}
      icon={<FileText size={13} />}
      actions={<span className="text-[11.5px] text-ink-3">正在打开编辑器…</span>}
    >
      <div className="flex h-10 shrink-0 items-center border-b border-line bg-surface-2 px-4 max-md:h-9 max-md:px-3">
        <div className="mx-auto flex w-full max-w-[46rem] gap-[3px]">
          {[28, 20, 20, 32].map((w, i) => (
            <div
              key={i}
              className="h-7 animate-pulse rounded-[6px] bg-surface-3"
              style={{ width: w, animationDelay: `${i * 130}ms` }}
            />
          ))}
        </div>
      </div>
      <SheetBody>
        <div className="space-y-3.5" aria-hidden>
          {['62%', '88%', '74%', '80%', '46%'].map((w, i) => (
            <div
              key={w}
              className="h-3.5 animate-pulse rounded bg-surface-2"
              style={{ width: w, animationDelay: `${i * 140}ms` }}
            />
          ))}
        </div>
      </SheetBody>
    </EditorShell>
  );
}
