/**
 * Helpers for supervisor CSV/PDF exports — presentation only; data comes from API responses as-is.
 */

import { canonicalViolationType, getViolationLabel } from "./violationLabels.js";
import { riyadhYmd } from "./reportDatePresets.js";

export const REPORT_PLATFORM_TITLE_AR = "عين الجودة";
export const REPORT_PLATFORM_TAGLINE_AR = "المنصة الذكية لمراقبة معايير الجودة في المطابخ";

export function parseYmdBounds(fromStr, toStr) {
  const from = String(fromStr || "").trim();
  const to = String(toStr || "").trim();
  let start = null;
  let end = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    start = new Date(`${from}T00:00:00`).getTime();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    end = new Date(`${to}T23:59:59.999`).getTime();
  }
  return { start, end };
}

export function inDateRange(iso, start, end) {
  if (start == null && end == null) return true;
  const t = new Date(iso || 0).getTime();
  if (!Number.isFinite(t)) return false;
  if (start != null && t < start) return false;
  if (end != null && t > end) return false;
  return true;
}

export function formatReportPeriodLabel(dateFrom, dateTo) {
  const f = String(dateFrom || "").trim();
  const t = String(dateTo || "").trim();
  if (!f && !t) return "كل الفترات (حسب البيانات المحمّلة)";
  return `من ${f || "—"} إلى ${t || "—"}`;
}

export function formatReportDateYmd() {
  return riyadhYmd();
}

export function taeenReportFilename(suffix) {
  return `taeen-quality-${suffix}-report-${formatReportDateYmd()}.csv`;
}

/** Match Dashboard display for alert confidence in monitoring cards. */
export function formatMonitoringConfidencePercent(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return "غير متوفر";
  const pct = n <= 1 ? n * 100 : n;
  if (pct <= 0) return "غير متوفر";
  return `${Math.round(pct * 10) / 10}%`;
}

/** Match `alertSeverityBadgeMeta` labels (monitoring alerts). */
export function monitoringSeverityLabelAr(confidence) {
  const n = Number(confidence);
  if (!Number.isFinite(n)) {
    return "خطورة غير محددة";
  }
  if (n >= 85) return "خطورة عالية";
  if (n >= 55) return "تحذير";
  return "منخفض";
}

export function monitoringAlertStatusArExport(status) {
  const s = String(status || "").toLowerCase();
  if (s === "open") return "مفتوح";
  if (s === "new") return "يحتاج مراجعة";
  if (s === "needs_review") return "يحتاج مراجعة";
  if (s === "resolved") return "تمت المعالجة";
  return String(status || "—").trim() || "—";
}

export function dishReviewStatusArExport(status) {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "معتمد";
  if (s === "rejected") return "مرفوض";
  if (s === "pending_review" || s === "needs_review") return "يحتاج مراجعة";
  if (!s) return "—";
  return String(status);
}

/**
 * Arabic-only violation label; never emit raw snake_case keys.
 * Prefer API `label_ar` when it is non-empty and not a technical key.
 */
export function violationTypeLabelForReport(row) {
  const rawType = String(row?.type || row?.violation_type || "").trim();
  const fromApi = String(row?.label_ar || "").trim();
  const looksTechnical = (t) => /^[a-z][a-z0-9_]*$/i.test(t);
  if (fromApi && !looksTechnical(fromApi)) {
    return fromApi;
  }
  if (rawType) {
    const key = canonicalViolationType(rawType);
    return getViolationLabel(key || rawType);
  }
  if (fromApi) {
    return fromApi;
  }
  return "غير محدد";
}

export function formatAlertBranchArea(row) {
  const br = String(row?.branch_name || row?.branch || "").trim();
  const loc = String(row?.location || "").trim();
  if (br && loc) return `${br} / ${loc}`;
  if (br) return br;
  if (loc) return loc;
  return "—";
}

const DISH_KEY_SEP = "\u{1F}";

/**
 * Aggregates dish review records by dish + branch for the given date window.
 * `reviewRecords` should already match active API filters.
 */
export function buildDishBranchPeriodRows(reviewRecords, dateFrom, dateTo) {
  const range = parseYmdBounds(dateFrom, dateTo);
  const map = new Map();
  for (const r of reviewRecords || []) {
    if (!inDateRange(r?.recorded_at, range.start, range.end)) continue;
    const branch = String(r?.branch_name || r?.branch || "").trim() || "غير محدد";
    const dish = String(r?.confirmed_label || r?.predicted_label || "").trim() || "غير محدد";
    const key = `${dish}${DISH_KEY_SEP}${branch}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  const periodLabel = formatReportPeriodLabel(dateFrom, dateTo);
  return Array.from(map.entries())
    .map(([key, count]) => {
      const [dish, branch] = key.split(DISH_KEY_SEP);
      return { dish, branch, count, periodLabel };
    })
    .sort((a, b) => b.count - a.count || a.dish.localeCompare(b.dish, "ar"));
}
