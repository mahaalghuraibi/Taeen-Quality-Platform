/**
 * Post-build SPA fallback for static hosts (Render, Netlify, Cloudflare Pages).
 * Copies index.html → 404.html so hosts that serve 404.html for unknown paths
 * still boot React Router instead of showing a generic "Not Found" page.
 */
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const indexHtml = join(distDir, "index.html");
const fallbackHtml = join(distDir, "404.html");

if (!existsSync(indexHtml)) {
  console.error("spa-fallback: dist/index.html not found — run vite build first.");
  process.exit(1);
}

copyFileSync(indexHtml, fallbackHtml);
console.log("spa-fallback: wrote dist/404.html from index.html");
