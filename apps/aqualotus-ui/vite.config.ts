import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri loads a fixed devUrl (see src-tauri/tauri.conf.json), so the
  // port must not drift: fail loudly instead of silently moving to :5174.
  // clearScreen keeps Tauri/CLI output readable.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
})
