import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      host: "127.0.0.1",
      strictPort: true,
      // Keep the browser's Host so the API's same-origin check matches the dev server origin.
      proxy: { "/api": { target: "http://127.0.0.1:8788", changeOrigin: false } },
    },
    build: { chunkSizeWarningLimit: 700 },
});
