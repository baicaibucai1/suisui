// 壁纸「配置清洗 + 取址」的覆盖。wallpaper.ts 是零依赖纯函数，Node 可直接 import：
//   node tests/wallpaper.test.mjs
//
// 重点在 normalizeWallpaper：那份配置是从 localStorage 回来的，
// 可能是旧版本写的、也可能被人手改过 —— 脏值最多让壁纸不显示，不能让应用打不开。
// 另一头是 id 直接进 URL，所以形状必须卡死（'../..' 这种不能活下来）。
import {
  DEFAULT_WALLPAPER,
  WALLPAPER_BLUR,
  WALLPAPER_DIM,
  assetUrl,
  clamp,
  findWallpaper,
  isWallpaperOn,
  manifestUrl,
  normalizeWallpaper,
  wallpaperFileUrl,
  wallpaperVars,
} from '../src/lib/wallpaper.ts';

let pass = 0;
let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}\n      得到 ${g}\n      期望 ${w}`);
  }
};
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra ? '   → ' + extra : ''}`);
  }
};

console.log('\n— 默认 —');
eq('默认关着', DEFAULT_WALLPAPER.enabled, false);
eq('默认没选图', DEFAULT_WALLPAPER.id, null);
ok('默认压暗在合法区间', DEFAULT_WALLPAPER.dim >= WALLPAPER_DIM.min && DEFAULT_WALLPAPER.dim <= WALLPAPER_DIM.max);
ok('默认模糊在合法区间', DEFAULT_WALLPAPER.blur >= WALLPAPER_BLUR.min && DEFAULT_WALLPAPER.blur <= WALLPAPER_BLUR.max);
eq('关着时台面不铺图', isWallpaperOn(DEFAULT_WALLPAPER), false);

console.log('\n— clamp —');
eq('区间内不动', clamp(0.5, 0, 1), 0.5);
eq('超上限取上限', clamp(9, 0, 1), 1);
eq('低于下限取下限', clamp(-3, 0, 1), 0);
eq('NaN 退到下限', clamp(NaN, 0.2, 0.9), 0.2);
eq('Infinity 也退到上限', clamp(Infinity, 0.2, 0.9), 0.9);

console.log('\n— normalize：脏数据一律洗成合法值，不抛 —');
eq('undefined → 默认', normalizeWallpaper(undefined), DEFAULT_WALLPAPER);
eq('null → 默认', normalizeWallpaper(null), DEFAULT_WALLPAPER);
eq('空对象 → 默认', normalizeWallpaper({}), DEFAULT_WALLPAPER);
eq(
  '越界的 dim/blur 被夹住',
  [normalizeWallpaper({ enabled: true, id: 'wp-20260920', dim: 5, blur: 999 }).dim, normalizeWallpaper({ dim: 5, blur: 999 }).blur],
  [WALLPAPER_DIM.max, WALLPAPER_BLUR.max],
);
eq('负的也夹住', normalizeWallpaper({ dim: -1, blur: -8 }).dim, WALLPAPER_DIM.min);
eq('字符串 dim 不当数', normalizeWallpaper({ dim: '0.5' }).dim, DEFAULT_WALLPAPER.dim);
eq('enabled 只认真 true', normalizeWallpaper({ enabled: 'yes' }).enabled, false);

console.log('\n— id 形状：直接进 URL，必须卡死 —');
eq('合法 id 保留', normalizeWallpaper({ id: 'wp-20260920' }).id, 'wp-20260920');
eq('目录穿越丢掉', normalizeWallpaper({ id: '../../etc/passwd' }).id, null);
eq('带引号丢掉', normalizeWallpaper({ id: 'wp-20260920".jpg' }).id, null);
eq('空串丢掉', normalizeWallpaper({ id: '   ' }).id, null);
eq('数字 id 丢掉', normalizeWallpaper({ id: 20260920 }).id, null);
eq(
  '只开开关但 id 非法 → 实际上不铺图',
  isWallpaperOn(normalizeWallpaper({ enabled: true, id: 'x' })),
  false,
);

console.log('\n— 取址 —');
eq('根目录', wallpaperFileUrl('wp-20260920', '/'), '/wallpapers/wp-20260920.jpg');
eq('base 缺尾斜杠也补上', wallpaperFileUrl('wp-20260920', '/app'), '/app/wallpapers/wp-20260920.jpg');
eq('子路径部署', wallpaperFileUrl('wp-20260920', '/suisui/'), '/suisui/wallpapers/wp-20260920.jpg');
eq('manifest 地址', manifestUrl('/'), '/wallpapers/manifest.json');
eq('相对资源补 base', assetUrl('wallpapers/wp-1-thumb.jpg', '/suisui/'), '/suisui/wallpapers/wp-1-thumb.jpg');
eq('相对资源自带的斜杠不重复', assetUrl('/wallpapers/a.jpg', '/'), '/wallpapers/a.jpg');

console.log('\n— 列表里找图 —');
const items = [
  { id: 'wp-20260920', date: '20260920', title: '海獭' },
  { id: 'wp-20260919', date: '20260919', title: '铁塔' },
];
eq('找得到', findWallpaper(items, 'wp-20260919')?.title, '铁塔');
eq('找不到返回 null（不是 undefined）', findWallpaper(items, 'wp-20000101'), null);
eq('id 为空返回 null', findWallpaper(items, null), null);
eq('列表为空也返回 null', findWallpaper([], 'wp-20260920'), null);

console.log('\n— CSS 变量 —');
eq('关着时一个变量都不给', wallpaperVars({ ...DEFAULT_WALLPAPER }, '/wallpapers/a.jpg'), {});
eq('没选图也不给', wallpaperVars({ enabled: true, id: null, dim: 0.5, blur: 2 }, '/a.jpg'), {});
eq(
  '开着时给全三个',
  wallpaperVars({ enabled: true, id: 'wp-1', dim: 0.5, blur: 2 }, '/a.jpg'),
  { '--wall-url': 'url("/a.jpg")', '--wall-dim': '0.5', '--wall-blur': '2px' },
);
// 图还没下完（url=null）不能先把变量铺上：那会让台面闪一下空白
eq('图没下完就不铺', wallpaperVars({ enabled: true, id: 'wp-1', dim: 0.5, blur: 2 }, null), {});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
