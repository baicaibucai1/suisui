// 工具栏「源码模式」的编辑逻辑覆盖。mdkit.ts 是零依赖纯函数，Node 24 可直接 import：
//   node tests/mdkit.test.mjs
import {
  activeFromText,
  applyTool,
  insertCodeBlock,
  insertHr,
  insertLink,
  lineEndOf,
  lineStartOf,
  parseLine,
  setHeading,
  toggleBlock,
  wrapInline,
} from '../src/lib/mdkit.ts';

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

/** 断言「改写后的文本 + 选区」都符合预期 */
const edit = (label, got, wantText, wantStart, wantEnd) => {
  if (got.text !== wantText) {
    fail++;
    console.log(`  ✗ ${label}\n      文本得到 ${JSON.stringify(got.text)}\n      期望   ${JSON.stringify(wantText)}`);
    return;
  }
  if (got.start !== wantStart || got.end !== wantEnd) {
    fail++;
    console.log(
      `  ✗ ${label}\n      选区得到 [${got.start},${got.end}]\n      期望   [${wantStart},${wantEnd}]`,
    );
    return;
  }
  pass++;
  console.log(`  ✓ ${label}`);
};

console.log('\n== 行定位');
const doc = 'abc\ndefg\nhi'; // 长度 11
eq('lineStartOf 行中', lineStartOf(doc, 6), 4);
eq('lineStartOf 行首', lineStartOf(doc, 4), 4);
eq('lineStartOf 首行', lineStartOf(doc, 1), 0);
eq('lineEndOf 行中', lineEndOf(doc, 6), 8);
eq('lineEndOf 末行到文档尾', lineEndOf(doc, 10), 11);

console.log('\n== parseLine 认得各种块标记');
eq('标题', parseLine('## 标题').kind, 'heading');
eq('标题级别', parseLine('### x').level, 3);
eq('标题正文起点', parseLine('## 标题').contentStart, 3);
eq('无序列表 -', parseLine('- a').kind, 'bullet');
eq('无序列表 *', parseLine('* a').kind, 'bullet');
eq('无序列表 +', parseLine('+ a').kind, 'bullet');
eq('有序列表带点', parseLine('12. a').kind, 'ordered');
eq('有序列表带括号', parseLine('3) a').kind, 'ordered');
eq('引用', parseLine('> a').kind, 'quote');
eq('引用无空格：>a 的正文在 1', parseLine('>a').contentStart, 1);
eq('普通文本', parseLine('随便写点').kind, 'text');
// `##` 后必须有空格，否则 #话题 会被误判成标题
eq('井号无空格不是标题', parseLine('##没有空格').kind, 'text');
eq('列表缩进保留', parseLine('  - a').indent, '  ');
// 4 空格缩进在 md 里是代码块，不是标题
eq('四空格不算标题', parseLine('    # x').kind, 'text');

console.log('\n== 标题');
edit('正文 → H2', setHeading('hello', 0, 5, 2), '## hello', 3, 8);
edit('H2 → H1：整行选中仍是整行', setHeading('## hello', 0, 8, 1), '# hello', 0, 7);
edit('H1 → 正文', setHeading('# hello', 0, 7, 0), 'hello', 0, 5);
edit('取消标题不碰列表', setHeading('- a', 0, 3, 0), '- a', 0, 3);
edit('列表 → 标题（标记被替换而非叠加）', setHeading('- a', 0, 3, 2), '## a', 0, 4);
edit('引用 → 标题', setHeading('> a', 0, 3, 1), '# a', 0, 3);
edit('空行不插标题', setHeading('a\n\nb', 0, 4, 1), '# a\n\n# b', 2, 8);
// 多行：只作用到选区覆盖的行
edit('多行一起变标题', setHeading('a\nb\nc', 0, 5, 1), '# a\n# b\n# c', 2, 11);
// 选区在第二行中间，行首加了 `## ` 后光标要右移 3
edit('选区位置随前缀右移', setHeading('aaa\nbbb', 5, 6, 2), 'aaa\n## bbb', 8, 9);
// 这一格是关键回归：第 1 行变长会把第 2 行整体推右，映射必须把这部分位移算进去
edit('多行时后面几行的位移要累计', setHeading('a\nbb', 0, 4, 1), '# a\n# bb', 2, 8);

console.log('\n== 列表 / 引用（整块翻转）');
edit('正文 → 无序', toggleBlock('a', 0, 0, 'bullet'), '- a', 2, 2);
edit('无序 → 取消', toggleBlock('- a', 2, 3, 'bullet'), 'a', 0, 1);
edit('无序 → 有序（换标记不叠加）', toggleBlock('- a', 0, 3, 'ordered'), '1. a', 0, 4);
// 选中态下加前缀，结果选区跟着正文走（不含新加的标记）
edit('多行有序自动编号', toggleBlock('a\nb\nc', 0, 5, 'ordered'), '1. a\n2. b\n3. c', 3, 14);
edit('正文 → 引用', toggleBlock('a', 0, 0, 'quote'), '> a', 2, 2);
edit('引用 → 取消', toggleBlock('> a', 2, 3, 'quote'), 'a', 0, 1);
// 一半一半时整块转过去，不做翻烙饼
edit('混合块统一转列表', toggleBlock('- a\nb', 0, 5, 'bullet'), '- a\n- b', 0, 7);
edit('空行保留', toggleBlock('a\n\nb', 0, 4, 'bullet'), '- a\n\n- b', 2, 8);
edit('保留缩进', toggleBlock('  a', 0, 3, 'bullet'), '  - a', 0, 5);

console.log('\n== 行内包裹');
edit('加粗选中', wrapInline('hello world', 6, 11, '**'), 'hello **world**', 8, 13);
edit('空选区插一对', wrapInline('ab', 1, 1, '**'), 'a****b', 3, 3);
edit('再点一次取消（光标在词内）', wrapInline('a **b** c', 4, 5, '**'), 'a b c', 2, 3);
edit('再点一次取消（整块选中）', wrapInline('**b**', 2, 3, '**'), 'b', 0, 1);
edit('选区自带标记则剥掉', wrapInline('**b**', 0, 5, '**'), 'b', 0, 1);
edit('斜体', wrapInline('ab', 0, 1, '*'), '*a*b', 1, 2);
// `**a**` 用 `*` 切会变成 `*a*` —— 这是错判，要挡住
edit('单星号不吃掉双星号', wrapInline('**a**', 2, 3, '*'), '***a***', 3, 4);
edit('删除线', wrapInline('ab', 0, 2, '~~'), '~~ab~~', 2, 4);
edit('行内代码', wrapInline('ab', 0, 2, '`'), '`ab`', 1, 3);
// 反引号里的内容不该被再加一层转义
edit('代码里的星号照样能加粗', wrapInline('`a*b`', 0, 5, '**'), '**`a*b`**', 2, 7);

console.log('\n== 链接');
edit('选中文字加链接', insertLink('hello', 0, 5, 'https://a.com'), '[hello](https://a.com)', 0, 22);
edit('空选区给一对 [] 并选中中间', insertLink('ab', 1, 1, 'u'), 'a[](u)b', 2, 2);
edit('已选中链接文本 → 只换地址', insertLink('[hello](old)', 1, 6, 'new'), '[hello](new)', 1, 6);
eq('地址两侧空白被吃掉', insertLink('ab', 0, 1, '  u  ').text, '[a](u)b');

console.log('\n== 块级插入');
edit('分割线', insertHr('a', 1, 1), 'a\n\n---\n\n', 8, 8);
edit('段尾插分割线不黏行', insertHr('a\nb', 3, 3), 'a\nb\n\n---\n\n', 10, 10);
edit('代码块包住选中', insertCodeBlock('abc', 0, 3), '```\nabc\n```\n\n', 13, 13);
edit('空选区光标进围栏中间', insertCodeBlock('', 0, 0), '```\n\n```\n\n', 4, 4);
// 段中插入：前后各补一个空行，别和邻居黏成一行
edit('段中插分割线', insertHr('x\ny', 1, 1), 'x\n\n---\n\ny', 7, 7);

console.log('\n== 状态读取');
eq('H2 行', activeFromText('## a', 4).h, 2);
eq('正文', activeFromText('a', 1).h, 0);
eq('无序列表行', activeFromText('x\n- a', 4).bullet, true);
eq('引用行', activeFromText('> a', 2).quote, true);
eq('有序列表行', activeFromText('1. a', 3).ordered, true);
eq('混合块只认当前行', activeFromText('- a\nb', 5).bullet, false);

console.log('\n== applyTool 分发');
eq('未知 id 返回 null', applyTool('a', 0, 1, 'nope'), null);
eq('h2 走对分支', applyTool('a', 0, 1, 'h2').text, '## a');
eq('bold 走对分支', applyTool('a', 0, 1, 'bold').text, '**a**');
eq('link 吃到 payload', applyTool('a', 0, 1, 'link', 'u').text, '[a](u)');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
