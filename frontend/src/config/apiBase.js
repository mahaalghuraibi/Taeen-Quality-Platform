/**
 * Production: static frontend on Render calls API on another host.
 *
 * Priority:
 * 1) VITE_API_BASE_URL (set at build time on Render / Railway)
 * 2) Known Render pairing fallback (taeen-quality-frontend → taeen-quality-platform)
 * 3) Dev only: localStorage `ska_api_base`
 */
function normalizeBase(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\/+$/, "");
}

/** Render production backend (used when VITE_API_BASE_URL is missing from the build). */
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

/** Last-resort when VITE_API_BASE_URL was not baked into the build. */
function inferProductionApiBase() {
  if (typeof window === "undefined") return "";
  if (!import.meta.env.PROD) return "";
  const h = String(window.location.hostname || "").toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return "";
  return PRODUCTION_API_ORIGIN;
}

/** Legacy/wrong hosts that break production if left in localStorage. */
const STALE_API_BASE_HOSTS = [
  "https://ska-backend.onrender.com",
  "http://ska-backend.onrender.com",
];

export function clearStaleApiBaseOverride() {
  if (typeof window === "undefined" || !import.meta.env.PROD) return;
  try {
    const v = window.localStorage?.getItem("ska_api_base");
    if (!v) return;
    const n = normalizeBase(v);
    if (!n) return;
    if (STALE_API_BASE_HOSTS.includes(n) || n !== PRODUCTION_API_ORIGIN) {
      window.localStorage.removeItem("ska_api_base");
    }
  } catch {
    /* ignore */
  }
}

clearStaleApiBaseOverride();

/** Local dev: point <img src> and fetch at the FastAPI backend (port 8000). */
function devApiBaseDefault() {
  if (import.meta.env.PROD) return "";
  if (typeof window === "undefined") return "http://127.0.0.1:8000";
  const h = String(window.location.hostname || "").toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return "http://127.0.0.1:8000";
  return "";
}

const fromEnv = normalizeBase(import.meta.env.VITE_API_BASE_URL);

export const API_BASE_URL =
  fromEnv || inferProductionApiBase() || devApiBaseDefault() || storageApiBase();

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
