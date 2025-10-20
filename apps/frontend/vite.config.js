// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Backend Flask
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
      '/zf': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
      '/oc': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
})
