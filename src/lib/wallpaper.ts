/*
 * 壁纸的「配置」与「取址」。
 *
 * 两条刻意的取舍：
 *
 * 1. **运行时不联网。** Bing 的图片接口不带 CORS 头，浏览器里 fetch 会被拦；
 *    为它搭一个转发代理，等于给整个应用开一条常驻外网通道 —— 装饰性的东西不值这个价。
 *    所以壁纸是**随包**的：`scripts/fetch-wallpapers.mjs` 抓一次落到 public/wallpapers/，
 *    之后离线可用、也不受 Bing 改版影响。
 *
 * 2. **取址不依赖 manifest。** 文件名的规则是 `wallpapers/<id>.jpg`（id = wp-20260920），
 *    选中之后就算 manifest 读不到（比如用户自己清了缓存、包里没带），壁纸照样能铺上。
 *    manifest 只负责「列表里显示什么」（缩略图、图注、日期）。
 *
 * 这个模块**零依赖、不碰 import.meta.env**：base 由调用方传进来，
 * 这样 Node 里可以直接 import 做单测（`node tests/wallpaper.test.mjs`）。
 */

export type WallpaperItem = {
  /** 形如 wp-20260920，同时是文件名的一部分 */
  id: string;
  /** 20260920 */
  date: string;
  title: string;
  credit: string;
  copyright: string;
  url: string;
  thumb: string;
};

export type WallpaperManifest = {
  source: string;
  market: string;
  fetchedAt: string;
  count: number;
  items: WallpaperItem[];
};

export type WallpaperConfig = {
  enabled: boolean;
  /** null = 「用台面本来的纸纹」，不铺图 */
  id: string | null;
  /** 台面色盖在图上的不透明度：0 = 原图，1 = 回到纯纸底 */
  dim: number;
  /** 高斯模糊半径（px）。台面上的图不该跟正文抢细节 */
  blur: number;
};

export const WALLPAPER_DIM = { min: 0, max: 0.92, step: 0.02 } as const;
export const WALLPAPER_BLUR = { min: 0, max: 24, step: 1 } as const;

/*
 * 默认**关着**，且开着时也是「压得很淡 + 轻微模糊」。
 * 壁纸是在文字后面干活的背景：第一次打开就铺一张 1920 的风景照，
 * 唯一的效果是让人读不清文件名 —— 想要的人会自己去开。
 */
export const DEFAULT_WALLPAPER: WallpaperConfig = {
  enabled: false,
  id: null,
  dim: 0.62,
  blur: 4,
};

export const WALLPAPER_MANIFEST = 'wallpapers/manifest.json';

export function clamp(n: number, min: number, max: number): number {
  // NaN 是没有意义的输入，退到下限；±Infinity 是有方向的，各自贴到该去的那一端
  if (Number.isNaN(n)) return min;
  if (n === Infinity) return max;
  if (n === -Infinity) return min;
  return Math.min(max, Math.max(min, n));
}

const cleanId = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  // id 直接进 URL，只放行 wp-日期 这种形状，别的（含 ../）一律丢掉
  return /^wp-\d{8}$/.test(v.trim()) ? v.trim() : null;
};

/**
 * 把任意来路的配置（旧版本的 localStorage、手改的 JSON）洗成合法配置。
 * **永不抛**：设置坏了最多是壁纸不显示，不能连整个应用都打不开。
 */
export function normalizeWallpaper(raw: unknown): WallpaperConfig {
  const r = (raw ?? {}) as Partial<WallpaperConfig> & Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    id: cleanId(r.id),
    dim: clamp(typeof r.dim === 'number' ? r.dim : DEFAULT_WALLPAPER.dim, WALLPAPER_DIM.min, WALLPAPER_DIM.max),
    blur: clamp(
      typeof r.blur === 'number' ? r.blur : DEFAULT_WALLPAPER.blur,
      WALLPAPER_BLUR.min,
      WALLPAPER_BLUR.max,
    ),
  };
}

export const wallpaperFileUrl = (id: string, base = '/'): string =>
  `${base.endsWith('/') ? base : base + '/'}wallpapers/${id}.jpg`;

export const manifestUrl = (base = '/'): string =>
  `${base.endsWith('/') ? base : base + '/'}${WALLPAPER_MANIFEST}`;

/** 相对路径 → 绝对（manifest 里存的是相对包的路径，方便直接塞进 <img src>） */
export const assetUrl = (rel: string, base = '/'): string =>
  `${base.endsWith('/') ? base : base + '/'}${rel.replace(/^\/+/, '')}`;

export function findWallpaper(items: WallpaperItem[], id: string | null): WallpaperItem | null {
  if (!id) return null;
  return items.find((i) => i.id === id) ?? null;
}

/** 给外层容器用的 CSS 变量；没开或没选就返回空（台面回到纸纹） */
export function wallpaperVars(cfg: WallpaperConfig, url: string | null): Record<string, string> {
  if (!cfg.enabled || !cfg.id || !url) return {};
  return {
    '--wall-url': `url("${url}")`,
    '--wall-dim': String(cfg.dim),
    '--wall-blur': `${cfg.blur}px`,
  };
}

/** 台面上到底要不要铺图。给 DOM 打 data-wall='1' 用，e2e 也认这个 */
export const isWallpaperOn = (cfg: WallpaperConfig): boolean => cfg.enabled && !!cfg.id;

/**
 * 读 manifest。**不抛** —— 包里没抓过壁纸是很正常的状态（脚本要手动跑），
 * 那只是「列表为空」，不是错误。
 */
export async function loadWallpaperManifest(
  base = '/',
  signal?: AbortSignal,
): Promise<WallpaperManifest> {
  const res = await fetch(manifestUrl(base), { signal, cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  const j = (await res.json()) as Partial<WallpaperManifest>;
  const items = Array.isArray(j.items)
    ? j.items.filter((i): i is WallpaperItem => typeof i?.id === 'string' && !!i.id)
    : [];
  return {
    source: String(j.source ?? 'bing'),
    market: String(j.market ?? ''),
    fetchedAt: String(j.fetchedAt ?? ''),
    count: items.length,
    items,
  };
}
