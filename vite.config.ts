import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    // The app calls the backend at a relative /api path (see src/api.ts) rather than a separate
    // port, so the backend has to run behind the same origin - in Docker that's nginx, and here
    // it's Vite's own dev server proxying to wherever the backend is actually running.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.VITE_BACKEND_PORT || '4001'}`,
        changeOrigin: true,
      },
    },
  },
})