// GitHub REST（Git Data API）薄封装。全部走 fetch，浏览器可直连（api.github.com 放行 CORS）。
// 不依赖任何 git 程序 —— 安卓端同样能用这一套。

export type GhConfig = {
  owner: string;
  repo: string;
  branch: string;
  token: string;
};

export type TreeEntry = {
  path: string;
  sha: string;
  size: number;
};

const API = 'https://api.github.com';

export class GhError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'GhError';
  }
}

const TIMEOUT_MS = 20_000;

/**
 * 浏览器的网络失败只有一句 "Failed to fetch"，用户完全看不懂。
 * 这里翻译成能指导行动的话；status=0 表示根本没到 HTTP 层。
 */
function netError(e: unknown): GhError {
  const err = e as Error;
  const raw = err?.message ?? String(e);
  if (err?.name === 'TimeoutError' || /ERR_TIMED_OUT|timed? ?out/i.test(raw)) {
    return new GhError(0, '请求 api.github.com 超时 —— 网络慢，或被本机代理挡住');
  }
  if (/Failed to fetch|ERR_CONNECTION|ERR_NETWORK|NetworkError|network ?error/i.test(raw)) {
    return new GhError(0, '连不上 api.github.com —— 检查网络，或关掉本机代理再试');
  }
  return new GhError(0, raw);
}

async function doFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      // GitHub 的 /git/ref/heads/{branch} 带 CDN 缓存（约 60s）：刚推完就再读，
      // 会拿回推送前的 HEAD，于是远端 tree 里看不到新文件，比对结果变成「与远端一致」。
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw netError(e);
  }
}

async function ghFetch<T>(cfg: GhConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await doFetch(API + path, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { message?: string };
      detail = j.message ?? '';
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 200);
    }
    throw new GhError(res.status, `${res.status} ${detail || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function whoami(cfg: GhConfig): Promise<string> {
  const me = await ghFetch<{ login: string }>(cfg, '/user');
  return me.login;
}

export async function getHead(cfg: GhConfig): Promise<{ commitSha: string; treeSha: string }> {
  const ref = await ghFetch<{ object: { sha: string } }>(
    cfg,
    `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${cfg.branch}`,
  );
  const commitSha = ref.object.sha;
  const commit = await ghFetch<{ tree: { sha: string } }>(
    cfg,
    `/repos/${cfg.owner}/${cfg.repo}/git/commits/${commitSha}`,
  );
  return { commitSha, treeSha: commit.tree.sha };
}

/** 递归列出树里所有文件（不含目录项）。 */
export async function listTree(cfg: GhConfig, treeSha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const data = await ghFetch<{
    tree: { path: string; type: string; sha: string; size?: number }[];
    truncated?: boolean;
  }>(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/trees/${treeSha}?recursive=1`);
  const entries = data.tree
    .filter((t) => t.type === 'blob')
    .map((t) => ({ path: t.path, sha: t.sha, size: t.size ?? 0 }));
  return { entries, truncated: Boolean(data.truncated) };
}

/** 读单个 blob 的原始文本（用 raw media type，省掉 base64 解码）。 */
export async function readBlob(cfg: GhConfig, sha: string): Promise<string> {
  const res = await doFetch(`${API}/repos/${cfg.owner}/${cfg.repo}/git/blobs/${sha}`, {
    headers: {
      Accept: 'application/vnd.github.raw+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new GhError(res.status, `${res.status} 读取 blob 失败`);
  return res.text();
}

export async function createBlob(cfg: GhConfig, text: string): Promise<string> {
  const data = await ghFetch<{ sha: string }>(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: text, encoding: 'utf-8' }),
  });
  return data.sha;
}

export type TreeChange = { path: string; sha: string | null };

export async function createTree(cfg: GhConfig, changes: TreeChange[], baseTree?: string): Promise<string> {
  const tree = changes.map((c) =>
    c.sha === null
      ? { path: c.path, mode: '100644', type: 'blob', sha: null }
      : { path: c.path, mode: '100644', type: 'blob', sha: c.sha },
  );
  const body: Record<string, unknown> = { tree };
  if (baseTree) body.base_tree = baseTree;
  const data = await ghFetch<{ sha: string }>(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return data.sha;
}

export async function createCommit(
  cfg: GhConfig,
  message: string,
  treeSha: string,
  parentSha: string,
): Promise<string> {
  const data = await ghFetch<{ sha: string }>(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  return data.sha;
}

export async function updateRef(cfg: GhConfig, commitSha: string): Promise<void> {
  await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${cfg.branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
}

/** 内容统一成 LF + 无 BOM，否则每次保存 sha 都会变，同步会永远"脏"。 */
export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** 复刻 git 的 blob 哈希：sha1("blob " + 字节长度 + "\0" + 内容)。和远端 sha 可直接比。 */
export async function blobSha(text: string): Promise<string> {
  const content = new TextEncoder().encode(text);
  const header = new TextEncoder().encode('blob ' + content.length + '\0');
  const buf = new Uint8Array(header.length + content.length);
  buf.set(header, 0);
  buf.set(content, header.length);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
