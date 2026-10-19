import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 本機開發：前端用 Vite，/api 與 /ws 轉給 wrangler dev（npm run dev:server）
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
