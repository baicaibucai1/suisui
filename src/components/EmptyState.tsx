import { FileText } from './icons';

/*
 * 编辑器区的两种「还没有编辑器」状态。
 *
 * 为什么不写在 EditorPane 里：编辑器带着 Milkdown / Crepe / KaTeX，压缩后 1.4MB。
 * 只要 EditorPane 参与首屏渲染，这 1.4MB 就得在主包之后再下一遍 ——
 * 而只想看一眼文件列表的人根本用不上。所以编辑区改成按需加载（`App.tsx` 里的 `lazy`），
 * 这两种状态必须留在主包里，由 App 直接渲染。
 *
 * ⚠️ 往这里加东西时注意别把编辑器的依赖引进来（别 import EditorPane / RichPane / mdkit 之外的编辑器模块）。
 */

/** 还没选文件。不说「左边」—— 手机上文件列表在抽屉里，说方位会让人找不到。 */
export function EmptyState() {
  return (
    <div data-editor-empty className="flex h-full flex-col items-center justify-center gap-3 bg-surface text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-ink-3">
        <FileText size={20} />
      </div>
      <p className="text-[13px] leading-relaxed text-ink-3">
        选一篇开始写，或点「创建笔记」写新的
        <br />
        也可以按「同步」把仓库拉下来
      </p>
    </div>
  );
}

/**
 * 点了文件、编辑器那个包还在路上。
 *
 * 先把路径栏按编辑器的样子画出来：**别让点击看起来没反应** ——
 * 手机上第一次打开要下 1.4MB，真机上这段空窗是能感觉到的。
 */
export function EditorLoading({ path }: { path: string }) {
  return (
    <div data-editor-loading className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-2.5 border-b border-line px-4 max-md:gap-2 max-md:px-3">
        <FileText size={13} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">{path}</span>
        <span className="shrink-0 text-[11.5px] text-ink-3">正在打开编辑器…</span>
      </div>
      <div className="flex flex-1 items-start justify-center pt-16">
        <div className="w-full max-w-[44rem] space-y-3 px-6 max-md:px-3" aria-hidden>
          {/* 骨架：三条宽度不等的灰条，比转圈更能说明"东西在这儿，马上出来" */}
          {['62%', '88%', '74%'].map((w, i) => (
            <div key={w} className="h-3.5 animate-pulse rounded bg-surface-2" style={{ width: w, animationDelay: `${i * 140}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
