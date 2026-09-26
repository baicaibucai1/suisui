import { useEffect, useMemo } from 'react';
import { useStore } from '../lib/store';
import { kindLabel } from '../lib/decide';
import { backlinksOf, dirOf, outgoingOf, tagsOf } from '../lib/links';
import { isFolderFile } from '../lib/folders';
import { isBinaryPath, isImagePath, isPdfPath, prettySize } from '../lib/binary';
import { Close } from './icons';

/*
 * 属性面板（右键菜单最后一项）。
 *
 * 只显示**不用问远端就知道**的东西：路径、大小、字数、标签、关系、本地同步状态。
 * 刻意不放修改时间 / 创建时间 —— 本地这一份是 localStorage 里的一个字符串，
 * 根本没有时间戳；硬编一个"刚刚"糊上去，用户真去跟文件管理器对就露馅了。
 * 宁可少两行，不能显示一个查不到来源的数字。
 *
 * 「这是文件还是文件夹 / 是不是二进制」全部走**和文件树图标同一套判据**
 * （isBinaryPath / isImagePath ...）—— 两边各写一份，迟早出现"图标是图片、
 * 属性写着文字"这种自相矛盾的画面。
 */
export default function EntryInfo({ path, onClose }: { path: string; onClose: () => void }) {
  const files = useStore((s) => s.files);
  const changes = useStore((s) => s.changes);
  const planStale = useStore((s) => s.planStale);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { rows, isDir } = useMemo(() => {
    const paths = Object.keys(files);
    const dir = paths.some((p) => p.startsWith(`${path}/`));
    const out: { k: string; v: string; mono?: boolean }[] = [{ k: '路径', v: path, mono: true }];

    if (dir) {
      const inner = paths.filter((p) => p.startsWith(`${path}/`) && !isFolderFile(p));
      const sub = new Set(inner.map((p) => p.slice(path.length + 1).split('/')[0]));
      const notes = inner.filter((p) => p.endsWith('.md')).length;
      const bytes = inner.reduce((n, p) => n + byteLength(files[p] ?? '', isBinaryPath(p)), 0);
      out.push({ k: '类型', v: '文件夹' });
      out.push({ k: '里面', v: `${inner.length} 个文件 · ${sub.size} 个子文件夹` });
      if (inner.length) out.push({ k: '其中笔记', v: `${notes} 篇` });
      out.push({ k: '合计大小', v: prettySize(bytes) });
      return { rows: out, isDir: true };
    }

    const body = files[path] ?? '';
    const binary = isBinaryPath(path);
    out.push({ k: '类型', v: kindOf(path) });
    out.push({ k: '大小', v: `${prettySize(byteLength(body, binary))}（${byteLength(body, binary)} 字节）` });

    if (!binary) {
      const chars = Array.from(body).filter((c) => !/\s/.test(c)).length;
      out.push({ k: '字数', v: `${chars} 字 · ${body.split('\n').length} 行` });
      const tags = tagsOf(body);
      out.push({ k: '标签', v: tags.length ? tags.map((t) => `#${t}`).join('  ') : '没有' });
      const outLinks = outgoingOf(body, paths, dirOf(path)).length;
      const back = backlinksOf(files, path).length;
      out.push({ k: '关系', v: `指向 ${outLinks} 篇 · 被 ${back} 篇引用` });
    }

    const hit = changes.find((c) => c.path === path);
    out.push({
      k: '同步',
      v: hit ? kindLabel(hit.kind) : planStale ? '还没比对' : '与远端一致',
    });
    return { rows: out, isDir: false };
  }, [path, files, changes, planStale]);

  return (
    <>
      <div data-info-mask onClick={onClose} className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[1px]" />
      <div
        data-info-panel
        role="dialog"
        aria-label="属性"
        className="fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[12px] border border-line bg-surface shadow-pop"
      >
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 py-2.5 pl-4 pr-2">
          <span className="eyebrow">属性</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">
            {path.slice(path.lastIndexOf('/') + 1)}
          </span>
          <button
            data-info-close
            onClick={onClose}
            aria-label="关闭属性"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Close size={14} />
          </button>
        </div>
        <dl className="px-4 py-2">
          {rows.map((r) => (
            <div key={r.k} className="flex gap-3 border-b border-line py-2 last:border-b-0">
              <dt className="w-[68px] shrink-0 pt-px text-[11.5px] text-ink-3">{r.k}</dt>
              <dd
                className={`min-w-0 flex-1 break-words text-[12.5px] text-ink ${
                  r.mono ? 'font-mono text-[12px]' : ''
                }`}
              >
                {r.v}
              </dd>
            </div>
          ))}
        </dl>
        {isDir && (
          <p className="border-t border-line bg-surface-2 px-4 py-2 text-[10.5px] leading-relaxed text-ink-3">
            文件夹在库里是一个隐藏的 .folder 标识文件：它在这个文件夹就在。
          </p>
        )}
      </div>
    </>
  );
}

/** 文件类型的人话名字 —— 判断顺序跟文件树的图标一致（图片 → PDF → md → 其他） */
function kindOf(path: string): string {
  if (isImagePath(path)) return '图片';
  if (isPdfPath(path)) return 'PDF';
  if (path.toLowerCase().endsWith('.md')) return 'Markdown 文字';
  if (isFolderFile(path)) return '文件夹标识文件';
  if (isBinaryPath(path)) return '二进制文件';
  return '文本文件';
}

/**
 * 文本按 UTF-8 算字节，二进制按 base64 解码后的长度算。
 * ⚠️ 不能靠"字符串长得像不像 base64"来猜 —— 一个英文单词也全是合法字符，
 * 猜错的后果是属性里那个数字跟实际文件对不上。所以由调用方按**路径**判定（和图标同一套）。
 */
function byteLength(body: string, binary: boolean): number {
  if (binary) {
    const pad = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.round((body.length * 3) / 4) - pad);
  }
  return new TextEncoder().encode(body).length;
}
