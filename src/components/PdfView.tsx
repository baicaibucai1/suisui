/*
 * PDF 预览：**用 pdf.js 渲到 canvas**，不是丢给浏览器的内嵌查看器。
 *
 * 为什么不嵌 `<iframe src=blobUrl>`：那依赖浏览器自带 PDF 插件，
 * 而 Tauri 的 WebView2 **不带** —— 桌面上会是一片空白，网页端却好好的，
 * 这种"换个端就没了"的问题最难查。pdf.js 是纯 JS，两个端行为一致。
 *
 * 代价是它约 1MB，所以：① 这个文件被 `PreviewPane` 用 `lazy()` 动态 import，
 * 只有真的打开一个 PDF 时才下载；② worker 也走独立 URL，不进主包。
 */
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Alert, Fit, PageNext, PagePrev, ZoomIn, ZoomOut } from './icons';

/** pdf.js 的 worker。Vite 会把它当独立资源产出，不在主包里。 */
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** 缩放档位：适应窗口是 -1，其余是真实倍率 */
const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const FIT = -1;

type Props = {
  /** PDF 的原始字节。⚠️ 不能是 base64 字符串，pdf.js 认不出来 */
  bytes: Uint8Array;
};

/**
 * 关掉一个文档。
 * ⚠️ 运行时 `destroy()` 是有的（v5 起），但 pdf.js 自带的 .d.ts 没声明它 ——
 * 不关的话 worker 和那份字节会一直挂着，翻几次 PDF 就能攒出几百 MB。
 */
function dropDoc(doc: PDFDocumentProxy | null): void {
  const d = doc as unknown as { destroy?: () => Promise<void> } | null;
  void d?.destroy?.();
}

export default function PdfView({ bytes }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(FIT);
  const [boxW, setBoxW] = useState(0);
  const [busy, setBusy] = useState(true);
  const [fail, setFail] = useState<string | null>(null);

  /*
   * 打开文档。`bytes` 变了（换了文件 / 重新同步下来一份新的）就重开。
   * ⚠️ pdf.js 会"拿走"传进去的 ArrayBuffer（防止别的线程改它），
   * 所以每次都给一份**拷贝** —— 否则同一个 Uint8Array 第二次打开时是空的。
   */
  useEffect(() => {
    let alive = true;
    let opened: PDFDocumentProxy | null = null;
    setBusy(true);
    setFail(null);

    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const copy = new Uint8Array(bytes);
        const d = await pdfjs.getDocument({ data: copy }).promise;
        if (!alive) {
          dropDoc(d);
          return;
        }
        opened = d;
        setDoc(d);
        setPages(d.numPages);
        setPage((p) => (p > d.numPages ? 1 : p));
      } catch (e) {
        if (!alive) return;
        // worker 起不来（桌面端的资源协议偶尔如此）时退回主线程跑 —— 慢一点，但能看
        try {
          const pdfjs = await import('pdfjs-dist');
          pdfjs.GlobalWorkerOptions.workerSrc = '';
          const d = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
          if (!alive) {
            dropDoc(d);
            return;
          }
          opened = d;
          setDoc(d);
          setPages(d.numPages);
          setPage(1);
        } catch (e2) {
          if (alive) setFail((e2 as Error)?.message ?? String(e2));
        }
      } finally {
        if (alive) setBusy(false);
      }
    })();

    return () => {
      alive = false;
      dropDoc(opened);
    };
  }, [bytes]);

  /** 「适应窗口」要知道容器多宽 —— 量一次，窗口变了再量 */
  useEffect(() => {
    const host = canvasRef.current?.parentElement;
    if (!host) return;
    const measure = () => setBoxW(host.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [doc]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!doc) return;
      const page0 = Math.min(Math.max(page, 1), pages);
      try {
        const p = await doc.getPage(page0);
        if (!alive) return;
        const base = p.getViewport({ scale: 1 });
        // 适应窗口：按容器宽度算一个倍率；否则用选的档位
        const scale = zoom === FIT && boxW > 0 ? (boxW - 24) / base.width : (zoom === FIT ? 1 : zoom);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = p.getViewport({ scale: scale * dpr });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        // CSS 尺寸按逻辑像素给，否则高分屏上会画成两倍大
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        await p.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
      } catch (e) {
        if (alive) setFail((e as Error)?.message ?? String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [doc, page, pages, zoom, boxW]);

  const step = (dir: 1 | -1) => {
    const i = STEPS.indexOf(zoom);
    if (i < 0) {
      // 从"适应窗口"出发：往放大走就给 100%，往缩小走就给 75%
      setZoom(dir > 0 ? 1 : 0.75);
      return;
    }
    const next = STEPS[Math.min(Math.max(i + dir, 0), STEPS.length - 1)];
    setZoom(next);
  };

  return (
    <div data-pdf className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-3">
        <button
          data-page-prev
          disabled={page <= 1}
          onClick={() => setPage((n) => Math.max(1, n - 1))}
          title="上一页"
          className="grid h-6 w-6 place-items-center rounded-[6px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <PagePrev size={13} />
        </button>
        <span data-page className="min-w-[62px] text-center text-[11.5px] tabular-nums text-ink-2">
          {pages ? `${page} / ${pages}` : '—'}
        </span>
        <button
          data-page-next
          disabled={!pages || page >= pages}
          onClick={() => setPage((n) => Math.min(pages, n + 1))}
          title="下一页"
          className="grid h-6 w-6 place-items-center rounded-[6px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <PageNext size={13} />
        </button>

        <span className="mx-1 h-4 w-px bg-line" />

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
          title="适应宽度"
          className={`grid h-6 w-6 place-items-center rounded-[6px] transition-colors ${
            zoom === FIT ? 'bg-surface-2 text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
          }`}
        >
          <Fit size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-surface-2/60 p-3">
        {fail && (
          <div className="mx-auto flex max-w-[36rem] items-start gap-2 rounded-[10px] border border-danger-line bg-danger-soft p-3">
            <Alert size={14} className="mt-[2px] shrink-0 text-danger" />
            <p data-pdf-fail className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-danger">
              这个 PDF 打不开：{fail}
            </p>
          </div>
        )}
        {!fail && (
          <div className="mx-auto w-fit">
            {/*
              canvas 必须常驻：pdf.js 往同一个 canvas 反复重绘（翻页、缩放），
              用 key 或者条件渲染换掉它，画完的那一下就丢了。
            */}
            <canvas
              ref={canvasRef}
              data-pdf-canvas
              className={`block rounded-[6px] bg-white shadow-sm ${busy ? 'opacity-0' : 'opacity-100'}`}
            />
            {busy && (
              <p data-pdf-loading className="py-16 text-center text-[12.5px] text-ink-3">
                正在打开 PDF…
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
