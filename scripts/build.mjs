// 构建生产产物 —— 为什么要包一层，而不是直接 `vite build`：
//
//   `vite build` 的第一步是**清空 outDir**。如果这时有别的进程正在读 dist
//   （最常见的就是 preview 服务，或者宿主的预览面板还开着那个地址），
//   Windows 上会抛 `EPERM, Permission denied: dist\assets`，而且**删到一半才失败** ——
//   dist/assets 已经没了、index.html 还是旧的，等于把上一份能用的产物砸烂了，
//   日志里却只有一句"权限不足"。（这个坑踩过两次。）
//
// 所以改成「先构建到暂存目录 → 自检 → 再整体换掉 dist」：构建失败时 dist 原封不动。
//
// 本机还有两个 Windows 上的怪脾气，都绕开了（别"优化"掉）：
//   · 目录级 rename 会被拒（EPERM，换个目标名也一样；同一个名字 mkdir/rmdir 却是好的）
//     → 退化成「删掉旧的 + 整目录拷贝」
//   · 递归删除 180+ 个文件的目录会卡住不返回（不是报错，是**再也不返回**）
//     → 暂存目录改成逐个 unlink，且全程 best-effort：清不掉就留着（已 gitignore），绝不拖住构建
//
//   node scripts/build.mjs
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FINAL = join(root, 'dist');
const STAGING = join(root, '.dist-staging');

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;

/** 同步睡一会儿（懒得为几十毫秒上异步）。 */
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function bytesOf(dir) {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? bytesOf(p) : statSync(p).size;
  }
  return total;
}

/**
 * 逐个文件删，不用 rmSync 递归 —— 递归删大目录在这台机器上会永不返回。
 * 全程 best-effort：清不掉的留着，返回是否清干净。
 */
function cleanDir(dir) {
  let left = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        walk(p);
        try {
          rmdirSync(p);
        } catch {
          left++;
        }
      } else {
        try {
          unlinkSync(p);
        } catch {
          left++;
        }
      }
    }
  };
  walk(dir);
  try {
    rmdirSync(dir);
  } catch {
    left++;
  }
  return left === 0;
}

/** 删目录：多半是刚被别人松手，重试几次通常就过了。仍然失败就让调用方决定怎么办。 */
function removeWithRetry(dir, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    if (cleanDir(dir)) return true;
    if (i < tries) nap(220 * i);
  }
  return false;
}

// ── 1. 准备暂存目录 ──────────────────────────────────────────────
// 清不掉就换个名字，绝不因为"上一轮的残留"而构建不出来。
let staging = STAGING;
if (existsSync(staging) && !removeWithRetry(staging)) {
  staging = `${STAGING}-${Date.now()}`;
  console.log(`· 旧的 .dist-staging 清不掉，改用 ${staging.slice(root.length + 1)}`);
}

console.log('▶ 构建到暂存目录 …');
execFileSync(
  process.execPath,
  [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', staging.slice(root.length + 1)],
  { cwd: root, stdio: 'inherit' },
);

// ── 2. 产物自检：引用的资源必须都在 ────────────────────────────────
const indexHtml = readFileSync(join(staging, 'index.html'), 'utf8');
const refs = [...indexHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
if (!refs.length) throw new Error('index.html 里没有任何 /assets/ 引用 —— 产物不对');
const missing = refs.filter((r) => !existsSync(join(staging, r)));
if (missing.length) throw new Error(`产物缺文件: ${missing.join(', ')}`);

// ── 3. 换掉旧 dist ────────────────────────────────────────────────
removeWithRetry(FINAL);
try {
  renameSync(staging, FINAL);
} catch (err) {
  if (err.code !== 'EPERM') throw err;
  console.log('· rename 被拒（本机已知问题），改用拷贝');
  mkdirSync(FINAL, { recursive: true });
  cpSync(staging, FINAL, { recursive: true });
  if (!removeWithRetry(staging)) console.log(`· 残留 ${staging.slice(root.length + 1)}（已 gitignore，不影响使用）`);
}
console.log('✔ dist 已更新');

// ── 4. 报告（首屏引用了什么 / 最大的几个 chunk） ──────────────────
console.log('\n首屏引用：');
for (const r of refs) console.log(`  ${kb(statSync(join(FINAL, r)).size).padStart(8)}  ${r}`);

const js = readdirSync(join(FINAL, 'assets'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => [f, statSync(join(FINAL, 'assets', f)).size])
  .sort((a, b) => b[1] - a[1]);
console.log(`\n全部 chunk 共 ${js.length} 个，前 8 大：`);
for (const [n, z] of js.slice(0, 8)) console.log(`  ${kb(z).padStart(8)}  ${n}`);

const firstScreen = refs.filter((r) => r.endsWith('.js')).reduce((s, r) => s + statSync(join(FINAL, r)).size, 0);
console.log(`\n首屏 JS 合计 ${kb(firstScreen)}　产物合计 ${kb(bytesOf(FINAL))}`);
