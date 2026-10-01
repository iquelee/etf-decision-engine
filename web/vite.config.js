import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 静态托管部署：base 用相对路径，避免子路径资源 404
//
// V365（2026-09-30）新增：多页入口。
//   · index.html  → 旧前端（web/src/main.js），**保持不变**
//   · rewrite.html → 新前端（web/src/rewrite/app.js），独立产物，与旧前端并存
//   这样新前端可独立构建 / 独立预览，旧前端随时可回退；
//   待 M9 兼容切换完成后，再由 owner 决定入口收敛（见 SPEC §2.3 / §16）。
//   注：入口用**相对路径字符串**（相对 vite root），避免 __dirname / import.meta 的模块体系差异。
export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 5173,
    host: true,
    open: false
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: 'index.html',
        rewrite: 'rewrite.html'
      }
    }
  }
});
