import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { backlinksOf, contextOf, dirOf, outgoingOf, parseWiki, tagsOf, titleOf } from '../lib/links';
import { Backlink, FileText, Pen, Tag } from './icons';

/*
 * 正文下面那一条「这篇和别的篇是什么关系」。
 *
 * Obsidian 把反向链接放在右侧边栏 —— 那里永远占一块地方，哪怕这篇一个链接都没有。
 * 这儿改成**有关系才出现**：标签、反向链接、还没建的链接，三样都空就整条不渲染，
 * 一个空面板占着正文的位置是纯浪费。
 *
 * 三块各有各的去处：
 *   标签 → 点一下，侧栏只留带这个标签的篇（筛选用，不是打开）
 *   反向链接 → 点一下，打开引用它的那篇（并滚到引用的那一句附近）
 *   还没建的 → 点一下，当场把那篇建出来
 */

/** 一行小标题 + 一条 hairline，跟侧栏那个 Section 一套东西 */
function Row({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="eyebrow mt-[3px] w-[3.4rem] shrink-0">{label}</span>
      <span className="min-w-0 flex-1">
        {count > 0 ? (
          children
        ) : (
          <span className="text-[11.5px] text-ink-3">还没有</span>
        )}
      </span>
    </div>
  );
}

/**
 * @param variant 渲染成哪种壳：
 *   - `bottom`（默认）：正文下面那一条，有关系才出现（整块不渲染）；
 *   - `side`：右栏里的一节，永远占位 —— 没有关系时给一句轻提示，
 *     不然右栏会看起来"少了一块"。data-* 两边完全同名，e2e 不用分叉。
 */
export default function BacklinkPane({
  path,
  text,
  variant = 'bottom',
}: {
  path: string;
  text: string;
  variant?: 'bottom' | 'side';
}) {
  const files = useStore((s) => s.files);
  const setCurrent = useStore((s) => s.setCurrent);
  const setTagFilter = useStore((s) => s.setTagFilter);
  const tagFilter = useStore((s) => s.tagFilter);
  const openWiki = useStore((s) => s.openWiki);
  const setPendingHeading = useStore((s) => s.setPendingHeading);

  const tags = useMemo(() => tagsOf(text), [text]);
  const back = useMemo(() => backlinksOf(files, path), [files, path]);
  const missing = useMemo(() => {
    const dir = dirOf(path);
    return outgoingOf(text, Object.keys(files), dir).filter((o) => !o.path);
  }, [text, files, path]);

  if (tags.length === 0 && back.length === 0 && missing.length === 0) {
    if (variant === 'bottom') return null;
    return (
      <div data-rel-empty className="px-1 py-1.5 text-[11.5px] leading-relaxed text-ink-3">
        还没有链接关系 —— 在正文里写 <span className="font-mono">[[另一篇]]</span> 或{' '}
        <span className="font-mono">#标签</span>，这里就会亮起来。
      </div>
    );
  }

  const openAt = (from: string, heading: string) => {
    setCurrent(from);
    if (heading) setPendingHeading(heading);
  };

  return (
    <div
      data-backlinks
      className={
        variant === 'side'
          ? 'min-w-0 flex-1 space-y-2.5'
          : 'shrink-0 border-t border-line bg-paper-2/60 px-5 py-2.5 max-md:px-3.5'
      }
    >
      <div className={variant === 'side' ? 'space-y-2.5' : 'mx-auto max-w-[46rem] space-y-1.5'}>
        {tags.length > 0 && (
          <Row label="标签" count={tags.length}>
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  data-backlink-tag={t}
                  onClick={() => setTagFilter(tagFilter === t ? null : t)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[11.5px] transition-colors ${
                    tagFilter === t
                      ? 'border-craft-line bg-craft-soft font-medium text-craft'
                      : 'border-line bg-surface text-ink-2 hover:border-craft-line hover:text-craft'
                  }`}
                >
                  <Tag size={10} />
                  {t}
                </button>
              ))}
            </div>
          </Row>
        )}

        {back.length > 0 && (
          <Row label="被引用" count={back.length}>
            <div className="space-y-[3px]">
              {back.map((b) => (
                <button
                  key={b.from}
                  type="button"
                  data-backlink-from={b.from}
                  onClick={() => openAt(b.from, '')}
                  className="group flex w-full items-start gap-1.5 text-left"
                >
                  <Backlink size={11} className="mt-[3px] shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-ink group-hover:text-accent">
                      {titleOf(b.from)}
                      {b.hits.length > 1 && (
                        <span className="ml-1 text-[10.5px] text-ink-3">×{b.hits.length}</span>
                      )}
                    </span>
                    <span className="block truncate text-[10.5px] leading-[1.5] text-ink-3">
                      {contextOf(files[b.from] ?? '', b.hits[0], 24)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </Row>
        )}

        {missing.length > 0 && (
          <Row label="还没建" count={missing.length}>
            <div className="flex flex-wrap gap-1">
              {missing.map((m) => (
                <button
                  key={m.link.target}
                  type="button"
                  data-backlink-create={m.link.target}
                  onClick={() => openWiki(m.link.target)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-2 bg-surface px-2 py-[1px] text-[11.5px] text-ink-3 transition-colors hover:border-accent-line hover:text-accent"
                  title="点一下就建这篇"
                >
                  <Pen size={10} />
                  {m.link.target}
                </button>
              ))}
            </div>
          </Row>
        )}
      </div>
    </div>
  );
}

/** 源码模式下的反向链接只有来源名，没有上下文 —— 复用上面那块，够用。 */
export function BacklinkCount({ path }: { path: string }) {
  const files = useStore((s) => s.files);
  const n = useMemo(() => backlinksOf(files, path).length, [files, path]);
  const links = useMemo(() => parseWiki(files[path] ?? '').length, [files, path]);
  if (n === 0 && links === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
      <FileText size={11} />
      {n > 0 && `${n} 条反向链接`}
      {n > 0 && links > 0 && ' · '}
      {links > 0 && `${links} 条出链`}
    </span>
  );
}
