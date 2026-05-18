import { API_BASE_URL, PRODUCTION_API_ORIGIN } from "../config/apiBase.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

/** Render free tier cold start can exceed 30s. */
const WAKE_TIMEOUT_MS = 90_000;
const WAKE_ATTEMPTS = 3;

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

/**
 * Ping API before auth so Render wakes the service.
 * @returns {Promise<boolean>} true if API responded
 */
export async function wakeApiBeforeAuth() {
  const urls = wakeUrls();
  for (let attempt = 1; attempt <= WAKE_ATTEMPTS; attempt += 1) {
    for (const url of urls) {
      try {
        const res = await fetchWithTimeout(
          url,
          { method: "GET", headers: { Accept: "application/json" } },
          WAKE_TIMEOUT_MS,
        );
        if (isReachableResponse(res)) return true;
      } catch (err) {
        if (attempt === WAKE_ATTEMPTS && url === urls[urls.length - 1]) {
          console.warn("[wakeApi] API unreachable after retries", apiBase(), err);
        }
      }
    }
  }
  return false;
}
