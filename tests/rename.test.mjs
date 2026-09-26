// 改名 / 搬家的覆盖。两个模块都是零依赖纯函数，Node 可直接 import：
//   node tests/rename.test.mjs
//
// 这两件事最容易出错的地方都不在"能不能改"，而在**改完谁知道**：
//   · 目录改名是一整棵子树换前缀，漏掉一条就会有文件"留在原地"
//   · 双链是按名字找的（`[[随手]]` → `2026-09-21-随手.md`），名字一改，
//     库里所有指向它的链接当场悬空 —— 所以 retargetLinks 的每一条边界都要压住：
//     小节要留、显示文字要留、代码块里的不许动。
import {
  baseOf,
  canDrop,
  isDirPath,
  moveEntry,
  normalizeSeg,
  occupied,
  parentOf,
  renameEntry,
} from '../src/lib/folders.ts';
import {
  aliasesOf,
  retargetLinks,
  retargetLinksMap,
  retargetMap,
  retitleBody,
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
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra ? '   → ' + extra : ''}`);
  }
};
const step = (s) => console.log('\n== ' + s);

/** 每次都给一份干净的文件表，免得用例之间互相污染 */
const base = () => ({
  'thoughts/2026-09-21-开张.md': '# 开张\n\n第一篇。见 [[随手]]。\n',
  'notes/2026-09-21-随手.md': '# 随手\n\n记一笔。\n',
  '读书/2026/.folder': '# 2026\n\n标识文件。\n',
  '读书/2026/书评.md': '# 书评\n\n空。\n',
  'notes/图.png': 'iVBORw0KGgo=',
});

step('单个名字的净化');
eq('斜杠被删掉（分层不是这里能表达的需求）', normalizeSeg('读书/笔记'), '读书笔记');
eq('各平台非法字符清掉', normalizeSeg('a\\b:c*d?e"f<g>h|i'), 'abcdefghi');
eq('空名字不给过', normalizeSeg('   '), '');
eq('. 不给过', normalizeSeg('.'), '');
eq('.. 不给过（会跳出库）', normalizeSeg('..'), '');
eq('末尾的点去掉（Windows 会吞掉它）', normalizeSeg('笔记.'), '笔记');
eq('按码点截到 60 个字', Array.from(normalizeSeg('字'.repeat(80))).length, 60);
eq('emoji 不被劈成半个', normalizeSeg('🐱'.repeat(80)).endsWith('🐱'), true);
eq('正常名字原样保留', normalizeSeg(' 随手记 '), '随手记');

step('路径的拆解');
eq('parentOf 取目录', parentOf('notes/a.md'), 'notes');
eq('parentOf 根目录下是空串', parentOf('a.md'), '');
eq('baseOf 取最后一段', baseOf('读书/2026/书评.md'), '书评.md');
ok('有东西以它开头就是目录', isDirPath(base(), '读书/2026'));
ok('没有东西以它开头就不是目录', !isDirPath(base(), '读书/2027'));
ok('文件占着的算 occupied', occupied(base(), 'notes/图.png'));
ok('目录也算 occupied', occupied(base(), '读书/2026'));

step('改文件名');
{
  const f = base();
  const r = renameEntry(f, 'notes/2026-09-21-随手.md', '随笔');
  ok('成功', r.ok);
  eq('路径变了', r.ok ? r.to : null, 'notes/随笔.md');
  eq('后缀沿用原来的（没敲 .md 也还是笔记）', r.ok ? r.files['notes/随笔.md'] : null, '# 随手\n\n记一笔。\n');
  ok('老路径没了', r.ok ? !('notes/2026-09-21-随手.md' in r.files) : false);
  eq('只动了一条', r.ok ? r.moved : null, [{ from: 'notes/2026-09-21-随手.md', to: 'notes/随笔.md' }]);
  ok('别的文件一个字节没动', r.ok ? r.files['thoughts/2026-09-21-开张.md'] === f['thoughts/2026-09-21-开张.md'] : false);
}
{
  const r = renameEntry(base(), 'notes/2026-09-21-随手.md', '随笔.txt');
  eq('明确敲了别的后缀就听人的', r.ok ? r.to : null, 'notes/随笔.txt');
}
{
  const r = renameEntry(base(), 'notes/2026-09-21-随手.md', '2026-09-21-随手');
  ok('改成一模一样的名字 = 空操作', r.ok && r.moved.length === 0);
}
{
  const r = renameEntry(base(), 'notes/2026-09-21-随手.md', '图.png');
  ok('同级重名被挡住（不自动加 -2）', !r.ok);
  ok('错误话说清了', !r.ok && r.error.includes('图.png'));
}
{
  const r = renameEntry(base(), 'notes/2026-09-21-随手.md', 'a/b');
  ok('名字里带斜杠被挡住', !r.ok);
}
{
  const r = renameEntry(base(), 'notes/2026-09-21-随手.md', '   ');
  ok('空名字被挡住', !r.ok);
}
{
  const r = renameEntry(base(), '读书/2026/.folder', '2027');
  ok('标识文件不给单独改名', !r.ok);
}
{
  const r = renameEntry(base(), 'notes/图.png', '新图');
  eq('附件也能改名，后缀照旧', r.ok ? r.to : null, 'notes/新图.png');
}

step('改目录名（整棵子树换前缀）');
{
  const f = base();
  const r = renameEntry(f, '读书/2026', '2027');
  ok('成功', r.ok);
  eq('目录路径变了', r.ok ? r.to : null, '读书/2027');
  eq(
    '里面的东西一条不剩地跟着走',
    r.ok ? r.moved.map((m) => m.to).sort() : null,
    ['读书/2027/.folder', '读书/2027/书评.md'],
  );
  eq('标识文件的文件名不变（它必须是 .folder）', r.ok ? Object.keys(r.files).filter((p) => p.endsWith('/.folder')) : null, ['读书/2027/.folder']);
  ok('老前缀下什么都不剩', r.ok ? !Object.keys(r.files).some((p) => p.startsWith('读书/2026/')) : false);
  ok('别处不动', r.ok ? r.files['notes/图.png'] === f['notes/图.png'] : false);
}
{
  // 只有标识文件的空目录也要能改名 —— 这正是标识文件存在的理由
  const f = { '读书/2026/.folder': '# 2026\n' };
  const r = renameEntry(f, '读书/2026', '2027');
  eq('空目录照样改', r.ok ? Object.keys(r.files) : null, ['读书/2027/.folder']);
}
{
  // 改了名还想改回去：新路径上已经没有"自己"那一条了，所以不冲突
  const r1 = renameEntry(base(), '读书/2026', '2027');
  const r2 = renameEntry(r1.ok ? r1.files : {}, '读书/2027', '2026');
  ok('改回原名也成立', r2.ok && r2.to === '读书/2026');
}
{
  const r = renameEntry({ ...base(), '读书/2027/.folder': 'x' }, '读书/2026', '2027');
  ok('撞上已有目录被挡住', !r.ok);
}
{
  // 同级那个没后缀的文件正占着这个名字
  const r = renameEntry({ ...base(), '读书/LICENSE': 'x' }, '读书/2026', 'LICENSE');
  ok('撞上已有同名文件被挡住', !r.ok);
}
{
  // ⚠️ 改名只换**同级**的名字，不会顺手把人挪到别的目录去
  const r = renameEntry(base(), '读书/2026', 'notes');
  eq('敲了别处的目录名，也只是在同级换个叫法', r.ok ? r.to : null, '读书/notes');
}

step('搬家（名字不变）');
{
  const f = base();
  const r = moveEntry(f, 'notes/2026-09-21-随手.md', 'thoughts');
  eq('挪进别的目录', r.ok ? r.to : null, 'thoughts/2026-09-21-随手.md');
  ok('内容原样', r.ok ? r.files['thoughts/2026-09-21-随手.md'] === f['notes/2026-09-21-随手.md'] : false);
}
{
  const r = moveEntry(base(), 'notes/2026-09-21-随手.md', '');
  eq('挪到根目录', r.ok ? r.to : null, '2026-09-21-随手.md');
}
{
  const r = moveEntry(base(), 'notes/2026-09-21-随手.md', 'notes');
  ok('挪回原处 = 空操作', r.ok && r.moved.length === 0);
}
{
  const r = moveEntry({ ...base(), '读书/2026/图.png': 'x' }, 'notes/图.png', '读书/2026');
  ok('目标里已经有同名文件被挡住', !r.ok);
  ok('错误里点名了是哪个目录', !r.ok && r.error.includes('读书/2026'));
}
{
  const r = moveEntry(base(), '读书/2026', '读书/2026/子');
  ok('不能把文件夹挪进它自己里面', !r.ok);
  ok('错误说清了原因', !r.ok && r.error.includes('自己'));
}
{
  const r = moveEntry(base(), '读书/2026', '读书/2026');
  ok('挪进"自己"这个路径也算（同一层）', !r.ok);
}
{
  const r = moveEntry(base(), '读书/2026', 'thoughts');
  eq('整个目录挪走', r.ok ? Object.keys(r.files).filter((p) => p.startsWith('thoughts/2026/')).sort() : null, [
    'thoughts/2026/.folder',
    'thoughts/2026/书评.md',
  ]);
}
{
  const f = base();
  ok('拖到合法去处 canDrop 为真', canDrop(f, 'notes/2026-09-21-随手.md', 'thoughts'));
  ok('拖进自己里面 canDrop 为假', !canDrop(f, '读书/2026', '读书/2026/子'));
  ok('目标里重名 canDrop 为假', !canDrop({ ...f, '读书/2026/图.png': 'x' }, 'notes/图.png', '读书/2026'));
  // 拖回原处本身不算冲突，界面另外把它显示成"不是落点"（见 FileTree 的 hitTest）
  ok('拖回原处 canDrop 为真', canDrop(f, 'notes/2026-09-21-随手.md', 'notes'));
}
{
  // 搬家不带清理：旧的空目录壳（没有标识文件时）留不留全看文件表里还有没有别的东西
  const r = moveEntry({ 'a/b/x.md': 'x' }, 'a/b/x.md', '');
  eq('挪空一个目录后，那个目录自然从树里消失', Object.keys(r.files), ['x.md']);
}

step('别名：同一篇的几种写法');
eq(
  '全路径 / 去后缀 / 文件名 / 标题，四种都算',
  aliasesOf('notes/2026-09-21-随手.md'),
  ['notes/2026-09-21-随手.md', 'notes/2026-09-21-随手', '2026-09-21-随手', '随手'],
);
eq('没有日期前缀时不会重复列', aliasesOf('notes/随手.md'), ['notes/随手.md', 'notes/随手', '随手']);
eq('附件带后缀，别名各自不同', aliasesOf('notes/图.png'), ['notes/图.png', 'notes/图', '图']);

step('双链联动改写');
const AL = aliasesOf('notes/2026-09-21-随手.md');
eq('最平常的写法', retargetLinks('见 [[随手]]。', AL, '随笔'), { text: '见 [[随笔]]。', count: 1 });
eq('带小节名，小节要留着', retargetLinks('[[随手#开头]]', AL, '随笔'), { text: '[[随笔#开头]]', count: 1 });
eq('带显示文字，显示文字要留着', retargetLinks('[[随手|那段话]]', AL, '随笔'), {
  text: '[[随笔|那段话]]',
  count: 1,
});
eq('小节 + 显示文字一起', retargetLinks('[[随手#开头|那段话]]', AL, '随笔'), {
  text: '[[随笔#开头|那段话]]',
  count: 1,
});
eq('嵌入（![[ ]]) 也算指向它', retargetLinks('![[随手]]', AL, '随笔'), { text: '![[随笔]]', count: 1 });
eq('全路径写法', retargetLinks('[[notes/2026-09-21-随手.md]]', AL, '随笔'), {
  text: '[[随笔]]',
  count: 1,
});
eq('一篇里引了两次就改两处', retargetLinks('[[随手]] 和 [[随手#x]]', AL, '随笔'), {
  text: '[[随笔]] 和 [[随笔#x]]',
  count: 2,
});
eq('前后有空格的行内写法', retargetLinks('[[ 随手 ]]', AL, '随笔'), { text: '[[ 随笔 ]]', count: 1 });
eq('指别人的链接一个字不动', retargetLinks('[[开张]] 和 [[随手]]', AL, '随笔'), {
  text: '[[开张]] 和 [[随笔]]',
  count: 1,
});
eq('代码块里的示例不动（那是字，不是链接）', retargetLinks('```\n[[随手]]\n```', AL, '随笔'), {
  text: '```\n[[随手]]\n```',
  count: 0,
});
eq('行内代码里的也不动', retargetLinks('写 `[[随手]]` 这样', AL, '随笔'), {
  text: '写 `[[随手]]` 这样',
  count: 0,
});
eq('一个字都没引到就原样返回', retargetLinks('这里没有链接。', AL, '随笔'), {
  text: '这里没有链接。',
  count: 0,
});
eq('别名表空 = 不改', retargetLinks('[[随手]]', [], '随笔'), { text: '[[随手]]', count: 0 });
eq('新名字为空 = 不改（不能把链接改成空的）', retargetLinks('[[随手]]', AL, '   '), {
  text: '[[随手]]',
  count: 0,
});

step('正文标题联动');
eq('第一行就是标题 → 改', retitleBody('# 随手\n\n正文。\n', '随手', '随笔'), {
  text: '# 随笔\n\n正文。\n',
  changed: true,
});
eq('标题是自起的、和旧名不一样 → 不动（那是他写的东西）', retitleBody('# 我的碎念\n\n', '随手', '随笔'), {
  text: '# 我的碎念\n\n',
  changed: false,
});
eq('二级标题不算"这篇的标题"', retitleBody('## 随手\n', '随手', '随笔'), {
  text: '## 随手\n',
  changed: false,
});
eq('第一行不是标题就不动', retitleBody('正文\n# 随手\n', '随手', '随笔'), {
  text: '正文\n# 随手\n',
  changed: false,
});
eq('旧新同名 = 不用改', retitleBody('# 随手\n', '随手', '随手'), { text: '# 随手\n', changed: false });
eq('空正文不炸', retitleBody('', '随手', '随笔'), { text: '', changed: false });

/*
 * 保形改写。这一组是给「改目录名」和「搬家」兜底的：
 * 旧版一律把链接换成裸新名，遇到 `[[读书/2026/书评]]` 这种带路径的写法就露馅 ——
 * 改目录时它会把路径压没，搬家时（名字没变）它压根认不出这条链接要改。
 */
step('保形改写（改目录名 / 搬家不断链）');

const REN = retargetMap('notes/2026-09-21-随手.md', 'notes/随笔.md');
eq('全路径写法 → 全路径（不是压成裸名）', retargetLinksMap('见 [[notes/2026-09-21-随手]]。', REN), {
  text: '见 [[notes/随笔]]。',
  count: 1,
});
eq('带 .md 的全路径也认', retargetLinksMap('见 [[notes/2026-09-21-随手.md]]。', REN), {
  text: '见 [[notes/随笔.md]]。',
  count: 1,
});
eq('裸名写法 → 裸名', retargetLinksMap('见 [[随手]]。', REN), { text: '见 [[随笔]]。', count: 1 });
eq('小节 + 显示文字在新版里照样留着', retargetLinksMap('[[notes/2026-09-21-随手#开头|那段]]', REN), {
  text: '[[notes/随笔#开头|那段]]',
  count: 1,
});
eq('代码块里的不动（保形版也一样）', retargetLinksMap('`[[notes/随手]]`', REN), {
  text: '`[[notes/随手]]`',
  count: 0,
});

// 搬家：名字没变，只有全路径那种写法要跟着换目录
const MOV = retargetMap('notes/随手.md', 'thoughts/随手.md');
eq('搬家：全路径写法跟着换目录', retargetLinksMap('见 [[notes/随手]]。', MOV), {
  text: '见 [[thoughts/随手]]。',
  count: 1,
});
eq('搬家：裸名写法本来就没坏 → 一处都不算改', retargetLinksMap('见 [[随手]]。', MOV), {
  text: '见 [[随手]]。',
  count: 0,
});

/** 目录改名时 rewriteRefs 干的那件事：把整棵子树的改写表并起来 */
const subtreeMap = (files, from, to) => {
  const r = renameEntry(files, from, to);
  if (!r.ok) throw new Error(r.error);
  const map = new Map();
  for (const m of r.moved) {
    if (m.from.endsWith('/.folder')) continue;
    for (const [k, v] of retargetMap(m.from, m.to)) map.set(k, v);
  }
  return map;
};
const DIRMAP = subtreeMap(base(), '读书/2026', '2027');
eq('改目录名：子树里那篇的全路径链接跟着走', retargetLinksMap('见 [[读书/2026/书评]]。', DIRMAP), {
  text: '见 [[读书/2027/书评]]。',
  count: 1,
});
eq('改目录名：裸名链接不受影响（名字没变）', retargetLinksMap('见 [[书评]]。', DIRMAP), {
  text: '见 [[书评]]。',
  count: 0,
});
eq(
  '改目录名：别的目录下的同名文件不会被误伤',
  retargetLinksMap('见 [[读书/2026/书评]] 和 [[notes/书评]]。', DIRMAP).text,
  '见 [[读书/2027/书评]] 和 [[notes/书评]]。',
);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
