// [[双链]] 与 #标签 的解析覆盖。links.ts 是零依赖纯函数，Node 24 可直接 import：
//   node tests/links.test.mjs
//
// 这里验的是「读」这一侧 —— 写完的东西还能被认出来、且不该被认出来的没被误认。
// 真正在编辑器里点得动是 e2e 的事（tests/link-e2e.mjs）。
import {
  backlinksOf,
  contextOf,
  dirOf,
  noteNameOf,
  outgoingOf,
  parseTags,
  parseWiki,
  resolveWiki,
  splitWiki,
  stripCode,
  suggestNotes,
  tagIndex,
  tagsOf,
  titleOf,
  unescapeWiki,
} from '../src/lib/links.ts';

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

console.log('\n== 拆内层：[[笔记#小节|显示]]');
eq('只有名字', splitWiki('开张'), { target: '开张', heading: '', display: '' });
eq('带小节', splitWiki('开张#第二段'), { target: '开张', heading: '第二段', display: '' });
eq('带显示文字', splitWiki('开张|去看'), { target: '开张', heading: '', display: '去看' });
eq('两样都有', splitWiki('开张#第二段|去看'), { target: '开张', heading: '第二段', display: '去看' });
eq('小节自己带空格', splitWiki('开张 # 第二段'), { target: '开张', heading: '第二段', display: '' });
eq('空名字 → 空 target', splitWiki('  '), { target: '', heading: '', display: '' });

console.log('\n== 找链接');
{
  const ls = parseWiki('今天读到 [[开张]]，想起 [[昨日#第二段]] 和 [[随手|那篇]]。');
  eq('三条', ls.length, 3);
  eq('第一条', [ls[0].target, ls[0].heading, ls[0].display], ['开张', '', '']);
  eq('第二条带小节', [ls[1].target, ls[1].heading], ['昨日', '第二段']);
  eq('第三条带显示', [ls[2].target, ls[2].display], ['随手', '那篇']);
  eq('区间对得上（含方括号）', ls[0].raw, '[[开张]]');
  eq('第二条起点', ls[0].to < ls[1].from, true);
}
eq('没链接 → 空', parseWiki('一句普通的话。'), []);
eq('只有半个括号不算', parseWiki('半个 [[开张 没闭合'), []);
eq('反着的括号不算', parseWiki(']]这样[['), []);
eq('空括号不算', parseWiki('[[]]'), []);
eq('跨行的不算', parseWiki('[[开\n张]]'), []);
eq('同一篇引两次都在', parseWiki('[[开张]] 又 [[开张]]').length, 2);

console.log('\n== 代码块里不长链接');
{
  const md = '正文 [[真的]]。\n\n```\n示例 [[假的]]\n```\n\n行内 `[[也不算]]`。';
  eq('只认正文那条', parseWiki(md).map((l) => l.target), ['真的']);
  // 位置必须还是原文里的位置 —— stripCode 不能挪动字符
  const hit = parseWiki(md)[0];
  eq('位置没被涂改', md.slice(hit.from, hit.to), '[[真的]]');
  eq('stripCode 长度不变', stripCode(md).length, md.length);
  eq('围栏内被涂掉', stripCode('```\nabc\n```').trim(), '');
}

console.log('\n== 找标签');
eq('中文标签', parseTags('今天 #灵感 来了').map((t) => t.tag), ['灵感']);
eq('多个', parseTags('#读书 #读书 #写作').map((t) => t.tag), ['读书', '读书', '写作']);
eq('去重后', tagsOf('#读书 #读书 #写作'), ['读书', '写作']);
eq('层级标签', parseTags('#读书/笔记').map((t) => t.tag), ['读书/笔记']);
eq('英文与数字混', parseTags('#todo2 #a_b').map((t) => t.tag), ['todo2', 'a_b']);
eq('行首也算', parseTags('#开头').map((t) => t.tag), ['开头']);

console.log('\n== 这些不是标签');
eq('# 空格 是标题', parseTags('# 标题'), []);
eq('## 是二级标题', parseTags('## 小节'), []);
eq('##紧贴字也不是', parseTags('##小节'), []);
eq('### 更不是', parseTags('###三级'), []);
eq('纯数字不是', parseTags('#2026'), []);
eq('hex 色值不是', parseTags('#fff #f0f0f0 #abc'), []);
eq('URL 里的锚点不是', parseTags('https://a.com/x#top'), []);
eq('英文词里的 # 不是', parseTags('c#tag'), []);
eq('链接里的小节不是', parseTags('[[开张#第二段]]'), []);
eq('代码块里的不是', parseTags('`#真的不是`'), []);
eq('标签能挨着标点', parseTags('（#括号 后').map((t) => t.tag), ['括号']);

console.log('\n== 名字 → 路径');
{
  const paths = ['notes/2026-09-21-开张.md', 'thoughts/2026-09-20-昨日.md', 'drafts/a.md'];
  eq('按文件名命中', resolveWiki('开张', paths), 'notes/2026-09-21-开张.md');
  eq('带路径命中', resolveWiki('thoughts/2026-09-20-昨日', paths), 'thoughts/2026-09-20-昨日.md');
  eq('带后缀也命中', resolveWiki('notes/2026-09-21-开张.md', paths), 'notes/2026-09-21-开张.md');
  eq('大小写不敏感', resolveWiki('A', paths), 'drafts/a.md');
  eq('找不到 → null', resolveWiki('没有这篇', paths), null);
  eq('空串 → null', resolveWiki('', paths), null);
  // 文件名是「日期-标题」，但人写链接只会写标题 —— 这一档必须能兜住
  eq('按标题命中（去掉日期前缀）', resolveWiki('昨日', paths), 'thoughts/2026-09-20-昨日.md');
  eq(
    '同名多篇优先同目录',
    resolveWiki('开张', ['thoughts/开张.md', 'notes/开张.md'], 'notes'),
    'notes/开张.md',
  );
  eq(
    '同目录没有就取第一个',
    resolveWiki('开张', ['thoughts/开张.md', 'notes/开张.md'], 'drafts'),
    'thoughts/开张.md',
  );
}

console.log('\n== 名字与目录');
eq('去目录去后缀', noteNameOf('thoughts/2026-09-21-雨天.md'), '2026-09-21-雨天');
eq('没有目录', noteNameOf('a.md'), 'a');
eq('目录', dirOf('notes/2026/a.md'), 'notes/2026');
eq('没有目录时是空串', dirOf('a.md'), '');

console.log('\n== 标题（名字去掉日期前缀）');
eq('去掉日期', titleOf('thoughts/2026-09-21-开张.md'), '开张');
eq('没有日期前缀就原样', titleOf('notes/开张.md'), '开张');
eq('日期不像日期就不动', titleOf('notes/2026-9-1-开张.md'), '2026-9-1-开张');

console.log('\n== 出链：指到了没有');
{
  const paths = ['notes/开张.md', 'thoughts/昨日.md'];
  const out = outgoingOf('看 [[开张]] 和 [[没有的]] 还有 [[开张]]', paths);
  eq('同名只算一条', out.length, 2);
  eq('指到的有路径', out[0].path, 'notes/开张.md');
  eq('没指到的是 null', out[1].path, null);
}

console.log('\n== 反向链接');
{
  const files = {
    'notes/2026-09-21-开张.md': '# 开张\n\n第一篇。\n',
    'thoughts/昨日.md': '昨天写了 [[开张]]，又提了一次 [[开张#第二段]]。',
    'drafts/草稿.md': '这里没链。',
  };
  const back = backlinksOf(files, 'notes/2026-09-21-开张.md');
  eq('只有一篇引了它', back.length, 1);
  eq('来源', back[0].from, 'thoughts/昨日.md');
  eq('引了两次都留着', back[0].hits.length, 2);
  eq('不把自己算进来', backlinksOf(files, 'thoughts/昨日.md').length, 0);
  // 文件名带日期前缀，但引用方写的是标题 —— 这也得算指向它
  eq('按文件名写也能认出', backlinksOf({ ...files, 'a.md': '[[2026-09-21-开张]]' }, 'notes/2026-09-21-开张.md').length, 2);
}

console.log('\n== 标签索引');
{
  const files = {
    'a.md': '#读书 也 #写作',
    'b.md': '#读书',
    'c.md': '什么都没有',
  };
  const idx = tagIndex(files);
  eq('读书两篇', idx.get('读书'), ['a.md', 'b.md']);
  eq('写作一篇', idx.get('写作'), ['a.md']);
  eq('没标签的不进索引', idx.has('没有'), false);
}

console.log('\n== 补全候选');
{
  const paths = [
    'thoughts/2026-09-21-开张.md',
    'notes/2026-09-21-随手.md',
    'notes/2026-09-20-开张筹备.md',
    'drafts/a.md',
  ];
  eq('空查询给前几篇', suggestNotes('', paths).length, 4);
  eq('精确名排最前', suggestNotes('开张', paths)[0], 'thoughts/2026-09-21-开张.md');
  eq('包含就入选', suggestNotes('开张', paths).length, 2);
  eq('查不到 → 空', suggestNotes('完全没有', paths), []);
  eq('上限生效', suggestNotes('', paths, 2).length, 2);
}

console.log('\n== 保存回来时把转义吃回去');
// 所见即所得把 `[[` 序列化成 `\[\[` —— 不还原的话磁盘上那串字就不再是链接了
eq('还原成对左括号', unescapeWiki('想起 \\[\\[开张]]'), '想起 [[开张]]');
eq('左右都还原', unescapeWiki('\\[\\[a\\]\\]'), '[[a]]');
eq('单个反斜杠不动', unescapeWiki('转义 \\[ 是这个意思'), '转义 \\[ 是这个意思');
eq('没有转义就原样', unescapeWiki('[[开张]] #灵感'), '[[开张]] #灵感');
eq('还原之后还能被认出来', parseWiki(unescapeWiki('\\[\\[开张]]')).map((l) => l.target), ['开张']);

console.log('\n== 上下文片段');
{
  const text = '前面一句话，中间是 [[开张]] 这个链接，后面还有话。';
  const link = parseWiki(text)[0];
  const c = contextOf(text, link, 6);
  eq('含链接本身', c.includes('[[开张]]'), true);
  eq('两边带省略号', c.startsWith('…') && c.endsWith('…'), true);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
