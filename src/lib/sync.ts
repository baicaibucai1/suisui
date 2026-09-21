// 三路比对同步引擎：上次快照 / 本地文件 / 远端 sha。
//
// ⚠️ 这一层**不认任何一家云服务**：只认 providers/types.ts 里的 Remote 接口。
// 换后端（GitHub / 坚果云 / OneDrive）不改这里一行 —— 判定表、冲突处理、删除确认
// 这些真正会丢东西的逻辑因此只有一份，不会在三个后端里各错一次。
// 下面那些 "一次同步只产生一个 commit" 之类的话，是按 GitHub 的语义写的：
// 网盘没有事务（见 Remote.write 的注释），但比对与冲突规则完全一样。

import { blobSha, normalizeText } from './gh';
import { decide } from './decide';
import type { Change } from './decide';
import type { Remote, RemoteChange } from './providers/types';

export type FileMap = Record<string, string>;
export type Snapshot = Record<string, string>;

export type Plan = {
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

export async function planSync(remote: Remote, files: FileMap, snapshot: Snapshot): Promise<Plan> {
  // 远端指纹和本地是同一种算法（blob sha）—— 见 providers/types.ts 里那条取舍，
  // 三路比对才成立
  const entries = await remote.list();
  const remoteMap: Record<string, string> = {};
  for (const e of entries) remoteMap[e.path] = e.sha;

  const paths = new Set<string>([...Object.keys(files), ...Object.keys(snapshot), ...Object.keys(remoteMap)]);
  const changes: Change[] = [];
  for (const path of paths) {
    const localSha = path in files ? await blobSha(normalizeText(files[path] ?? '')) : undefined;
    const kind = decide(localSha, snapshot[path], remoteMap[path]);
    if (kind) changes.push({ kind, path });
  }

  changes.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
  return { remote: remoteMap, changes };
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
  remote: Remote,
  files: FileMap,
  snapshot: Snapshot,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const plan = await planSync(remote, files, snapshot);
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
      if (!(c.path in plan.remote)) continue;
      next[c.path] = normalizeText(await remote.read(c.path));
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
    const remoteText = c.path in plan.remote ? normalizeText(await remote.read(c.path)) : '';
    const copy = conflictPath(c.path, taken);
    taken.add(copy);
    next[copy] = remoteText;
    copies.push(copy);
    conflictOriginals.push(c.path);
    stats.conflicts += 1;
    log.push(`⚠ ${c.path} 两边都改了，远端版本存为 ${copy}`);
  }

  const writes: RemoteChange[] = [];
  const pushPaths: string[] = [];
  for (const c of plan.changes) {
    if (c.kind === 'push-del') {
      // 没确认过就不删远端，只在日志里说清楚
      if (pendingDeletes.includes(c.path)) {
        log.push(`⏸ 待确认删除远端 ${c.path}`);
        continue;
      }
      writes.push({ path: c.path, content: null });
      pushPaths.push(c.path);
      stats.pushed += 1;
      log.push(`↑ 删除 ${c.path}`);
    } else if (c.kind === 'push-new' || c.kind === 'push-mod') {
      const content = normalizeText(next[c.path] ?? '');
      next[c.path] = content;
      writes.push({ path: c.path, content });
      pushPaths.push(c.path);
      stats.pushed += 1;
      log.push(`↑ ${c.path}`);
    }
  }
  for (const copy of copies) {
    writes.push({ path: copy, content: normalizeText(next[copy] ?? '') });
    pushPaths.push(copy);
    log.push(`↑ 冲突副本 ${copy}`);
  }

  if (writes.length > 0) {
    await remote.write(writes, commitMessage(pushPaths));
    log.push(`✔ 已提交 ${writes.length} 个改动（${conflictOriginals.length ? `${conflictOriginals.length} 处冲突待你处理` : '干净'}）`);
  } else if (stats.pulled || stats.removed) {
    log.push('✔ 本地已更新');
  } else if (pendingDeletes.length) {
    log.push('⏸ 没有别的改动，只有待确认的删除');
  } else {
    log.push('✔ 已是最新，无改动');
  }

  // 收尾：把快照对齐到远端真值。GitHub 写的是一个 commit，网盘是逐个 PUT ——
  // 不管哪种，重新列一遍才拿得到"现在到底是什么样"
  const after = await remote.list();
  const nextSnapshot: Snapshot = {};
  for (const e of after) nextSnapshot[e.path] = e.sha;

  return { files: next, snapshot: nextSnapshot, stats, log, pendingDeletes };
}
