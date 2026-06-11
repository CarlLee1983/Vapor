// @ts-expect-error node:url types are not available in this config's tsconfig
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  resolve: {
    alias: {
      // Node-only deps (e.g. @carllee1983/tagsmith/dist/core/config.js) import
      // fs helpers at module scope; only their pure functions run on the
      // frontend. Point `node:fs/promises` at a stub so named imports resolve
      // for the browser/Tauri bundle. See src/lib/shims/fs-promises-browser.ts.
      "node:fs/promises": fileURLToPath(
        new URL("./src/lib/shims/fs-promises-browser.ts", import.meta.url),
      ),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
