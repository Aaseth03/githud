import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri drives this dev server, so the port is fixed and a failure to bind must
// be loud — a silent port bump would leave the webview pointed at nothing.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // The Rust side has its own watcher; watching it from Vite only produces
      // duplicate reloads.
      ignored: ["**/src-tauri/**"],
    },
  },
});
