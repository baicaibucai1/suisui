// 三路比对同步引擎：上次快照 / 本地文件 / 远端 sha。
// 一次同步只产生一个 commit；冲突绝不静默丢字（远端版本另存 .conflict-日期.md 副本）。

import {
  blobSha,
  createBlob,
  createCommit,
  createTree,
  getHead,
  listTree,
  normalizeText,
  readBlob,
  updateRef,
} from './gh';
import type { GhConfig } from './gh';
import { decide } from './decide';
import type { Change } from './decide';

export type FileMap = Record<string, string>;
export type Snapshot = Record<string, string>;

export type Plan = {
  head: { commitSha: string; treeSha: string };
  remote: Record<string, string>;
  changes: Change[];
};

export type SyncStats = {
  pushed: number;
  pulled: number;
  removed: number;
  conflicts: number;
  commitSha: string | null;
};

export type SyncResult = {
  files: FileMap;
  snapshot: Snapshot;
  stats: SyncStats;
  log: string[];
  /**
   * 这轮计划里要删掉的远端文件。**删远端是不可逆的**，所以默认不动手：
   * 只拉取、把这些路径交回界面等用户点头（见 opts.allowDelete）。
   */
  pendingDeletes: string[];
};

export type SyncOptions = {
  /** 用户确认过「就删这些」才置 true。默认 false = 只拉不删。 */
  allowDelete?: boolean;
};

export async function planSync(cfg: GhConfig, files: FileMap, snapshot: Snapshot): Promise<Plan> {
  const head = await getHead(cfg);
  const { entries, truncated } = await listTree(cfg, head.treeSha);
  if (truncated) throw new Error('远端文件树被截断，当前实现不支持');

  const remote: Record<string, string> = {};
  for (const e of entries) remote[e.path] = e.sha;

  const paths = new Set<string>([...Object.keys(files), ...Object.keys(snapshot), ...Object.keys(remote)]);
  const changes: Change[] = [];
  for (const path of paths) {
    const localSha = path in files ? await blobSha(normalizeText(files[path] ?? '')) : undefined;
    const kind = decide(localSha, snapshot[path], remote[path]);
    if (kind) changes.push({ kind, path });
  }

  changes.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
  return { head, remote, changes };
}

function conflictPath(path: string, taken: Set<string>): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = `${dir}${stem}.conflict-${stamp}${ext}`;
  let i = 2;
  while (taken.has(candidate)) candidate = `${dir}${stem}.conflict-${stamp}-${i++}${ext}`;
  return candidate;
}

function commitMessage(paths: string[]): string {
  const names = paths.slice(0, 4).map((p) => p.split('/').pop());
  const n = paths.length;
  return `碎碎：${n > 4 ? `${names.join('、')} 等 ${n} 个文件` : names.join('、')}`;
}

/** 执行一轮同步：先拉、后冲突留副本、最后推；结束时把快照对齐到远端真值。 */
export async function syncOnce(
  cfg: GhConfig,
  files: FileMap,
  snapshot: Snapshot,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const plan = await planSync(cfg, files, snapshot);
  const log: string[] = [];
  const next: FileMap = { ...files };
  const stats: SyncStats = { pushed: 0, pulled: 0, removed: 0, conflicts: 0, commitSha: null };

  // 「本地没有 + 上次快照有 + 远端没动」会被判成本地删除。本地文件列表一旦不完整
  // （拉了半截、工作副本被清过），这条判定就会把远端文件成片删掉 —— 不可逆。
  // 所以删除永远要人点头，默认只把它们列出来。
  const deletes = plan.changes.filter((c) => c.kind === 'push-del').map((c) => c.path);
  const pendingDeletes = deletes.length > 0 && !opts.allowDelete ? deletes : [];

  for (const c of plan.changes) {
    if (c.kind === 'pull-new' || c.kind === 'pull-mod') {
      const sha = plan.remote[c.path];
      if (!sha) continue;
      next[c.path] = normalizeText(await readBlob(cfg, sha));
      stats.pulled += 1;
      log.push(`↓ ${c.path}`);
    } else if (c.kind === 'pull-del') {
      delete next[c.path];
      stats.removed += 1;
      log.push(`↓ 远端已删 ${c.path}`);
    }
  }

  const taken = new Set(Object.keys(next));
  const copies: string[] = [];
  const conflictOriginals: string[] = [];
  for (const c of plan.changes) {
    if (c.kind !== 'conflict') continue;
    const sha = plan.remote[c.path];
    const remoteText = sha ? normalizeText(await readBlob(cfg, sha)) : '';
    const copy = conflictPath(c.path, taken);
    taken.add(copy);
    next[copy] = remoteText;
    copies.push(copy);
    conflictOriginals.push(c.path);
    stats.conflicts += 1;
    log.push(`⚠ ${c.path} 两边都改了，远端版本存为 ${copy}`);
  }

  const treeChanges: { path: string; sha: string | null }[] = [];
  const pushPaths: string[] = [];
  for (const c of plan.changes) {
    if (c.kind === 'push-del') {
      // 没确认过就不删远端，只在日志里说清楚
      if (pendingDeletes.includes(c.path)) {
        log.push(`⏸ 待确认删除远端 ${c.path}`);
        continue;
      }
      treeChanges.push({ path: c.path, sha: null });
      pushPaths.push(c.path);
      stats.pushed += 1;
      log.push(`↑ 删除 ${c.path}`);
    } else if (c.kind === 'push-new' || c.kind === 'push-mod') {
      const content = normalizeText(next[c.path] ?? '');
      next[c.path] = content;
      treeChanges.push({ path: c.path, sha: await createBlob(cfg, content) });
      pushPaths.push(c.path);
      stats.pushed += 1;
      log.push(`↑ ${c.path}`);
    }
  }
  for (const copy of copies) {
    treeChanges.push({ path: copy, sha: await createBlob(cfg, normalizeText(next[copy] ?? '')) });
    pushPaths.push(copy);
    log.push(`↑ 冲突副本 ${copy}`);
  }

  if (treeChanges.length > 0) {
    const treeSha = await createTree(cfg, treeChanges, plan.head.treeSha);
    const commitSha = await createCommit(cfg, commitMessage(pushPaths), treeSha, plan.head.commitSha);
    await updateRef(cfg, commitSha);
    stats.commitSha = commitSha;
    log.push(`✔ 已提交 ${commitSha.slice(0, 7)}（${conflictOriginals.length ? `${conflictOriginals.length} 处冲突待你处理` : '干净'}）`);
  } else if (stats.pulled || stats.removed) {
    log.push('✔ 本地已更新');
  } else if (pendingDeletes.length) {
    log.push('⏸ 没有别的改动，只有待确认的删除');
  } else {
    log.push('✔ 已是最新，无改动');
  }

  const after = await getHead(cfg);
  const tree = await listTree(cfg, after.treeSha);
  const nextSnapshot: Snapshot = {};
  for (const e of tree.entries) nextSnapshot[e.path] = e.sha;

  return { files: next, snapshot: nextSnapshot, stats, log, pendingDeletes };
}
