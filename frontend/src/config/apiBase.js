/**
 * Production: static frontend on Render calls API on another host.
 *
 * Priority (production):
 * 1) VITE_API_BASE_URL (Render Static Site → Environment, build time)
 * 2) Known pairing fallback for taeen-quality-frontend.onrender.com
 * 3) Dev only: localStorage `ska_api_base`
 */
function normalizeBase(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\/+$/, "");
}

export const PRODUCTION_API_ORIGIN = "https://taeen-quality-platform.onrender.com";

function storageApiBase() {
  if (typeof window === "undefined") return "";
  if (import.meta.env.PROD) return "";
  try {
    const v = window.localStorage?.getItem("ska_api_base");
    if (v && /^https?:\/\//i.test(v)) return normalizeBase(v);
  } catch {
    /* private mode */
  }
  return "";
}

/** When VITE_API_BASE_URL was not baked into the build. */
function inferProductionApiBase() {
  if (typeof window === "undefined") return "";
  if (!import.meta.env.PROD) return "";
  const h = String(window.location.hostname || "").toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return "";
  return PRODUCTION_API_ORIGIN;
}

/** Clear stale overrides that pointed login at a dead host. */
export function clearStaleApiBaseOverride() {
  if (typeof window === "undefined" || !import.meta.env.PROD) return;
  try {
    const v = window.localStorage?.getItem("ska_api_base");
    if (!v) return;
    const n = normalizeBase(v);
    if (n && n !== PRODUCTION_API_ORIGIN) {
      window.localStorage.removeItem("ska_api_base");
    }
  } catch {
    /* ignore */
  }
}

clearStaleApiBaseOverride();

const fromEnv = normalizeBase(import.meta.env.VITE_API_BASE_URL);

export const API_BASE_URL = fromEnv || inferProductionApiBase() || storageApiBase();

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
