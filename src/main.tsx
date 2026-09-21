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
