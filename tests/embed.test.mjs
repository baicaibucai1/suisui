// `![[某篇]]` 嵌入正文的渲染内核。embed.ts 是零依赖纯函数（依赖全部注入），
// Node 24 可直接 import：
//   node tests/embed.test.mjs
//
// 这里验的是「拼出来的片段对不对」——真在编辑器里画出来、点得动，是 e2e 的事。
// ⚠️ mdToHtml 是注入的：单测塞一个极简的假渲染器，这样不必为了测拼装去引 micromark。
import { MAX_EMBED_DEPTH, renderEmbed } from '../src/lib/embed.ts';

let pass = 0;
let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log('  ✓ ' + label);
  } else {
    fail++;
    console.log(`  ✗ ${label}\n      得到 ${g}\n      期望 ${w}`);
  }
};
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log('  ✓ ' + label);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra ? '   → ' + extra : ''}`);
  }
};
const step = (s) => console.log('\n== ' + s);

/**
 * 极简假渲染器：只认标题、段落 —— 够验拼装，不引依赖。
 * ⚠️ 它必须**跟真 micromark 一样转义原样 HTML**：本测试里那条「尖括号不变标签」
 * 验的是「拼装没有二次解码」，如果假渲染器不转义，那条断言就成了在验假货。
 * （真实行为前面实测过：micromark 把 `<script>` 输出成 `&lt;script&gt;`。）
 */
const fakeMd = (md) =>
  md
    .split(/\n{2,}/)
    .map((b) => {
      const t = b.trim();
      if (!t) return '';
      const h = /^(#{1,6})\s+(.*)$/.exec(t);
      if (h) return `<h${h[1].length}>${escape(h[2])}</h${h[1].length}>`;
      return `<p>${escape(t.replace(/\n/g, ' '))}</p>`;
    })
    .join('');

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 造一个库：名字 → 内容。返回 resolve 函数。 */
function makeCtx(lib, opts = {}) {
  const paths = Object.keys(lib);
  return {
    resolve: (target) => {
      const p = paths.find((x) => x === target || x.endsWith('/' + target) || x.replace(/\.[a-z0-9]+$/i, '').endsWith('/' + target) || x.replace(/\.[a-z0-9]+$/i, '') === target);
      if (!p) return null;
      const name = p.slice(p.lastIndexOf('/') + 1);
      const img = /\.(png|jpg|jpeg|gif|webp)$/i.test(p);
      return {
        path: p,
        name: name.replace(/\.[a-z0-9]+$/i, ''),
        url: img ? 'blob:fake' : null,
        isAsset: img || /\.pdf$/i.test(p),
        isImage: img,
        body: img ? undefined : lib[p],
      };
    },
    depth: opts.depth ?? 0,
    chain: opts.chain ?? [],
    mdToHtml: fakeMd,
    escape,
  };
}

step('嵌一篇笔记：抬头 + 正文');
{
  const lib = { 'notes/开张.md': '# 开张\n\n今天开张了。' };
  const html = renderEmbed('开张', makeCtx(lib));
  ok('返回了片段', typeof html === 'string' && html.length > 0);
  ok('带 su-note 外壳', html.includes('class="su-note"'));
  ok('写着被嵌那篇的路径', html.includes('data-note-embed="notes/开张.md"'));
  ok('抬头显示篇名（用标题不是文件名）', html.includes('>开张<'));
  ok('有「打开原文」入口', html.includes('打开原文') && html.includes('data-note-open="notes/开张.md"'));
  ok('正文渲染进去了', html.includes('今天开张了。'));
  // 标题降级：嵌进来的 h1 不能跟本文的 h1 打架
  ok('标题降级成 su-note-h', html.includes('class="su-note-h"') && !/<h1>/.test(html));
  ok('日期前缀被吃掉（标题优先）', !html.includes('2026-'));
}

step('附件不进这条渲染路');
{
  const lib = { 'att/dot.png': 'AAAA', 'att/说明.pdf': 'BBBB' };
  eq('图片返回 null（交给附件的 blob 那条路）', renderEmbed('dot.png', makeCtx(lib)), null);
  eq('PDF 也返回 null（画卡片）', renderEmbed('说明.pdf', makeCtx(lib)), null);
}

step('库里没有 → null（调用方画虚线占位）');
{
  eq('找不到就是 null', renderEmbed('查无此篇', makeCtx({ 'a.md': 'x' })), null);
}

step('防环：A 嵌 B、B 嵌 A，第二回不再展开');
{
  const lib = {
    'a.md': '# A\n\n![[b]]',
    'b.md': '# B\n\n![[a]]',
  };
  // 链条起手已含 a（当前打开的就是 a）
  const html = renderEmbed('b', makeCtx(lib, { chain: ['a.md'] }));
  ok('B 展开了', html.includes('data-note-embed="b.md"'));
  ok('B 里的 A 收成卡片（不再展开）', html.includes('▤ a'));
  ok('没有出现第二个 su-note', (html.match(/class="su-note"/g) ?? []).length === 1);
}

step('防自嵌：正文里写 `![[本文]]` 当场收卡片');
{
  const lib = { 'a.md': '# A\n\n![[a]]' };
  const html = renderEmbed('a', makeCtx(lib, { chain: ['a.md'] }));
  eq('自己嵌自己 → null', html, null);
}

step('深度上限');
{
  // a → b → c → d：上限 2 层展开
  const lib = {
    'a.md': '![[b]]',
    'b.md': '![[c]]',
    'c.md': '![[d]]',
    'd.md': '最深处',
  };
  const html = renderEmbed('a', makeCtx(lib));
  ok('第一层展开了', html.includes('data-note-embed="a.md"'));
  ok('第二层展开了', html.includes('data-note-embed="b.md"'));
  ok(`第三层到上限收卡片（MAX=${MAX_EMBED_DEPTH}）`, html.includes('▤ c') || html.includes('▤ c.md'));
  ok('最深那篇的正文没被拉进来', !html.includes('最深处'));
}

step('被嵌正文里的 [[链接]] 画成只读链接');
{
  const lib = {
    'a.md': '提到 [[b]] 和 [[没建过的]]。',
    'b.md': 'B 的正文',
  };
  const html = renderEmbed('a', makeCtx(lib));
  ok('指到了 → 带 data-note-open 的链接色', html.includes('class="su-note-link" data-note-open="b.md"'));
  ok('没建过 → 只是淡淡的字', html.includes('su-note-link-new') && html.includes('没建过的'));
}

step('转义：正文里的尖括号不能变成标签');
{
  const lib = { 'a.md': '看这个 <script>alert(1)</script> 和 "引号"' };
  const html = renderEmbed('a', makeCtx(lib));
  ok('尖括号被转义', !/<script>/.test(html) && html.includes('&lt;script&gt;'));
  ok('引号被转义', html.includes('&quot;'));
}

step('被嵌正文里的 ![[图]] 直接画 img');
{
  const lib = { 'a.md': '![[dot.png]]', 'att/dot.png': 'AAAA' };
  // resolve 得能同时认笔记和附件 —— 假 ctx 按后缀分
  const ctx = makeCtx(lib);
  const html = renderEmbed('a', ctx);
  ok('图片被画成 img', html.includes('<img src="blob:fake"'));
  ok('带 alt', html.includes('alt="dot"'));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);