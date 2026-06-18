import { API_BASE_URL, PRODUCTION_API_ORIGIN } from "../config/apiBase.js";
import { isApiRecentlyAlive, markApiAlive, probeApiHealth } from "./apiHealth.js";

export { markApiAlive } from "./apiHealth.js";

/**
 * Render free tier cold start can exceed 30–90s. probeApiHealth retries /health
 * with a long timeout so the dashboard does not show "offline" during wake-up.
 */
const WAKE_TIMEOUT_MS = import.meta.env.PROD ? 45_000 : 25_000;
const WAKE_ATTEMPTS = import.meta.env.PROD ? 3 : 1;

let _inFlightWake = null;

function apiBase() {
  return (API_BASE_URL || PRODUCTION_API_ORIGIN).replace(/\/+$/, "");
}

/**
 * Best-effort ping so Render wakes the service.
 * Single in-flight request is shared across callers.
 * @param {{ maxAttempts?: number, timeoutMs?: number }} [options]
 * @returns {Promise<boolean>} true if API responded with HTTP 200 on /health or /
 */
export async function wakeApiBeforeAuth(options = {}) {
  if (isApiRecentlyAlive()) return true;
  if (_inFlightWake) return _inFlightWake;
  const maxAttempts = options.maxAttempts ?? WAKE_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? WAKE_TIMEOUT_MS;
  _inFlightWake = (async () => {
    const result = await probeApiHealth({ maxAttempts, timeoutMs });
    if (result.reachable) {
      markApiAlive();
      return true;
    }
    if (result.status === "waking") {
      console.warn("[wakeApi] API waking (cold start)", apiBase());
    } else {
      console.warn("[wakeApi] API unreachable", apiBase(), result.reason || "");
    }
    return false;
  })().finally(() => {
    _inFlightWake = null;
  });
  return _inFlightWake;
}
