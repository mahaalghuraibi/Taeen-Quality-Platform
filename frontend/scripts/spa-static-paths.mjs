/**
 * Render Static Sites (and similar CDNs) return 404 when no file exists at the path.
 * Blueprint rewrite rules may not sync; this mirrors index.html into each app route
 * directory so GET /login, /dashboard, etc. return HTTP 200 with the SPA shell.
 *
 * Dynamic segments (/alerts/42, /cameras/3) still need CDN rewrite /* → /index.html
 * when available. Top-level and fixed nested paths are covered here.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const indexHtml = join(distDir, "index.html");

/** Paths from App.jsx (no leading slash). */
const ROUTE_DIRS = [
  "login",
  "signup",
  "register",
  "admin-request",
  "admin/users",
  "admin/requests",
  "admin/branches",
  "dashboard",
  "dashboard/search",
  "dashboard/records",
  "analytics",
  "alerts",
  "cameras",
  "reports",
  "dish-reviews",
  "employees",
  "settings",
  "mask-check",
  "people-count-check",
  "supervisor",
  "monitoring",
];

if (!existsSync(indexHtml)) {
  console.error("spa-static-paths: dist/index.html missing — run vite build first.");
  process.exit(1);
}

let written = 0;
for (const route of ROUTE_DIRS) {
  const dir = join(distDir, route);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, "index.html");
  copyFileSync(indexHtml, target);
  written += 1;
}

console.log(`spa-static-paths: wrote ${written} route index.html copies under dist/`);
