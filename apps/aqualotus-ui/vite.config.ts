import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { aqualotusVersionFromPackage, optilotusVersionFromCargo } from './version.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Build-time Optilotus version (from crates/optilotus/Cargo.toml):
  // the status pill shows the live WASM version when ready and falls
  // back to this before init, so engine bumps need no UI edit.
  // Build-time AquaLotus app version (from the app package.json):
  // the app bar shows the release label, so app version bumps need
  // no UI edit either.
  define: {
    __OPTILOTUS_VERSION__: JSON.stringify(optilotusVersionFromCargo()),
    __AQUALOTUS_VERSION__: JSON.stringify(aqualotusVersionFromPackage()),
  },
  // Tauri loads a fixed devUrl (see src-tauri/tauri.conf.json), so the
  // port must not drift: fail loudly instead of silently moving to :5174.
  // clearScreen keeps Tauri/CLI output readable.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
})
