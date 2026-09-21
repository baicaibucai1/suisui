import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../lib/store';
import {
  WALLPAPER_BLUR,
  WALLPAPER_DIM,
  assetUrl,
  findWallpaper,
  loadWallpaperManifest,
  type WallpaperItem,
} from '../lib/wallpaper';
import { Alert, Check, Close, Image } from './icons';

/*
 * 设置面板：从右侧推出的一张纸。
 *
 * 内容按「改了之后影响多大的一片地方」排序：
 *   台面（整页背景）→ 文件列表（半页）→ 关于（只是说明）。
 * 同一条设置**不在这里和别处各放一份开关** —— 两处状态同源但视觉不同步时，
 * 用户会以为自己改了没生效（文件列表那个眼睛图标是快捷方式，它俩共用同一个 store 值）。
 *
 * ⚠️ 壁纸列表是**从包里读 manifest**，不是联网抓（理由见 lib/wallpaper.ts 的注释）：
 * 包里没抓过壁纸是正常的初始状态，那只是「列表为空」，不能当错误弹红字。
 */

const BASE = import.meta.env.BASE_URL;

/** manifest 抓一次就够：关掉面板再打开不该重下一遍列表 */
let cache: { items: WallpaperItem[]; fetchedAt: string; count: number } | null = null;

export default function SettingsSheet() {
  const open = useStore((s) => s.settings);
  const setOpen = useStore((s) => s.setSettings);
  const wall = useStore((s) => s.wallpaper);
  const setWall = useStore((s) => s.setWallpaper);
  const showAll = useStore((s) => s.showAll);
  const setShowAll = useStore((s) => s.setShowAll);

  const [items, setItems] = useState<WallpaperItem[]>(cache?.items ?? []);
  const [fetchedAt, setFetchedAt] = useState(cache?.fetchedAt ?? '');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || cache) {
      if (cache) setItems(cache.items);
      return;
    }
    let alive = true;
    void loadWallpaperManifest(BASE)
      .then((m) => {
        if (!alive) return;
        cache = { items: m.items, fetchedAt: m.fetchedAt, count: m.count };
        setItems(m.items);
        setFetchedAt(m.fetchedAt);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [open]);

  // Esc 关面板。跟抽屉那条一致：浮层就得能被 Esc 收掉
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const on = wall.enabled && !!wall.id;
  const cur = findWallpaper(items, wall.id);
  const day = fetchedAt ? fetchedAt.slice(0, 10) : '—';

  return (
    <>
      <div
        data-settings-mask
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[1px]"
      />
      <aside
        data-settings-panel
        className="fixed right-0 top-0 z-50 flex h-full w-[400px] flex-col border-l border-line bg-surface shadow-pop max-md:w-full"
      >
        <div className="flex shrink-0 items-baseline justify-between border-b border-line bg-surface-2 px-4 py-3">
          <span className="font-serif text-[13.5px] font-semibold tracking-[0.1em]">设置</span>
          <button
            data-settings-close
            onClick={() => setOpen(false)}
            aria-label="关闭设置"
            className="grid h-7 w-7 place-items-center rounded-[8px] text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Close size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <Section title="台面">
            <Toggle
              id="wall"
              label="台面壁纸"
              hint="把 Bing 每日一图铺在台面上，纸仍然浮在它上面"
              on={wall.enabled}
              onChange={(v) => setWall({ enabled: v, ...(v && !wall.id && items[0] ? { id: items[0].id } : {}) })}
            />

            <div className="mt-3">
              {items.length === 0 ? (
                <div className="flex items-start gap-2 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5">
                  <Alert size={13} className="mt-[2px] shrink-0 text-ink-3" />
                  <p className="text-[11.5px] leading-relaxed text-ink-2">
                    {failed ? '这份包里还没有壁纸。' : '正在读壁纸清单…'}
                    <br />
                    在项目根目录跑一次
                    <code className="mx-1 font-mono text-[11px] text-ink">
                      node scripts/fetch-wallpapers.mjs
                    </code>
                    就能抓一批进来。
                  </p>
                </div>
              ) : (
                <div
                  data-wall-grid
                  className="grid grid-cols-3 gap-2 max-md:grid-cols-2"
                >
                  {items.map((it) => {
                    const sel = wall.id === it.id;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        data-wall-item={it.id}
                        data-selected={sel ? '1' : '0'}
                        title={it.copyright}
                        // 直接点图 = 「就这张，并且打开」，不让人先开开关再选图
                        onClick={() => setWall({ enabled: true, id: it.id })}
                        className={`relative overflow-hidden rounded-[9px] border transition-[border-color,box-shadow] duration-150 ${
                          sel
                            ? 'border-accent shadow-sm'
                            : 'border-line hover:border-line-2 hover:shadow-xs'
                        }`}
                      >
                        <img
                          src={assetUrl(it.thumb, BASE)}
                          alt={it.title}
                          loading="lazy"
                          className="aspect-[16/10] w-full object-cover"
                        />
                        <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-ink/75 to-transparent px-1.5 pb-1 pt-2.5 text-[10px] text-white/95">
                          {it.title}
                        </span>
                        {sel && (
                          <span className="absolute right-1 top-1 grid h-[15px] w-[15px] place-items-center rounded-full bg-accent text-white shadow-xs">
                            <Check size={9} strokeWidth={2.8} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {items.length > 0 && (
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="truncate text-[11px] text-ink-3">
                    {on && cur ? `当前：${cur.title}` : '当前：台面本来的纸纹'}
                  </span>
                  <button
                    data-wall-clear
                    onClick={() => setWall({ enabled: false, id: null })}
                    className="shrink-0 rounded-[7px] border border-line px-2 py-[3px] text-[11.5px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    不用壁纸
                  </button>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3">
              <Slider
                id="dim"
                label="压暗"
                value={wall.dim}
                min={WALLPAPER_DIM.min}
                max={WALLPAPER_DIM.max}
                step={WALLPAPER_DIM.step}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => setWall({ dim: v })}
              />
              <Slider
                id="blur"
                label="模糊"
                value={wall.blur}
                min={WALLPAPER_BLUR.min}
                max={WALLPAPER_BLUR.max}
                step={WALLPAPER_BLUR.step}
                format={(v) => `${v}px`}
                onChange={(v) => setWall({ blur: v })}
              />
            </div>
          </Section>

          <Section title="文件列表">
            <Toggle
              id="showall"
              label="显示全部文件"
              hint="连脚本、配置这些程序文件一起列出来（只是显示，同步照旧）"
              on={showAll}
              onChange={setShowAll}
            />
          </Section>

          <Section title="关于">
            <div className="space-y-1.5 text-[11.5px] leading-relaxed text-ink-3">
              <p className="flex items-center gap-1.5">
                <Image size={12} className="shrink-0 text-ink-3" />
                壁纸来自 Bing 每日一图，共 {items.length || 0} 张，抓于 <span className="font-mono">{day}</span>
              </p>
              <p>
                壁纸是<b className="font-medium text-ink-2">随包</b>的，运行时不联网 ——
                Bing 的图不带 CORS 头，为它开一条代理通道不值得。
              </p>
              <p>
                想换一批：
                <code className="mx-1 font-mono text-[11px] text-ink-2">
                  node scripts/fetch-wallpapers.mjs --days=12
                </code>
              </p>
            </div>
          </Section>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="eyebrow mb-2.5 flex items-center gap-2">
        <span className="shrink-0">{title}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      {children}
    </section>
  );
}

function Toggle({
  id,
  label,
  hint,
  on,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-toggle={id}
      onClick={() => onChange(!on)}
      className="flex w-full items-start gap-3 rounded-[9px] text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-ink">{label}</span>
        {hint && <span className="mt-[1px] block text-[11px] leading-snug text-ink-3">{hint}</span>}
      </span>
      <span
        className={`relative mt-[2px] h-[18px] w-[32px] shrink-0 rounded-full transition-colors duration-150 ${
          on ? 'bg-accent' : 'bg-line-2'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-surface shadow-xs transition-[left] duration-150 ${
            on ? 'left-[16px]' : 'left-[2px]'
          }`}
        />
      </span>
    </button>
  );
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[12px] text-ink-2">{label}</span>
        <span data-wall-value={id} className="font-mono text-[11px] text-ink-3">
          {format(value)}
        </span>
      </span>
      <input
        type="range"
        data-wall-range={id}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider mt-1.5 w-full"
      />
    </label>
  );
}
