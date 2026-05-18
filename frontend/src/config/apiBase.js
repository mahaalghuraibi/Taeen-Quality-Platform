/**
 * Production: static frontend on Render (or CDN) calls API on another host.
 *
 * Priority:
 * 1) Build-time: VITE_API_BASE_URL (recommended on Render Static Site → Environment → Build)
 * 2) Runtime: localStorage key `ska_api_base` = full origin, e.g. https://taeen-quality-platform.onrender.com
 * 3) Fallback: known Render hostname pairing (only when env unset — avoids silent same-origin /api failures)
 *
 * Dev: leave unset — Vite proxies `/api` to the backend (see vite.config.js).
 */
function normalizeBase(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function storageApiBase() {
  if (typeof window === "undefined") return "";
  try {
    const v = window.localStorage?.getItem("ska_api_base");
    if (v && /^https?:\/\//i.test(v)) return normalizeBase(v);
  } catch {
    /* private mode */
  }
  return "";
}

const PRODUCTION_API_ORIGIN = "https://taeen-quality-platform.onrender.com";

/** Last-resort when VITE_API_BASE_URL was not baked into the build. */
function inferProductionApiBase() {
  if (typeof window === "undefined") return "";
  if (!import.meta.env.PROD) return "";
  const h = String(window.location.hostname || "").toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return "";
  return PRODUCTION_API_ORIGIN;
}

const fromEnv = normalizeBase(import.meta.env.VITE_API_BASE_URL);

export const API_BASE_URL = fromEnv || storageApiBase() || inferProductionApiBase();

/**
 * @param {string} path - Absolute path starting with `/` or full `http(s)://`, `blob:`, `data:` URL.
 */
export function apiUrl(path) {
  const s = String(path ?? "").trim();
  if (!s) return s;
  if (/^(https?:|blob:|data:)/i.test(s)) return s;
  const p = s.startsWith("/") ? s : `/${s}`;
  if (!API_BASE_URL) return p;
  return `${API_BASE_URL}${p}`;
}
