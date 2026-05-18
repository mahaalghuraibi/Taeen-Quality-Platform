import { API_BASE_URL, PRODUCTION_API_ORIGIN } from "../config/apiBase.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

/** Render free tier cold start can exceed 30s. */
const WAKE_TIMEOUT_MS = 90_000;
const WAKE_ATTEMPTS = 3;

function healthUrl() {
  const base = (API_BASE_URL || PRODUCTION_API_ORIGIN).replace(/\/+$/, "");
  return `${base}/`;
}

/**
 * Ping API root before auth so Render wakes the service and the browser does not hit a 30s abort.
 * @returns {Promise<boolean>} true if API responded
 */
export async function wakeApiBeforeAuth() {
  const url = healthUrl();
  for (let attempt = 1; attempt <= WAKE_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetchWithTimeout(
        url,
        { method: "GET", headers: { Accept: "application/json" } },
        WAKE_TIMEOUT_MS,
      );
      if (res.ok) return true;
    } catch (err) {
      if (attempt === WAKE_ATTEMPTS) {
        console.warn("[wakeApi] API unreachable after retries", url, err);
      }
    }
  }
  return false;
}
