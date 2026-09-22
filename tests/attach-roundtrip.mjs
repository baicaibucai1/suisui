// 附件的**真实同步往返**：推一个 PNG 上去 → 按字节拉回来 → 比对 → 删掉。
//
//   node tests/attach-roundtrip.mjs
//
// ⚠️ 这个脚本会真的动远端仓库（`VITE_GH_REPO` 指向的那个，默认是私有的 ramblings）：
// 建一个 `_suisui-test/dot.png`，验完就删。中途失败也会在退出前尽力删掉。
// 之所以非得真跑一趟：附件那条路最怕的就是**静默损坏** ——
// 本地看着好好的，推上去变成一串 U+FFFD，而单测和浏览器 e2e 都碰不到真实网络。
//
// 单测（binary.test.mjs）验编解码，浏览器 e2e（attach-e2e.mjs）验界面，
// 这里验的是**最后那一公里：字节真的原样穿过 GitHub 回来了吗**。
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  createBlob,
  createCommit,
  createTree,
  getHead,
  listTree,
  readBlobBytes,
} from '../src/lib/gh.ts';
import { bytesToBase64 } from '../src/lib/binary.ts';

for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
  delete process.env[k];
}

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const cfg = {
  owner: env.VITE_GH_OWNER,
  repo: env.VITE_GH_REPO,
  branch: env.VITE_GH_BRANCH || 'main',
  token: env.VITE_GH_TOKEN,
};

const PATH = '_suisui-test/dot.png';
/** 1×1 的 PNG。小到可以写死在脚本里，又确实是合法二进制。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

/** git 的 blob 哈希，用来和远端给的 sha 对账 */
const gitSha = (buf) =>
  createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf]))
    .digest('hex');

/** 无论前面成不成，退出前都把这个测试文件从远端抹掉 */
const cleanup = async () => {
  try {
    const head = await getHead(cfg);
    const tree = await createTree(cfg, [{ path: PATH, sha: null }], head.treeSha);
    const commit = await createCommit(cfg, '碎碎：清理附件往返测试', tree, head.commitSha);
    const { updateRef } = await import('../src/lib/gh.ts');
    await updateRef(cfg, commit);
    console.log('\n  已清理远端测试文件');
  } catch (e) {
    console.log(`\n  ⚠ 清理失败，远端可能还留着 ${PATH}：${e?.message ?? e}`);
  }
};

const run = async () => {
  if (!cfg.token) {
    console.log('没有 VITE_GH_TOKEN —— 这是环境问题，不是 bug');
    process.exit(1);
  }
  console.log(`\n目标：${cfg.owner}/${cfg.repo}@${cfg.branch} 的 ${PATH}`);

  console.log('\n== 推上去');
  const head = await getHead(cfg);
  const blobSha = await createBlob(cfg, bytesToBase64(new Uint8Array(PNG)), 'base64');
  ok('建 blob 用的是 base64 编码', !!blobSha);
  // 关键断言：GitHub 存进去的是**解码后的字节**，所以 sha 必须等于本地按字节算的
  ok('远端 blob sha = 原始字节的 git sha', blobSha === gitSha(PNG), `${blobSha} vs ${gitSha(PNG)}`);

  const tree = await createTree(cfg, [{ path: PATH, sha: blobSha }], head.treeSha);
  const commit = await createCommit(cfg, '碎碎：附件往返测试', tree, head.commitSha);
  const { updateRef } = await import('../src/lib/gh.ts');
  await updateRef(cfg, commit);
  ok('提交成功', !!commit);

  console.log('\n== 按字节拉回来');
  // CDN 缓存：刚推完就列会拿回旧的 tree，重试几拍
  let listed = null;
  for (let i = 0; i < 6 && !listed; i++) {
    const h = await getHead(cfg);
    const { entries } = await listTree(cfg, h.treeSha);
    listed = entries.find((e) => e.path === PATH) ?? null;
    if (!listed) await new Promise((r) => setTimeout(r, 1200));
  }
  ok('远端列得到它', !!listed, listed ? '' : '等了 7 秒还没出现');
  if (!listed) {
    await cleanup();
    process.exit(1);
  }
  ok('远端那个 sha 也对得上', listed.sha === gitSha(PNG), `${listed.sha} vs ${gitSha(PNG)}`);

  const back = await readBlobBytes(cfg, listed.sha);
  ok('拉回来是同一份字节（一个字节都没变）', Buffer.compare(Buffer.from(back), PNG) === 0,
    `拉回 ${back.length} 字节，原 ${PNG.length} 字节`);
  ok('开头是 PNG 的魔数（没被 UTF-8 解坏）', back[0] === 0x89 && back[1] === 0x50,
    Array.from(back.slice(0, 4)).join(','));

  await cleanup();
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
};

run().catch(async (e) => {
  console.error(e);
  await cleanup();
  process.exit(1);
});
