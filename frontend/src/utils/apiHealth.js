import { API_BASE_URL, PRODUCTION_API_ORIGIN } from "../config/apiBase.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

/** Skip redundant /health probes for a few minutes after any successful API call. */
let _lastAliveMs = 0;
const ALIVE_FRESH_MS = 5 * 60_000;

export function markApiAlive() {
  _lastAliveMs = Date.now();
}

export function isApiRecentlyAlive() {
  return Date.now() - _lastAliveMs < ALIVE_FRESH_MS;
}

/** Connection state shown in supervisor/admin monitoring UI. */
export const API_STATUS = {
  CHECKING: "checking",
  ONLINE: "online",
  OFFLINE: "offline",
  WAKING: "waking",
};

export const API_STATUS_LABEL_AR = {
  checking: "جاري التحقق من الخادم…",
  online: "الخادم متصل",
  offline: "الخادم غير متصل",
  waking: "جاري إعادة تشغيل الخادم، انتظر دقيقة",
};

export function apiStatusLabelAr(status) {
  return API_STATUS_LABEL_AR[status] || API_STATUS_LABEL_AR.checking;
}

function apiOrigin() {
  return (API_BASE_URL || PRODUCTION_API_ORIGIN).replace(/\/+$/, "");
}

function probeUrls() {
  const base = apiOrigin();
  return [`${base}/health`, `${base}/`];
}

function isRenderWakingHttp(status) {
  return status === 502 || status === 503 || status === 504;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Probe backend reachability (Render cold start aware).
 * @returns {Promise<{ status: string, reachable: boolean, httpStatus?: number }>}
 */
export async function probeApiHealth(options = {}) {
  const maxAttempts = options.maxAttempts ?? (import.meta.env.PROD ? 3 : 2);
  const timeoutMs = options.timeoutMs ?? (import.meta.env.PROD ? 45_000 : 20_000);
  const urls = probeUrls();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    for (const url of urls) {
      try {
        const res = await fetchWithTimeout(
          url,
          { method: "GET", headers: { Accept: "application/json" } },
          timeoutMs,
        );
        if (res.status === 200) {
          markApiAlive();
          return { status: API_STATUS.ONLINE, reachable: true, httpStatus: res.status };
        }
        if (isRenderWakingHttp(res.status)) {
          if (attempt < maxAttempts) {
            await sleep(4000);
            break;
          }
          return { status: API_STATUS.WAKING, reachable: false, httpStatus: res.status };
        }
        // Host answered (404 on wrong path still means API process is up).
        if (res.status > 0 && res.status < 500) {
          markApiAlive();
          return { status: API_STATUS.ONLINE, reachable: true, httpStatus: res.status };
        }
      } catch (err) {
        const isTimeout = err?.code === "TIMEOUT";
        const isNetwork = err instanceof TypeError;
        if (attempt < maxAttempts && isTimeout) {
          await sleep(3000);
          break;
        }
        if (isTimeout) {
          return { status: API_STATUS.WAKING, reachable: false, reason: "timeout" };
        }
        if (isNetwork) {
          return { status: API_STATUS.OFFLINE, reachable: false, reason: "network" };
        }
        if (attempt === maxAttempts) {
          return { status: API_STATUS.OFFLINE, reachable: false, reason: String(err?.message || err) };
        }
      }
    }
  }
  return { status: API_STATUS.OFFLINE, reachable: false };
}

/**
 * Arabic message for failed supervisor data loads (cameras, alerts, AI status).
 */
export function supervisorDataLoadErrorAr(resourceLabel, { status, err, apiStatus, detail } = {}) {
  if (status === 401) return null;
  if (status === 403) {
    return typeof detail === "string" && detail.trim()
      ? detail
      : `ليس لديك صلاحية لتحميل ${resourceLabel}.`;
  }
  if (apiStatus === API_STATUS.OFFLINE) {
    return `الخادم غير متصل — تعذر تحميل ${resourceLabel}. تحقق من الاتصال أو أعد تحميل الصفحة.`;
  }
  if (apiStatus === API_STATUS.WAKING) {
    return `جاري إعادة تشغيل الخادم، انتظر دقيقة — تعذر تحميل ${resourceLabel}.`;
  }
  if (err?.code === "TIMEOUT") {
    return `انتهت مهلة تحميل ${resourceLabel}. أول طلب بعد إيقاف الخادم قد يستغرق دقيقة.`;
  }
  if (err instanceof TypeError) {
    return `تعذر الاتصال بالخادم — تعذر تحميل ${resourceLabel}.`;
  }
  if (typeof detail === "string" && detail.trim()) return detail;
  if (status && status >= 500) {
    return `خطأ في الخادم (${status}) — تعذر تحميل ${resourceLabel}.`;
  }
  return `تعذر تحميل ${resourceLabel}.`;
}
