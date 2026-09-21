/*
 * 按当前设置造一个后端出来。
 *
 * 坚果云那一路要一个 **transport**：WebDAV 在浏览器里一定被 CORS 拦（见 webdav.ts），
 * 所以桌面端（Tauri）启动时会把自己那条 Rust 通道注册进来（`setDavTransport`）。
 * 没注册就是"没有可用通道"，界面上要照实说，不能给一个按了没反应的按钮。
 */

import type { GhConfig } from '../gh';
import { githubRemote } from './github';
import { webdavRemote } from './webdav';
import type { DavConfig, DavTransport } from './webdav';
import { onedriveRemote } from './onedrive';
import type { OneDriveConfig } from './onedrive';
import { RemoteError, type ProviderId, type Remote } from './types';

export type ProviderConfig = {
  github: GhConfig;
  nutstore: DavConfig;
  onedrive: OneDriveConfig;
};

let davTransport: DavTransport | null = null;

/** 桌面端在启动时调用；传 null 表示收回（比如从桌面端切回浏览器预览） */
export function setDavTransport(t: DavTransport | null): void {
  davTransport = t;
}

export const hasDavTransport = (): boolean => davTransport !== null;

export function makeRemote(id: ProviderId, cfg: ProviderConfig): Remote {
  if (id === 'github') return githubRemote(cfg.github);
  if (id === 'nutstore') {
    if (!davTransport) {
      throw new RemoteError(
        'nutstore',
        '坚果云的 WebDAV 不支持跨域，浏览器直连一定被拦 —— 要用桌面端',
      );
    }
    return webdavRemote(cfg.nutstore, davTransport);
  }
  return onedriveRemote(cfg.onedrive);
}

export { PROVIDERS } from './types';
export type { ProviderId, ProviderMeta, Remote, RemoteChange, RemoteEntry } from './types';
