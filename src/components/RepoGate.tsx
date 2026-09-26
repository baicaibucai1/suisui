import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { canPickDir, defaultRepo, isTauri } from '../lib/repo';
import { Alert, Folder, FolderPlus } from './icons';

/*
 * 选仓库的引导页。**只在仓库还没定下来的时候出现**。
 *
 * ## 为什么是"挡一道"而不是"悄悄用一个默认的"
 *
 * 仓库是这个程序里唯一一处**选错了就得搬家的决定**：它决定了笔记和书落在磁盘的
 * 哪个位置。要是启动时自己挑一个目录就进去，用户会在写了几十篇之后才发现东西
 * 在一个找不着的地方 —— 那时候"换仓库"就变成一件要小心翼翼的事了。
 * 所以第一次必须让人自己看一眼、点一下。
 *
 * ## 三条不能破的规矩
 *
 *   ① **有默认，但默认要看得见**：桌面端给出「程序目录」并把它**写明白是哪个路径**，
 *      人可以直接用它（一键），也可以换。没有默认又不给理由的强制选择是刁难。
 *   ② **挑不了就照实说**：浏览器（Safari / Firefox）拿不到目录句柄时，
 *      那一档要变成「这个环境不支持」的说明，而不是一颗按了没反应的按钮。
 *   ③ **暂存要标成暂存**：`memory` 那一档不是仓库（它躺在 localStorage 里，
 *      清缓存就没了）。按钮上就写「先存在浏览器里」，不粉饰成"确定"。
 */

export default function RepoGate() {
  const gate = useStore((s) => s.repoGate);
  const busy = useStore((s) => s.repoBusy);
  const error = useStore((s) => s.repoError);
  const pickRepoDir = useStore((s) => s.pickRepoDir);
  const useDefaultRepo = useStore((s) => s.useDefaultRepo);
  const setRepoNotice = useStore((s) => s.setRepoNotice);

  /** 桌面端那份出厂目录的路径。显示它，人才知道"程序目录"是哪一个 */
  const [def, setDef] = useState<string>('');
  const desktop = isTauri();
  const pickable = canPickDir();

  useEffect(() => {
    if (!gate || !desktop) return;
    let alive = true;
    void defaultRepo()
      .then((r) => {
        if (alive && r) setDef(r.where);
      })
      .catch(() => {
        /* 拿不到就不显示路径，按钮仍然能按 —— 它会自己再试一次并报错 */
      });
    return () => {
      alive = false;
    };
  }, [gate, desktop]);

  if (!gate) return null;

  return (
    <div
      data-repo-gate
      className="dialog-in fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-paper p-4 md:p-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="选一个仓库"
        className="w-[min(560px,100%)] rounded-[14px] border border-line bg-surface p-5 shadow-pop md:p-6"
      >
        <div className="flex items-center gap-2">
          <Folder size={15} className="text-accent" />
          <span className="eyebrow">先选一个仓库</span>
        </div>

        <h1 className="mt-2 font-serif text-[18px] font-semibold leading-snug tracking-[0.02em] text-ink">
          笔记和书，放到哪个文件夹里？
        </h1>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
          仓库就是<b className="font-medium text-ink-2">你磁盘上一个普通的文件夹</b>
          ：笔记是里面一个个 <span className="font-mono">.md</span> 文件，
          书在它的 <span className="font-mono">books/</span> 子目录里。
          你可以用别的编辑器直接改、用网盘同步、也可以随时在设置里换一个 ——
          程序只是这个文件夹的一个视图。
        </p>

        <div className="mt-4 space-y-2">
          {desktop && (
            <button
              type="button"
              data-repo-default
              disabled={busy}
              onClick={() => void useDefaultRepo()}
              className="flex w-full items-start gap-3 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-accent-line hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-50"
            >
              <Folder size={14} className="mt-[2px] shrink-0 text-ink-2" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-ink">
                  用程序自带的目录
                </span>
                <span
                  data-repo-default-path
                  className="mt-[2px] block break-all font-mono text-[10.5px] leading-snug text-ink-3"
                >
                  {def || '正在准备…'}
                </span>
                <span className="mt-[2px] block text-[11px] leading-snug text-ink-3">
                  不用挑，直接开始写。以后想挪随时能改
                </span>
              </span>
            </button>
          )}

          <button
            type="button"
            data-repo-pick
            disabled={busy || !pickable}
            onClick={() => void pickRepoDir()}
            className="flex w-full items-start gap-3 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-accent-line hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-50"
          >
            <FolderPlus size={14} className="mt-[2px] shrink-0 text-ink-2" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium text-ink">
                {desktop ? '换个文件夹' : '选一个文件夹'}
              </span>
              <span className="mt-[2px] block text-[11px] leading-snug text-ink-3">
                {pickable
                  ? '比如「文档/QuitWriteRead」—— 已有的 .md 会被原样读进来'
                  : '这个浏览器不支持授权文件夹（Safari / Firefox 都不行），要用桌面版'}
              </span>
            </span>
          </button>

          {!desktop && (
            <button
              type="button"
              data-repo-memory
              disabled={busy}
              onClick={async () => {
                const { openRepo } = await import('../lib/repo');
                await useStore.getState().adoptRepo(await openRepo({ kind: 'memory' }));
                setRepoNotice('现在只是「暂存」：笔记留在浏览器里，换台机器或者清缓存就没了');
              }}
              className="flex w-full items-start gap-3 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-accent-line hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-50"
            >
              <Alert size={14} className="mt-[2px] shrink-0 text-warn" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-ink">
                  先存在浏览器里
                </span>
                <span className="mt-[2px] block text-[11px] leading-snug text-ink-3">
                  不在磁盘上：受浏览器配额限制，换台机器或清缓存就没了。
                  之后可以在设置里换成真文件夹
                </span>
              </span>
            </button>
          )}
        </div>

        {busy && (
          <p data-repo-busy className="mt-3 text-[11.5px] text-ink-3">
            正在打开仓库…
          </p>
        )}

        {error && (
          <p
            data-repo-error
            className="mt-3 rounded-[8px] border border-warn-line bg-warn-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-warn"
          >
            {error}
          </p>
        )}

        <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">
          仓库里已经有的 <span className="font-mono">.md</span> 会被原样读进来 ——
          不会改你的文件，也不会因为它们而报错。
        </p>
      </div>
    </div>
  );
}
