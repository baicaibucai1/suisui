// 文件夹的覆盖。folders.ts 零依赖纯函数，Node 可直接 import：
//   node tests/folder.test.mjs
//
// 文件夹的落地方式是一个隐藏标识文件（.folder）：git 里空目录不存在，
// 网盘里空目录存在但和 git 行为不一致 —— 统一成"一个真实文件"两边才对得上。
// 所以这里重点验两件事：目录名清洗（别让人把 `../..` 或者 `C:\` 写进路径），
// 以及"空目录能被推出来"（那条只有一个标识文件的目录必须出现在树里）。
import {
  FOLDER_FILE,
  ancestorsOf,
  buildTree,
  countInDir,
  createFolder,
  dirName,
  dirsOf,
  folderBody,
  folderFileOf,
  isFolderFile,
  normalizeDir,
  removeDir,
} from '../src/lib/folders.ts';

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

console.log('\n— 目录名清洗 —');
eq('正常目录', normalizeDir('notes'), 'notes');
eq('多层', normalizeDir('notes/2026/09'), 'notes/2026/09');
eq('反斜杠也当分隔符', normalizeDir('notes\\2026'), 'notes/2026');
eq('首尾斜杠去掉', normalizeDir('/notes/'), 'notes');
eq('重复斜杠合并', normalizeDir('notes//2026'), 'notes/2026');
eq('空段去掉', normalizeDir('notes///2026'), 'notes/2026');
eq('. 段去掉', normalizeDir('./notes/.'), 'notes');
eq('.. 会被丢掉（不许跳出库）', normalizeDir('notes/../../etc'), 'notes/etc');
eq('纯 .. 什么都不剩', normalizeDir('../..'), '');
eq('空输入', normalizeDir(''), '');
eq('只有斜杠', normalizeDir('///'), '');
eq('只剩空白', normalizeDir('   '), '');
eq('Windows 非法字符清掉', normalizeDir('no:tes*'), 'notes');
eq('竖线引号也清掉', normalizeDir('a|b"c<d>e?f'), 'abcdef');
eq('目录名末尾的点去掉', normalizeDir('notes.'), 'notes');
eq('中文保留', normalizeDir('读书笔记/2026'), '读书笔记/2026');
ok('超长段被截断', normalizeDir('x'.repeat(200)).length === 60, String(normalizeDir('x'.repeat(200)).length));

console.log('\n— 标识文件 —');
eq('标识文件路径', folderFileOf('notes/2026'), `notes/2026/${FOLDER_FILE}`);
eq('目录非法就没有标识文件', folderFileOf('../..'), '');
eq('认得出标识文件', isFolderFile(`a/${FOLDER_FILE}`), true);
eq('普通文件不是', isFolderFile('a/b.md'), false);
eq('名字像但不是', isFolderFile('a/folder.md'), false);
eq('目录显示名', dirName('notes/2026/09'), '09');
ok('正文里带目录名', folderBody('读书笔记').includes('# 读书笔记'));
ok('正文说明了删掉会怎样', folderBody('x').includes('消失'));

console.log('\n— 建文件夹 —');
const r1 = createFolder({}, 'notes/2026');
eq('建出来的是目录', r1?.dir, 'notes/2026');
eq('落了一个标识文件', Object.keys(r1.files), ['notes/2026/' + FOLDER_FILE]);
ok('标识文件有内容', (r1.files['notes/2026/' + FOLDER_FILE] ?? '').length > 0);
eq('非法输入返回 null', createFolder({}, '../..'), null);
eq('空输入返回 null', createFolder({}, '  '), null);
const already = { ['a/' + FOLDER_FILE]: '我改过的说明' };
const r2 = createFolder(already, 'a');
eq('已存在时不覆盖（幂等）', r2.files['a/' + FOLDER_FILE], '我改过的说明');
eq('不改动原对象', already['a/' + FOLDER_FILE], '我改过的说明');

console.log('\n— 目录推导：空目录必须还在 —');
eq('从文件路径推目录', dirsOf(['notes/a.md']), ['notes']);
eq('推中间层', dirsOf(['a/b/c.md']), ['a', 'a/b']);
eq('只有标识文件也能推出来', dirsOf(['空的/' + FOLDER_FILE]), ['空的']);
eq('根目录文件不产生目录', dirsOf(['readme.md']), []);
eq('去重', dirsOf(['a/1.md', 'a/2.md']), ['a']);
ok('结果有序', JSON.stringify(dirsOf(['b/1.md', 'a/1.md'])) === JSON.stringify(['a', 'b']));

console.log('\n— 删文件夹 —');
const withDir = {
  'notes/a.md': 'A',
  'notes/b.md': 'B',
  ['notes/' + FOLDER_FILE]: 'mark',
  'thoughts/c.md': 'C',
};
const rd = removeDir(withDir, 'notes');
eq('删掉前缀下所有文件', rd.removed, ['notes/' + FOLDER_FILE, 'notes/a.md', 'notes/b.md']);
eq('别的目录不动', Object.keys(rd.files), ['thoughts/c.md']);
eq('非法输入什么都不删', removeDir(withDir, '../..').removed, []);
eq('删不存在的目录也没事', removeDir(withDir, 'nope').removed, []);
eq('原对象没被改动', Object.keys(withDir).length, 4);
eq('目录里除标识外有几个文件', countInDir(withDir, 'notes'), 2);
eq('空目录算 0 个', countInDir({ ['x/' + FOLDER_FILE]: 'm' }, 'x'), 0);

console.log('\n— 建树 —');
const t = buildTree(['readme.md', 'notes/a.md', 'notes/sub/b.md', 'thoughts/c.md']);
eq('根目录文件', t.files, ['readme.md']);
eq('一级目录（按名排）', t.dirs.map((d) => d.path), ['notes', 'thoughts']);
eq('notes 下的文件', t.dirs[0].files, ['notes/a.md']);
eq('嵌套目录', t.dirs[0].dirs.map((d) => d.path), ['notes/sub']);
eq('嵌套目录里的文件', t.dirs[0].dirs[0].files, ['notes/sub/b.md']);
eq('目录名是最后一段', t.dirs[0].dirs[0].name, 'sub');
eq('空列表也能建', buildTree([]).dirs, []);
const deep = buildTree(['a/b/c/d.md']);
eq('中间层自动补出来', deep.dirs[0].dirs[0].path, 'a/b');
eq('中间层没有文件', deep.dirs[0].dirs[0].files, []);
eq('文件挂在最深那层，且是完整路径', deep.dirs[0].dirs[0].dirs[0].files, ['a/b/c/d.md']);

console.log('\n— 展开到目标目录 —');
eq('祖先链', ancestorsOf('a/b/c'), ['a', 'a/b', 'a/b/c']);
eq('一层就一个', ancestorsOf('notes'), ['notes']);
eq('非法输入没有祖先', ancestorsOf('../..'), []);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
