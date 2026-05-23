/** Default HTTP timeout for API calls (ms). */
export const DEFAULT_FETCH_TIMEOUT_MS = 45_000;

/**
 * Login / register / profile bootstrap.
 * Render free tier cold start can exceed 30s, so production allows 60s — but we
 * keep it tight enough that a stalled connection surfaces a clear error message
 * instead of an indefinite freeze.
 */
export const AUTH_FETCH_TIMEOUT_MS = import.meta.env.PROD ? 60_000 : 25_000;

/** Monitoring frame analysis (YOLO download + first inference on Render can be slow). */
export const MONITORING_FETCH_TIMEOUT_MS = import.meta.env.PROD ? 180_000 : 90_000;

/**
 * fetch() with AbortController timeout. Rejects with err.code === "TIMEOUT" on expiry.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
      timeoutErr.code = "TIMEOUT";
      timeoutErr.url = url;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

/** User-facing Arabic message for failed network / timeout. */
export function formatMonitoringFetchError(err, fallback = "تعذر تحليل الصورة أو تسجيل المخالفة.") {
  if (err?.code === "TIMEOUT") {
    return "انتهت مهلة التحليل. أول طلب بعد إيقاف الخادم قد يستغرق 1–3 دقائق لتحميل النظام. حاول مرة أخرى.";
  }
  return formatFetchError(err, fallback);
}

export function formatFetchError(err, fallback = "تعذر الاتصال بالخادم.") {
  if (err?.code === "TIMEOUT") {
    return "انتهت مهلة الاتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.";
  }
  if (err instanceof TypeError) {
    return "تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت.";
  }
  return fallback;
}
