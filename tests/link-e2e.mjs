// 双链 [[笔记]] 与 #标签 的端到端。
//
//   node tests/link-e2e.mjs                       # 默认打开发服务器 5183
//   DEMO_URL=http://localhost:5184 node tests/link-e2e.mjs
//
// 单测（tests/links.test.mjs）验的是「读得对不对」，这里验的是**在编辑器里真的点得动**：
//   ① `[[链接]]` / `#标签` 在所见即所得里被认出来、且存进文件的还是那几个字
//   ② 指到的和没指到的长得不一样（一个实线一个虚线）
//   ③ Ctrl + 点击能跳过去；没那篇就当场建出来
//   ④ 点 `#标签` 侧栏只留带它的篇
//   ⑤ 打 `[[` 弹补全，回车就把字补上
//   ⑥ 反向链接面板出现在被引用的那篇下面
//
// ⚠️ 桌面端是 **Ctrl + 点击**（单击是"把光标放进去改字"，不能跳），测试里必须带 modifiers。
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

/** 三篇：一篇被引用（开张）、一篇引用别人（随手）、一篇只有标签（草稿） */
const FILES = {
  'thoughts/2026-09-21-开张.md': '# 开张\n\n这是第一篇。\n\n## 第二段\n\n第二段的内容。\n',
  'notes/2026-09-21-随手.md':
    '# 随手\n\n想起 [[开张]] 里说的，这条是 #灵感。\n\n还没写的 [[没有这篇]] 也提一句。\n',
  'drafts/2026-09-20-草稿.md': '# 草稿\n\n#灵感 这里也有一个。\n',
};

/**
 * 灌数据。`patch` 用来往 FILES 上再盖几篇 —— 比如上一步刚点出来的新笔记，
 * 不然重新灌一遍就把它冲没了，测的就不是「链接变亮」而是「文件不见了」。
 */
const seed = (cur, patch = null) =>
  page.evaluate(
    ([files, current, patch]) => {
      window.__suisui.setState({
        files: patch ? { ...files, ...patch } : files,
        current,
        token: '',
        tagFilter: null,
        drawer: false,
      });
    },
    [FILES, cur, patch],
  );

const state = () =>
  page.evaluate(() => {
    const s = window.__suisui.getState();
    return { current: s.current, tagFilter: s.tagFilter, files: Object.keys(s.files) };
  });

const openNote = async (cur, patch = null) => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.desk');
  await page.waitForTimeout(900);
  /*
   * ⚠️ 先把 current 清空再设目标：编辑器只在「切文件 / 切模式 / 同步完」时重建，
   * 而重载后 localStorage 里那份 current 往往就是这次要打开的那篇 ——
   * current 没变，编辑器会拿着旧正文继续用，灌进去的新内容根本不显示。
   * （真实场景里同步拉完会改 lastSyncAt，那条路是通的，所以这不是产品 bug。）
   */
  await page.evaluate(() => window.__suisui.setState({ current: null }));
  await page.waitForTimeout(350);
  await seed(cur, patch);
  await page.waitForSelector('.ProseMirror', { timeout: 15000 });
  await page.waitForTimeout(1200);
};

step('打开「随手」：链接和标签被认出来了');
await openNote('notes/2026-09-21-随手.md');
{
  const wikis = page.locator('.ProseMirror .su-wiki');
  ok('两条链接都被认出来', (await wikis.count()) === 2, String(await wikis.count()));
  ok('标签被认出来', (await page.locator('.ProseMirror .su-tag').count()) >= 1);
  ok('链接的文字没被改成别的', (await wikis.first().textContent()) === '[[开张]]', String(await wikis.first().textContent()));
  ok('标签的文字是 #灵感', (await page.locator('.ProseMirror .su-tag').first().textContent()) === '#灵感');

  // 指到了的和没指到的必须长得不一样 —— 否则看不出哪个点得开
  const cls = await wikis.evaluateAll((els) => els.map((e) => e.className));
  ok('存在的那篇不带虚线', cls.some((c) => !c.includes('su-wiki-new')), JSON.stringify(cls));
  ok('没有的那篇标成虚线', cls.some((c) => c.includes('su-wiki-new')), JSON.stringify(cls));

  // 关键：装饰只改外观，文件里存的还是纯文本 —— 别的 markdown 软件打开照样是 [[开张]]
  const raw = await page.evaluate(() => window.__suisui.getState().files['notes/2026-09-21-随手.md']);
  ok('存进文件的还是 [[开张]] 原文', raw.includes('[[开张]]'), raw.slice(0, 60));
  ok('文件里没有塞进 span', !raw.includes('<span'), raw.slice(0, 80));
}
await page.screenshot({ path: `${OUT}/13-双链-高亮.png` });

step('Ctrl + 点击链接：跳过去');
await page.locator('.ProseMirror .su-wiki', { hasText: '[[开张]]' }).first().click({ modifiers: ['Control'] });
await page.waitForTimeout(1500);
{
  const s = await state();
  ok('打开的是「开张」', s.current === 'thoughts/2026-09-21-开张.md', String(s.current));
  ok('正文换成了开张的内容', (await page.textContent('.ProseMirror')).includes('这是第一篇'));
}

step('被引用的那篇下面挂着反向链接');
{
  let visible = true;
  await page.locator('[data-backlinks]').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
    visible = false;
  });
  if (!visible) {
    const dump = await page.evaluate(() => ({
      current: window.__suisui.getState().current,
      files: Object.keys(window.__suisui.getState().files),
      sheet: [...(document.querySelector('.sheet')?.children ?? [])].map((c) => c.className.slice(0, 50)),
    }));
    console.log('  [诊断] ' + JSON.stringify(dump));
  }
  const pane = page.locator('[data-backlinks]');
  ok('反向链接面板出来了', visible);
  const txt = await pane.textContent();
  ok('写着「被引用」', txt.includes('被引用'), txt.slice(0, 80));
  ok('来源是「随手」', txt.includes('随手'), txt.slice(0, 120));
  const from = page.locator('[data-backlink-from]');
  ok('有一条可点的来源', (await from.count()) === 1, String(await from.count()));
}
await page.screenshot({ path: `${OUT}/14-反向链接.png` });

step('点反向链接：回到引用它的那篇');
await page.locator('[data-backlink-from]').first().click();
await page.waitForTimeout(1200);
ok('回到了「随手」', (await state()).current === 'notes/2026-09-21-随手.md', String((await state()).current));

step('Ctrl + 点击没建的链接：当场建出来');
await page.locator('.ProseMirror .su-wiki.su-wiki-new').first().click({ modifiers: ['Control'] });
await page.waitForTimeout(1600);
const created = (await state()).current ?? '';
{
  const s = await state();
  ok('新建了一篇', s.files.length === 4, String(s.files.length));
  ok('打开的就是刚建的那篇', !!s.current && s.current.includes('没有这篇'), String(s.current));
  // 建在哪儿 = 引用它的那篇所在目录（notes/），不是随便扔在根上
  ok('落在 notes/ 里', !!s.current && s.current.startsWith('notes/'), String(s.current));
  const cls = await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror');
    return el ? el.textContent : '';
  });
  ok('新笔记的正文有标题', cls.includes('没有这篇'), cls.slice(0, 60));
}

step('回到「随手」：那条链接现在该变亮了');
await openNote('notes/2026-09-21-随手.md', { [created]: `# 没有这篇\n\n` });
{
  const cls = await page.locator('.ProseMirror .su-wiki').evaluateAll((els) => els.map((e) => e.className));
  ok('不再有任何虚线链接', cls.every((c) => !c.includes('su-wiki-new')), JSON.stringify(cls));
}

step('点 #标签：侧栏只留带它的篇');
await page.locator('.ProseMirror .su-tag').first().click({ modifiers: ['Control'] });
await page.waitForTimeout(900);
{
  ok('筛选条出现了', await page.isVisible('[data-tag-filter]'));
  const bar = await page.textContent('[data-tag-filter]');
  ok('横幅上写着标签名', bar.includes('灵感'), bar.trim());
  ok('横幅上写着篇数', /\d+\s*篇/.test(bar), bar.trim());
  const shown = await page.locator('[data-file]').allTextContents();
  // 带 #灵感 的是「随手」和「草稿」两篇，开张没有
  ok('列表只剩两篇', shown.length === 2, JSON.stringify(shown));
  ok('筛掉的那篇不在列表里', !shown.some((t) => t.includes('开张')), JSON.stringify(shown));
}
await page.screenshot({ path: `${OUT}/15-标签筛选.png` });

step('退出筛选');
await page.click('[data-tag-clear]');
await page.waitForTimeout(600);
{
  ok('筛选条没了', (await page.locator('[data-tag-filter]').count()) === 0);
  // 库里就这 3 篇（上面新建那篇在这一轮被重新灌数据冲掉了），退出筛选后该都在
  ok('列表恢复（不再只剩两篇）', (await page.locator('[data-file]').count()) >= 3, String(await page.locator('[data-file]').count()));
}

step('打 [[ 弹补全');
await openNote('notes/2026-09-21-随手.md');
{
  await page.click('.ProseMirror');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('试着链一下 [[');
  await page.waitForTimeout(700);
  ok('浮层出来了', await page.isVisible('[data-wiki-hints]'));
  const all = await page.locator('[data-wiki-hint]').count();
  ok('候选里有笔记', all >= 3, String(all));

  await page.keyboard.type('开张');
  await page.waitForTimeout(600);
  const names = await page.locator('[data-wiki-hint]').allTextContents();
  ok('过滤后候选变少了', names.length <= all, `${all} → ${names.length}`);
  ok('候选里有「开张」', names.some((t) => t.includes('开张')), JSON.stringify(names));

  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  ok('回车之后浮层收起', (await page.locator('[data-wiki-hints]').count()) === 0);
  const text = await page.textContent('.ProseMirror');
  ok('正文里补上了链接', text.includes('[[开张]]'), text.slice(-60));
}
await page.screenshot({ path: `${OUT}/16-双链补全.png` });

step('Esc 收起补全');
{
  await page.keyboard.type(' 再 [[开');
  await page.waitForTimeout(600);
  ok('又弹出来了', await page.isVisible('[data-wiki-hints]'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  ok('Esc 之后收起', (await page.locator('[data-wiki-hints]').count()) === 0);
  // 收起之后 Esc 不能再把字吃掉 —— 只是关浮层，正文照旧
  const text = await page.textContent('.ProseMirror');
  ok('正文没被 Esc 改动', text.includes('再 [[开'), text.slice(-40));
}

step('锚点：[[开张#第二段]]');
// ⚠️ 必须重新灌一遍数据再开：编辑器只在切文件/切模式时重建，
// 中途改 store 里的正文，画面上的编辑器不会跟着变。
await openNote('notes/2026-09-21-随手.md', {
  'notes/2026-09-21-随手.md':
    FILES['notes/2026-09-21-随手.md'] + '\n\n跳到 [[开张#第二段]] 看看。\n',
});
{
  const texts = await page.locator('.ProseMirror .su-wiki').allTextContents();
  ok('带小节的链接也被认出来', texts.some((t) => t.includes('开张#第二段')), JSON.stringify(texts));
  const link = page.locator('.ProseMirror .su-wiki').filter({ hasText: '第二段' }).first();
  ok('它带着 data-heading', (await link.getAttribute('data-heading')) === '第二段', String(await link.getAttribute('data-heading')));
  await link.click({ modifiers: ['Control'] });
  await page.waitForTimeout(1800);
  const s = await state();
  ok('跳到了「开张」', s.current === 'thoughts/2026-09-21-开张.md', String(s.current));
  const headings = await page.locator('.ProseMirror h2').allTextContents();
  ok('目标小节确实在文里', headings.some((h) => h.includes('第二段')), JSON.stringify(headings));
}

step('源码模式下这些字还是原来的字');
await openNote('notes/2026-09-21-随手.md');
await page.click('[data-mode="source"]');
await page.waitForTimeout(900);
{
  const v = await page.inputValue('[data-source]');
  ok('源码里是 [[开张]] 原文', v.includes('[[开张]]'), v.slice(0, 60));
  ok('源码里没有 HTML 标签混进来', !v.includes('<span'), v.slice(0, 80));
}

const realErrors = errors.filter((e) => !/favicon|401|Failed to load resource/i.test(e));
step('控制台');
ok('没有报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${bad.length} 失败`);
if (bad.length) console.log('失败项：\n  - ' + bad.join('\n  - '));
process.exit(bad.length ? 1 : 0);
