/** Gap between live auto-analysis frames (YOLO on Render needs several seconds per frame). */
export const LIVE_ANALYSIS_GAP_MS = import.meta.env.PROD ? 10_000 : 5_000;

export const YOLO_BUSY_DETAIL_AR = "التحليل السابق ما زال قيد المعالجة";

/** Server skipped this frame because YOLO was still busy — not a user-facing error. */
export function isMonitoringSkippedResponse(status, body) {
  if (body?.status === "skipped_busy") return true;
  const detail = typeof body?.detail === "string" ? body.detail.trim() : "";
  return detail === YOLO_BUSY_DETAIL_AR || detail.includes("قيد المعالجة");
}

export function isMonitoringAnalyzeSuccess(status, body) {
  if (isMonitoringSkippedResponse(status, body)) return false;
  return status >= 200 && status < 300 && body?.ok !== false;
}
