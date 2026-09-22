/*
 * 附件预览：图片直接显示，PDF 交给 `PdfView`（pdf.js，懒加载）。
 *
 * 三条约束：
 * 1. **本体必须轻** —— 它会被 App 懒加载，但**图片预览不该拖着 pdf.js 那 1MB**。
 *    所以 PdfView 是二级懒加载：打开图片只下这一层。
 * 2. 显示走 **blob URL**，不是 data URL。8MB 的图塞进 `src="data:..."` 会变成一个
 *    十几 MB 的 DOM 属性，DevTools 和内存都受不了；blob 只持一份二进制。
 *    ⚠️ 用完必须 `revokeObjectURL`，不然整份文件会一直挂在内存里。
 * 3. 路径栏复用 `EditorShell` —— 附件也是"摊在台面上的一张纸"，别另写一套 chrome。
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import {
  base64Bytes,
  base64ToBytes,
  blobOf,
  dataUrl,
  isImagePath,
  isPdfPath,
  mimeOf,
  prettySize,
} from '../lib/binary';
import { Badge, EditorShell } from './EditorShell';
import { Download, FilePdf, Fit, Image, ZoomIn, ZoomOut } from './icons';

const PdfView = lazy(() => import('./PdfView'));

const STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
const FIT = -1;

export default function PreviewPane() {
  const current = useStore((s) => s.current);
  const files = useStore((s) => s.files);
  const [zoom, setZoom] = useState(FIT);

  const stored = current ? (files[current] ?? '') : '';
  const isImage = current ? isImagePath(current) : false;
  const isPdf = current ? isPdfPath(current) : false;

  // 换文件时回到"适应窗口"：上一张图的放大倍率跟下一张没关系
  useEffect(() => setZoom(FIT), [current]);

  /*
   * base64 → Blob → object URL。
   * ⚠️ 依赖里放 `stored` 而不是 `files`：只有内容变了才重造（切文件、同步下来新的一版）。
   */
  const url = useMemo(() => {
    if (!current || !stored) return '';
    try {
      const bytes = base64ToBytes(stored);
      return URL.createObjectURL(blobOf(bytes, mimeOf(current)));
    } catch {
      return '';
    }
  }, [current, stored]);

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  /** pdf.js 要的是字节，不是 base64 字符串 */
  const pdfBytes = useMemo(() => {
    if (!isPdf || !stored) return null;
    try {
      return base64ToBytes(stored);
    } catch {
      return null;
    }
  }, [isPdf, stored]);

  if (!current) return null;

  const size = prettySize(base64Bytes(stored));
  const step = (dir: 1 | -1) => {
    const i = STEPS.indexOf(zoom);
    if (i < 0) {
      setZoom(dir > 0 ? 1 : 0.75);
      return;
    }
    setZoom(STEPS[Math.min(Math.max(i + dir, 0), STEPS.length - 1)]);
  };

  return (
    <EditorShell
      path={current}
      data-preview={isPdf ? 'pdf' : 'image'}
      icon={isPdf ? <FilePdf size={13} /> : <Image size={13} />}
      tag={<Badge tone={isPdf ? 'craft' : 'accent'}>{isPdf ? 'PDF' : '图片'}</Badge>}
      status={<span data-preview-size className="shrink-0 text-[11.5px] text-ink-3">{size}</span>}
      actions={
        <>
          {isImage && (
            <>
              <button
                data-zoom-out
                onClick={() => step(-1)}
                title="缩小"
                className="grid h-6 w-6 place-items-center rounded-[6px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <ZoomOut size={13} />
              </button>
              <span data-zoom className="min-w-[46px] text-center text-[11.5px] tabular-nums text-ink-2">
                {zoom === FIT ? '适应' : `${Math.round(zoom * 100)}%`}
              </span>
              <button
                data-zoom-in
                onClick={() => step(1)}
                title="放大"
                className="grid h-6 w-6 place-items-center rounded-[6px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <ZoomIn size={13} />
              </button>
              <button
                data-zoom-fit
                onClick={() => setZoom(FIT)}
                title="适应窗口"
                className={`grid h-6 w-6 place-items-center rounded-[6px] transition-colors ${
                  zoom === FIT
                    ? 'bg-surface-2 text-accent'
                    : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                }`}
              >
                <Fit size={13} />
              </button>
            </>
          )}
          {/*
            下载走 data URL 而不是 blob URL：blob 那个 URL 会在组件卸载时被 revoke，
            而 `<a download>` 的落盘是异步的 —— 用 data URL 不存在"还没下就被回收"这一说。
          */}
          <a
            data-download
            href={url || dataUrl(current, stored)}
            download={current.slice(current.lastIndexOf('/') + 1)}
            title="下载这个附件"
            className="grid h-6 w-6 place-items-center rounded-[6px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Download size={13} />
          </a>
        </>
      }
    >
      {isPdf ? (
        pdfBytes ? (
          <Suspense
            fallback={
              <div className="grid min-h-0 flex-1 place-items-center">
                <p className="text-[12.5px] text-ink-3">正在载入 PDF 查看器…</p>
              </div>
            }
          >
            <PdfView bytes={pdfBytes} />
          </Suspense>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center p-6">
            <p data-preview-broken className="text-[12.5px] text-danger">
              这个 PDF 的内容不是合法 base64，读不出来
            </p>
          </div>
        )
      ) : url ? (
        <div className="min-h-0 flex-1 overflow-auto bg-surface-2/60 p-4">
          {/* `m-auto` 而不是 place-items-center：内容比容器大时，居中的那套会把左上裁掉 */}
          <div className="flex h-full w-full">
            <img
              data-preview-img
              src={url}
              alt={current}
              style={
                zoom === FIT
                  ? { maxWidth: '100%', maxHeight: '100%' }
                  : { width: `${zoom * 100}%`, maxWidth: 'none', maxHeight: 'none' }
              }
              className="m-auto block rounded-[6px] bg-white shadow-sm"
            />
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center p-6">
          <p data-preview-broken className="text-[12.5px] text-danger">
            这张图的内容不是合法 base64，显示不出来
          </p>
        </div>
      )}
    </EditorShell>
  );
}
