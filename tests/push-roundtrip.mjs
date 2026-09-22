// 端到端往返：新建文件 → 输入 → 推送 → 校验远端 → 删除 → 再推送 → 校验远端已消失。
//
// ⚠️ 每一步都有断言。之前只 console.log 不断言，网络一抖就"假绿"了
//（顶栏显示「与远端一致」、远端文件还在，脚本照样 exit 0）。
// 现在任何一步不符预期都 exit 1，并且会说明是网络问题还是逻辑问题。
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

// ⚠️ Playwright 会把 http_proxy/https_proxy 透传给浏览器（端口每次还不一样）→ 浏览器对
// api.github.com 时通时不通，报 ERR_CONNECTION_CLOSED。node 的 fetch 不吃这个代理。
for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
  delete process.env[k];
}

const require = createRequire('C:/AI_Production/QQbot/');
const { chromium } = require('playwright');

const URL = process.env.DEMO_URL ?? 'http://localhost:5183';
const REPO = 'baicaibucai1/ramblings';
const TEST_PATH = 'drafts/demo-push-test.md';

let fails = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails += 1;
};

const token = execFileSync(
  process.execPath,
  [
    '-e',
    "const {execSync}=require('child_process');const out=execSync('git credential fill',{input:'protocol=https\\nhost=github.com\\n\\n'}).toString();process.stdout.write(out.match(/password=(.*)/)[1].trim())",
  ],
  { encoding: 'utf8' },
).trim();

const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };

// --- 0. 先探活：网络不通的话，后面所有失败都没有诊断价值 ---
try {
  const r = await fetch('https://api.github.com/rate_limit', { headers: H });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  console.log(`== 0. 网络与凭据 OK（配额 ${j.rate.remaining}/${j.rate.limit}）`);
} catch (e) {
  console.error(`✗ 连不上 api.github.com：${e.message}`);
  console.error('  这是本机网络/代理问题，不是代码问题 —— 别在这条线索上查 bug。');
  process.exit(1);
}

const remoteHas = async (path) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: H });
  return r.status === 200;
};
const headCommit = async () => {
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=1`, { headers: H });
  const j = await r.json();
  return j[0];
};
/** 轮询远端直到变成期望状态 —— 同步可能还在飞，别只查一次 */
const waitRemote = async (path, want, ms = 15000) => {
  const until = Date.now() + ms;
  for (;;) {
    if ((await remoteHas(path)) === want) return true;
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 600));
  }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 920 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));

// 差异状况说在「待同步」那块的抬头里（顶栏整条已拿掉，dock 只管动手）
const topBar = async () => (await page.textContent('[data-changes]')).replace(/\s+/g, ' ').trim();
// 先等它真的忙起来，再等空闲。只等「按钮不 disabled」会在 React 重渲染之前就返回，
// 于是断言全跑在任务开始之前 —— 表现为随机假红/假绿。
const waitIdle = async () => {
  await page
    .waitForFunction(() => window.__suisui.getState().busy !== null, { timeout: 8000 })
    .catch(() => {});
  await page.waitForFunction(() => window.__suisui.getState().busy === null, { timeout: 60000 });
};
/** 浏览器侧一次请求都没发出去时，store 里会留下 error —— 必须当成失败 */
const netError = () => page.evaluate(() => window.__suisui?.getState().error ?? null);
const fileCount = () => page.evaluate(() => Object.keys(window.__suisui.getState().files).length);

/** 等到「结果真出现」为止（busy 变 null 不等于拿到东西：请求挂住/被拦也一样会结束） */
const waitForFiles = async (min, ms = 25000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await fileCount()) >= min) return true;
    if (await netError()) return false;
    await page.waitForTimeout(400);
  }
  return (await fileCount()) >= min;
};

try {
  console.log('\n== 1. 打开 + 初次拉取');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.click('[data-sync]');
  await waitIdle();
  const pulled = await waitForFiles(1);
  check((await netError()) === null, '同步无网络错误', (await netError()) ?? '');
  check(pulled, '左侧列出了文件', pulled ? '' : `store 里 ${await fileCount()} 个文件`);

  const before = await headCommit();
  console.log('   同步前远端 HEAD:', before.sha.slice(0, 7), '-', before.commit.message);

  console.log('\n== 2. 新建 ' + TEST_PATH + ' 并输入内容');
  await page.click('[data-new]');
  await page.fill('input[placeholder*="thoughts"]', TEST_PATH);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  check((await page.locator(`[data-file="${TEST_PATH}"]`).count()) === 1, '文件出现在左侧');
  await page.click('.milkdown .ProseMirror, .milkdown');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('demo push test from web client');
  await page.waitForTimeout(1200);

  console.log('\n== 3. 刷新差异（应显示「1 待推送」）');
  await page.click('[data-refresh]');
  await waitIdle();
  await page.waitForTimeout(800);
  const bar = await topBar();
  check((await netError()) === null, '比对无网络错误', (await netError()) ?? '');
  check(/1 待推送/.test(bar), '识别为本地新增', bar.slice(0, 80));

  console.log('\n== 4. 同步（应产生 commit）');
  await page.click('[data-sync]');
  await waitIdle();
  await page.waitForTimeout(1200);
  const pushed = await waitRemote(TEST_PATH, true);
  check(pushed, '远端已存在该文件');
  const after = await headCommit();
  console.log('   同步后远端 HEAD:', after.sha.slice(0, 7), '-', after.commit.message);
  check(after.sha !== before.sha, 'HEAD 前进了');
  await page.screenshot({ path: 'C:/AI_Production/suisui-app/shots/06-pushed.png' });

  console.log('\n== 5. 本地删除 + 再同步');
  const row = page.locator(`[data-file="${TEST_PATH}"]`);
  await row.hover();
  await row.locator('button').click({ force: true });
  await page.waitForTimeout(600);
  check((await page.locator(`[data-file="${TEST_PATH}"]`).count()) === 0, '本地行已消失');

  await page.click('[data-refresh]');
  await waitIdle();
  await page.waitForTimeout(800);
  const bar2 = await topBar();
  check((await netError()) === null, '比对无网络错误', (await netError()) ?? '');
  check(/1 待推送/.test(bar2), '识别为本地删除', bar2.slice(0, 80));

  await page.click('[data-sync]');
  await waitIdle();
  await page.waitForTimeout(800);
  const stillThere0 = await remoteHas(TEST_PATH);
  check(stillThere0, '没确认前，远端文件还在（不会静默删）');
  const bar1 = page.locator('[data-delete-confirm]');
  check((await bar1.count()) === 1, '删远端前先要求确认');
  console.log('   确认条:', (await bar1.textContent().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 120));
  await page.screenshot({ path: 'C:/AI_Production/suisui-app/shots/11-delete-confirm.png' });

  await page.click('[data-delete-ok]');
  await waitIdle();
  await page.waitForTimeout(1200);
  const stillThere = await waitRemote(TEST_PATH, false);
  check(stillThere, '确认后远端已删除该文件');
  const final = await headCommit();
  console.log('   最终远端 HEAD:', final.sha.slice(0, 7), '-', final.commit.message);
} finally {
  console.log('\n页面错误:', errors.length ? errors.join(' | ') : '(无)');
  await browser.close();
  // 兜底清理：不管上面成没成，远端都不该留测试文件
  if (await remoteHas(TEST_PATH)) {
    const f = await (await fetch(`https://api.github.com/repos/${REPO}/contents/${TEST_PATH}`, { headers: H })).json();
    await fetch(`https://api.github.com/repos/${REPO}/contents/${TEST_PATH}`, {
      method: 'DELETE',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '清理测试残留', sha: f.sha, branch: 'main' }),
    });
    console.error('✗ 远端残留 ' + TEST_PATH + ' 已兜底清理');
    fails += 1;
  }
}

console.log(fails ? `\n✗ ${fails} 项不符合预期` : '\n✓ 往返全部通过');
process.exit(fails ? 1 : 0);
