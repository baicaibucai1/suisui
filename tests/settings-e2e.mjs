// 设置面板的端到端。
//
//   node tests/settings-e2e.mjs                            # 默认打开发服务器 5183
//   DEMO_URL=http://localhost:5184 node tests/settings-e2e.mjs
//
// 验的是几件「改回去功能也全对」的事：
//   ① 入口在左下角 —— 顶栏只说状况，动手的按钮沉在 dock 上
//   ② 没做完的后端是 disabled + 标「待接入」，不是假按钮
//   ③ 凭据跟着后端走（选谁配谁），且没配时齿轮上顶红点
//   ④ 浮层能被 Esc 收掉（跟抽屉那条一致）
//
// ⚠️ 壁纸功能已经整块拿掉了（2026-09-21）。这里留一条负向断言：
// 台面上不许再出现壁纸层，面板里也不许再有壁纸字样 —— 防止哪天又被塞回来。
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

const DESK = '.desk';

step('打开页面');
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(DESK);
await page.waitForTimeout(1200);
// 负向断言：壁纸整块拿掉了，台面不该再有任何壁纸的痕迹
ok('没有壁纸层节点', (await page.locator('.desk-wall, .desk-wall-img, .desk-wall-veil').count()) === 0);
ok('台面不再打 data-wall', (await page.getAttribute(DESK, 'data-wall')) === null);
ok(
  '没有 --wall-* 变量',
  await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.desk'));
    return !s.getPropertyValue('--wall-url').trim() && !s.getPropertyValue('--wall-dim').trim();
  }),
);

/*
 * 入口位置：设置和同步都在**左下角那条 dock** 里，不在顶栏。
 * 顶栏只说状况（仓库、差异胶囊），动手的按钮沉到左下角 ——
 * 这边守着，免得哪天有人图省事又把齿轮塞回顶栏去。
 */
step('入口在左下角');
{
  ok('顶栏里没有齿轮了', (await page.locator('header [data-settings]').count()) === 0);
  ok('顶栏里也没有同步按钮了', (await page.locator('header [data-sync]').count()) === 0);

  const aside = await page.locator('[data-drawer]').boundingBox();
  const dock = await page.locator('[data-dock]').boundingBox();
  ok('dock 贴着左边缘', !!dock && Math.abs(dock.x - aside.x) < 1, JSON.stringify(dock));
  ok(
    'dock 在这一列的最底部',
    !!dock && Math.abs(dock.y + dock.height - (aside.y + aside.height)) < 1.5,
    `dock底=${dock ? dock.y + dock.height : '?'} aside底=${aside.y + aside.height}`,
  );

  const sync = await page.locator('[data-sync]').boundingBox();
  const gear = await page.locator('[data-settings]').boundingBox();
  ok('同步和齿轮同一行', Math.abs(sync.y - gear.y) < 2, `${sync.y} / ${gear.y}`);
  ok('齿轮在最右、同步占剩下的宽度', gear.x > sync.x && sync.x + sync.width > 200, JSON.stringify({ sync, gear }));
  await page.screenshot({ path: `${OUT}/08-左下角-dock.png` });
}

step('打开设置面板');
await page.click('[data-settings]');
await page.waitForSelector('[data-settings-panel]', { timeout: 5000 });
ok('面板出来了', await page.isVisible('[data-settings-panel]'));
{
  const text = await page.textContent('[data-settings-panel]');
  ok('分区是 同步 / 文件列表 / 关于', ['同步', '文件列表', '关于'].every((t) => text.includes(t)));
  ok('面板里没有壁纸字样了', !text.includes('壁纸') && !text.includes('台面'));
}
const panelX = await page.locator('[data-settings-panel]').boundingBox();
ok('面板从左边出来（跟左下角的入口同一侧）', !!panelX && panelX.x < 2, JSON.stringify(panelX));

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

step('凭据：跟着后端走，搬出顶栏');
{
  ok(
    '凭据框在面板里（不再挂在顶栏那颗钥匙上）',
    await page.isVisible('[data-settings-panel] [data-token]'),
  );
  ok('凭据框是密码框', (await page.getAttribute('[data-token]', 'type')) === 'password');
  /*
   * 红点从顶栏那颗钥匙挪到了齿轮上：没配凭据就一直在。
   * ⚠️ dev 环境常常由 .env.local 自带 VITE_GH_TOKEN，所以"初始有红点"不成立 ——
   * 判据只能是"清掉 token 就出现、填上就消失"这个方向上的关系。
   */
  const realToken = await page.inputValue('[data-token]');
  await page.locator('[data-token]').fill('');
  await page.waitForTimeout(200);
  ok('没配凭据时齿轮上顶着红点', (await page.locator('[data-cred-dot]').count()) === 1);
  await page.locator('[data-token]').fill('ghp_d_e2e_only');
  await page.waitForTimeout(200);
  ok('配上之后红点消失', (await page.locator('[data-cred-dot]').count()) === 0);
  ok('面板里还有一颗「立即同步」', await page.isVisible('[data-sync-now]'));
  // 还原，而且必须还原到原来那个：后面还有 reload 的用例，留一个假 token
  // 会让页面一进来就自动比对，蹭蹭吃三个 401（控制台零报错那条就要红了）
  await page.locator('[data-token]').fill(realToken);
  await page.waitForTimeout(200);
}

step('Esc 收面板');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
ok('面板关了', (await page.locator('[data-settings-panel]').count()) === 0);

step('手机上：面板铺满宽度');
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-settings]');
// 手机上入口在**抽屉**里（这一列整体变成了从左侧推入的浮层）：
// 得先把抽屉拉出来，够得着左下角那个齿轮。
await page.click('[data-drawer-toggle]');
await page.waitForTimeout(400);
ok('齿轮也跟着抽屉进来了', await page.isVisible('[data-settings]'));
await page.click('[data-settings]');
await page.waitForSelector('[data-settings-panel]');
const box = await page.locator('[data-settings-panel]').boundingBox();
ok('面板占满窄屏', !!box && box.width >= 380, box ? String(box.width) : 'no box');
ok('面板从左边出来（跟入口同一侧）', !!box && box.x < 2, box ? String(box.x) : 'no box');
await page.screenshot({ path: `${OUT}/07-设置-手机.png` });

step('控制台');
ok('零报错', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${bad.length} 失败`);
if (bad.length) console.log('失败：\n' + bad.map((b) => '  - ' + b).join('\n'));
process.exit(bad.length ? 1 : 0);
