import { API_BASE_URL, PRODUCTION_API_ORIGIN } from "../config/apiBase.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

/** Render free tier cold start can exceed 30s. */
const WAKE_TIMEOUT_MS = 90_000;
const WAKE_ATTEMPTS = 3;

/** Skip wake ping if API responded within the last 90 seconds. */
const WAKE_FRESH_MS = 90_000;
let _lastAliveMs = 0;

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
 * Ping API before auth so Render wakes the service.
 * Skipped if the API was successfully reached within the last 90 seconds.
 * @returns {Promise<boolean>} true if API responded
 */
export async function wakeApiBeforeAuth() {
  if (Date.now() - _lastAliveMs < WAKE_FRESH_MS) return true;

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
          console.warn("[wakeApi] API unreachable after retries", apiBase(), err);
        }
      }
    }
  }
  return false;
}
