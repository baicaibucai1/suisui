// 「稿纸」(.rich) 的端到端验证。
//
// 最要紧的一条断言不是"按钮亮没亮"，而是**用户写的 CSS 真的能生效**：
// 默认排版躺在 @layer base 里，用户样式是 @scope 包着的未分层规则 ——
// 两者谁赢，只有真跑一遍才知道。
//
// 用 QQbot 里的 playwright + 本机 Edge。跑法：
//   node tests/rich-e2e.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';

// Playwright 会把 http_proxy 透传给浏览器，而本机代理端口每次都不一样 → 必须清掉
for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
  delete process.env[k];
}

const require = createRequire('C:/AI_Production/QQbot/');
const { chromium } = require('playwright');

const URL = process.env.DEMO_URL ?? 'http://localhost:5183';
const OUT = 'C:/AI_Production/suisui-app/shots';
fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (cond) pass++;
  else fail++;
};
const step = (s) => console.log('\n== ' + s);

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 300)));

const store = () => page.evaluate(() => window.__suisui.getState());
const raw = () =>
  page.evaluate(() => {
    const st = window.__suisui.getState();
    return st.files[st.current ?? ''] ?? '';
  });

step('打开页面');
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
console.log('title:', await page.title());

step('创建一篇稿纸');
await page.click('[data-new-note]');
await page.waitForTimeout(400);
ok('创建表单已打开', (await page.locator('[data-note-form]').count()) === 1);
ok('有两种格式可选', (await page.locator('[data-note-kind]').count()) === 2);

await page.click('[data-note-kind="rich"]');
await page.click('[data-note-dir="notes"]');
await page.fill('[data-note-title]', '稿纸测试');
await page.waitForTimeout(250);
const preview = (await page.textContent('[data-note-preview]')) ?? '';
console.log('  路径预览:', preview);
ok('预览后缀变成 .rich', /^notes\/\d{4}-\d{2}-\d{2}-稿纸测试\.rich$/.test(preview), preview);

await page.press('[data-note-title]', 'Enter');
await page.waitForTimeout(2000);

const made = await store();
ok('文件名按预览落库', made.current === preview, String(made.current));
ok('左侧出现了这篇', (await page.locator(`[data-file="${preview}"]`).count()) === 1);
const initial = await raw();
console.log('  初始正文:', JSON.stringify(initial));
// 按回车提交时，这个回车**不能漏进刚打开的正文**。踩过：新建的稿纸凭空多出
// 一个空 <h1><br></h1>（焦点已经移到编辑器，按键默认动作却还照旧执行）
ok('标题进 HTML 后没带出多余空块', /^<h1>稿纸测试<\/h1>/.test(initial), initial);
ok('只有一个标题', (initial.match(/<h1/g) ?? []).length === 1, initial);
ok('留了个空段落给光标落脚', initial.includes('<br>'), initial);
ok('没被当成 md 打开（没有 milkdown）', (await page.locator('.milkdown').count()) === 0);
ok('稿纸编辑器已挂载', (await page.locator('[data-rich-doc]').count()) === 1);
ok('标着「稿纸」', (await page.locator('text=稿纸').count()) > 0);
await page.screenshot({ path: `${OUT}/r01-created.png` });

step('工具栏');
ok('工具栏在', (await page.locator('[data-rich-toolbar]').count()) === 1);
const btnCount = await page.locator('[data-rich]').count();
console.log('  按钮数:', btnCount);
ok('共 25 个工具', btnCount === 25, String(btnCount));
// 样式类按钮是稿纸的立身之本，缺一个就等于退化成 md 了
for (const id of ['color', 'bg', 'size', 'card', 'css']) {
  ok(`有「${id}」按钮`, (await page.locator(`[data-rich="${id}"]`).count()) === 1);
}

step('敲字 + 加粗');
await page.locator('[data-rich-doc] p').last().click();
await page.keyboard.type('第一行');
await page.waitForTimeout(200);
await page.click('[data-rich="bold"]');
await page.keyboard.type('加粗的字');
await page.waitForTimeout(1000);
let body = await raw();
console.log('  正文:', body.slice(0, 220).replace(/\n/g, '⏎'));
ok('普通文字进了正文', body.includes('第一行'));
ok('加粗落了实（内联 font-weight，不是 <b>）', /font-weight:\s*bold/.test(body), body.slice(0, 200));

step('居中对齐当前段');
await page.locator('[data-rich-doc] p').last().click();
await page.click('[data-rich="center"]');
await page.waitForTimeout(900);
body = await raw();
ok('段落拿到 text-align: center', /text-align:\s*center/.test(body), body.slice(0, 240));
ok('居中按钮亮起', (await page.getAttribute('[data-rich="center"]', 'aria-pressed')) === 'true');
await page.click('[data-rich="left"]');
await page.waitForTimeout(900);
body = await raw();
ok('再点左对齐能回去', !/text-align:\s*center/.test(body), body.slice(0, 240));

step('文字颜色（CSS 样式组）');
await page.evaluate(() => {
  const doc = document.querySelector('[data-rich-doc]');
  const p = doc.querySelector('p');
  const r = document.createRange();
  r.selectNodeContents(p);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
});
await page.click('[data-rich="color"]');
await page.waitForTimeout(350);
ok('色板弹出来了', (await page.locator('[data-rich-pop]').count()) === 1);
await page.click('[data-rich-swatch="#ac4a3e"]');
await page.waitForTimeout(900);
body = await raw();
console.log('  正文:', body.slice(0, 300).replace(/\n/g, '⏎'));
ok('颜色写进了正文', /color:\s*(rgb\(172,\s*74,\s*62\)|#ac4a3e)/i.test(body), body.slice(0, 260));
ok('选完色板自动收起', (await page.locator('[data-rich-pop]').count()) === 0);

step('卡片块');
await page.locator('[data-rich-doc] p').last().click();
await page.click('[data-rich="card"]');
await page.waitForTimeout(900);
body = await raw();
ok('块上带了卡片标记', body.includes('data-rich-card'), body.slice(0, 320));
ok('卡片样式是行内写的（文件能独立存活）', /border-radius:\s*10px/.test(body), body.slice(0, 320));
await page.click('[data-rich="card"]');
await page.waitForTimeout(900);
body = await raw();
ok('再点一次取消卡片', !body.includes('data-rich-card'));
// 取消要顺手，但刚才那段字不能丢
ok('取消卡片没吃掉正文', body.includes('第一行'), body.slice(0, 240));

step('这篇的 CSS：套预设 + 真的生效');
await page.click('[data-rich="css"]');
await page.waitForTimeout(400);
ok('CSS 面板已展开', (await page.locator('[data-rich-css-panel]').count()) === 1);
ok('面板里有 CSS 输入框', (await page.locator('[data-rich-css]').count()) === 1);
const presetCount = await page.locator('[data-rich-preset]').count();
console.log('  预设数:', presetCount);
ok('给了几套主题预设', presetCount >= 4, String(presetCount));

await page.click('[data-rich-preset="night"]');
await page.waitForTimeout(1200);
body = await raw();
console.log('  文件开头:', JSON.stringify(body.slice(0, 120)));
ok('CSS 写进了文件最前面', body.startsWith('<style>'), body.slice(0, 80));
ok('预设内容在文件里', body.includes(':scope') && body.includes('#1c1b19'));
ok('正文还在（CSS 没把正文挤掉）', body.includes('</style>') && body.includes('第一行'));

// 注入到页面里的那份必须被 @scope 圈住，否则用户一条 body{} 就改到界面上了
const injected = await page.evaluate(
  () => document.querySelector('[data-rich-style]')?.textContent ?? '',
);
console.log('  注入的样式:', JSON.stringify(injected.slice(0, 90)));
ok('注入的样式包在 @scope 里', injected.includes('@scope (.rich-scope)'));

// ★ 成败点：默认排版在 @layer base，用户样式未分层 —— 用户必须赢
const docStyle = await page.evaluate(() => {
  const doc = document.querySelector('[data-rich-doc]');
  const cs = getComputedStyle(doc);
  const h1 = doc.querySelector('h1');
  return {
    background: cs.backgroundColor,
    color: cs.color,
    h1Color: h1 ? getComputedStyle(h1).color : '',
    uaScope: typeof CSS !== 'undefined' && CSS.supports?.('selector(:scope)') !== undefined,
  };
});
console.log('  文档根实际样式:', JSON.stringify(docStyle));
ok('预设的背景真的压过了默认（@layer 让路了）', docStyle.background === 'rgb(28, 27, 25)', docStyle.background);
ok('预设的文字色也生效', docStyle.color === 'rgb(215, 211, 204)', docStyle.color);
ok('用户 CSS 能改到标题（默认样式没压死它）', docStyle.h1Color === 'rgb(242, 239, 233)', docStyle.h1Color);
await page.screenshot({ path: `${OUT}/r02-styled.png` });

step('切主题：换预设应整段替换，不是叠加');
await page.click('[data-rich-preset="sticky"]');
await page.waitForTimeout(1200);
body = await raw();
ok('旧预设被换掉了', !body.includes('#1c1b19') && body.includes('#fdf6d8'), body.slice(0, 160));
ok('只留一个 <style> 块', body.split('<style>').length === 2, String(body.split('<style>').length - 1));

step('切主题：清空');
await page.click('[data-rich-preset="plain"]');
await page.waitForTimeout(1200);
body = await raw();
ok('清空后文件里没有 <style> 了', !body.includes('<style>'), body.slice(0, 120));
ok('正文一个字不少', body.includes('第一行') && body.includes('加粗的字'), body.slice(0, 200));

step('源码模式：来回切不丢字');
await page.click('[data-rich-mode="source"]');
await page.waitForTimeout(700);
ok('源码框出现', (await page.locator('[data-rich-source]').count()) === 1);
const srcText = await page.inputValue('[data-rich-source]');
ok('源码框拿到的是正文', srcText.includes('第一行'), srcText.slice(0, 140));
ok('源码模式下工具栏收起', (await page.locator('[data-rich-toolbar]').count()) === 0);

// 在源码里手写一段 CSS，切回稿纸后必须生效
await page.fill('[data-rich-source]', `<style>\n:scope { background: rgb(7, 8, 9); }\n</style>\n${srcText}`);
await page.waitForTimeout(1000);
await page.click('[data-rich-mode="rich"]');
await page.waitForTimeout(900);
const backStyle = await page.evaluate(
  () => getComputedStyle(document.querySelector('[data-rich-doc]')).backgroundColor,
);
ok('源码里手写的 CSS 切回来就生效', backStyle === 'rgb(7, 8, 9)', backStyle);
ok('切回稿纸后按钮又出来了', (await page.locator('[data-rich-toolbar]').count()) === 1);
await page.screenshot({ path: `${OUT}/r03-source-roundtrip.png` });

step('防抖窗口里切文件：字不能丢');
await page.locator('[data-rich-doc] p').last().click();
await page.keyboard.press('End');
await page.keyboard.type('尾巴两个字');
// 故意不等 500ms 防抖，立刻切走 —— 靠载入前的落盘救回来
await page.click('[data-new-note]');
await page.waitForTimeout(300);
await page.click('[data-note-kind="md"]');
await page.click('[data-note-dir="thoughts"]');
await page.fill('[data-note-title]', '临时上一篇');
await page.press('[data-note-title]', 'Enter');
await page.waitForTimeout(900);
const leaked = await page.evaluate(
  (p) => window.__suisui.getState().files[p] ?? '',
  preview,
);
console.log('  稿纸那篇现在:', JSON.stringify(leaked.slice(-80)));
ok('切走前的字已经落盘', leaked.includes('尾巴两个字'), leaked.slice(-120));
ok('切到的确实是 md 那篇', (await page.locator('.milkdown').count()) === 1);

step('清理');
await page.evaluate(
  (p) => {
    const st = window.__suisui.getState();
    for (const k of Object.keys(st.files)) {
      if (k.includes('稿纸测试') || k.includes('临时上一篇')) st.removeFile(k);
    }
    void p;
  },
  preview,
);
await page.waitForTimeout(600);
const left = await page.evaluate(() =>
  Object.keys(window.__suisui.getState().files).filter(
    (p) => p.includes('稿纸测试') || p.includes('临时上一篇'),
  ),
);
console.log('  残留:', left.length ? left.join(' | ') : '(无)');
ok('两篇都已清掉', left.length === 0);

console.log('\n== 控制台错误 ==');
console.log(errors.length ? errors.slice(0, 12).join('\n---\n') : '(无)');
ok('控制台零错误', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n断言：${fail === 0 ? '全部通过' : fail + ' 条失败'}（${pass} 通过 / ${fail} 失败）`);
await browser.close();
process.exit(fail ? 1 : 0);
