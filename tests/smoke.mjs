// 浏览器端冒烟：加载 → 拉取仓库 → 打开一篇文章 → 创建笔记 → 截图。
// 用 QQbot 里的 playwright + 本机 Edge。
import { createRequire } from 'node:module';
import fs from 'node:fs';

// ⚠️ Playwright 会把 http_proxy/https_proxy 透传给浏览器，而本机这个代理端口每次还不一样
//（今天见过 50606 和 56154）→ 浏览器对 api.github.com 时通时不通，报 ERR_CONNECTION_CLOSED。
// node 自己的 fetch 不吃这个代理，所以「node 能连、浏览器连不上」不是玄学。测试里必须清掉。
for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
  delete process.env[k];
}

const require = createRequire('C:/AI_Production/QQbot/');
const { chromium } = require('playwright');

const URL = process.env.DEMO_URL ?? 'http://localhost:5183';
const OUT = 'C:/AI_Production/suisui-app/shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 920 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 300)));

const step = (s) => console.log('\n== ' + s);

step('打开页面');
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
console.log('title:', await page.title());
await page.screenshot({ path: `${OUT}/01-empty.png` });

step('点「刷新差异」');
await page.click('[data-refresh]');
await page.waitForTimeout(3500);
const beforeText = await page.textContent('header');
console.log('顶栏:', (beforeText ?? '').replace(/\s+/g, ' ').trim().slice(0, 160));
await page.screenshot({ path: `${OUT}/02-plan.png` });

step('点「同步」');
// 先等它真的忙起来，再等空闲 —— 只等「按钮不 disabled」会在 React 重渲染之前就返回
await page.click('[data-sync]');
await page
  .waitForFunction(() => window.__suisui.getState().busy !== null, { timeout: 8000 })
  .catch(() => {});
await page.waitForFunction(() => window.__suisui.getState().busy === null, { timeout: 60000 });
await page.waitForTimeout(1200);
const fileCount = await page.locator('[data-file]').count();
console.log('左侧可见文件数:', fileCount);
const status = await page.textContent('footer');
console.log('状态栏:', (status ?? '').replace(/\s+/g, ' ').trim());
console.log('文件列表（左侧可见）:', (await page.locator('[data-file]').allTextContents()).join(' | '));
await page.screenshot({ path: `${OUT}/03-synced.png` });

step('左侧过滤：程序文件默认不显示');
const hiddenTip = await page
  .getByText(/已隐藏/)
  .first()
  .textContent()
  .catch(() => '(没有隐藏提示)');
console.log('隐藏提示:', (hiddenTip ?? '').replace(/\s+/g, ' ').trim());
const filtered = await page.locator('[data-file]').count();
await page.screenshot({ path: `${OUT}/07-filtered.png` });

step('点眼睛：切到「显示全部」');
await page.click('[data-toggle-all]');
await page.waitForTimeout(600);
const allCount = await page.locator('[data-file]').count();
console.log(`可见文件数：过滤 ${filtered} → 全部 ${allCount}`);
await page.screenshot({ path: `${OUT}/08-show-all.png` });
await page.click('[data-toggle-all]');
await page.waitForTimeout(500);
console.log('切回过滤后:', await page.locator('[data-file]').count());

step('打开第一篇 md');
const mdCount = await page.locator('[data-file$=".md"]').count();
console.log('md 文件数:', mdCount);
// 网络不通时同步会失败、左侧是空的 —— 「创建笔记」是纯本地的，不能被拖挂
if (mdCount > 0) {
  await page.locator('[data-file$=".md"]').first().click();
  await page.waitForTimeout(2500);
  const hasEditor = await page.locator('.milkdown').count();
  console.log('milkdown 节点数:', hasEditor);
  const editorText = await page
    .locator('.milkdown')
    .first()
    .innerText()
    .catch(() => '');
  console.log('编辑器内容:', editorText.replace(/\s+/g, ' ').slice(0, 160));
  await page.screenshot({ path: `${OUT}/04-editor.png` });

  step('切到源码模式');
  await page.getByText('源码', { exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/05-source.png` });
} else {
  console.log('  ⚠ 左侧没有 md，跳过「打开 / 源码」两节（多半是网络不通，看上面状态栏）');
}

let failed = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

step('创建笔记：表单 / 路径预览 / 回车即建');
// 上面可能停在源码模式；建完笔记要断言 wysiwyg，先切回来
const wys = page.getByText('所见即所得', { exact: true });
if (await wys.count()) {
  await wys.click();
  await page.waitForTimeout(600);
}

await page.click('[data-new-note]');
await page.waitForTimeout(400);
ok('表单已打开', (await page.locator('[data-note-form]').count()) === 1);
ok(
  '标题框自动聚焦',
  await page.evaluate(() => document.activeElement?.hasAttribute('data-note-title') === true),
);
console.log('  空标题时的预览:', await page.textContent('[data-note-preview]'));

// 中文输入法组字期间的回车是"选词"，不能当提交 —— 否则打拼音一选字就把笔记建了
await page.evaluate(() => {
  document
    .querySelector('[data-note-title]')
    ?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }),
    );
});
await page.waitForTimeout(500);
ok('输入法组字中的回车不提交', (await page.locator('[data-note-form]').count()) === 1);
console.log('  组字回车后，文件数:', await page.evaluate(() => Object.keys(window.__suisui.getState().files).length));

await page.click('[data-note-dir="notes"]');
await page.fill('[data-note-title]', '雨天 散步');
await page.waitForTimeout(250);
const preview = (await page.textContent('[data-note-preview]')) ?? '';
console.log('  填了标题后的预览:', preview);
ok('预览带目录/日期/标题', /^notes\/\d{4}-\d{2}-\d{2}-雨天-散步\.md$/.test(preview), preview);
await page.screenshot({ path: `${OUT}/09-note-form.png` });

await page.press('[data-note-title]', 'Enter');
await page.waitForTimeout(2500);
const made = await page.evaluate(() => {
  const st = window.__suisui.getState();
  const p = st.current ?? '';
  const el = document.querySelector(`[data-file="${p}"]`);
  return {
    path: p,
    body: p ? (st.files[p] ?? null) : null,
    listed: !!el,
    dirty: st.dirty,
    formClosed: !document.querySelector('[data-note-form]'),
  };
});
console.log('  建出来的文件:', made.path);
console.log('  初始正文:', JSON.stringify(made.body));
ok('路径按预览落库', made.path === preview, made.path);
ok('初始正文是 H1 标题', made.body === '# 雨天 散步\n\n', JSON.stringify(made.body));
ok('已出现在左侧文件树', made.listed);
ok('表单已收起', made.formClosed);
ok('标记为有未同步改动', made.dirty);
await page.waitForTimeout(1200);
const inEditor = ((await page.locator('.milkdown').first().innerText().catch(() => '')) ?? '')
  .replace(/\s+/g, ' ')
  .trim();
console.log('  编辑器里:', inEditor.slice(0, 60));
ok('编辑器已打开这篇', inEditor.includes('雨天 散步'));
const barAfter = (await page.textContent('header')).replace(/\s+/g, ' ').trim();
console.log('  顶栏:', barAfter.slice(0, 80));
ok('顶栏说「还没比对」', barAfter.includes('还没比对'));
ok('顶栏不再说「与远端一致」', !barAfter.includes('与远端一致'));
ok(
  '光标已进正文（不是停在标题里）',
  await page.evaluate(() => {
    const el = document.querySelector('.milkdown .ProseMirror');
    const sel = window.getSelection();
    if (!el || !sel || !sel.rangeCount) return false;
    const node = sel.getRangeAt(0).endContainer;
    if (!el.contains(node)) return false;
    const block = (node.nodeType === 1 ? node : node.parentElement)?.closest(
      'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre',
    );
    return block?.tagName === 'P';
  }),
);
await page.screenshot({ path: `${OUT}/10-note-created.png` });

// 工具栏必须在「真的敲进去的字」上验证 —— 只看按钮变没变色证明不了命令跑通了
const readMd = () =>
  page.evaluate(() => {
    const st = window.__suisui.getState();
    return st.files[st.current ?? ''] ?? '';
  });

step('工具栏（所见即所得）：加粗 / 标题 / 列表');
ok('工具栏已出现', (await page.locator('[data-md-toolbar]').count()) === 1);
ok('共 14 个工具', (await page.locator('[data-md]').count()) === 14);

await page.click('[data-md="bold"]');
await page.waitForTimeout(300);
await page.keyboard.type('粗体测试');
await page.waitForTimeout(1500);
let md = await readMd();
console.log('  正文:', JSON.stringify(md));
ok('点加粗后敲的字被 ** 包住', md.includes('**粗体测试**'), md);

await page.click('[data-md="h2"]');
await page.waitForTimeout(1500);
md = await readMd();
console.log('  正文:', JSON.stringify(md));
ok('点 H2 后该段变二级标题', /^## \*\*粗体测试\*\*$/m.test(md), md);
ok(
  'H2 按钮同步显示为选中',
  (await page.getAttribute('[data-md="h2"]', 'aria-pressed')) === 'true',
);

await page.click('[data-md="text"]');
await page.waitForTimeout(1200);
md = await readMd();
ok('点「正文」退回段落', !/^## /m.test(md), md);

await page.click('[data-md="bullet"]');
await page.waitForTimeout(1500);
md = await readMd();
console.log('  正文:', JSON.stringify(md));
// Milkdown 序列化无序列表用的是 `*`，不是 `-` —— 两种都得认
ok('点列表后变无序列表', /^[-*+] \*\*粗体测试\*\*$/m.test(md), md);
ok(
  '列表按钮同步显示为选中',
  (await page.getAttribute('[data-md="bullet"]', 'aria-pressed')) === 'true',
);
// 再点一次要能取消 —— wrapInList 只负责包起来，出栈得走 lift
await page.click('[data-md="bullet"]');
await page.waitForTimeout(1500);
md = await readMd();
ok('再点一次取消列表', !/^[-*+] /m.test(md), md);
await page.screenshot({ path: `${OUT}/12-toolbar.png` });

step('工具栏（源码模式）：选中 → 加粗 / 链接');
await page.click('[data-mode="source"]');
await page.waitForTimeout(900);
const sel = await page.evaluate(() => {
  const ta = document.querySelector('[data-source]');
  const v = ta.value;
  const i = v.indexOf('粗体测试');
  ta.focus();
  ta.setSelectionRange(i, i + 4);
  return { i, v };
});
console.log('  源码内容:', JSON.stringify(sel.v));
ok('源码模式下工具栏还在', (await page.locator('[data-md-toolbar]').count()) === 1);

await page.click('[data-md="bold"]');
await page.waitForTimeout(1200);
md = await readMd();
console.log('  正文:', JSON.stringify(md));
ok('已加粗的选中文字被剥掉标记', md.includes('粗体测试') && !md.includes('**粗体测试**'), md);

// 剥完标记，选区还留在原处，接着测链接弹层
await page.click('[data-md="link"]');
await page.waitForTimeout(400);
ok('链接输入框已弹出', (await page.locator('[data-md-link-pop]').count()) === 1);
await page.fill('[data-md-link-input]', 'https://example.com');
await page.click('[data-md-link-apply]');
await page.waitForTimeout(1200);
md = await readMd();
console.log('  正文:', JSON.stringify(md));
ok('插入链接', md.includes('[粗体测试](https://example.com)'), md);
ok('插入后弹层已收起', (await page.locator('[data-md-link-pop]').count()) === 0);
await page.screenshot({ path: `${OUT}/13-toolbar-source.png` });
await page.click('[data-mode="wysiwyg"]');
await page.waitForTimeout(800);

step('创建笔记：重名不覆盖');
await page.click('[data-new-note]');
await page.fill('[data-note-title]', '雨天 散步');
await page.click('[data-note-dir="notes"]');
await page.press('[data-note-title]', 'Enter');
await page.waitForTimeout(1200);
const second = await page.evaluate(() => window.__suisui.getState().current);
console.log('  第二篇:', second);
ok('重名自动加 -2', second === preview.replace(/\.md$/, '-2.md'), String(second));

step('清理：把这两篇本地删掉（没推送，远端不受影响）');
await page.evaluate(() => {
  const st = window.__suisui.getState();
  for (const p of ['notes/2026-09-21-雨天-散步.md', 'notes/2026-09-21-雨天-散步-2.md']) {
    if (p in st.files) st.removeFile(p);
  }
});
await page.waitForTimeout(600);
const left = await page.evaluate(() => {
  const st = window.__suisui.getState();
  return Object.keys(st.files).filter((p) => p.includes('雨天-散步'));
});
console.log('  残留:', left.length ? left.join(' | ') : '(无)');
ok('两篇都已删除', left.length === 0);

console.log('\n== 控制台错误 ==');
console.log(errors.length ? errors.slice(0, 12).join('\n---\n') : '(无)');
console.log(`\n断言：${failed === 0 ? '全部通过' : failed + ' 条失败'}`);

await browser.close();
process.exit(failed ? 1 : 0);
