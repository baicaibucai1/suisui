import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 绑所有网卡：手机连同一个 WiFi 就能打开，真机预览靠这个。
    // localhost / 127.0.0.1 照常可用，桌面 e2e 不受影响。
    host: true,
    port: 5183,
    strictPort: true,
  },
  preview: {
    // 正式产物预览。Service Worker / 「添加到主屏幕」只有在构建产物上才能验
    // —— 开发期是 Vite 的内存模块图，没有可缓存的静态文件。
    host: true,
    port: 5184,
  },
});
