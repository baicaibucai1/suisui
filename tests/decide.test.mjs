// 三路判定表的完整覆盖。decide.ts 是零依赖纯函数，Node 24 可直接 import（自带类型剥离）：
//   node tests/decide.test.mjs
import { decide } from '../src/lib/decide.ts';

const cases = [
  ['本地新增', 'A', undefined, undefined, 'push-new'],
  ['双方都有且相同', 'A', undefined, 'A', null],
  ['双方各自新增同名且不同', 'A', undefined, 'B', 'conflict'],
  ['完全一致', 'A', 'A', 'A', null],
  ['远端已删、本地未动', 'A', 'A', undefined, 'pull-del'],
  ['远端已删、本地也改过', 'A', 'B', undefined, 'conflict'],
  ['本地删除、远端未动', undefined, 'A', 'A', 'push-del'],
  ['本地删除、远端也改了', undefined, 'A', 'B', 'conflict'],
  ['远端新增', undefined, undefined, 'A', 'pull-new'],
  ['本地改动', 'B', 'A', 'A', 'push-mod'],
  ['远端改动', 'A', 'A', 'B', 'pull-mod'],
  ['两边改成一样', 'B', 'A', 'B', null],
  ['两边改成不同', 'B', 'A', 'C', 'conflict'],
  ['什么都没有', undefined, undefined, undefined, null],
];

let pass = 0;
const fails = [];
for (const [name, local, base, remote, expect] of cases) {
  const got = decide(local, base, remote);
  if (got === expect) pass += 1;
  else fails.push(`${name}: 期望 ${expect}，得到 ${got}`);
}

console.log(`decide() 用例 ${pass}/${cases.length} 通过`);
if (fails.length) {
  console.log('失败：\n' + fails.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
