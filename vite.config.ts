import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// El servidor de datos vive en 127.0.0.1:7317 (ver server/src/config.ts).
// En desarrollo Vite sirve el front en 5173 y proxya /api y /hook al backend.
export default defineConfig({
  root: 'web',
  plugins: [vue()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7317', changeOrigin: false },
      '/hook': { target: 'http://127.0.0.1:7317', changeOrigin: false },
    },
  },
  build: {
    outDir: '../web-dist',
    emptyOutDir: true,
  },
})
