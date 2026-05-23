import { API_BASE_URL, PRODUCTION_API_ORIGIN } from "../config/apiBase.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

/**
 * Render free tier cold start can exceed 30s but the auth fetch itself already
 * has a 90s timeout, so a single best-effort wake ping is enough — multi-retry
 * stacked timeouts were causing perceived "frozen" login UI on slow networks.
 */
const WAKE_TIMEOUT_MS = 25_000;
const WAKE_ATTEMPTS = 1;

/** Skip wake ping if API responded within the last 5 minutes. */
const WAKE_FRESH_MS = 5 * 60_000;
let _lastAliveMs = 0;
let _inFlightWake = null;

function apiBase() {
  return (API_BASE_URL || PRODUCTION_API_ORIGIN).replace(/\/+$/, "");
}

/** Paths to probe — `/` always exists; `/health` on newer backend deploys. */
function wakeUrls() {
  const base = apiBase();
  return [`${base}/`, `${base}/health`];
}

/** Any HTTP response (not a network error) means the host is reachable. */
function isReachableResponse(res) {
  return res.status > 0 && res.status < 502;
}

/** Call this after any successful API response to skip the next wake probe. */
export function markApiAlive() {
  _lastAliveMs = Date.now();
}

/**
 * Best-effort ping so Render wakes the service.
 * Single in-flight request is shared across callers; the auth fetch retains its
 * own 90s timeout so we never block the user on this probe.
 * @returns {Promise<boolean>} true if API responded
 */
export async function wakeApiBeforeAuth() {
  if (Date.now() - _lastAliveMs < WAKE_FRESH_MS) return true;
  if (_inFlightWake) return _inFlightWake;
  _inFlightWake = (async () => {
    const urls = wakeUrls();
    for (let attempt = 1; attempt <= WAKE_ATTEMPTS; attempt += 1) {
      for (const url of urls) {
        try {
          const res = await fetchWithTimeout(
            url,
            { method: "GET", headers: { Accept: "application/json" } },
            WAKE_TIMEOUT_MS,
          );
          if (isReachableResponse(res)) {
            _lastAliveMs = Date.now();
            return true;
          }
        } catch (err) {
          if (attempt === WAKE_ATTEMPTS && url === urls[urls.length - 1]) {
            console.warn("[wakeApi] API unreachable", apiBase(), err);
          }
        }
      }
    }
    return false;
  })().finally(() => {
    _inFlightWake = null;
  });
  return _inFlightWake;
}
