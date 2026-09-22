/*
 * 坚果云（WebDAV）后端。
 *
 * ⚠️ **浏览器里跑不通，这是坚果云的限制，不是代码的限制**：它的服务器不返回
 * `Access-Control-Allow-Origin`，而且 PROPFIND 属于非简单请求，浏览器会先发一个
 * 不带凭据的 OPTIONS 预检 —— 坚果云照样要求鉴权，于是预检永远失败。官方对此的答复是
 * "我们实现的是标准 WebDAV 服务端协议"，即不打算支持。
 * 所以这一层把请求**抽象成一个 transport**：桌面端（Tauri）在 Rust 侧发，没有同源策略这一说；
 * 浏览器里没有可用 transport，界面上就标「需桌面端」，不给一个按了没反应的按钮。
 *
 * 内容的指纹在 list() 里现算（理由见 types.ts）：坚果云给的 ETag 跟本地算法不同，
 * 不能直接当基线。取回来的内容缓存住，read() 直接用，避免二次下载。
 */

import { blobSha, normalizeText } from '../gh';
import { base64ToBytes, bytesSha, bytesToBase64, isBinaryPath } from '../binary';
import { parsePropfind } from './davxml';
import { RemoteError, type Remote, type RemoteChange, type RemoteEntry } from './types';

export type DavConfig = {
  /** 库根的完整 URL，比如 `https://dav.jianguoyun.com/dav/碎碎` */
  url: string;
  user: string;
  /** 坚果云的「应用密码」（不是登录密码，在账户安全选项里单独生成） */
  pass: string;
};

export type DavRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  /**
   * 这一趟是**二进制**。置 true 时响应体走 `base64` 字段回来（不进 `text`），
   * 请求体则走 `bodyBase64`。
   * 为什么非要绕一道：transport 是一根 JSON 管道（前端 ⇄ Rust），
   * 字符串过不去字节 —— 而 `res.text()` 解二进制会把它解坏（见 lib/binary.ts）。
   */
  binary?: boolean;
  bodyBase64?: string;
};

export type DavResponse = { status: number; text: string; base64?: string };

/** 一次 WebDAV 请求。桌面端走 Rust，浏览器里没有实现 —— 见文件头。 */
export type DavTransport = (req: DavRequest) => Promise<DavResponse>;

export const NUTSTORE_DAV = 'https://dav.jianguoyun.com/dav/';

const PROPFIND_BODY =
  '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>';

export function webdavRemote(cfg: DavConfig, transport: DavTransport): Remote {
  const root = String(cfg.url ?? '').trim().replace(/\/+$/, '');
  if (!root) throw new RemoteError('nutstore', '还没填坚果云的地址');
  if (!cfg.user || !cfg.pass) throw new RemoteError('nutstore', '还没填坚果云的账号和应用密码');

  const auth = 'Basic ' + btoa(`${cfg.user}:${cfg.pass}`);
  /** 相对路径 → 完整 URL（每段各自编码，中文目录名才不会被吃掉） */
  const href = (path: string) => `${root}/${path.split('/').map(encodeURIComponent).join('/')}`;
  /** 路径 → 完整 URL 且带尾斜杠（MKCOL 要的就是这个） */
  const dirHref = (dir: string) => href(dir) + '/';

  const call = async (req: DavRequest): Promise<DavResponse> => {
    try {
      return await transport({ ...req, headers: { Authorization: auth, ...req.headers } });
    } catch (e) {
      const raw = (e as Error)?.message ?? String(e);
      // 浏览器里最常见的失败就是这一句，说清楚是谁拦的
      if (/Failed to fetch|CORS|NetworkError/i.test(raw)) {
        throw new RemoteError(
          'nutstore',
          '连不上坚果云 —— 它的 WebDAV 不支持跨域，浏览器直连一定被拦（要用桌面端）',
        );
      }
      throw new RemoteError('nutstore', raw);
    }
  };

  /** 内容缓存：list() 为了算指纹已经下过一遍，read() 别再下一次。附件另存一份（base64）。 */
  let cache: Map<string, string> | null = null;
  let binCache: Map<string, string> | null = null;

  /** 逐级建目录。已存在会回 405，忽略即可 —— 幂等才敢在每次写之前无条件调 */
  const ensureDir = async (dir: string) => {
    const segs = dir.split('/').filter(Boolean);
    for (let i = 1; i <= segs.length; i++) {
      const res = await call({ method: 'MKCOL', url: dirHref(segs.slice(0, i).join('/')), headers: {} });
      if (![200, 201, 204, 405, 409, 301, 302].includes(res.status)) {
        throw new RemoteError('nutstore', `建目录失败（${res.status}）：${segs.slice(0, i).join('/')}`);
      }
    }
  };

  const remote: Remote = {
    id: 'nutstore',
    label: '坚果云',

    async list(): Promise<RemoteEntry[]> {
      const res = await call({
        method: 'PROPFIND',
        url: dirHref(''),
        headers: { Depth: 'infinity', 'Content-Type': 'application/xml' },
        body: PROPFIND_BODY,
      });
      if (res.status >= 400) {
        throw new RemoteError('nutstore', `列目录失败（${res.status}）${res.status === 401 ? '：账号或应用密码不对' : ''}`);
      }
      // ⚠️ 先把旧缓存清掉：下面 read() 会优先用缓存，留着旧值就是拿上次的正文当这次的
      cache = null;
      binCache = null;
      const items = parsePropfind(res.text, root).filter((i) => !i.dir);
      const next = new Map<string, string>();
      const bins = new Map<string, string>();
      const out: RemoteEntry[] = [];
      for (const it of items) {
        // 附件必须按字节读（指纹也是按字节算的），走文本那条路会把它解坏
        if (isBinaryPath(it.path)) {
          const bytes = await remote.readBytes(it.path);
          bins.set(it.path, bytesToBase64(bytes));
          out.push({ path: it.path, sha: await bytesSha(bytes) });
          continue;
        }
        const text = normalizeText(await remote.read(it.path));
        next.set(it.path, text);
        out.push({ path: it.path, sha: await blobSha(text) });
      }
      cache = next;
      binCache = bins;
      return out;
    },

    async read(path: string): Promise<string> {
      const hit = cache?.get(path);
      if (hit !== undefined) return hit;
      const res = await call({ method: 'GET', url: href(path), headers: {} });
      if (res.status >= 400) throw new RemoteError('nutstore', `读 ${path} 失败（${res.status}）`);
      return normalizeText(res.text);
    },

    async readBytes(path: string): Promise<Uint8Array> {
      const hit = binCache?.get(path);
      if (hit !== undefined) return base64ToBytes(hit);
      const res = await call({ method: 'GET', url: href(path), headers: {}, binary: true });
      if (res.status >= 400) throw new RemoteError('nutstore', `读附件 ${path} 失败（${res.status}）`);
      if (!res.base64) throw new RemoteError('nutstore', `读附件 ${path} 失败：通道没返回二进制内容`);
      return base64ToBytes(res.base64);
    },

    async write(changes: RemoteChange[], _message: string): Promise<void> {
      // 网盘没有事务：先写后删，中途挂了也只是"没删干净"，下轮比对会接着补
      for (const c of changes) {
        if (c.content === null) continue;
        const i = c.path.lastIndexOf('/');
        if (i >= 0) await ensureDir(c.path.slice(0, i));
        const binary = c.encoding === 'base64';
        const res = await call({
          method: 'PUT',
          url: href(c.path),
          headers: { 'Content-Type': binary ? 'application/octet-stream' : 'text/markdown; charset=utf-8' },
          body: binary ? undefined : normalizeText(c.content),
          bodyBase64: binary ? c.content : undefined,
          binary,
        });
        if (res.status >= 400) throw new RemoteError('nutstore', `写 ${c.path} 失败（${res.status}）`);
      }
      for (const c of changes) {
        if (c.content !== null) continue;
        const res = await call({ method: 'DELETE', url: href(c.path), headers: {} });
        // 已经没了（404）也算成功：删除是幂等的
        if (res.status >= 400 && res.status !== 404) {
          throw new RemoteError('nutstore', `删 ${c.path} 失败（${res.status}）`);
        }
      }
      cache = null;
      binCache = null;
    },
  };

  return remote;
}
