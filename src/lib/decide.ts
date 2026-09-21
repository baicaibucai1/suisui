// 三路判定：纯函数，零依赖 —— 好单独跑测试（node 24 可直接 import 这个 .ts）。
// local = 本地文件 sha；base = 上次同步时远端的 sha；remote = 现在远端的 sha。

export type ChangeKind =
  | 'push-new'
  | 'push-mod'
  | 'push-del'
  | 'pull-new'
  | 'pull-mod'
  | 'pull-del'
  | 'conflict';

export type Change = { kind: ChangeKind; path: string };

const KIND_LABEL: Record<ChangeKind, string> = {
  'push-new': '本地新增',
  'push-mod': '本地修改',
  'push-del': '本地删除',
  'pull-new': '远端新增',
  'pull-mod': '远端修改',
  'pull-del': '远端删除',
  conflict: '冲突',
};

export function kindLabel(kind: ChangeKind): string {
  return KIND_LABEL[kind];
}

export function isPush(kind: ChangeKind): boolean {
  return kind.startsWith('push');
}

/** 返回 null 表示这一格无需任何动作。 */
export function decide(
  localSha: string | undefined,
  baseSha: string | undefined,
  remoteSha: string | undefined,
): ChangeKind | null {
  if (localSha !== undefined && remoteSha !== undefined) {
    if (localSha === remoteSha) return null;
    if (baseSha === undefined) return 'conflict';
    const localChanged = localSha !== baseSha;
    const remoteChanged = remoteSha !== baseSha;
    if (localChanged && remoteChanged) return 'conflict';
    return localChanged ? 'push-mod' : 'pull-mod';
  }
  if (localSha !== undefined) {
    if (baseSha === undefined) return 'push-new';
    return localSha === baseSha ? 'pull-del' : 'conflict';
  }
  if (remoteSha !== undefined) {
    if (baseSha === undefined) return 'pull-new';
    // 基线存在 ⟹ 上次同步后本地也有过这个文件，现在没了：
    // 远端没动 = 本地删除；远端也改了 = 删改冲突
    return remoteSha === baseSha ? 'push-del' : 'conflict';
  }
  return null;
}
