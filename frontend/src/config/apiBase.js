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

/** Known Render backend hosts (try in order during login if primary is down). */
export const PRODUCTION_API_CANDIDATES = [
  "https://taeen-quality-platform.onrender.com",
  "https://taeen-backend.onrender.com",
];

/** Primary production backend (build-time default). */
export const PRODUCTION_API_ORIGIN = PRODUCTION_API_CANDIDATES[0];

const RUNTIME_API_BASE_KEY = "ska_runtime_api_base";
let _runtimeApiBase = "";

export function setRuntimeApiBase(raw) {
  _runtimeApiBase = normalizeBase(raw);
  if (typeof window === "undefined" || !_runtimeApiBase) return;
  try {
    window.sessionStorage?.setItem(RUNTIME_API_BASE_KEY, _runtimeApiBase);
  } catch {
    /* private mode */
  }
}

function loadRuntimeApiBase() {
  if (_runtimeApiBase) return _runtimeApiBase;
  if (typeof window === "undefined") return "";
  try {
    const v = window.sessionStorage?.getItem(RUNTIME_API_BASE_KEY);
    _runtimeApiBase = normalizeBase(v);
  } catch {
    _runtimeApiBase = "";
  }
  return _runtimeApiBase;
}

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
    if (STALE_API_BASE_HOSTS.includes(n)) {
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

function resolveApiBase() {
  const fromEnvNow = normalizeBase(import.meta.env.VITE_API_BASE_URL);
  return (
    fromEnvNow ||
    loadRuntimeApiBase() ||
    inferProductionApiBase() ||
    devApiBaseDefault() ||
    storageApiBase()
  );
}

const fromEnv = normalizeBase(import.meta.env.VITE_API_BASE_URL);
const runtimeBase = loadRuntimeApiBase();

export const API_BASE_URL =
  fromEnv || runtimeBase || inferProductionApiBase() || devApiBaseDefault() || storageApiBase();

/**
 * @param {string} path - Absolute path starting with `/` or full `http(s)://`, `blob:`, `data:` URL.
 */
export function apiUrl(path) {
  const s = String(path ?? "").trim();
  if (!s) return s;
  if (/^(https?:|blob:|data:)/i.test(s)) return s;
  const p = s.startsWith("/") ? s : `/${s}`;
  const base = resolveApiBase();
  if (!base) return p;
  return `${base}${p}`;
}
