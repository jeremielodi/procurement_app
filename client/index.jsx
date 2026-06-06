// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
      },
    },
  },
  resolve: {
    extensions: ['.js', '.jsx', '.json'], // Ajouter .jsx
  },
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.jsx?$/, // Inclure les fichiers .js et .jsx
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx', // Traiter les fichiers .js comme JSX
        '.jsx': 'jsx',
      },
    },
  },
})