// 生成主屏 / PWA 图标。
//
// 不引入 sharp / canvas 这类原生依赖 —— 用本机 Edge 渲染一遍再截图就够了，
// 好处是字体（微软雅黑）和界面同一套，图标上的「碎」和顶栏那个方块长得一模一样。
//
//   node scripts/gen-icons.mjs
//
// 产物进 public/icons/，跟着构建一起进 dist。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'public/icons');

const PAPER = '#f5f3ef';
const INK = '#221f1c';
const ON_INK = '#fffefd';

/** 图标就是顶栏 logo 放大：墨色圆角方块 + 白色「碎」 */
function html({ size, radius, mark }) {
  const box = Math.round(size * mark);
  const font = Math.round(box * 0.66);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}
    .bg{width:100%;height:100%;background:${PAPER};border-radius:${radius}px;display:grid;place-items:center}
    .mark{width:${box}px;height:${box}px;background:${INK};border-radius:${Math.round(box * 0.24)}px;
          display:grid;place-items:center}
    .t{font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif;font-weight:600;
       font-size:${font}px;line-height:1;color:${ON_INK};transform:translateY(-1.5%)}
  </style></head><body><div class="bg"><div class="mark"><span class="t">碎</span></div></div></body></html>`;
}

const TARGETS = [
  // 常规用途：带圆角
  { file: 'icon-192.png', size: 192, radius: 44, mark: 0.62 },
  { file: 'icon-512.png', size: 512, radius: 116, mark: 0.62 },
  // maskable：安卓会自己裁成圆/水滴，底色必须铺满，内容缩进中间安全区
  { file: 'icon-maskable-512.png', size: 512, radius: 0, mark: 0.52 },
  // iOS 主屏：系统自己加圆角，所以给方图，且不能有透明边
  { file: 'apple-touch-icon.png', size: 180, radius: 0, mark: 0.62 },
];

// Playwright 会把本机的 http_proxy 透传进浏览器，端口还每次都不一样 —— 截图不需要网络，清掉最省事
for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
  delete process.env[k];
}

const { chromium } = createRequire('C:/AI_Production/QQbot/')('playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
fs.mkdirSync(OUT, { recursive: true });

for (const t of TARGETS) {
  const page = await browser.newPage({
    viewport: { width: t.size, height: t.size },
    deviceScaleFactor: 1,
  });
  await page.setContent(html(t), { waitUntil: 'load' });
  // 等字体真正排好再截，否则「碎」可能落成方框
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(OUT, t.file), buf);
  console.log(`${t.file.padEnd(24)} ${t.size}×${t.size}  ${(buf.length / 1024).toFixed(1)}KB`);
  await page.close();
}

await browser.close();
