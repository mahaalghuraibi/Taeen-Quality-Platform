import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    /**
     * Split heavy third-party libraries into their own chunks so the initial
     * mobile payload stays small (Recharts and SheetJS are only used on the
     * reports page) and the main app chunk caches independently.
     */
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/recharts/") || id.includes("/d3-")) return "charts";
          if (id.includes("/xlsx/")) return "xlsx";
          if (id.includes("/react-router") || id.includes("@remix-run")) return "router";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "react";
          }
          return "vendor";
        },
      },
    },
  },
  /**
   * SPA history fallback: `vite preview` serves index.html for unknown paths.
   * Render Static Sites: see `public/_redirects` (`/* /index.html 200`).
   */
  css: {
    postcss: "./postcss.config.js",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
