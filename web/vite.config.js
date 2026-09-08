import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 静态托管部署：base 用相对路径，避免子路径资源 404
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
    chunkSizeWarningLimit: 1200
  }
});
