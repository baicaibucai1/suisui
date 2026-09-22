// 附件（图片 / PDF / 正文嵌入）的端到端。
//
//   node tests/attach-e2e.mjs                     # 默认打开发服务器 5183
//   DEMO_URL=http://localhost:5184 node tests/attach-e2e.mjs
//
// 单测（tests/binary.test.mjs）验的是「编解码对不对」，这里验的是**真的看得见**：
//   ① 走「添加附件」把图放进来 → 文件树里有它 → 点开是一张图（不是裂图、不是乱码）
//   ② PDF 是**画在 canvas 上的**（不是 iframe，WebView2 没那插件），能翻页
//   ③ 正文里写 `![[a.png]]` → 图上就嵌在正文里，且磁盘上存的还是那几个字
//   ④ 太大的、不是图片或 PDF 的，被挡下来并说清原因（不是静默吞掉）
//   ⑤ 打开一张图不该把 pdf.js 拽下来 —— 那 1MB 只有真看 PDF 时才付
//
// ⚠️ 桌面端 e2e 不测 iframe 内嵌 PDF：那套在 WebView2 里是白屏，见 PdfView.tsx 文件头。
import { createRequire } from 'node:module';

for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
  delete process.env[k];
}

const { chromium } = createRequire('C:/AI_Production/QQbot/')('playwright');

const URL = process.env.DEMO_URL ?? 'http://localhost:5183';
const OUT = 'C:/AI_Production/suisui-app/shots/ui';

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra ? ` —— ${extra}` : ''}`);
  }
};

/** 1×1 的红点 PNG。小到能塞进测试文件里，渲染出来 naturalWidth 是 1。 */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * 现造一个**两页**的 PDF。
 * 为什么不拿现成的文件：仓库里不该躺着一个只为测试存在的二进制。
 * xref 表必须写对 —— pdf.js 虽然有恢复模式，但缺 startxref 的那种它未必救得回来。
 */
function makePdf() {
  const content = 'BT /F1 24 Tf 20 100 Td (Sui Sui) Tj ET\n';
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<</Font<</F1 5 0 R>>>>/Contents 6 0 R>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${content.length}>>\nstream\n${content}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const run = async () => {
  // 用本机 Edge：这台机器上没装 playwright 自带的 chromium 内核（见其它 e2e）
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--no-proxy-server'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-new-note]', { timeout: 20000 });
  // 上一轮跑留下来的工作副本会干扰断言（同名文件会变成 -2）
  await page.evaluate(() => window.__suisui.setState({ files: {}, current: null, snapshot: {} }));

  console.log('\n== ① 添加一张图');
  await page.setInputFiles('[data-attach-input]', {
    name: 'dot.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_B64, 'base64'),
  });
  await page.waitForSelector('[data-file="thoughts/dot.png"]', { timeout: 10000 });
  ok('文件树里出现了它', true);
  await page.waitForSelector('[data-preview="image"]', { timeout: 10000 });
  ok('自动切到预览，且认出是图片', true);

  const img = page.locator('[data-preview-img]');
  await img.waitFor({ timeout: 10000 });
  const shot = await img.evaluate((el) => ({
    src: el.getAttribute('src') || '',
    w: el.naturalWidth,
    complete: el.complete,
  }));
  // blob: 而不是 data: —— 大图塞进 src 属性会把 DOM 撑爆
  ok('图用的是 blob URL', shot.src.startsWith('blob:'), shot.src.slice(0, 24));
  ok('图真的解出来了（不是裂图）', shot.complete && shot.w === 1, JSON.stringify(shot));
  const sizeText = await page.locator('[data-preview-size]').textContent();
  ok('显示了体积', /\d/.test(sizeText ?? ''), sizeText ?? '');

  console.log('\n== ② 打开图片时不该拉 pdf.js');
  {
    const pulled = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some((r) => /pdf/i.test(r.name)),
    );
    ok('没有下载 pdf.js', !pulled);
  }

  console.log('\n== ③ PDF：画在 canvas 上，能翻页');
  await page.setInputFiles('[data-attach-input]', {
    name: 'doc.pdf',
    mimeType: 'application/pdf',
    buffer: makePdf(),
  });
  await page.waitForSelector('[data-preview="pdf"]', { timeout: 10000 });
  ok('认出是 PDF', true);
  /*
   * ⚠️ 两个坑：
   * ① 不能拿 `canvas.width > 0` 当"画完了" —— canvas 默认就是 300×150；
   * ② 也不能只判"页码不等于「—」" —— PdfView 还在懒加载时 `[data-page]` 压根不存在，
   *    querySelector 返回 null，空串当然也不等于「—」，断言会当场假绿。
   * 所以必须是"出现了形如 1 / 2 的页码"。
   */
  await page.waitForFunction(
    () => /\d+\s*\/\s*\d+/.test(document.querySelector('[data-page]')?.textContent ?? ''),
    { timeout: 30000 },
  );
  const drawn = await page.evaluate(() => {
    const c = document.querySelector('[data-pdf-canvas]');
    return c instanceof HTMLCanvasElement && c.width > 0 && c.height > 0;
  });
  ok('canvas 真的画出来了', drawn);
  const pageText = await page.locator('[data-page]').textContent();
  ok('认出两页', (pageText ?? '').replace(/\s/g, '') === '1/2', pageText ?? '');

  await page.click('[data-page-next]');
  await page.waitForFunction(
    () => (document.querySelector('[data-page]')?.textContent ?? '').replace(/\s/g, '') === '2/2',
    { timeout: 10000 },
  );
  ok('翻到第 2 页', true);
  await page.click('[data-page-prev]');
  await page.waitForFunction(
    () => (document.querySelector('[data-page]')?.textContent ?? '').replace(/\s/g, '') === '1/2',
    { timeout: 10000 },
  );
  ok('翻回第 1 页', true);

  console.log('\n== ④ 正文里 ![[dot.png]] 直接把图画出来');
  await page.evaluate(() => {
    const s = window.__suisui.getState();
    const files = { ...s.files, 'thoughts/带图.md': '# 带图\n\n看图：![[dot.png]]\n\n还有链接 [[开张]]\n' };
    window.__suisui.setState({ files, current: 'thoughts/带图.md' });
  });
  await page.waitForSelector('[data-mode="wysiwyg"]', { timeout: 20000 });
  await page.waitForSelector('.su-embed-img', { timeout: 20000 });
  {
    const info = await page.locator('.su-embed-img').first().evaluate((el) => ({
      src: el.getAttribute('src') || '',
      w: el.naturalWidth,
    }));
    ok('嵌进正文的那张图是真的', info.src.startsWith('blob:') && info.w === 1, JSON.stringify(info));
  }
  {
    // 磁盘上存的必须还是那几个字 —— 装饰只是装饰
    const stored = await page.evaluate(
      () => window.__suisui.getState().files['thoughts/带图.md'] ?? '',
    );
    ok('存进文件的还是 ![[dot.png]]', stored.includes('![[dot.png]]'), stored.slice(0, 60));
    ok('嵌入没被当链接改掉', !stored.includes('![\\['), stored.slice(0, 60));
  }

  console.log('\n== ⑤ 挡下来的要说清原因');
  await page.setInputFiles('[data-attach-input]', {
    name: 'note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await page.waitForSelector('[data-attach-error]', { timeout: 10000 });
  ok('不是图片也不是 PDF → 拦下', (await page.locator('[data-attach-error]').textContent())?.includes('note.txt'));
  ok('它没进库', await page.evaluate(() => !('thoughts/note.txt' in window.__suisui.getState().files)));

  await page.setInputFiles('[data-attach-input]', {
    name: 'huge.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(9 * 1024 * 1024, 1),
  });
  await page.waitForFunction(
    () => (document.querySelector('[data-attach-error]')?.textContent ?? '').includes('huge.png'),
    { timeout: 15000 },
  );
  ok('超过上限 → 拦下并报出实际大小', (await page.locator('[data-attach-error]').textContent())?.includes('MB'));
  ok('超大的没进库', await page.evaluate(() => !('thoughts/huge.png' in window.__suisui.getState().files)));

  console.log('\n== ⑥ 附件在同步里按字节算指纹');
  {
    const sha = await page.evaluate(async () => {
      const s = window.__suisui.getState();
      const mod = await import('/src/lib/binary.ts');
      return mod.storedSha(s.files['thoughts/dot.png']);
    });
    // 1×1 那个 PNG 的 git blob sha：和本地 git 算的是同一个值
    const { createHash } = await import('node:crypto');
    const bytes = Buffer.from(PNG_B64, 'base64');
    const want = createHash('sha1')
      .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
      .digest('hex');
    ok('指纹 = 原始字节的 blob sha', sha === want, `${sha} vs ${want}`);
  }

  console.log('\n== ⑦ 手机上预览区不能横向溢出');
  await page.evaluate(() => window.__suisui.setState({ current: 'thoughts/dot.png' }));
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForSelector('[data-preview="image"]', { timeout: 10000 });
  await page.waitForTimeout(400);
  {
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    ok('没有横向滚动条', over <= 1, `溢出了 ${over}px`);
  }
  await page.screenshot({ path: `${OUT}/21-attach-mobile.png`, fullPage: false });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.__suisui.setState({ current: 'thoughts/doc.pdf' }));
  await page.waitForSelector('[data-preview="pdf"]', { timeout: 10000 });

  await page.screenshot({ path: `${OUT}/20-attach.png`, fullPage: false });

  ok('页面没有报错', errors.length === 0, errors.join(' | '));
  await browser.close();

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
