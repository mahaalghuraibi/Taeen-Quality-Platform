/**
 * Production: static frontend on Render calls API on another host.
 *
 * Priority (development):
 * 1) VITE_API_BASE_URL (build-time)
 * 2) localStorage `ska_api_base` (dev override only)
 *
 * Production always uses exactly PRODUCTION_API_ORIGIN (or VITE_API_BASE_URL if set at build).
 */
function normalizeBase(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\/+$/, "");
}

/** Canonical production backend — do not add fallback hosts here. */
export const PRODUCTION_API_ORIGIN = "https://taeen-quality-platform.onrender.com";

/** @deprecated Use PRODUCTION_API_ORIGIN only; kept so older imports do not break. */
export const PRODUCTION_API_CANDIDATES = [PRODUCTION_API_ORIGIN];

const RUNTIME_API_BASE_KEY = "ska_runtime_api_base";
const LOCAL_API_BASE_KEY = "ska_api_base";
let _runtimeApiBase = "";

export function isCanonicalProductionApiBase(raw) {
  return normalizeBase(raw) === PRODUCTION_API_ORIGIN;
}

export function setRuntimeApiBase(raw) {
  const next = normalizeBase(raw);
  if (!next) return;
  if (import.meta.env.PROD && !isCanonicalProductionApiBase(next)) return;
  _runtimeApiBase = next;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem(RUNTIME_API_BASE_KEY, _runtimeApiBase);
  } catch {
    /* private mode */
  }
}

function loadRuntimeApiBase() {
  if (import.meta.env.PROD) return "";
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
  if (typeof window === "undefined" || import.meta.env.PROD) return "";
  try {
    const v = window.localStorage?.getItem(LOCAL_API_BASE_KEY);
    if (v && /^https?:\/\//i.test(v)) return normalizeBase(v);
  } catch {
    /* private mode */
  }
  return "";
}

/** Last-resort when VITE_API_BASE_URL was not baked into the build. */
function inferProductionApiBase() {
  if (typeof window === "undefined" || !import.meta.env.PROD) return "";
  const h = String(window.location.hostname || "").toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return "";
  return PRODUCTION_API_ORIGIN;
}

function shouldClearStoredApiBase(raw) {
  const n = normalizeBase(raw);
  if (!n) return false;
  if (import.meta.env.PROD) return !isCanonicalProductionApiBase(n);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(n)) return true;
  return false;
}

/**
 * On production startup, drop cached API hosts (localStorage / sessionStorage) that are
 * not the canonical Render backend — common cause of mobile login/register failures.
 */
export function clearStaleApiBaseOverride() {
  if (typeof window === "undefined") return;
  try {
    const local = window.localStorage?.getItem(LOCAL_API_BASE_KEY);
    if (local && shouldClearStoredApiBase(local)) {
      window.localStorage.removeItem(LOCAL_API_BASE_KEY);
    }
  } catch {
    /* ignore */
  }
  try {
    const session = window.sessionStorage?.getItem(RUNTIME_API_BASE_KEY);
    if (session && shouldClearStoredApiBase(session)) {
      window.sessionStorage.removeItem(RUNTIME_API_BASE_KEY);
      _runtimeApiBase = "";
    }
  } catch {
    /* ignore */
  }
}

clearStaleApiBaseOverride();

/** Local dev: point fetch at the FastAPI backend (port 8000). */
function devApiBaseDefault() {
  if (import.meta.env.PROD) return "";
  if (typeof window === "undefined") return "http://127.0.0.1:8000";
  const h = String(window.location.hostname || "").toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return "http://127.0.0.1:8000";
  return "";
}

function resolveApiBase() {
  const fromEnv = normalizeBase(import.meta.env.VITE_API_BASE_URL);
  if (import.meta.env.PROD) {
    return fromEnv || inferProductionApiBase() || PRODUCTION_API_ORIGIN;
  }
  return (
    fromEnv ||
    loadRuntimeApiBase() ||
    devApiBaseDefault() ||
    storageApiBase()
  );
}

export const API_BASE_URL = resolveApiBase();

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
