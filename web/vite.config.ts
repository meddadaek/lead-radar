import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5317,
    strictPort: true,
    // the Python engine (lead-radar/engine/run.py) serves every /api route
    proxy: { "/api": { target: "http://127.0.0.1:8030", changeOrigin: true } },
  },
});
