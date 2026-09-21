// 「创建笔记」命名规则的覆盖。note.ts 是零依赖纯函数，Node 24 可直接 import：
//   node tests/note.test.mjs
import {
  NOTE_DIRS,
  dedupePath,
  localDate,
  localTime,
  noteBody,
  notePath,
  slugifyNoteTitle,
} from '../src/lib/note.ts';

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

// 固定一个本地时刻，避免测试跟着系统时区飘
const T = new Date(2026, 8, 21, 9, 5); // 2026-09-21 09:05 本地

console.log('\n== 日期与时刻（本地时区，不能用 UTC）');
eq('localDate', localDate(T), '2026-09-21');
eq('localTime 补零', localTime(T), '09-05');
eq('localTime 用 - 不用 :', localTime(new Date(2026, 0, 2, 23, 59)), '23-59');
// 晚上 23:30 跑，UTC 已经是第二天 —— toISOString 会写成 22 号
eq('深夜不跨天', localDate(new Date(2026, 8, 21, 23, 30)), '2026-09-21');

console.log('\n== 标题 → 文件名片段');
eq('中文原样保留', slugifyNoteTitle('雨天'), '雨天');
eq('空白收成 -', slugifyNoteTitle('  今天  有点  累 '), '今天-有点-累');
eq('保留中英混排', slugifyNoteTitle('读《人类简史》 chapter 3'), '读《人类简史》-chapter-3');
eq('删非法字符', slugifyNoteTitle('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
eq('删控制字符', slugifyNoteTitle('前\u0000面\u001f后'), '前面后');
eq('保留点和括号', slugifyNoteTitle('v1.2 (草稿)'), 'v1.2-(草稿)');
eq('首尾的点与横线去掉', slugifyNoteTitle('..--标题--..'), '标题');
eq('只有非法字符 → 空', slugifyNoteTitle('///'), '');
eq('只有空白 → 空', slugifyNoteTitle('   '), '');
eq('emoji 保留', slugifyNoteTitle('雨天 ☔ 散步'), '雨天-☔-散步');

const long = '标'.repeat(60);
eq('超长按码点截到 40', Array.from(slugifyNoteTitle(long)).length, 40);
// 40 个 emoji 是 80 个 UTF-16 码元，切错就会留下半个
const emoji = '☔'.repeat(60);
eq('emoji 不劈成半个', Array.from(slugifyNoteTitle(emoji)).length, 40);
eq('截断后不带尾巴横线', slugifyNoteTitle('字'.repeat(39) + ' 尾巴'), '字'.repeat(39));

console.log('\n== 落库路径');
eq('带标题', notePath('thoughts', '雨天', T), 'thoughts/2026-09-21-雨天.md');
eq('空标题退化成时刻', notePath('thoughts', '', T), 'thoughts/2026-09-21-09-05.md');
eq('标题全是非法字符也退化成时刻', notePath('notes', '///', T), 'notes/2026-09-21-09-05.md');
eq('目录带尾斜杠', notePath('notes/', '随手', T), 'notes/2026-09-21-随手.md');
eq('标题首尾空白不影响', notePath('excerpts', '  一句话  ', T), 'excerpts/2026-09-21-一句话.md');
eq('标题里的斜杠不会造出子目录', notePath('thoughts', '2026/09', T), 'thoughts/2026-09-21-202609.md');

console.log('\n== 重名不覆盖');
const taken = new Set(['thoughts/2026-09-21-雨天.md', 'thoughts/2026-09-21-雨天-2.md']);
eq('没重名时原样', dedupePath('thoughts/2026-09-21-晴.md', (p) => taken.has(p)), 'thoughts/2026-09-21-晴.md');
eq('重名 → -2', dedupePath('thoughts/2026-09-21-雨天.md', (p) => taken.has(p)), 'thoughts/2026-09-21-雨天-3.md');
eq('断续号也能加', dedupePath('notes/dump.md', (p) => p === 'notes/dump.md'), 'notes/dump-2.md');

console.log('\n== 初始正文');
eq('标题当 H1', noteBody('雨天'), '# 雨天\n\n');
eq('标题去空白', noteBody('  雨天  '), '# 雨天\n\n');
eq('空标题 → 空正文', noteBody(''), '');

console.log('\n== 目录表与 update-index.mjs 对齐');
const dirs = NOTE_DIRS.map((d) => d.dir);
eq('四个目录', dirs, ['thoughts', 'notes', 'excerpts', 'drafts']);
// 碎碎/scripts/update-index.mjs 的 SCAN_DIRS 就是这三个；drafts 刻意不进目录
eq('前三个进 README 目录', dirs.slice(0, 3), ['thoughts', 'notes', 'excerpts']);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
