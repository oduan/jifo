import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (['react-markdown', 'remark-gfm', 'remark-breaks'].some((name) => normalizedId.includes(`/node_modules/${name}/`))) {
            return 'markdown';
          }
          if (normalizedId.includes('/node_modules/dexie/')) {
            return 'storage';
          }
        }
      }
    }
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.JIFO_API_PROXY_TARGET ?? 'http://127.0.0.1:8080',
        changeOrigin: true
      },
      '/mcp': {
        target: process.env.JIFO_API_PROXY_TARGET ?? 'http://127.0.0.1:8080',
        changeOrigin: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts'
  }
});
