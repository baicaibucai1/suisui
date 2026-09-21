// 设置面板 + 台面壁纸的端到端。
//
//   node tests/settings-e2e.mjs                            # 默认打开发服务器 5183
//   DEMO_URL=http://localhost:5184 node tests/settings-e2e.mjs
//
// 验的是几件「改回去功能也全对」的事：
//   ① 默认是关的 —— 一进来就铺一张 1920 的风景照，只会让人读不清文件名
//   ② 选了之后图真的下下来了（不是只写了个 CSS 变量，图 404 台面会全白）
//   ③ 刷新之后还是那张（持久化），且压暗/模糊也跟着回来
//   ④ 「不用壁纸」能干净地退回纸纹
//   ⑤ 浮层能被 Esc 收掉（跟抽屉那条一致）
//
// ⚠️ 壁纸是随包的静态资源，dev 和 preview 都能直出，所以两边都能跑。
import { createRequire } from 'node:module';
import fs from 'node:fs';

for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
  delete process.env[k];
}

const { chromium } = createRequire('C:/AI_Production/QQbot/')('playwright');

const URL = process.env.DEMO_URL ?? 'http://localhost:5183';
const OUT = 'C:/AI_Production/suisui-app/shots/ui';
fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
const bad = [];
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    bad.push(name);
    console.log('  ✗ ' + name + (extra ? '   → ' + extra : ''));
  }
};
const step = (s) => console.log('\n== ' + s);

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));

// 壁纸图到底有没有真下下来：CSS 变量写对了但图 404，台面会是一片空白
const wallHits = [];
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/wallpapers/') && u.endsWith('.jpg')) wallHits.push({ url: u, status: r.status() });
});

const DESK = '.desk';
const wallAttr = () => page.getAttribute(DESK, 'data-wall');
const cssVar = (name) =>
  page.evaluate(
    ([sel, v]) => getComputedStyle(document.querySelector(sel)).getPropertyValue(v).trim(),
    [DESK, name],
  );
const persisted = () =>
  page.evaluate(() => {
    const raw = localStorage.getItem('suisui.demo.v1');
    if (!raw) return null;
    try {
      return JSON.parse(raw).state?.wallpaper ?? null;
    } catch {
      return null;
    }
  });

step('打开页面：默认不该有壁纸');
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(DESK);
await page.waitForTimeout(1200);
ok('台面 data-wall=0', (await wallAttr()) === '0', String(await wallAttr()));
ok('--wall-url 是空的', (await cssVar('--wall-url')) === '');
ok('没有壁纸层节点', (await page.locator('.desk-wall').count()) === 0);

step('打开设置面板');
await page.click('[data-settings]');
await page.waitForSelector('[data-settings-panel]', { timeout: 5000 });
ok('面板出来了', await page.isVisible('[data-settings-panel]'));
ok('面板里有「台面」分区', (await page.textContent('[data-settings-panel]')).includes('台面壁纸'));

step('同步：后端不放假按钮');
ok('三个后端都列出来了', (await page.locator('[data-provider]').count()) === 3);
ok('GitHub 默认选中', (await page.getAttribute('[data-provider="github"]', 'class'))?.includes('bg-accent-soft') === true);
// 没做完的后端必须是 disabled + 标「待接入」：给一个按了没反应的按钮比不给更糟
ok('OneDrive 点不动（授权还没接）', await page.locator('[data-provider="onedrive"]').isDisabled());
ok('OneDrive 标了待接入', (await page.textContent('[data-provider="onedrive"]')).includes('待接入'));
await page.click('[data-provider="nutstore"]');
await page.waitForSelector('[data-dav-warn]');
ok('网页版把坚果云的限制说清楚了', (await page.textContent('[data-dav-warn]')).includes('CORS'));
ok('坚果云的凭据框在（先填着，桌面端能用）', await page.isVisible('[data-dav-user]'));
// 切回去：provider 是持久化的，留在坚果云上会让后面的用例连错地方
await page.click('[data-provider="github"]');

const tiles = page.locator('[data-wall-item]');
const n = await tiles.count();
ok(`壁纸列表非空（${n} 张）`, n > 0);
const firstId = n ? await tiles.first().getAttribute('data-wall-item') : null;
ok('缩略图都带 id', !!firstId && /^wp-\d{8}$/.test(firstId), String(firstId));

step('选一张壁纸');
await tiles.first().click();
await page.waitForFunction(() => document.querySelector('.desk')?.getAttribute('data-wall') === '1', null, {
  timeout: 6000,
});
ok('台面 data-wall=1', (await wallAttr()) === '1');
const urlVar = await cssVar('--wall-url');
ok('--wall-url 指向这张图', urlVar.includes(firstId), urlVar);
ok('壁纸层节点出现了', (await page.locator('.desk-wall-img').count()) === 1);
const hit = wallHits.find((h) => h.url.includes(firstId));
ok('图真的下下来了（200）', !!hit && hit.status === 200, hit ? String(hit.status) : '没抓到请求');
ok('选中项打了标记', (await tiles.first().getAttribute('data-selected')) === '1');

step('压暗与模糊');
await page.locator('[data-wall-range="dim"]').fill('0.2');
await page.waitForTimeout(150);
ok('压暗跟着动', (await cssVar('--wall-dim')) === '0.2', await cssVar('--wall-dim'));
await page.locator('[data-wall-range="blur"]').fill('12');
await page.waitForTimeout(150);
ok('模糊跟着动', (await cssVar('--wall-blur')) === '12px', await cssVar('--wall-blur'));
ok('面板上显示的是同一个数', (await page.textContent('[data-wall-value="blur"]')).includes('12'));
await page.screenshot({ path: `${OUT}/06-设置-壁纸.png` });

step('刷新之后还在（持久化）');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector(DESK);
await page.waitForFunction(() => document.querySelector('.desk')?.getAttribute('data-wall') === '1', null, {
  timeout: 6000,
});
ok('刷新后还是那张', (await cssVar('--wall-url')).includes(firstId));
const saved = await persisted();
ok('localStorage 里存着 id', saved?.id === firstId, JSON.stringify(saved));
ok('压暗也存下来了', Math.abs(Number(saved?.dim) - 0.2) < 1e-6, String(saved?.dim));
ok('模糊也存下来了', Number(saved?.blur) === 12, String(saved?.blur));
ok('模糊值回到界面上', (await cssVar('--wall-blur')) === '12px');

step('不用壁纸');
await page.click('[data-settings]');
await page.waitForSelector('[data-settings-panel]');
await page.click('[data-wall-clear]');
await page.waitForFunction(() => document.querySelector('.desk')?.getAttribute('data-wall') === '0', null, {
  timeout: 4000,
});
ok('退回纸纹', (await wallAttr()) === '0');
ok('--wall-url 清掉了', (await cssVar('--wall-url')) === '');
ok('壁纸层节点撤了', (await page.locator('.desk-wall').count()) === 0);

step('Esc 收面板');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
ok('面板关了', (await page.locator('[data-settings-panel]').count()) === 0);

step('手机上：面板铺满宽度');
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-settings]');
await page.click('[data-settings]');
await page.waitForSelector('[data-settings-panel]');
const box = await page.locator('[data-settings-panel]').boundingBox();
ok('面板占满窄屏', !!box && box.width >= 380, box ? String(box.width) : 'no box');
await page.screenshot({ path: `${OUT}/07-设置-手机.png` });

step('控制台');
ok('零报错', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${bad.length} 失败`);
if (bad.length) console.log('失败：\n' + bad.map((b) => '  - ' + b).join('\n'));
process.exit(bad.length ? 1 : 0);
