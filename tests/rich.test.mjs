// 「稿纸」格式内核的覆盖。rich.ts 是零依赖纯字符串函数，Node 24 可直接 import：
//   node tests/rich.test.mjs
import {
  CSS_HINT,
  NOTE_KINDS,
  RICH_EXT,
  RICH_PRESETS,
  RICH_SCOPE,
  emptyDoc,
  escapeHtml,
  isMdPath,
  isRichPath,
  joinRich,
  richBody,
  sanitizeHtml,
  scopedCss,
  splitRich,
} from '../src/lib/rich.ts';

let pass = 0;
let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}\n      得到 ${g}\n      期望 ${w}`);
  }
};
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`);
  }
};

console.log('\n== 认文件');
eq('后缀常量', RICH_EXT, 'rich');
ok('.rich 认出来', isRichPath('thoughts/2026-09-21-雨天.rich'));
ok('大小写不敏感', isRichPath('notes/A.RICH'));
ok('.md 不算稿纸', !isRichPath('notes/雨天.md'));
// `xxrich` 这种没点的尾巴不能误判
ok('没点的尾巴不算', !isRichPath('notes/notrich'));
ok('.md 认出来', isMdPath('notes/雨天.md'));
eq('给创建表单用的两种格式', NOTE_KINDS.map((k) => k.id), ['md', 'rich']);
eq('标签与后缀对得上', NOTE_KINDS.map((k) => k.ext), ['md', 'rich']);

console.log('\n== 拆文件');
const withCss = `<style>\nh1 { color: gold; }\n</style>\n<h1>标题</h1>\n<p>正文</p>`;
eq('抽出这篇的 CSS', splitRich(withCss).css, 'h1 { color: gold; }');
eq('剩下的就是正文', splitRich(withCss).html, '<h1>标题</h1>\n<p>正文</p>');

const noCss = '<h1>标题</h1>\n<p>正文</p>';
eq('没有 style 时 CSS 为空', splitRich(noCss).css, '');
eq('没有 style 时正文原样', splitRich(noCss).html, noCss);

const twoStyles = '<style>a{color:red}</style><p>x</p><style>b{color:blue}</style>';
eq('多个 style 都抽走', splitRich(twoStyles).css, 'a{color:red}\nb{color:blue}');
eq('多个 style 抽完只剩正文', splitRich(twoStyles).html, '<p>x</p>');

eq('空文件 → 全空', splitRich(''), { css: '', html: '' });
eq('只有空白 → 全空', splitRich('  \n\n  '), { css: '', html: '' });
// 空 <style> 不该留下空串以外的垃圾
eq('空 style 块', splitRich('<style></style><p>a</p>'), { css: '', html: '<p>a</p>' });
// 属性带空格 / 大写标签都得认
eq('带属性的 style', splitRich('<STYLE type="text/css">i{color:red}</STYLE><p>a</p>').css, 'i{color:red}');

console.log('\n== 合文件');
eq('有 CSS 时写在最前面', joinRich('h1{color:gold}', '<h1>t</h1>'), '<style>\nh1{color:gold}\n</style>\n<h1>t</h1>\n');
eq('没 CSS 就不写空 style', joinRich('', '<h1>t</h1>'), '<h1>t</h1>\n');
eq('只有 CSS 没有正文', joinRich('a{color:red}', ''), '<style>\na{color:red}\n</style>\n');
eq('两头都空 → 空文件', joinRich('', ''), '');
eq('CSS 外的空白不算数', joinRich('  \n h1{color:gold} \n ', '<p>a</p>'), '<style>\nh1{color:gold}\n</style>\n<p>a</p>\n');

// 拆了再合必须回到原样 —— 否则「打开再保存」这种没改动的动作都会产生 diff
const round = joinRich(splitRich(withCss).css, splitRich(withCss).html);
eq('拆→合 回到原样', round, withCss + '\n');
eq('再拆一次还一样', splitRich(round), splitRich(withCss));
ok('合出来的东西是幂等的', joinRich(splitRich(round).css, splitRich(round).html) === round);

console.log('\n== 圈作用域');
eq('没 CSS 就不注入', scopedCss(''), '');
eq('只有空白也不注入', scopedCss('   \n '), '');
eq('包进 @scope', scopedCss('h1{color:gold}'), `@scope (.${RICH_SCOPE}) {\nh1{color:gold}\n}\n`);
ok('锚点就是渲染容器的类名', scopedCss('a{}').startsWith(`@scope (.${RICH_SCOPE})`));
// @scope 内的选择器不加特异性 —— 所以默认样式必须躺在 @layer base 里才压不垮用户
ok('不写成 .rich-scope h1 那种前缀（那会压死用户样式）', !scopedCss('h1{}').includes('.rich-scope h1'));
ok('占位提示交代了 :scope', CSS_HINT.includes(':scope'));

console.log('\n== 转义与初始正文');
eq('转义尖括号', escapeHtml('<b>&"\'') , '&lt;b&gt;&amp;&quot;&#39;');
// 标题里带 <> 时不能把文档结构撑坏
eq('标题当 H1 并转义', richBody('a<b>c'), '<h1>a&lt;b&gt;c</h1>\n<p><br></p>\n');
eq('空标题只留空段落', richBody('   '), '<p><br></p>\n');
eq('空文档就是空段落', emptyDoc(), '<p><br></p>\n');
ok('空段落里有 <br>（不然点不进去）', emptyDoc().includes('<br>'));

console.log('\n== 清洗（Node 下无 DOMParser，应原样放过而不是炸）');
eq('无 DOM 时降级放过', sanitizeHtml('<p>a</p>'), '<p>a</p>');
eq('无 DOM 时空串还是空串', sanitizeHtml(''), '');

console.log('\n== 主题预设');
eq('第一项是清空', RICH_PRESETS[0].id, 'plain');
eq('清空项真的没 CSS', RICH_PRESETS[0].css, '');
ok('预设都有中文名和说明', RICH_PRESETS.every((p) => p.label.length > 0 && p.hint.length > 0));
ok('预设 id 不重复', new Set(RICH_PRESETS.map((p) => p.id)).size === RICH_PRESETS.length);
ok('除清空项外都有 CSS', RICH_PRESETS.slice(1).every((p) => p.css.trim().length > 0));
// 预设是写进用户文档里的内容，必须能安全地过一圈拆合
for (const p of RICH_PRESETS) {
  const back = splitRich(joinRich(p.css, '<p>x</p>')).css;
  eq(`「${p.label}」拆合不掉字`, back, p.css.trim());
}
// 都用了 :scope 才顾得住"只影响这一篇"
ok('预设都用 :scope 起手', RICH_PRESETS.slice(1).every((p) => p.css.includes(':scope')));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
