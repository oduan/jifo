import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          markdown: ['react-markdown', 'remark-gfm', 'remark-breaks'],
          storage: ['dexie']
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
