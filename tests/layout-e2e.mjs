// 三栏布局（参考 Obsidian）：右栏（大纲 + 关系）与左栏搜索框的端到端。
//
//   node tests/layout-e2e.mjs                      # 默认打开发服务器 5183
//   DEMO_URL=http://localhost:5184 node tests/layout-e2e.mjs
//
// 单测（tests/links.test.mjs 的大纲一节）验的是「解析得对不对」，
// 这里验的是「在页面上真的长出来、点得动、收得起」：
//   ① 右栏常驻（桌面 ≥768px），没开笔记时给说明，不白板
//   ② 大纲列出正文标题，点一下正文滚过去（所见即所得走 su-flash 高亮）
//   ③ 关系面板搬进右栏（同一份 data-backlinks，e2e 抓手不换）
//   ④ 顶栏按钮能把右栏收起 / 展开
//   ⑤ 左栏搜索框按文件名 / 标题过滤，Esc 和 × 都能清
//   ⑥ 手机（≤768px）右栏不渲染，关系面板回正文底部
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

const FILES = {
  'thoughts/2026-09-21-开张.md':
    '# 开张\n\n这是第一篇。\n\n## 第二段\n\n第二段的内容。\n\n## 第三段\n\n尾部内容。\n',
  'notes/2026-09-21-随手.md': '# 随手\n\n想起 [[开张]]，这条是 #灵感。\n',
  'drafts/2026-09-20-购物清单.md': '# 购物清单\n\n牛奶、鸡蛋。\n',
};

const openApp = async () => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.desk');
  await page.waitForTimeout(600);
  await page.evaluate((files) => {
    window.__suisui.setState({ files, current: null, token: '', tagFilter: null, drawer: false });
  }, FILES);
  await page.waitForTimeout(600);
};

/** 打开一篇并等编辑器就绪 */
const openNote = async (cur) => {
  await page.evaluate(() => window.__suisui.setState({ current: null }));
  await page.waitForTimeout(300);
  await page.evaluate((c) => window.__suisui.setState({ current: c }), cur);
  await page.waitForSelector('.ProseMirror', { timeout: 15000 });
  await page.waitForTimeout(900);
};

step('桌面：右栏常驻，没开笔记时有说明');
await openApp();
{
  const pane = page.locator('[data-rightpane]');
  ok('右栏在页面上', (await pane.count()) === 1);
  ok('右栏可见', await pane.isVisible());
  const txt = await pane.textContent();
  ok('空态有说明文字', txt.includes('打开一篇笔记'), txt.slice(0, 60));
}

step('大纲：列出标题，点一下正文滚过去');
await openNote('thoughts/2026-09-21-开张.md');
{
  const items = page.locator('[data-outline-item]');
  ok('三个标题都列出来', (await items.count()) === 3, String(await items.count()));
  const texts = await items.evaluateAll((els) => els.map((e) => e.textContent));
  ok('顺序对', texts.join('|') === '开张|第二段|第三段', texts.join('|'));

  // 点「第三段」：正文里那个 heading 会拿到 su-flash 高亮（跳转成功的记号）
  await items.nth(2).click();
  await page.waitForTimeout(700);
  const flashed = await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror .su-flash');
    return el ? el.textContent : null;
  });
  ok('跳转后目标小节闪了一下', flashed !== null && flashed.includes('第三段'), String(flashed));
}
await page.screenshot({ path: `${OUT}/22-右栏大纲.png` });

step('关系面板搬进了右栏');
{
  const pane = page.locator('[data-rightpane] [data-backlinks]');
  ok('关系面板在右栏里', (await pane.count()) === 1);
  const txt = await pane.textContent();
  ok('写着被引用', txt.includes('被引用'), txt.slice(0, 80));

  // 打开一篇只有一级标题、没有关系的：右栏给轻提示，而不是整节消失
  await openNote('thoughts/2026-09-21-开张.md');
  await openNote('drafts/2026-09-20-购物清单.md');
  ok('没关系的篇给轻提示', (await page.locator('[data-rel-empty]').count()) === 1);
  const ol = await page.locator('[data-outline-item]').allTextContents();
  ok('只有文档标题自己', ol.join('|') === '购物清单', ol.join('|'));
}
await page.screenshot({ path: `${OUT}/23-右栏关系.png` });

step('右栏自己收起 / 展开（开关在右栏头上，收起后留一条窄轨）');
{
  await page.locator('[data-right-toggle]').click();
  await page.waitForTimeout(300);
  ok('点一下收起', (await page.locator('[data-rightpane]').count()) === 0);
  await page.locator('[data-right-toggle]').click();
  await page.waitForTimeout(300);
  ok('再点一下回来', (await page.locator('[data-rightpane]').count()) === 1);
}

step('左栏搜索框：文件名 / 标题过滤');
{
  const box = page.locator('[data-note-search]');
  ok('搜索框在', (await box.count()) === 1);
  await box.fill('随手');
  await page.waitForTimeout(300);
  const hits = page.locator('[data-file]');
  ok('按名字命中一篇', (await hits.count()) === 1, String(await hits.count()));
  ok('命中是「随手」', (await hits.first().getAttribute('data-file')) === 'notes/2026-09-21-随手.md');
  ok('横幅写了命中数', (await page.locator('[data-search-banner]').textContent()).includes('1 篇'));

  // 标题也能搜：文件名是 2026-09-20-购物清单.md，搜「购物」靠标题命中
  await box.fill('购物');
  await page.waitForTimeout(300);
  ok('按标题命中', (await page.locator('[data-file]').count()) === 1);

  await box.fill('查无此篇');
  await page.waitForTimeout(300);
  ok('没命中给空态', (await page.locator('[data-search-empty]').count()) === 1);

  await page.locator('[data-note-search-clear]').click();
  await page.waitForTimeout(300);
  ok('× 清空后整棵树回来', (await page.locator('[data-file]').count()) === 3);

  await box.fill('随手');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('Esc 也能清', (await page.locator('[data-file]').count()) === 3);
}
await page.screenshot({ path: `${OUT}/24-搜索过滤.png` });

step('手机（≤768px）：右栏不渲染，关系面板回正文底部');
{
  const d = await browser.newPage({ viewport: { width: 412, height: 915 } });
  d.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message.slice(0, 200)));
  await d.goto(URL, { waitUntil: 'domcontentloaded' });
  await d.waitForSelector('.desk');
  await d.waitForTimeout(600);
  await d.evaluate((files) => {
    window.__suisui.setState({ files, current: null, token: '', tagFilter: null, drawer: false });
  }, FILES);
  await d.evaluate(() => window.__suisui.setState({ current: 'notes/2026-09-21-随手.md' }));
  await d.waitForSelector('.ProseMirror', { timeout: 15000 });
  await d.waitForTimeout(900);
  ok('右栏不在 DOM 里', !(await d.locator('[data-rightpane]').isVisible()));
  ok('关系面板在正文底部', (await d.locator('.sheet [data-backlinks]').count()) === 1);
  ok('搜索框还在抽屉里', (await d.locator('[data-note-search]').count()) === 1);
  await d.screenshot({ path: `${OUT}/25-手机底部关系.png` });
  await d.close();
}

await browser.close();

console.log(`\n结果：${pass} 通过 / ${bad.length} 失败`);
if (errors.length) {
  console.log('\n页面报错（前几条）：');
  for (const e of errors.slice(0, 6)) console.log('  ' + e);
}
process.exit(bad.length || errors.length ? 1 : 0);
