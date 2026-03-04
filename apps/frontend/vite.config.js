// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // Esto permite que se vea en la red
    proxy: {
      '/api': {
        target: 'http://192.168.5.4:5000', // Cambiado a la IP del servidor
        changeOrigin: true,
      },
      '/zf': {
        target: 'http://192.168.5.4:5000', // Cambiado a la IP del servidor
        changeOrigin: true,
      },
      '/oc': {
        target: 'http://192.168.5.4:5000', // Cambiado a la IP del servidor
        changeOrigin: true,
      },
    },
  },
})