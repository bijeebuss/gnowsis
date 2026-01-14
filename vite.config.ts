import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import tsconfigPaths from 'vite-tsconfig-paths'

// API URL for dev server proxy (not used in production - API serves frontend)
const apiUrl = process.env.VITE_API_URL || 'http://localhost:3001';

export default defineConfig({
  plugins: [
    TanStackRouterVite(),
    react(),
    tsconfigPaths(),
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: apiUrl,
        changeOrigin: true,
      },
      '/uploads': {
        target: apiUrl,
        changeOrigin: true,
      },
    },
  },
})
