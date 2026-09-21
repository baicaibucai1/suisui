/*
 * OneDrive 后端：走 Microsoft Graph。
 *
 * 浏览器直连是通的（Graph 放 CORS），缺的是**授权**：要一个 Azure 应用的 client_id
 * 走 PKCE 换 access token。注册应用得由账号主人在 Azure 门户做，所以这里
 * **只接 token**：有 token 就能跑，没 token 就在界面上标「待接入」。
 *
 * 路径用 Graph 的「冒号寻址」：`/me/drive/root:/碎碎/notes/a.md:/content`。
 * 中文和空格都要编码（冒号是语法，不能编）。
 *
 * 指纹同样是现算的：DriveItem 给的 quickXorHash 不是 sha1，不能当基线（见 types.ts）。
 */

import { blobSha, normalizeText } from '../gh';
import { RemoteError, type Remote, type RemoteChange, type RemoteEntry } from './types';

export type OneDriveConfig = {
  /** Graph 的 access token。留空 = 还没接上授权。 */
  token: string;
  /** 库在 OneDrive 里的根目录，比如 `碎碎`。留空 = 整个 drive 的根。 */
  basePath?: string;
};

const API = 'https://graph.microsoft.com/v1.0';

/** 路径各段分别编码（中文目录名），段间的 `/` 保留 */
const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/** 相对路径 → Graph 的「冒号寻址」片段（不含 /content 之类的后缀） */
export function graphPath(basePath: string, path: string): string {
  const root = (basePath ?? '').trim().replace(/^\/+|\/+$/g, '');
  const rel = root ? `${root}/${path}` : path;
  const drive = 'root:';
  return rel ? `${drive}/${rel.split('/').map(encodeURIComponent).join('/')}:` : `${drive}/`;
}

/** Graph 的列表项。目录靠 `folder` 字段区分；`file` 存在说明是文件。 */
type DriveItem = {
  name: string;
  parentReference?: { path?: string };
  folder?: unknown;
  file?: unknown;
};

const json = async (res: Response, where: string) => {
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j.error?.message ?? '';
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 160);
    }
    throw new RemoteError('onedrive', `${where} 失败（${res.status}）${detail ? '：' + detail : ''}`);
  }
  return (await res.json()) as { value?: DriveItem[]; '@odata.nextLink'?: string };
};

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function onedriveRemote(cfg: OneDriveConfig): Remote {
  const token = (cfg.token ?? '').trim();
  if (!token) throw new RemoteError('onedrive', 'OneDrive 还没接上授权（缺 access token）');
  const base = cfg.basePath ?? '';

  const headers = authHeaders(token);

  /** 递归列出库根下所有文件。Graph 一次最多 200 项，靠 nextLink 翻页。 */
  const walk = async (): Promise<string[]> => {
    const out: string[] = [];
    const stack: string[] = [base];
    while (stack.length) {
      const dir = stack.pop() ?? '';
      let url = dir
        ? `${API}/me/drive/root:/${dir.split('/').map(encodeURIComponent).join('/')}:/children?$select=name,folder,file&$top=200`
        : `${API}/me/drive/root/children?$select=name,folder,file&$top=200`;
      for (;;) {
        const res = await fetch(url, { headers, cache: 'no-store' });
        const page = await json(res, '列目录');
        for (const it of page.value ?? []) {
          const p = dir ? `${dir}/${it.name}` : it.name;
          if (it.folder) stack.push(p);
          else if (it.file) out.push(p);
        }
        if (!page['@odata.nextLink']) break;
        url = page['@odata.nextLink'];
      }
    }
    return out;
  };

  /** path（含库根前缀）→ 库内相对路径 */
  const rel = (full: string) => {
    const root = base.trim().replace(/^\/+|\/+$/g, '');
    if (!root) return full;
    return full.startsWith(root + '/') ? full.slice(root.length + 1) : '';
  };

  /**
   * 逐级建目录：Graph 的 PUT 不会顺手建父目录，父目录不在就是一个 404。
   * 库根那几层也要建 —— 第一次同步时它还没出现。
   */
  const created = new Set<string>();
  const ensureDir = async (dir: string) => {
    const segs = [
      ...base.trim().replace(/^\/+|\/+$/g, '').split('/').filter(Boolean),
      ...dir.split('/').filter(Boolean),
    ];
    for (let i = 0; i < segs.length; i++) {
      const key = segs.slice(0, i + 1).join('/');
      if (created.has(key)) continue;
      const parentPath = segs.slice(0, i).join('/');
      const url = parentPath
        ? `${API}/me/drive/root:/${enc(parentPath)}:/children`
        : `${API}/me/drive/root/children`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: segs[i], folder: {} }),
      });
      // 409 = 同名已存在，那正是想要的结果
      if (!res.ok && res.status !== 409) await json(res, `建目录 ${key}`);
      created.add(key);
    }
  };

  let cache: Map<string, string> | null = null;

  const remote: Remote = {
    id: 'onedrive',
    label: 'OneDrive',

    async list(): Promise<RemoteEntry[]> {
      cache = null;
      const paths = (await walk()).map(rel).filter(Boolean);
      const next = new Map<string, string>();
      const out: RemoteEntry[] = [];
      for (const p of paths) {
        const text = normalizeText(await remote.read(p));
        next.set(p, text);
        out.push({ path: p, sha: await blobSha(text) });
      }
      cache = next;
      return out;
    },

    async read(path: string): Promise<string> {
      const hit = cache?.get(path);
      if (hit !== undefined) return hit;
      const res = await fetch(`${API}/me/drive/${graphPath(base, path)}/content`, {
        headers,
        cache: 'no-store',
      });
      if (!res.ok) throw new RemoteError('onedrive', `读 ${path} 失败（${res.status}）`);
      return normalizeText(await res.text());
    },

    async write(changes: RemoteChange[], _message: string): Promise<void> {
      for (const c of changes) {
        if (c.content === null) continue;
        const i = c.path.lastIndexOf('/');
        if (i >= 0) await ensureDir(c.path.slice(0, i));
        const res = await fetch(`${API}/me/drive/${graphPath(base, c.path)}/content`, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
          body: normalizeText(c.content),
        });
        if (!res.ok) await json(res, `写 ${c.path}`);
      }
      for (const c of changes) {
        if (c.content !== null) continue;
        const res = await fetch(`${API}/me/drive/${graphPath(base, c.path)}`, {
          method: 'DELETE',
          headers,
        });
        // 已经删了（404）也算成功
        if (!res.ok && res.status !== 404) await json(res, `删 ${c.path}`);
      }
      cache = null;
    },
  };

  return remote;
}
