import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { useMedia, WIDE } from '../lib/media';
import { outlineOf } from '../lib/links';
import BacklinkPane from './BacklinkPane';
import MissingPane from './MissingPane';
import BookAside from './BookAside';
import { ListBullet } from './icons';

/*
 * 右侧边栏 —— 布局对齐 Obsidian 的第三条柱子：
 *
 *   左栏回答「库 里有什么」，正文回答「这一篇写了什么」，
 *   右栏回答「这一篇在书架的哪一层、跟别的篇有什么来往」。
 *
 * 两节内容：
 *   大纲 —— 正文里的标题，点一下滚过去（所见即所得走高亮跳转，源码模式算行号滚 textarea）；
 *   关系 —— BacklinkPane 换了个壳（side 变体）：标签、被引用、还没建，跟 Obsidian
 *   把反链挂右栏是同一个道理：它永远在固定的位置，不用滚到文末才找得着。
 *
 * 手机（≤768px）整条不渲染，关系面板回正文底部（EditorPane 那边用同一条媒体查询
 * 决定挂谁 —— 同一组件永远只有一份，选择器不会撞车）。
 */

/** 一节的小标题：eyebrow 字 + 一条 hairline，跟左栏的 Section 一套。 */
function PaneSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex h-8 items-center gap-2 pl-1 pr-0.5">
        <span className="eyebrow">{label}</span>
        <span className="h-px min-w-2 flex-1 bg-line" />
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default function RightPane() {
  const wide = useMedia(WIDE);
  const current = useStore((s) => s.current);
  const files = useStore((s) => s.files);
  const side = useStore((s) => s.side);
  const currentBook = useStore((s) => s.currentBook);
  const setPendingHeading = useStore((s) => s.setPendingHeading);

  const text = current ? (files[current] ?? '') : '';
  const isMd = current ? current.toLowerCase().endsWith('.md') : false;
  const outline = useMemo(() => (isMd ? outlineOf(text) : []), [text, isMd]);

  if (!wide) return null;

  /*
   * 读着书的时候右栏换成那本书的**目录 + 批注**。
   *
   * 判定要带上 `side`：切去书写改笔记时 currentBook 还留着（回去时能接上读到哪），
   * 那时候人要看的是**笔记**的大纲和关系 —— 把书的目录一直顶在那儿是抢地方。
   */
  if (side === 'read' && currentBook) return <BookAside />;

  /*
   * ⚠️ 收起按钮**不在这一栏里** —— 它在顶栏（`TopBar` 的 `data-right-toggle`）。
   * 原因写在 TopBar 的注释里：开关长在栏自己身上，栏一收按钮就跟着没了，
   * 人只能靠猜把它叫回来。同一时刻 `[data-right-toggle]` 必须只有一个。
   */

  // 没开任何一篇：右栏照常在（布局不跳），给一句说明为什么是空的
  if (!current) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <PaneSection label="本页">
            <p className="px-1 py-1.5 text-[11.5px] leading-relaxed text-ink-3">
              打开一篇笔记，这里会列出它的小标题和它跟别的篇的关系。
            </p>
          </PaneSection>
        </div>
      </div>
    );
  }

  const jump = (heading: string) => setPendingHeading(heading);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-rightpane-body
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3"
      >
      {/*
        大纲。缩进 = (level-1) × 10px，和左栏目录树一个节奏；
        一二级标题是"这一页的骨架"，给足字重，三往下自然退后。
      */}
      <PaneSection label="大纲">
        {outline.length === 0 ? (
          <p className="px-1 py-1.5 text-[11.5px] leading-relaxed text-ink-3">
            {isMd ? (
              '还没有小标题 —— 在正文里写 # 开头的一行就有了。'
            ) : (
              '这篇不是 markdown，没有大纲。'
            )}
          </p>
        ) : (
          <nav data-outline className="space-y-px pb-1">
            {outline.map((h, i) => (
              <button
                key={`${i}-${h.text}`}
                data-outline-item={h.text}
                onClick={() => jump(h.text)}
                title={`跳到「${h.text}」`}
                style={{ paddingLeft: 4 + (h.level - 1) * 10 }}
                className={`block w-full max-w-full truncate rounded-[6px] py-[4px] pr-1.5 text-left text-[12px] transition-colors hover:bg-surface-2 hover:text-ink ${
                  h.level <= 2 ? 'font-medium text-ink' : 'text-ink-2'
                }`}
              >
                {h.text}
              </button>
            ))}
          </nav>
        )}
      </PaneSection>

      <PaneSection label="关系">
        {isMd ? (
          <BacklinkPane path={current} text={text} variant="side" />
        ) : (
          <p className="px-1 py-1.5 text-[11.5px] leading-relaxed text-ink-3">
            这篇不是 markdown，没有链接关系。
          </p>
        )}
      </PaneSection>

      {/*
        全库的「待建笔记」。跟上面那节的区别：上面是**这一篇**的出链，
        这里是**所有篇**攒下来的悬空链接 —— 写的时候顺手写下打算以后补的那些。
      */}
      <PaneSection label="待建">
        <MissingPane />
      </PaneSection>

        {/* 右栏底部收个尾：大纲很长时上面滚，这行字提醒下面还有一节 */}
        <div className="mt-auto flex items-center gap-1.5 pl-1 pt-2 text-[10.5px] text-ink-3">
          <ListBullet size={11} />
          大纲点一下就能跳过去
        </div>
      </div>
    </div>
  );
}
