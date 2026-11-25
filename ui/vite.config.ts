import { glyphColorMode } from '@glyphui/ui/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `npm run dev` proxies the API to a local agent: `make dev` or `make dev-library` in the repo root.
export default defineConfig({
  plugins: [react(), tailwindcss(), glyphColorMode()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
  build: {
    target: 'safari16', // WPE WebKit 2.48 on the device
    outDir: 'dist',
    emptyOutDir: true,
  },
})
