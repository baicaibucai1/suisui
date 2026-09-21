import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { useStore } from './lib/store';

// 开发期把 store 挂到 window：e2e 和控制台可以直接读状态，不用靠猜。
// 只看 DEV 分支，正式构建不会带上。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__suisui = useStore;
}

/*
 * 桌面端才有的一条通道：**坚果云的 WebDAV 要在这里发**。
 *
 * 它的服务器不返回 CORS 头，浏览器里（包括安卓 WebView）连 PROPFIND 的预检都过不去 ——
 * 所以前端那个 WebDAV 适配器把请求抽象成一个 transport，桌面端把这条 Rust 命令注册进去，
 * 网页版没有 transport，界面上就标「要用桌面端」，不给一个按了没反应的按钮。
 *
 * 用动态 import：浏览器版不该为了一个用不上的通道去拉 @tauri-apps/api。
 */
if ('__TAURI_INTERNALS__' in window) {
  void (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { setDavTransport } = await import('./lib/providers');
      setDavTransport((req) => invoke('dav_request', { ...req }) as Promise<{ status: number; text: string }>);
    } catch {
      // 注册不上就退化成"坚果云不可用"，别把整个应用拖挂
    }
  })();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * 离线外壳。**只在正式构建里注册** —— 开发期注册会把模块图缓存住，
 * Vite 的 HMR 明明改了代码、页面却还是旧的，能白白浪费半天。
 * 注册失败的后果只是退化成普通网页，所以静默吞掉就行。
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
