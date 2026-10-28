// Temporaire (vérification locale) — à supprimer
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: { port: 5056, strictPort: true, proxy: { '/api': { target: 'http://localhost:5055', changeOrigin: true } } },
})
