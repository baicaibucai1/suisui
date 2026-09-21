// 「哪些文件不该出现在左侧」的规则覆盖。visible.ts 是零依赖纯函数，Node 24 可直接 import：
//   node tests/visible.test.mjs
import { isProgramArtifact } from '../src/lib/visible.ts';

// 前 8 条就是 ramblings 仓库真实内容 —— 只有最后两条是"碎碎"本身
const cases = [
  ['.gitignore', true],
  ['drafts/.gitkeep', true],
  ['excerpts/.gitkeep', true],
  ['scripts/update-index.mjs', true],
  ['update.bat', true],
  ['README.md', true],
  ['notes/2026-09-21-随手.md', false],
  ['thoughts/2026-09-21-开张.md', false],

  // 点开头的任意一段
  ['.github/workflows/pages.yml', true],
  ['.obsidian/app.json', true],
  ['notes/.DS_Store', true],

  // 程序目录
  ['src/readme.md', true],
  ['tests/case.md', true],
  ['assets/封面.md', true],

  // 程序后缀（大小写不敏感）
  ['Update.BAT', true],
  ['notes/dump.json', true],
  ['SCRIPTS/x.md', true],
  ['thoughts/草稿.txt', false],

  // 根目录元文件 vs 子目录同名文件
  ['License', true],
  ['docs/README.md', false],

  // 正常的碎碎念
  ['2026-09-21.md', false],
  ['drafts/没写完的.md', false],
  ['excerpts/别人的话.md', false],
  ['notes/2026/09/21.md', false],
  ['随手记', false],
];

let pass = 0;
const fails = [];
for (const [path, expect] of cases) {
  const got = isProgramArtifact(path);
  if (got === expect) pass += 1;
  else fails.push(`${path}: 期望 ${expect ? '隐藏' : '显示'}，得到 ${got ? '隐藏' : '显示'}`);
}

console.log(`isProgramArtifact() 用例 ${pass}/${cases.length} 通过`);
if (fails.length) {
  console.log('\n失败：');
  for (const f of fails) console.log('  ✗', f);
  process.exit(1);
}
