// GitHub 后端。仍然走 Git Data API（一个仓库当库、一次同步一个 commit），
// 只是把它包成统一的 Remote 接口。
//
// 它有个别的后端没有的优势：远端给的就是 git 的 blob sha，本地算得出来，
// 所以 list() 不用下载内容 —— 判定表里那三列天然对得上。

import {
  createBlob,
  createCommit,
  createTree,
  getHead,
  listTree,
  normalizeText,
  readBlob,
  readBlobBytes,
  updateRef,
} from '../gh';
import type { GhConfig } from '../gh';
import { RemoteError, type Remote, type RemoteChange, type RemoteEntry } from './types';

export function githubRemote(cfg: GhConfig): Remote {
  /** 路径 → blob sha。read() 要按路径取 sha，列过一次就别再列。 */
  let known: Map<string, string> | null = null;

  const remote: Remote = {
    id: 'github',
    label: 'GitHub',

    async list(): Promise<RemoteEntry[]> {
      const head = await getHead(cfg);
      const { entries, truncated } = await listTree(cfg, head.treeSha);
      if (truncated) throw new RemoteError('github', '远端文件树被截断，当前实现不支持');
      known = new Map(entries.map((e) => [e.path, e.sha]));
      return entries.map((e) => ({ path: e.path, sha: e.sha }));
    },

    async read(path: string): Promise<string> {
      let sha = known?.get(path);
      if (!sha) {
        const entries = await remote.list();
        sha = entries.find((e) => e.path === path)?.sha;
      }
      if (!sha) throw new RemoteError('github', `远端没有这个文件：${path}`);
      return normalizeText(await readBlob(cfg, sha));
    },

    async readBytes(path: string): Promise<Uint8Array> {
      let sha = known?.get(path);
      if (!sha) {
        const entries = await remote.list();
        sha = entries.find((e) => e.path === path)?.sha;
      }
      if (!sha) throw new RemoteError('github', `远端没有这个文件：${path}`);
      return readBlobBytes(cfg, sha);
    },

    async write(changes: RemoteChange[], message: string): Promise<void> {
      if (changes.length === 0) return;
      const head = await getHead(cfg);
      const tree: { path: string; sha: string | null }[] = [];
      for (const c of changes) {
        if (c.content === null) {
          tree.push({ path: c.path, sha: null });
          continue;
        }
        const binary = c.encoding === 'base64';
        // ⚠️ 附件不能过 normalizeText（见 binary.ts），而且要以 base64 身份建 blob ——
        // 这样 GitHub 存进去的是原始字节，sha 才和本地按字节算的相等
        tree.push({
          path: c.path,
          sha: await createBlob(cfg, binary ? c.content : normalizeText(c.content), binary ? 'base64' : 'utf-8'),
        });
      }
      const treeSha = await createTree(cfg, tree, head.treeSha);
      const commitSha = await createCommit(cfg, message, treeSha, head.commitSha);
      await updateRef(cfg, commitSha);
      // 树刚变过，缓存的 sha 全过期了
      known = null;
    },
  };

  return remote;
}
