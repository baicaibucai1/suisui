import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { isProgramArtifact } from '../lib/visible';
import { missingNotes } from '../lib/links';
import { Check, Pen } from './icons';

/*
 * 「引用过、但还没建的笔记」—— 全库扫一遍，批量补建。
 *
 * 为什么要有这一块：
 *   右栏那个「还没建」只看得见**当前这一篇**的出链。真实写东西时，
 *   未建的链接会散落在十几篇里（写的时候顺手写下 `[[某人]]`、`[[某本书]]`，
 *   打算以后补 —— 然后就忘了）。一篇篇点开找，等于没有这个功能。
 *
 * 两条设计线：
 *   ① **默认全不选**，靠「全选」一键选满。不小心批量建出十几篇空笔记，
 *      比漏建难收拾得多（它们会真的同步到远端）。
 *   ② **建哪儿由 missingNotes 算**（引用最多的那个目录），也可以逐条改。
 *      跨篇引用的目标往往不属于任何一篇旁边，硬塞进当前目录反而是错的。
 */

export default function MissingPane() {
  const files = useStore((s) => s.files);
  const showAll = useStore((s) => s.showAll);
  const createNotes = useStore((s) => s.createNotes);

  /** 选中的目标名。默认空 —— 见上面第 ① 条 */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** 刚建完的那批，给一句"建好了"的回执（不然面板毫无变化，像没反应） */
  const [done, setDone] = useState<string[]>([]);

  const missing = useMemo(() => {
    const src: Record<string, string> = {};
    for (const [p, t] of Object.entries(files)) {
      if (typeof t !== 'string') continue;
      if (!showAll && isProgramArtifact(p)) continue;
      src[p] = t;
    }
    return missingNotes(src);
  }, [files, showAll]);

  // 建完的从列表里掉出去（files 变了，missing 会重算），选中集合顺手清掉
  const live = useMemo(() => new Set(missing.map((m) => m.target)), [missing]);
  const sel = useMemo(() => [...picked].filter((t) => live.has(t)), [picked, live]);

  if (missing.length === 0 && done.length === 0) return null;

  const toggle = (target: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });

  const build = (targets: string[]) => {
    const items = missing.filter((m) => targets.includes(m.target)).map((m) => ({ dir: m.dir, title: m.target }));
    const made = createNotes(items);
    setDone(made.map((p) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '')));
    setPicked(new Set());
  };

  return (
    <div data-missing-pane className="min-w-0 space-y-1.5">
      {done.length > 0 && (
        <div
          data-missing-done
          className="flex items-start gap-1.5 rounded-[8px] border border-ok-line bg-ok-soft px-2 py-1.5"
        >
          <Check size={12} strokeWidth={2.2} className="mt-[2px] shrink-0 text-ok" />
          <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ok">
            建好了 {done.length} 篇：{done.join('、')}
          </span>
        </div>
      )}

      {missing.length === 0 ? (
        <p className="px-1 py-1 text-[11.5px] leading-relaxed text-ink-3">
          没有悬着的链接了。
        </p>
      ) : (
        <>
          <div className="flex items-center gap-1.5 pb-0.5">
            <button
              data-missing-all
              onClick={() => setPicked(new Set(missing.map((m) => m.target)))}
              className="rounded-[7px] px-1.5 py-[2px] text-[11px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              全选
            </button>
            <button
              data-missing-none
              onClick={() => setPicked(new Set())}
              className="rounded-[7px] px-1.5 py-[2px] text-[11px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              全不选
            </button>
            <button
              data-missing-build
              disabled={sel.length === 0}
              onClick={() => build(sel)}
              className="ml-auto rounded-[7px] border border-accent-line bg-accent-soft px-2 py-[3px] text-[11.5px] font-medium text-accent transition-opacity hover:brightness-[1.04] disabled:opacity-35 disabled:pointer-events-none"
            >
              {sel.length > 0 ? `建这 ${sel.length} 篇` : '建选中的'}
            </button>
          </div>

          <div className="space-y-px">
            {missing.map((m) => {
              const on = picked.has(m.target);
              return (
                <div
                  key={m.target}
                  data-missing-item={m.target}
                  className={`group flex w-full items-start gap-1.5 rounded-[7px] px-1.5 py-[5px] transition-colors ${
                    on ? 'bg-accent-soft' : 'hover:bg-surface-2'
                  }`}
                >
                  {/* 勾选框自己是个按钮：整行还要留给"点开看看是哪些篇引的" */}
                  <button
                    data-missing-check={m.target}
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(m.target)}
                    className={`mt-[1px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border transition-colors ${
                      on ? 'border-accent bg-accent text-white' : 'border-line-2 bg-surface'
                    }`}
                  >
                    {on && <Check size={10} strokeWidth={3} />}
                  </button>

                  <button
                    data-missing-open={m.target}
                    onClick={() => toggle(m.target)}
                    className="min-w-0 flex-1 text-left"
                    title={`被 ${m.from.length} 篇引用：${m.from.join('、')}`}
                  >
                    <span className="block truncate text-[12px] text-ink">{m.target}</span>
                    <span className="block truncate font-mono text-[10px] text-ink-3">
                      被 {m.from.length} 篇引用 · 建到 {m.dir || '.'}/
                    </span>
                  </button>

                  <button
                    data-missing-one={m.target}
                    onClick={() => build([m.target])}
                    title="只建这一篇"
                    className="mt-[1px] shrink-0 rounded-[5px] p-0.5 text-ink-3 opacity-0 transition-opacity hover:bg-surface-2 hover:text-accent group-hover:opacity-100"
                  >
                    <Pen size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}