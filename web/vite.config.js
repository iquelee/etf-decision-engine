import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { rewriteRootEntryPlugin } from './vite-config/rewrite-root-entry.js';

// 静态托管部署：base 用相对路径，避免子路径资源 404
//
// V365（2026-09-30）新增：多页入口。
//   · index.html   → **根入口**（引导来源由下面的开关决定）
//   · legacy.html  → 旧前端（web/src/main.js）
//   · rewrite.html → 新前端（web/src/rewrite/app.js），独立产物，与旧前端并存
//   注：入口用**相对路径字符串**（相对 vite root），避免 __dirname / import.meta 的模块体系差异。
//
// ★ E-006 / A2（2026-10-01）生产根入口收敛：
//   VITE_ENABLE_REWRITE_ENTRY=1  ⇒ dist/index.html = V3.6.5 Rewrite UI
//   未设置 / =0（默认）           ⇒ dist/index.html = Legacy UI（与收敛前一致）
//   实现见 `vite-config/rewrite-root-entry.js`（Vite 官方 transformIndexHtml，order:'pre'）。
//   注：目录名刻意避开 `build/`（`.gitignore:7` 会忽略任何名为 build 的目录，会导致模块无法入库）。
//   ⛔ 不改 web/src/**，⛔ 不对 dist 做事后处理，⛔ 不引入第三方插件。
export default defineConfig({
  plugins: [vue(), rewriteRootEntryPlugin()],
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
        legacy: 'legacy.html',
        rewrite: 'rewrite.html'
      }
    }
  }
});
