import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AOS from "aos";
import "aos/dist/aos.css";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ACCESS_TOKEN_KEY, CURRENT_USER_ME_URLS } from "../constants.js";
import { apiUrl } from "../config/apiBase.js";
import { dishSaveErrorMessage } from "../utils/apiError.js";
import { formatConfidencePercentDisplay } from "../utils/confidence.js";
import { useDetectDish } from "../hooks/useDetectDish.js";
import { useDishRecords } from "../hooks/useDishRecords.js";
import { useDashboardAuth } from "../hooks/useDashboardAuth.js";
import { useToastStore } from "../stores/useToastStore.js";
import {
  formatSaudiDateLine,
  formatSaudiDateTime,
  formatSaudiTimeLine,
} from "../utils/datetime.js";
import { computeDishStats, filterAndSortDishRecords } from "../utils/dishRecordsDisplay.js";
import DashboardNav from "../components/navigation/DashboardNav.jsx";
import Toast from "../components/shared/Toast.jsx";
import DeleteConfirmModal from "../components/shared/DeleteConfirmModal.jsx";
import DishDocSection from "../components/dish/DishDocSection.jsx";
import DishFilters from "../components/dish/DishFilters.jsx";
import RecordsList from "../components/dish/RecordsList.jsx";
import EditRecordModal from "../components/dish/EditRecordModal.jsx";
import StaffProfileCard from "../components/staff/StaffProfileCard.jsx";
import CameraCaptureSection from "../components/camera/CameraCaptureSection.jsx";
import RestaurantCameraCard from "../components/monitoring/RestaurantCameraCard.jsx";
import LiveMonitoringZoneCards from "../components/monitoring/LiveMonitoringZoneCards.jsx";
import SupervisorExecutiveHero from "../components/supervisor/SupervisorExecutiveHero.jsx";
import SupervisorSummaryCards from "../components/supervisor/SupervisorSummaryCards.jsx";
import SupervisorMonitoringOverview from "../components/supervisor/SupervisorMonitoringOverview.jsx";
import SupervisorAnalyticsRecharts from "../components/supervisor/SupervisorAnalyticsRecharts.jsx";
import ReportsAnalyticsCharts from "../components/supervisor/ReportsAnalyticsCharts.jsx";
import StickyAnalyticsSummaryBar from "../components/supervisor/StickyAnalyticsSummaryBar.jsx";
import ExpandMoreList from "../components/shared/ExpandMoreList.jsx";
import { useExpandMoreList } from "../hooks/useExpandMoreList.js";
import EmptyState from "../components/shared/EmptyState.jsx";
import { PLATFORM_BRAND, dashboardTitleForRole } from "../constants/branding.js";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  MONITORING_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  formatMonitoringFetchError,
} from "../utils/fetchWithTimeout.js";
import {
  isMonitoringAnalyzeSuccess,
  isMonitoringSkippedResponse,
  LIVE_ANALYSIS_GAP_MS,
} from "../utils/monitoringApi.js";
import { wakeApiBeforeAuth, markApiAlive } from "../utils/wakeApi.js";
import {
  STAFF_SECTION_IDS,
  SUPERVISOR_SECTION_IDS,
  ROUTES,
  staffPathFromSectionId,
  supervisorPathFromSectionId,
  getStaffSectionFromPathname,
  getSupervisorSectionFromPathname,
  isStaffDashboardPath,
  isSupervisorDashboardPath,
  legacyHashRedirectPath,
  DASHBOARD_PAGE_TITLES,
} from "../constants/appRoutes.js";
import { SECTION_THEME } from "../constants/dashboardTheme.js";
import {
  canonicalViolationType as canonicalMonitoringViolationType,
  getViolationLabel,
  VIOLATION_CATEGORY_KEYS_ORDER,
} from "../utils/violationLabels.js";
import {
  REPORT_PLATFORM_TAGLINE_AR,
  REPORT_PLATFORM_TITLE_AR,
  buildDishBranchPeriodRows,
  dishReviewStatusArExport,
  formatAlertBranchArea,
  formatMonitoringConfidencePercent,
  formatReportDateYmd,
  formatReportPeriodLabel,
  monitoringAlertStatusArExport,
  monitoringSeverityLabelAr,
  taeenReportFilename,
  violationTypeLabelForReport,
} from "../utils/reportExportHelpers.js";
import {
  MONITORING_ZONE_DEFINITIONS,
  findCameraForZone,
  alertsForZone,
  todayIsoDateLocal,
  isAlertToday,
} from "../constants/monitoringZones.js";
import {
  RESTAURANT_CONNECTION_TYPES,
  loadRestaurantCameraConfigs,
  persistRestaurantCameraConfigs,
  prepareSavePayload,
  validateRestaurantCameraDraft,
  mergeRestaurantCameraDefaults,
} from "../lib/restaurantCameraStorage.js";

/** Merge API `avatar_url` / `avatar_data_url` for UI + `<img src>`. */
function normalizeStaffMeUser(body) {
  if (!body || typeof body !== "object") return body;
  const rawAvatar = body.avatar_url ?? body.avatar_data_url ?? null;
  const avatar =
    typeof rawAvatar === "string" && rawAvatar.startsWith("/api/") ? apiUrl(rawAvatar) : rawAvatar;
  const email = String(body.email || "").trim().toLowerCase();
  const local = email.includes("@") ? email.split("@")[0].trim() : "";
  const username = String(body.username || "").trim().toLowerCase() || local;
  const branch_id = Number(body.branch_id);
  const branch_name = String(body.branch_name || "").trim() || "فرع تجريبي";
  const supervisor_name = String(body.supervisor_name || "").trim() || "supervisor";
  return {
    ...body,
    username,
    branch_id: Number.isFinite(branch_id) ? branch_id : 1,
    branch_name,
    supervisor_name,
    avatar_url: avatar,
    avatar_data_url: avatar,
  };
}

function IconBell({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 22a2.5 2.5 0 002.45-2H9.55A2.5 2.5 0 0012 22z"
        fill="currentColor"
      />
      <path
        d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconDish({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <ellipse cx="12" cy="14" rx="8" ry="4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4 14c0-4 3.5-8 8-8s8 4 8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconChart({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19V5M4 19h16M8 17V11M12 17V8M16 17v-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconActivity({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner({ className = "h-5 w-5 border-2 border-white/25 border-t-white" }) {
  return (
    <span
      className={`inline-block shrink-0 animate-spin rounded-full ${className}`}
      aria-hidden
    />
  );
}

function SkeletonPulse({ className = "" }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-gradient-to-l from-white/[0.04] to-white/[0.09] ${className}`}
      aria-hidden
    />
  );
}

function downloadUtf8Csv(filename, headerRow, rows, options = {}) {
  const { preambleRows = [] } = options;
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const preambleLines = preambleRows.map((r) =>
    Array.isArray(r) ? r.map(esc).join(",") : esc(r),
  );
  const headerLine = Array.isArray(headerRow) && headerRow.length ? headerRow.map(esc).join(",") : null;
  const lines = [
    ...preambleLines,
    ...(headerLine ? [headerLine] : []),
    ...rows.map((r) => r.map(esc).join(",")),
  ];
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** CSS-only relative bars from API numbers (no chart library). */
function SupervisorAnalyticsBars({ loading, supervisorSummary }) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#060d1f]/45 p-4 sm:p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">توزيع المؤشرات</p>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <SkeletonPulse key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    );
  }
  if (!supervisorSummary) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-[#060d1f]/30 p-6 text-center text-sm text-slate-500">
        لا توجد بيانات كافية لعرض الرسم.
      </div>
    );
  }
  const s = supervisorSummary;
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const rows = [
    { label: "إجمالي الأطباق", value: n(s.total_dishes), barClass: "from-sky-500/90 to-sky-400/70" },
    { label: "هذا الأسبوع", value: n(s.dishes_week), barClass: "from-emerald-500/85 to-emerald-400/65" },
    { label: "معلّق للمراجعة", value: n(s.pending_reviews), barClass: "from-amber-500/85 to-amber-400/60" },
    { label: "مخالفات المراقبة", value: n(s.violations_count), barClass: "from-rose-500/85 to-rose-400/60" },
    { label: "التنبيهات", value: n(s.alerts_count), barClass: "from-violet-500/80 to-violet-400/55" },
    {
      label: "أطباق اليوم",
      value: n(s.dishes_today ?? s.dishes_count),
      barClass: "from-cyan-500/80 to-cyan-400/55",
    },
  ];
  const maxVal = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="rounded-2xl border border-white/10 bg-[#060d1f]/45 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-sky/90">مخطط نسبي</p>
          <p className="mt-0.5 text-sm text-slate-400">مقارنة أحجام المؤشرات وفق البيانات الحالية من الخادم.</p>
        </div>
      </div>
      <ul className="space-y-3.5" aria-label="مؤشرات أداء نسبية">
        {rows.map((r) => {
          const pct = Math.round((r.value / maxVal) * 100);
          return (
            <li key={r.label}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-400">
                <span className="font-medium text-slate-300">{r.label}</span>
                <span className="tabular-nums text-slate-500">{r.value}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-[#020617]/80 ring-1 ring-white/5">
                <div
                  className={`h-full rounded-full bg-gradient-to-l ${r.barClass} transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Same-origin API paths (Vite proxy /api) + remote URLs + blob + data URLs. */
function isRenderableImageSrc(src) {
  if (typeof src !== "string") return false;
  const s = src.trim();
  if (!s) return false;
  return (
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("blob:") ||
    s.startsWith("data:") ||
    s.startsWith("/api/")
  );
}

/** Square food thumbnail: real image or placeholder. */
function FoodImageThumb({ src, alt = "", sizeClass = "h-24 w-24" }) {
  const [failed, setFailed] = useState(false);
  const show = isRenderableImageSrc(src) && !failed;
  return (
    <div
      className={`${sizeClass} shrink-0 overflow-hidden rounded-xl bg-[#0B1327] shadow-[0_8px_24px_-4px_rgba(0,0,0,0.55)] ring-1 ring-white/10 transition hover:ring-brand-sky/25`}
    >
      {show ? (
        <img
          alt={alt}
          src={src}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500">
          <IconDish className="h-9 w-9 opacity-45" />
          <span className="px-1 text-center text-[10px] leading-tight text-slate-600">بدون صورة</span>
        </div>
      )}
    </div>
  );
}

const glassCard =
  "rounded-2xl border border-white/10 bg-[rgba(15,23,42,0.82)] p-4 shadow-glass backdrop-blur-sm transition duration-200 hover:border-white/15 sm:p-6";

/** Staff sections — minimal blur for scroll performance */
const staffGlassCard =
  "rounded-2xl border border-white/10 bg-[rgba(15,23,42,0.85)] p-4 shadow-glass backdrop-blur-sm transition duration-200 hover:border-white/15 sm:p-6";

/** Staff dish workflow — clearer depth + glow (scoped to staff sections only). */
const staffElevatedCard =
  `${staffGlassCard} border-white/12 shadow-[0_0_48px_-18px_rgba(56,189,248,0.16)] ring-1 ring-white/[0.05] hover:border-brand-sky/20`;

const ADMIN_SETTINGS_STORAGE_KEY = "ska_admin_settings";
const ADMIN_SETTINGS_DEFAULTS = {
  ai: {
    minConfidence: 70,
    violations: {
      mask: true,
      gloves: true,
      headCover: true,
      wetFloor: true,
      containers: true,
    },
  },
  alerts: {
    enabled: true,
    defaultSeverity: "medium",
  },
  reports: {
    pdfEnabled: false,
    excelEnabled: false,
  },
  system: {
    platformName: "عين الجودة",
    defaultLanguage: "العربية",
    timezone: "Asia/Riyadh",
  },
};

function normalizeAdminSettingsShape(input) {
  const obj = input && typeof input === "object" ? input : {};
  const aiObj = obj.ai && typeof obj.ai === "object" ? obj.ai : {};
  const violationsObj = aiObj.violations && typeof aiObj.violations === "object" ? aiObj.violations : {};
  const alertsObj = obj.alerts && typeof obj.alerts === "object" ? obj.alerts : {};
  const reportsObj = obj.reports && typeof obj.reports === "object" ? obj.reports : {};
  const systemObj = obj.system && typeof obj.system === "object" ? obj.system : {};
  const minConfidenceNum = Number(aiObj.minConfidence);
  const severity = String(alertsObj.defaultSeverity || "").trim().toLowerCase();
  const validSeverity = severity === "low" || severity === "medium" || severity === "high";
  return {
    ai: {
      minConfidence: Number.isFinite(minConfidenceNum)
        ? Math.max(0, Math.min(100, Math.round(minConfidenceNum)))
        : ADMIN_SETTINGS_DEFAULTS.ai.minConfidence,
      violations: {
        mask: Boolean(violationsObj.mask),
        gloves: Boolean(violationsObj.gloves),
        headCover: Boolean(violationsObj.headCover),
        wetFloor: Boolean(violationsObj.wetFloor),
        containers: Boolean(violationsObj.containers),
      },
    },
    alerts: {
      enabled: Boolean(alertsObj.enabled),
      defaultSeverity: validSeverity ? severity : ADMIN_SETTINGS_DEFAULTS.alerts.defaultSeverity,
    },
    reports: {
      pdfEnabled: Boolean(reportsObj.pdfEnabled),
      excelEnabled: Boolean(reportsObj.excelEnabled),
    },
    system: {
      platformName: String(systemObj.platformName || "").trim() || ADMIN_SETTINGS_DEFAULTS.system.platformName,
      defaultLanguage: ADMIN_SETTINGS_DEFAULTS.system.defaultLanguage,
      timezone: ADMIN_SETTINGS_DEFAULTS.system.timezone,
    },
  };
}

function isValidYmdDate(text) {
  const s = String(text || "").trim();
  if (!s) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Dish photos stored as data URLs in DB; under backend `_MAX_DISH_IMAGE_URL_LEN` */
const DISH_IMAGE_DATA_URL_MAX_CHARS = 5_800_000;

const SUPERVISOR_REVIEWS_URL = apiUrl("/api/v1/supervisor/reviews");
const SUPERVISOR_CAMERAS_URL = apiUrl("/api/v1/supervisor/cameras");

function protectedApiErrorText(status, detail) {
  if (status === 401) return "انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى";
  if (status === 403) return "ليس لديك صلاحية للوصول لهذه الصفحة";
  if (typeof detail === "string" && detail.trim()) return detail;
  return "تعذر تحميل البيانات.";
}

const SUPERVISOR_ALERTS_URL = apiUrl("/api/v1/supervisor/alerts");
const MONITORING_ANALYZE_URL = apiUrl("/api/v1/monitoring/analyze-frame");
const DISH_REVIEW_UPDATED_EVENT = "ska:dish-review-updated";
const SUPERVISOR_SUMMARY_URL = apiUrl("/api/v1/supervisor/summary");
const SUPERVISOR_EMPLOYEES_URL = apiUrl("/api/v1/supervisor/employees");
function positiveIntQuantity(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function readImageFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = reader.result;
      if (typeof s !== "string") reject(new Error("invalid_result"));
      else resolve(s);
    };
    reader.onerror = () => reject(reader.error || new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

function supervisorStatusText(status) {
  if (status === "approved") return "تم الاعتماد";
  if (status === "rejected") return "مرفوض";
  return "يحتاج مراجعة";
}

function roleAr(role) {
  if (role === "staff") return "موظف";
  if (role === "supervisor") return "سوبر فايزر";
  if (role === "admin") return "أدمن";
  return role || "—";
}

function staffStatusText(status, needsReview) {
  if (status === "approved") return "تم الاعتماد";
  if (status === "rejected") return "مرفوض";
  if (status === "pending_review" || status === "needs_review" || needsReview) return "يحتاج مراجعة";
  return needsReview ? "يحتاج مراجعة" : "موثوق";
}

function displayAiConfidence(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return "غير متوفر";
  const pct = n <= 1 ? n * 100 : n;
  if (pct <= 0) return "غير متوفر";
  return `${Math.round(pct * 10) / 10}%`;
}

function monitoringCheckCardClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "safe") {
    return "border-2 border-emerald-500 bg-emerald-500/[0.18] shadow-[0_0_14px_rgba(16,185,129,0.18)]";
  }
  if (s === "violation") {
    return "border-2 border-red-500 bg-red-500/[0.18] shadow-[0_0_14px_rgba(239,68,68,0.2)]";
  }
  if (s === "needs_review" || s === "uncertain") {
    return "border-2 border-amber-400 bg-amber-500/[0.16] shadow-[0_0_12px_rgba(245,158,11,0.18)]";
  }
  return "border-white/15 bg-[#0B1327]/70";
}

function monitoringStatusLabelAr(status) {
  const s = String(status || "").toLowerCase();
  if (s === "safe") return "سليم";
  if (s === "violation") return "مخالفة";
  if (s === "needs_review") return "يحتاج مراجعة";
  return "غير مؤكد";
}

function monitoringAlertStatusAr(status) {
  const s = String(status || "").toLowerCase();
  if (s === "open") return "مفتوح";
  if (s === "new") return "يحتاج مراجعة";
  if (s === "needs_review") return "يحتاج مراجعة";
  if (s === "resolved") return "تمت المعالجة";
  return status || "—";
}

/** PDF export — professional status colors without affecting live UI. */
function monitoringAlertStatusPrintStyle(status) {
  const s = String(status || "").toLowerCase();
  if (s === "resolved") return { color: "#15803d", fontWeight: 600 };
  if (s === "open") return { color: "#dc2626", fontWeight: 600 };
  if (s === "new" || s === "needs_review") return { color: "#ea580c", fontWeight: 600 };
  return { color: "#475569" };
}

function monitoringSeverityPrintStyle(confidence) {
  const n = Number(confidence);
  if (!Number.isFinite(n)) return { color: "#64748b" };
  if (n >= 85) return { color: "#dc2626", fontWeight: 600 };
  if (n >= 55) return { color: "#ea580c", fontWeight: 600 };
  return { color: "#15803d", fontWeight: 600 };
}

/** Dish review PDF — green / orange / red / gray per spec. */
function dishReviewStatusPrintStyle(status) {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return { color: "#15803d", fontWeight: 600 };
  if (s === "rejected") return { color: "#dc2626", fontWeight: 600 };
  if (s === "pending_review" || s === "needs_review") return { color: "#ea580c", fontWeight: 600 };
  return { color: "#64748b", fontWeight: 600 };
}

function dishReviewArabicStatusPrintStyle(labelAr) {
  const s = String(labelAr || "").trim();
  if (s === "معتمد") return { color: "#15803d", fontWeight: 600 };
  if (s === "مرفوض") return { color: "#dc2626", fontWeight: 600 };
  if (s === "يحتاج مراجعة") return { color: "#ea580c", fontWeight: 600 };
  return { color: "#64748b", fontWeight: 600 };
}

/** Workflow styling — مفتوح (أحمر)، يحتاج مراجعة (برتقالي)، تمت المعالجة (أخضر). */
function alertWorkflowCardRing(status) {
  const s = String(status || "").toLowerCase();
  if (s === "resolved") return "border-emerald-500/35 shadow-[0_0_32px_-16px_rgba(52,211,153,0.35)]";
  if (s === "new") return "border-amber-500/38 shadow-[0_0_32px_-16px_rgba(251,191,36,0.28)]";
  if (s === "open") return "border-red-500/38 shadow-[0_0_32px_-16px_rgba(248,113,113,0.28)]";
  return "border-white/10 shadow-[0_12px_40px_-28px_rgba(0,0,0,0.85)]";
}

function alertWorkflowBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "resolved") return "border-emerald-500/45 bg-emerald-500/12 text-emerald-100";
  if (s === "new") return "border-amber-500/45 bg-amber-500/12 text-amber-100";
  if (s === "open") return "border-red-500/45 bg-red-500/12 text-red-100";
  return "border-white/15 bg-white/5 text-slate-300";
}

/** Stored `violation_type` from monitoring_alerts → UI taxonomy (kitchen monitoring catalog only) */
const ALLOWED_MONITORING_VIOLATION_KEYS = new Set([
  "no_mask",
  "no_gloves",
  "no_headcover",
  "improper_uniform",
  "improper_trash_location",
  "wet_floor",
]);

const VIOLATION_REPORT_CATEGORY_ORDER = VIOLATION_CATEGORY_KEYS_ORDER.map((key) => ({
  key,
  label: getViolationLabel(key),
}));

const MONITORING_RISK_META = {
  high: { label: "مرتفع", chip: "border-red-500/35 bg-red-500/15 text-red-200" },
  medium: { label: "متوسط", chip: "border-amber-500/35 bg-amber-500/15 text-amber-200" },
  low: { label: "منخفض", chip: "border-emerald-500/35 bg-emerald-500/15 text-emerald-200" },
};

/** Merge repeated violations across consecutive nearby video frames (same type + same worker). */
/** Downscale JPEG from live &lt;video&gt; for bandwidth + UI responsiveness */
function captureLiveMonitoringBlob(videoEl, maxLongEdge = 960, jpegQuality = 0.72) {
  return new Promise((resolve) => {
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh || vw < 2 || vh < 2) {
      resolve(null);
      return;
    }
    let tw = vw;
    let th = vh;
    const long = Math.max(vw, vh);
    if (long > maxLongEdge) {
      const scale = maxLongEdge / long;
      tw = Math.round(vw * scale);
      th = Math.round(vh * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(null);
      return;
    }
    ctx.drawImage(videoEl, 0, 0, tw, th);
    canvas.toBlob((blob) => resolve(blob || null), "image/jpeg", jpegQuality);
  });
}

function liveRiskToTier(riskLevel, violations) {
  const r = String(riskLevel || "").toLowerCase();
  const n = Array.isArray(violations) ? violations.length : 0;
  if (r === "high") return "red";
  if (r === "medium") return "yellow";
  if (n > 0) return "yellow";
  return "green";
}

function summarizeLiveViolations(violations) {
  if (!Array.isArray(violations) || violations.length === 0) return "لا توجد";
  const labels = [];
  for (const v of violations) {
    const k = canonicalMonitoringViolationType(v?.type || v?.violation_type);
    if (!k || !ALLOWED_MONITORING_VIOLATION_KEYS.has(k)) continue;
    const row = VIOLATION_REPORT_CATEGORY_ORDER.find((c) => c.key === k);
    labels.push(row?.label || k);
  }
  const uniq = [...new Set(labels)];
  if (uniq.length === 0) return "لا توجد";
  return uniq.slice(0, 5).join("، ");
}

function mergeNearbyMonitoringViolations(flatList, gapSec = 0.9) {
  const sorted = [...flatList].sort((a, b) => a.atSecond - b.atSecond);
  const out = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    const pk = `${v.typeKey}|${v.personIndex != null ? String(v.personIndex) : ""}`;
    const lk = last
      ? `${last.typeKey}|${last.personIndex != null ? String(last.personIndex) : ""}`
      : "";
    if (last && pk === lk && v.atSecond - last.atSecond <= gapSec) {
      const useNew = Number(v.confidence) >= Number(last.confidence);
      out[out.length - 1] = useNew
        ? { ...v, mergedFrames: (last.mergedFrames || 1) + 1 }
        : { ...last, mergedFrames: (last.mergedFrames || 1) + 1 };
    } else {
      out.push({ ...v, mergedFrames: 1 });
    }
  }
  return out;
}

function alertSeverityBadgeMeta(confidence) {
  const n = Number(confidence);
  if (!Number.isFinite(n)) {
    return { label: "خطورة غير محددة", cls: "border-slate-500/40 bg-slate-800/60 text-slate-300" };
  }
  if (n >= 85) return { label: "خطورة عالية", cls: "border-red-500/45 bg-red-500/15 text-red-100" };
  if (n >= 55) return { label: "تحذير", cls: "border-amber-500/45 bg-amber-500/15 text-amber-100" };
  return { label: "منخفض", cls: "border-emerald-500/45 bg-emerald-500/15 text-emerald-100" };
}

function monitoringViolationChipMeta(typeOrKey) {
  const canon = canonicalMonitoringViolationType(typeOrKey);
  const ar = () => getViolationLabel(canon || typeOrKey);
  if (canon === "no_gloves") {
    return { label: `🔴 ${ar()}`, cls: "border-red-500/35 bg-red-500/15 text-red-200" };
  }
  if (canon === "no_mask") {
    return { label: `🟠 ${ar()}`, cls: "border-orange-500/35 bg-orange-500/15 text-orange-200" };
  }
  if (canon === "no_headcover") {
    return { label: `🟠 ${ar()}`, cls: "border-amber-500/35 bg-amber-500/15 text-amber-200" };
  }
  if (canon === "improper_uniform" || canon === "no_uniform") {
    return { label: `🟠 ${ar()}`, cls: "border-yellow-500/35 bg-yellow-500/15 text-yellow-200" };
  }
  if (canon === "wet_floor") {
    return { label: `🔴 ${ar()}`, cls: "border-red-500/35 bg-red-500/15 text-red-200" };
  }
  if (canon === "improper_trash_location" || canon === "trash_floor" || canon === "waste_area") {
    return { label: `🟠 ${ar()}`, cls: "border-orange-500/35 bg-orange-500/15 text-orange-200" };
  }
  return { label: ar(), cls: "border-white/20 bg-white/5 text-slate-200" };
}

function monitoringViolationOrderIndex(typeOrKey) {
  const canon = canonicalMonitoringViolationType(typeOrKey);
  const idx = VIOLATION_REPORT_CATEGORY_ORDER.findIndex((c) => c.key === canon);
  return idx >= 0 ? idx : 999;
}

function sortMonitoringViolationsReadable(list) {
  const arr = Array.isArray(list) ? [...list] : [];
  arr.sort((a, b) => {
    const ai = monitoringViolationOrderIndex(a?.typeKey || a?.type);
    const bi = monitoringViolationOrderIndex(b?.typeKey || b?.type);
    if (ai !== bi) return ai - bi;
    return Number(b?.confidence || 0) - Number(a?.confidence || 0);
  });
  return arr;
}

function computeViolationsReportStats(alerts) {
  const list = Array.isArray(alerts) ? alerts : [];
  const typeCounts = Object.fromEntries(VIOLATION_REPORT_CATEGORY_ORDER.map((c) => [c.key, 0]));
  typeCounts._other = 0;
  const byRawType = new Map();
  let openCount = 0;
  let resolvedCount = 0;
  for (const a of list) {
    const raw = String(a.type || "").trim().toLowerCase();
    const canon = canonicalMonitoringViolationType(raw);
    if (raw) {
      const aggKey = VIOLATION_CATEGORY_KEYS_ORDER.includes(canon) ? canon : raw;
      byRawType.set(aggKey, (byRawType.get(aggKey) || 0) + 1);
    }
    const known = canon && VIOLATION_CATEGORY_KEYS_ORDER.includes(canon);
    if (known) {
      typeCounts[canon] += 1;
    } else if (raw) {
      typeCounts._other += 1;
    }
    const st = String(a.status || "").toLowerCase();
    if (st === "resolved") resolvedCount += 1;
    else openCount += 1;
  }
  let topRaw = "";
  let topN = 0;
  for (const [k, n] of byRawType.entries()) {
    if (n > topN) {
      topN = n;
      topRaw = k;
    }
  }
  let topLabel = "—";
  if (topN > 0 && topRaw) {
    const match = list.find((x) => String(x.type || "").trim().toLowerCase() === topRaw);
    topLabel = match?.label_ar?.trim() || getViolationLabel(topRaw);
  }
  const sortedLatest = [...list].sort(
    (x, y) => new Date(y.created_at || 0).getTime() - new Date(x.created_at || 0).getTime(),
  );
  return {
    total: list.length,
    typeCounts,
    openCount,
    resolvedCount,
    topRepeated: { type: topRaw, count: topN, label: topLabel },
    latest: sortedLatest.slice(0, 15),
  };
}

function formatFileBytes(sizeBytes) {
  const n = Number(sizeBytes);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatVideoDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return "غير متاح";
  const s = Math.floor(total % 60);
  const m = Math.floor((total / 60) % 60);
  const h = Math.floor(total / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function makeVideoFrameTimes(durationSec, sampleCount = 12) {
  const d = Number(durationSec);
  if (!Number.isFinite(d) || d <= 0) return [];
  const minSamples = d < 20 ? 16 : 12;
  const targetCount = Math.max(minSamples, Math.min(36, Math.floor(sampleCount)));
  const epsilon = Math.max(0.06, Math.min(0.35, d / 12));
  const start = Math.max(0, epsilon);
  const end = Math.max(start, d - epsilon);
  const anchors = [start, d * 0.25, d * 0.5, d * 0.75, end];
  const times = [];
  for (const t of anchors) {
    if (Number.isFinite(t)) times.push(Math.max(0, Math.min(d, t)));
  }
  if (targetCount <= 1 || end <= start) {
    const center = Math.max(0, Math.min(d, d / 2));
    times.push(center);
  } else {
    for (let i = 0; i < targetCount; i += 1) {
      const ratio = i / (targetCount - 1);
      const t = start + (end - start) * ratio;
      times.push(Math.max(0, Math.min(d, t)));
    }
  }
  const uniqueSorted = Array.from(new Set(times.map((t) => Number(t.toFixed(2))))).sort((a, b) => a - b);
  return uniqueSorted;
}

function inferBadgesFromApi(item) {
  const status = String(item.status || "").trim().toLowerCase();
  const needsReview = Boolean(item.needs_review) || status === "pending_review" || status === "needs_review";
  return {
    needsReviewBadge: needsReview,
    trustworthyBadge: status === "approved" && !needsReview,
  };
}

function toStaffRecord(item, meta = {}) {
  const inferred = inferBadgesFromApi(item);
  const effectiveLabel = item.confirmed_label || item.predicted_label || "طبق غير معروف";
  const rawId = item.id;
  return {
    id: `D-${rawId}`,
    rawId,
    label: effectiveLabel,
    predictedLabel: String(item.predicted_label || ""),
    imageUrl: String(item.image_url || item.image_data_url || ""),
    quantity: typeof item.quantity === "number" ? item.quantity : Number(item.quantity) || 1,
    sourceEntity: String(item.source_entity || ""),
    recordedAt: item.recorded_at,
    dateLine: formatSaudiDateLine(item.recorded_at),
    timeLine: formatSaudiTimeLine(item.recorded_at),
    timeCompact: formatSaudiDateTime(item.recorded_at),
    localPreviewUrl: meta.localPreviewUrl || null,
    needsReviewBadge: meta.needsReviewBadge ?? inferred.needsReviewBadge,
    trustworthyBadge: meta.trustworthyBadge ?? inferred.trustworthyBadge,
    confidenceRatio: meta.confidenceRatio != null ? Number(meta.confidenceRatio) : null,
    reviewStatus: String(item.status || "pending_review"),
    needsReview: Boolean(item.needs_review),
    reviewedByName: String(item.reviewed_by_name || ""),
    reviewedAt: item.reviewed_at || null,
    rejectedReason: String(item.rejected_reason || ""),
    statusText: staffStatusText(String(item.status || ""), Boolean(item.needs_review)),
  };
}

export default function Dashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const committedBlobUrlsRef = useRef(new Set());
  const dishFileInputRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const staffDocSectionRef = useRef(null);
  const staffSearchSectionRef = useRef(null);
  const staffRecordsSectionRef = useRef(null);
  const staffSpyNavigateTimerRef = useRef(null);
  const staffSpyRafRef = useRef(null);
  const supervisorSpyNavigateTimerRef = useRef(null);
  const supervisorSpyRafRef = useRef(null);
  /** When true, next pathname sync must not call scrollIntoView (coming from scroll-spy navigate). */
  const suppressScrollIntoViewFromSpyRef = useRef(false);
  const supervisorAnalyticsRef = useRef(null);
  const supervisorCamerasRef = useRef(null);
  /** Scroll target: supervisor «مراقبة بالذكاء الاصطناعي» block (video/image upload). */
  const supervisorMonitoringAiRef = useRef(null);
  const supervisorAlertsRef = useRef(null);
  const supervisorReviewsRef = useRef(null);
  const supervisorReportsRef = useRef(null);
  const supervisorEmployeesRef = useRef(null);
  const supervisorSettingsRef = useRef(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState("");
  const [captureModalOpen, setCaptureModalOpen] = useState(false);
  const [, setCaptureMode] = useState("choice");
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState(null);
  const [selectedAlternative, setSelectedAlternative] = useState("");
  const [manualDish, setManualDish] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [sourceEntity, setSourceEntity] = useState("");
  const [dishNotice, setDishNotice] = useState(null);
  const toast = useToastStore((s) => s.toast);
  const setToast = useToastStore((s) => s.setToast);
  const clearToast = useToastStore((s) => s.clearToast);
  const [highlightRawId, setHighlightRawId] = useState(null);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterDishType, setFilterDishType] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterDateErrors, setFilterDateErrors] = useState({ from: "", to: "" });
  const [filterQtyMin, setFilterQtyMin] = useState("");
  const [filterQtyMax, setFilterQtyMax] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [quickPreset, setQuickPreset] = useState(null);
  const [sortKey, setSortKey] = useState("newest");
  const [editingRecord, setEditingRecord] = useState(null);
  const [editForm, setEditForm] = useState({ label: "", quantity: 1, source: "" });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [supervisorSummary, setSupervisorSummary] = useState(null);
  const [supervisorSummaryLoading, setSupervisorSummaryLoading] = useState(false);
  const [supervisorEmployees, setSupervisorEmployees] = useState([]);
  const [supervisorEmployeesLoading, setSupervisorEmployeesLoading] = useState(false);
  const [employeeFilters, setEmployeeFilters] = useState({
    search: "",
    role: "",
    activeToday: false,
    hasPendingReviews: false,
  });
  const [reviewRecords, setReviewRecords] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewActionLoadingId, setReviewActionLoadingId] = useState(null);
  const [reviewFilters, setReviewFilters] = useState({
    employee: "",
    dishType: "",
    dateFrom: "",
    dateTo: "",
    confidenceMin: "",
    confidenceMax: "",
    status: "needs_review",
  });
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");
  const [editApproveTarget, setEditApproveTarget] = useState(null);
  const [editApproveForm, setEditApproveForm] = useState({ dishName: "", quantity: 1, source: "", notes: "" });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [staffMe, setStaffMe] = useState(null);
  const [staffProfileLoading, setStaffProfileLoading] = useState(false);
  const [cameraCards, setCameraCards] = useState([]);
  const [cameraCardsLoading, setCameraCardsLoading] = useState(false);
  const [cameraCardsError, setCameraCardsError] = useState("");
  const [alertsList, setAlertsList] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState("");
  /** null = unknown, true/false from lightweight GET /health or /. */
  const [apiReachable, setApiReachable] = useState(null);
  const [cameraTestFile, setCameraTestFile] = useState(null);
  const [cameraTestPreviewUrl, setCameraTestPreviewUrl] = useState("");
  const [cameraAnalyzeMode, setCameraAnalyzeMode] = useState("image");
  const [cameraVideoFile, setCameraVideoFile] = useState(null);
  const [cameraVideoPreviewUrl, setCameraVideoPreviewUrl] = useState("");
  const [cameraVideoDurationSec, setCameraVideoDurationSec] = useState(null);
  const [cameraVideoError, setCameraVideoError] = useState("");
  const [monitoringVideoAnalyzeLoading, setMonitoringVideoAnalyzeLoading] = useState(false);
  const [monitoringVideoProgressText, setMonitoringVideoProgressText] = useState("");
  const [monitoringVideoResults, setMonitoringVideoResults] = useState([]);
  const [monitoringVideoFrameResults, setMonitoringVideoFrameResults] = useState([]);
  const [monitoringVideoAlertsCreated, setMonitoringVideoAlertsCreated] = useState(0);
  const [monitoringFrameFilter, setMonitoringFrameFilter] = useState("all");
  const [newCameraForm, setNewCameraForm] = useState({ name: "", location: "", stream_url: "" });
  const [monitoringAnalysisResult, setMonitoringAnalysisResult] = useState(null);
  const [monitoringAnalyzeLoading, setMonitoringAnalyzeLoading] = useState(false);
  const [monitoringLastAnalyzedAt, setMonitoringLastAnalyzedAt] = useState(null);
  const [monitoringCameraSelectId, setMonitoringCameraSelectId] = useState("");
  const [monitoringResolveLoadingId, setMonitoringResolveLoadingId] = useState(null);
  /** Monitoring zone for analyze-frame payload (Arabic labels sent as location / camera_name). */
  const [selectedMonitoringZoneId, setSelectedMonitoringZoneId] = useState(MONITORING_ZONE_DEFINITIONS[0]?.id || "kitchen");
  const monitoringLiveVideoRef = useRef(null);
  const monitoringWebcamStreamRef = useRef(null);
  const livePrevKitchenRef = useRef(null);
  const livePrevStorageRef = useRef(null);
  const livePrevPrepRef = useRef(null);
  const liveAnalysisScheduleRef = useRef(null);
  const liveAnalysisInFlightRef = useRef(false);
  const liveGenRef = useRef(0);
  const liveAlertsThrottleRef = useRef(0);
  /** Always holds the latest tickLiveMonitoringAnalysis so timers/finally don't use stale closures. */
  const tickLiveRef = useRef(null);
  const selectedMonitoringZoneIdRef = useRef(selectedMonitoringZoneId);
  const [monitoringWebcamOn, setMonitoringWebcamOn] = useState(false);
  const [monitoringWebcamBusy, setMonitoringWebcamBusy] = useState(false);
  const [monitoringWebcamError, setMonitoringWebcamError] = useState("");
  /** Periodic analyze-frame while webcam is on (1 Hz); independent of image/video upload modes */
  const [monitoringLiveAutoOn, setMonitoringLiveAutoOn] = useState(false);
  const [liveTickBusy, setLiveTickBusy] = useState(false);
  const [liveAnalysisError, setLiveAnalysisError] = useState("");
  /** Per-zone snapshot from last live tick for that zone (device preview shared until RTSP per slot) */
  const [liveSlotStates, setLiveSlotStates] = useState({});
  /** Per-zone IP / RTSP / webcam connection UI (localStorage until backend CRUD exists). */
  const [restaurantCamConfigs, setRestaurantCamConfigs] = useState(() =>
    loadRestaurantCameraConfigs(MONITORING_ZONE_DEFINITIONS),
  );
  const [cameraSetupBusy, setCameraSetupBusy] = useState({ test: null, save: null });
  const [adminSettings, setAdminSettings] = useState(ADMIN_SETTINGS_DEFAULTS);
  const [adminSettingsSaving, setAdminSettingsSaving] = useState(false);
  const [violationsReportFrom, setViolationsReportFrom] = useState("");
  const [violationsReportTo, setViolationsReportTo] = useState("");
  const [violationsReportRows, setViolationsReportRows] = useState([]);
  const [violationsReportLoading, setViolationsReportLoading] = useState(false);
  const [violationsReportError, setViolationsReportError] = useState("");
  const hasPdfExport = false;
  const hasExcelExport = false;
  const { role, getAccessToken, logout, handleProtectedAuthFailure } = useDashboardAuth({ setToast });

  const { handleDetectDish } = useDetectDish({
    accessTokenKey: ACCESS_TOKEN_KEY,
    setDetecting,
    setDishNotice,
    setDetectResult,
    setSelectedAlternative,
    setManualDish,
  });
  const {
    staffRecords,
    staffRecordsLoading,
    staffRecordsLastUpdated,
    staffCount,
    saveLoading,
    editSaving,
    deleteLoading,
    reloadStaffDishes,
    saveDishEntry,
    saveEditedDishRecord,
    confirmDeleteDishRecord,
  } = useDishRecords({
    accessTokenKey: ACCESS_TOKEN_KEY,
    committedBlobUrlsRef,
    toStaffRecord,
    formatSaudiTimeLine,
    dishSaveErrorMessage,
    setToast,
    setDishNotice,
    setHighlightRawId,
    setEditingRecord,
    setDeleteTarget,
  });

  useEffect(() => {
    if (!selectedImage) {
      setSelectedPreviewUrl("");
      return undefined;
    }
    const url = URL.createObjectURL(selectedImage);
    setSelectedPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [selectedImage]);

  useEffect(() => {
    if (!cameraTestFile) {
      setCameraTestPreviewUrl("");
      return undefined;
    }
    const url = URL.createObjectURL(cameraTestFile);
    setCameraTestPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cameraTestFile]);

  useEffect(() => {
    if (!cameraVideoFile) {
      setCameraVideoPreviewUrl("");
      setCameraVideoDurationSec(null);
      return undefined;
    }
    const url = URL.createObjectURL(cameraVideoFile);
    setCameraVideoPreviewUrl(url);
    setCameraVideoDurationSec(null);
    return () => URL.revokeObjectURL(url);
  }, [cameraVideoFile]);

  useEffect(() => {
    return () => {
      monitoringVideoFrameResults.forEach((item) => {
        if (item?.frameUrl) URL.revokeObjectURL(item.frameUrl);
      });
    };
  }, [monitoringVideoFrameResults]);

  useEffect(() => {
    if (!selectedImage && dishFileInputRef.current) {
      dishFileInputRef.current.value = "";
    }
  }, [selectedImage]);

  useEffect(() => {
    const blobUrlSet = committedBlobUrlsRef.current;
    return () => {
      blobUrlSet.forEach((u) => URL.revokeObjectURL(u));
      blobUrlSet.clear();
    };
  }, [getAccessToken]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => clearToast(), 4200);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ADMIN_SETTINGS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setAdminSettings(normalizeAdminSettingsShape(parsed));
    } catch {
      /* ignore corrupt admin settings cache */
    }
  }, []);

  useEffect(() => {
    if (highlightRawId == null) return undefined;
    const t = setTimeout(() => setHighlightRawId(null), 6000);
    return () => clearTimeout(t);
  }, [highlightRawId]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    function closeNav() {
      setMobileNavOpen(false);
    }
    mq.addEventListener("change", closeNav);
    return () => mq.removeEventListener("change", closeNav);
  }, [getAccessToken]);

  /** Role ↔ URL guards (BrowserRouter paths only — no hash routing). */
  useEffect(() => {
    if (!role) return undefined;
    if (role === "staff" && isSupervisorDashboardPath(location.pathname)) {
      navigate(ROUTES.dashboard, { replace: true });
      return undefined;
    }
    if ((role === "supervisor" || role === "admin") && isStaffDashboardPath(location.pathname)) {
      navigate(ROUTES.analytics, { replace: true });
      return undefined;
    }
    return undefined;
  }, [role, location.pathname, navigate]);

  /** Migrate legacy bookmarked #sections to clean URLs once. */
  useEffect(() => {
    if (!role) return undefined;
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (!hash) return undefined;
    const target = legacyHashRedirectPath(hash, role);
    if (!target) return undefined;
    navigate(target, { replace: true });
    return undefined;
  }, [role, navigate]);

  /** Supervisor/admin: pathname drives active section + scroll into view (not when URL synced from scroll-spy). */
  useEffect(() => {
    if (!(role === "supervisor" || role === "admin")) return undefined;
    const sec = getSupervisorSectionFromPathname(location.pathname);
    if (!sec) return undefined;
    if (suppressScrollIntoViewFromSpyRef.current) {
      suppressScrollIntoViewFromSpyRef.current = false;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      document.getElementById(sec)?.scrollIntoView({ behavior: "auto", block: "nearest" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [location.pathname, role]);

  /** Staff: pathname drives dish workflow section + scroll into view (not when URL synced from scroll-spy). */
  useEffect(() => {
    if (role !== "staff") return undefined;
    const sec = getStaffSectionFromPathname(location.pathname);
    if (!sec) return undefined;
    if (suppressScrollIntoViewFromSpyRef.current) {
      suppressScrollIntoViewFromSpyRef.current = false;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      document.getElementById(sec)?.scrollIntoView({ behavior: "auto", block: "nearest" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [location.pathname, role]);

  /** Scroll spy: sync URL when the dominant section changes (replaceState → pathname). */
  useEffect(() => {
    if (role !== "staff") return undefined;
    const nodes = [
      document.getElementById(STAFF_SECTION_IDS.doc),
      document.getElementById(STAFF_SECTION_IDS.search),
      document.getElementById(STAFF_SECTION_IDS.records),
    ].filter(Boolean);
    if (nodes.length === 0) return undefined;

    const observer = new IntersectionObserver(
      () => {
        if (staffSpyRafRef.current != null) return;
        staffSpyRafRef.current = requestAnimationFrame(() => {
          staffSpyRafRef.current = null;
          let bestId = null;
          let bestDist = Number.POSITIVE_INFINITY;
          for (const el of nodes) {
            const top = el.getBoundingClientRect().top;
            const dist = Math.abs(top - 120);
            if (dist < bestDist) {
              bestDist = dist;
              bestId = el.id;
            }
          }
          if (!bestId) return;
          const nextPath = staffPathFromSectionId(bestId);
          if (typeof window !== "undefined" && window.location.pathname !== nextPath) {
            if (staffSpyNavigateTimerRef.current) window.clearTimeout(staffSpyNavigateTimerRef.current);
            staffSpyNavigateTimerRef.current = window.setTimeout(() => {
              staffSpyNavigateTimerRef.current = null;
              if (typeof window !== "undefined" && window.location.pathname !== nextPath) {
                suppressScrollIntoViewFromSpyRef.current = true;
                navigate(nextPath, { replace: true });
              }
            }, 120);
          }
        });
      },
      { root: null, rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.1, 0.25, 0.5] },
    );
    nodes.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      if (staffSpyRafRef.current != null) {
        cancelAnimationFrame(staffSpyRafRef.current);
        staffSpyRafRef.current = null;
      }
      if (staffSpyNavigateTimerRef.current) {
        window.clearTimeout(staffSpyNavigateTimerRef.current);
        staffSpyNavigateTimerRef.current = null;
      }
    };
  }, [role, navigate]);

  useEffect(() => {
    if (!(role === "supervisor" || role === "admin")) return undefined;
    let cancelled = false;
    let observer = null;
    let attachRaf = null;
    let attempts = 0;

    const buildNodes = () =>
      [
        supervisorAnalyticsRef.current,
        supervisorCamerasRef.current,
        supervisorAlertsRef.current,
        supervisorReviewsRef.current,
        supervisorReportsRef.current,
        supervisorEmployeesRef.current,
        supervisorSettingsRef.current,
      ].filter(Boolean);

    const attach = () => {
      const nodes = buildNodes();
      if (nodes.length === 0) return false;
      observer = new IntersectionObserver(
        () => {
          if (supervisorSpyRafRef.current != null) return;
          supervisorSpyRafRef.current = requestAnimationFrame(() => {
            supervisorSpyRafRef.current = null;
            const liveNodes = buildNodes();
            if (liveNodes.length === 0) return;
            let bestId = null;
            let bestDist = Number.POSITIVE_INFINITY;
            for (const el of liveNodes) {
              const top = el.getBoundingClientRect().top;
              const dist = Math.abs(top - 120);
              if (dist < bestDist) {
                bestDist = dist;
                bestId = el.id;
              }
            }
            if (!bestId) return;
            const cur = typeof window !== "undefined" ? window.location.pathname : "";
            if (
              bestId === SUPERVISOR_SECTION_IDS.employees &&
              cur.startsWith(`${ROUTES.employees}/`)
            ) {
              return;
            }
            if (bestId === SUPERVISOR_SECTION_IDS.alerts && cur.startsWith(`${ROUTES.alerts}/`)) {
              return;
            }
            if (bestId === SUPERVISOR_SECTION_IDS.cameras && cur.startsWith(`${ROUTES.cameras}/`)) {
              return;
            }
            if (bestId === SUPERVISOR_SECTION_IDS.reports && cur.startsWith(`${ROUTES.reports}/`)) {
              return;
            }
            const nextPath = supervisorPathFromSectionId(bestId);
            if (typeof window !== "undefined" && window.location.pathname !== nextPath) {
              if (supervisorSpyNavigateTimerRef.current) window.clearTimeout(supervisorSpyNavigateTimerRef.current);
              supervisorSpyNavigateTimerRef.current = window.setTimeout(() => {
                supervisorSpyNavigateTimerRef.current = null;
                if (typeof window !== "undefined" && window.location.pathname !== nextPath) {
                  suppressScrollIntoViewFromSpyRef.current = true;
                  navigate(nextPath, { replace: true });
                }
              }, 120);
            }
          });
        },
        { root: null, rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.1, 0.25, 0.5] },
      );
      nodes.forEach((el) => observer.observe(el));
      return true;
    };

    const tryAttach = () => {
      if (cancelled) return;
      if (attach()) return;
      attempts += 1;
      if (attempts > 40) return;
      attachRaf = requestAnimationFrame(tryAttach);
    };

    tryAttach();

    return () => {
      cancelled = true;
      if (attachRaf != null) cancelAnimationFrame(attachRaf);
      observer?.disconnect();
      if (supervisorSpyRafRef.current != null) {
        cancelAnimationFrame(supervisorSpyRafRef.current);
        supervisorSpyRafRef.current = null;
      }
      if (supervisorSpyNavigateTimerRef.current) {
        window.clearTimeout(supervisorSpyNavigateTimerRef.current);
        supervisorSpyNavigateTimerRef.current = null;
      }
    };
  }, [role, navigate]);

  /** Browser tab title — SaaS-style Arabic titles. */
  useEffect(() => {
    if (role === "staff") {
      const sec = getStaffSectionFromPathname(location.pathname);
      const titles = DASHBOARD_PAGE_TITLES.staff;
      document.title = sec ? titles[sec] || titles.default : titles.default;
      return;
    }
    if (role === "supervisor" || role === "admin") {
      const sec = getSupervisorSectionFromPathname(location.pathname);
      const titles = DASHBOARD_PAGE_TITLES.supervisor;
      document.title = sec ? titles[sec] || titles.default : titles.default;
      return;
    }
    document.title = PLATFORM_BRAND.documentTitle;
  }, [role, location.pathname]);

  const loadCurrentStaffUser = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setStaffMe(null);
      return null;
    }
    setStaffProfileLoading(true);
    try {
      for (const url of CURRENT_USER_ME_URLS) {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json().catch(() => ({}));
        const email = body?.email != null ? String(body.email).trim() : "";
        if (res.ok && email) {
          const normalized = normalizeStaffMeUser(body);
          setStaffMe(normalized);
          return normalized;
        }
      }
      setStaffMe(null);
      return null;
    } catch {
      setStaffMe(null);
      return null;
    } finally {
      setStaffProfileLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (role !== "staff") {
      return undefined;
    }
    void loadCurrentStaffUser();
    return undefined;
  }, [role, loadCurrentStaffUser]);

  const dishStats = useMemo(() => computeDishStats(staffRecords), [staffRecords]);

  const filtersAreDefault = useMemo(
    () =>
      !filterSearch &&
      !filterDishType &&
      !filterDateFrom &&
      !filterDateTo &&
      !filterQtyMin &&
      !filterQtyMax &&
      filterStatus === "all" &&
      sortKey === "newest",
    [
      filterSearch,
      filterDishType,
      filterDateFrom,
      filterDateTo,
      filterQtyMin,
      filterQtyMax,
      filterStatus,
      sortKey,
    ],
  );

  const displayedRecords = useMemo(
    () =>
      filterAndSortDishRecords(staffRecords, {
        search: filterSearch,
        dishType: filterDishType,
        dateFrom: isValidYmdDate(filterDateFrom) ? filterDateFrom : "",
        dateTo: isValidYmdDate(filterDateTo) ? filterDateTo : "",
        qtyMin: filterQtyMin,
        qtyMax: filterQtyMax,
        status: filterStatus,
        quick: quickPreset,
        sort: sortKey,
      }),
    [
      staffRecords,
      filterSearch,
      filterDishType,
      filterDateFrom,
      filterDateTo,
      filterQtyMin,
      filterQtyMax,
      filterStatus,
      quickPreset,
      sortKey,
    ],
  );

  useEffect(() => {
    AOS.init({
      duration: 700,
      easing: "ease-out-cubic",
      once: true,
      offset: 44,
      anchorPlacement: "top-bottom",
      disable: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    const id = requestAnimationFrame(() => {
      AOS.refresh();
    });
    let resizeDebounce = null;
    const onResize = () => {
      if (resizeDebounce != null) window.clearTimeout(resizeDebounce);
      resizeDebounce = window.setTimeout(() => {
        resizeDebounce = null;
        AOS.refresh();
      }, 250);
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      cancelAnimationFrame(id);
      if (resizeDebounce != null) window.clearTimeout(resizeDebounce);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  function resetAllFilters() {
    setFilterSearch("");
    setFilterDishType("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterQtyMin("");
    setFilterQtyMax("");
    setFilterStatus("all");
    setQuickPreset(null);
    setSortKey("newest");
  }

  const dashboardTitle = useMemo(() => dashboardTitleForRole(role), [role]);

  const unresolvedAlertsCount = useMemo(
    () => alertsList.filter((a) => String(a?.status || "").toLowerCase() !== "resolved").length,
    [alertsList],
  );

  const executiveBranchLabel = supervisorSummary?.branch_name?.trim() || PLATFORM_BRAND.nameShortAr;
  const executiveLiveLabel =
    monitoringWebcamOn && monitoringLiveAutoOn
      ? "نشط — تحليل دوري"
      : monitoringWebcamOn
        ? "معاينة كاميرا الجهاز"
        : "غير نشط";
  const executiveQualityLabel = supervisorSummaryLoading
    ? "…"
    : supervisorSummary?.quality_score != null
      ? `${Math.round(Number(supervisorSummary.quality_score))}%`
      : supervisorSummary?.compliance_rate != null
        ? `${Math.round(Number(supervisorSummary.compliance_rate))}%`
        : "—";

  const monitoringHealthLine = alertsLoading || apiReachable === null
    ? "جاري التحقق…"
    : apiReachable === false
      ? "الخادم لا يستجيب"
      : alertsError
        ? "تعذر تحميل التنبيهات"
        : "الاتصال بالخادم سليم";
  const monitoringLiveLine =
    monitoringWebcamOn && monitoringLiveAutoOn ? "تحليل لقطات نشط" : "بدون تحليل تلقائي فوري";

  const navLinks = useMemo(() => {
    if (role === "staff") {
      return [
        { to: ROUTES.dashboard, label: "توثيق الأطباق", emoji: "📸", sectionId: STAFF_SECTION_IDS.doc },
        { to: ROUTES.dashboardSearch, label: "البحث والتصفية", emoji: "🔎", sectionId: STAFF_SECTION_IDS.search },
        { to: ROUTES.dashboardRecords, label: "سجل الأطباق", emoji: "📋", sectionId: STAFF_SECTION_IDS.records },
      ];
    }
    if (role === "supervisor") {
      return [
        { to: ROUTES.analytics, label: "التحليلات", sectionId: SUPERVISOR_SECTION_IDS.analytics },
        { to: ROUTES.alerts, label: "التنبيهات", sectionId: SUPERVISOR_SECTION_IDS.alerts },
        { to: ROUTES.cameras, label: "الكاميرات", sectionId: SUPERVISOR_SECTION_IDS.cameras },
        { to: ROUTES.reports, label: "التقارير", sectionId: SUPERVISOR_SECTION_IDS.reports },
        { to: ROUTES.dishReviews, label: "مراجعة الأطباق", sectionId: SUPERVISOR_SECTION_IDS.reviews },
        { to: ROUTES.employees, label: "الموظفين", sectionId: SUPERVISOR_SECTION_IDS.employees },
      ];
    }
    return [
      { to: ROUTES.analytics, label: "التحليلات", sectionId: SUPERVISOR_SECTION_IDS.analytics },
      { to: ROUTES.alerts, label: "التنبيهات", sectionId: SUPERVISOR_SECTION_IDS.alerts },
      { to: ROUTES.cameras, label: "الكاميرات", sectionId: SUPERVISOR_SECTION_IDS.cameras },
      { to: ROUTES.reports, label: "التقارير", sectionId: SUPERVISOR_SECTION_IDS.reports },
      { to: ROUTES.dishReviews, label: "مراجعة الأطباق", sectionId: SUPERVISOR_SECTION_IDS.reviews },
      { to: ROUTES.employees, label: "الموظفين", sectionId: SUPERVISOR_SECTION_IDS.employees },
      { to: ROUTES.settings, label: "الإعدادات", sectionId: SUPERVISOR_SECTION_IDS.settings },
    ];
  }, [role]);

  const saveAdminSettings = useCallback(() => {
    const normalized = normalizeAdminSettingsShape(adminSettings);
    setAdminSettingsSaving(true);
    try {
      localStorage.setItem(ADMIN_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
      setAdminSettings(normalized);
      setToast({ type: "success", text: "تم حفظ إعدادات النظام محلياً." });
    } catch {
      setToast({ type: "error", text: "تعذر حفظ الإعدادات محلياً." });
    } finally {
      setAdminSettingsSaving(false);
    }
  }, [adminSettings, setToast]);

  const resetAdminSettings = useCallback(() => {
    setAdminSettings(ADMIN_SETTINGS_DEFAULTS);
    try {
      localStorage.setItem(ADMIN_SETTINGS_STORAGE_KEY, JSON.stringify(ADMIN_SETTINGS_DEFAULTS));
      setToast({ type: "success", text: "تمت إعادة الإعدادات للوضع الافتراضي." });
    } catch {
      setToast({ type: "error", text: "تعذر إعادة ضبط الإعدادات محلياً." });
    }
  }, [setToast]);

  const reviewFiltersAreActive = useMemo(
    () =>
      reviewFilters.employee.trim() !== "" ||
      reviewFilters.dishType.trim() !== "" ||
      reviewFilters.dateFrom !== "" ||
      reviewFilters.dateTo !== "" ||
      reviewFilters.confidenceMin !== "" ||
      reviewFilters.confidenceMax !== "" ||
      reviewFilters.status !== "needs_review",
    [reviewFilters],
  );

  const employeeFiltersAreActive = useMemo(
    () =>
      employeeFilters.search.trim() !== "" ||
      Boolean(employeeFilters.role) ||
      employeeFilters.activeToday ||
      employeeFilters.hasPendingReviews,
    [employeeFilters],
  );

  const violationsReportStats = useMemo(
    () => computeViolationsReportStats(violationsReportRows),
    [violationsReportRows],
  );

  const violationsLatestExpand = useExpandMoreList(violationsReportStats.latest.length, 3);

  const violationsSortedForExport = useMemo(() => {
    const list = Array.isArray(violationsReportRows) ? [...violationsReportRows] : [];
    list.sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
    );
    return list;
  }, [violationsReportRows]);

  const dishAnalysisExportRows = useMemo(
    () => buildDishBranchPeriodRows(reviewRecords, reviewFilters.dateFrom, reviewFilters.dateTo),
    [reviewRecords, reviewFilters.dateFrom, reviewFilters.dateTo],
  );

  /** Dish totals by name for PDF bar chart — same filtered review records as branch/period table. */
  const dishChartBarsForPrint = useMemo(() => {
    const rows = buildDishBranchPeriodRows(reviewRecords, violationsReportFrom, violationsReportTo);
    const byDish = new Map();
    for (const r of rows) {
      byDish.set(r.dish, (byDish.get(r.dish) || 0) + r.count);
    }
    return Array.from(byDish.entries())
      .map(([dish, count]) => ({ dish, count }))
      .sort((a, b) => b.count - a.count || a.dish.localeCompare(b.dish, "ar"))
      .slice(0, 16);
  }, [reviewRecords, violationsReportFrom, violationsReportTo]);

  /** Aggregates for Dish Review PDF — derived from loaded review rows only. */
  const dishReviewPdfStats = useMemo(() => {
    const records = Array.isArray(reviewRecords) ? reviewRecords : [];
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    const dishTotals = new Map();
    const empTotals = new Map();
    for (const r of records) {
      const st = String(r?.status || "").toLowerCase();
      if (st === "approved") approved += 1;
      else if (st === "rejected") rejected += 1;
      else if (st === "pending_review" || st === "needs_review") pending += 1;
      else pending += 1;
      const dish = String(r?.confirmed_label || r?.predicted_label || "").trim() || "غير محدد";
      dishTotals.set(dish, (dishTotals.get(dish) || 0) + 1);
      const emp = String(r?.employee_name || r?.employee_email || "").trim() || "غير محدد";
      empTotals.set(emp, (empTotals.get(emp) || 0) + 1);
    }
    let topDish = "";
    let topDishN = 0;
    for (const [d, n] of dishTotals.entries()) {
      if (n > topDishN) {
        topDish = d;
        topDishN = n;
      }
    }
    let topEmp = "";
    let topEmpN = 0;
    for (const [e, n] of empTotals.entries()) {
      if (n > topEmpN) {
        topEmp = e;
        topEmpN = n;
      }
    }
    return {
      total: records.length,
      pending,
      approved,
      rejected,
      topDish: topDishN > 0 ? `${topDish} (${topDishN})` : "—",
      topEmployee: topEmpN > 0 ? `${topEmp} (${topEmpN})` : "—",
    };
  }, [reviewRecords]);

  /** الطبق | الحالة | عدد السجلات for PDF summary table. */
  const dishReviewStatusSummaryRows = useMemo(() => {
    const SEP = "\u001f";
    const map = new Map();
    for (const r of reviewRecords || []) {
      const dish = String(r?.confirmed_label || r?.predicted_label || "").trim() || "غير محدد";
      const ar = dishReviewStatusArExport(r?.status);
      const key = `${dish}${SEP}${ar}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([key, count]) => {
        const [dish, statusAr] = key.split(SEP);
        return { dish, statusAr, count };
      })
      .sort((a, b) => b.count - a.count || a.dish.localeCompare(b.dish, "ar"));
  }, [reviewRecords]);

  /** Stacked horizontal bars: dishes × counts by review status (PDF chart). */
  const dishReviewChartBarsForPrint = useMemo(() => {
    const byDish = new Map();
    for (const r of reviewRecords || []) {
      const dish = String(r?.confirmed_label || r?.predicted_label || "").trim() || "غير محدد";
      const st = String(r?.status || "").toLowerCase();
      if (!byDish.has(dish)) {
        byDish.set(dish, { approved: 0, pending: 0, rejected: 0, other: 0 });
      }
      const b = byDish.get(dish);
      if (st === "approved") b.approved += 1;
      else if (st === "rejected") b.rejected += 1;
      else if (st === "pending_review" || st === "needs_review") b.pending += 1;
      else b.other += 1;
    }
    return Array.from(byDish.entries())
      .map(([dish, s]) => ({
        dish,
        ...s,
        total: s.approved + s.pending + s.rejected + s.other,
      }))
      .sort((a, b) => b.total - a.total || a.dish.localeCompare(b.dish, "ar"))
      .slice(0, 14);
  }, [reviewRecords]);

  const exportSupervisorReportCsv = useCallback(() => {
    if (!supervisorSummary) {
      setToast({ type: "error", text: "لا توجد بيانات ملخص للتصدير." });
      return;
    }
    const s = supervisorSummary;
    const val = (v) => (v === undefined || v === null ? "" : v);
    const filename = taeenReportFilename("summary");
    const branchLabel = String(s.branch_name || "").trim() || "—";
    const periodReviews = formatReportPeriodLabel(reviewFilters.dateFrom, reviewFilters.dateTo);
    const periodViolations = formatReportPeriodLabel(violationsReportFrom, violationsReportTo);
    const preambleRows = [
      [REPORT_PLATFORM_TITLE_AR, ""],
      [REPORT_PLATFORM_TAGLINE_AR, ""],
      ["تقرير الملخص التنفيذي", ""],
      ["تاريخ إنشاء التقرير", formatReportDateYmd()],
      ["الفرع", branchLabel],
      ["الفترة الزمنية — سجلات الأطباق (حسب فلاتر المراجعة)", periodReviews],
      ["الفترة الزمنية — مخالفات المراقبة (حسب فلاتر التقرير)", periodViolations],
      ["", ""],
    ];
    const section = (titleAr) => [
      ["", ""],
      [titleAr, ""],
      ["المؤشر", "القيمة"],
    ];
    const rows = [
      ...section("ملخص الأداء"),
      ["إجمالي الأطباق", val(s.total_dishes)],
      ["الأطباق هذا الأسبوع", val(s.dishes_week)],
      ["إجمالي الكمية", val(s.total_quantity)],
      ["مؤشر الجودة", val(s.quality_score ?? s.compliance_rate)],
      ["متوسط الثقة", val(s.average_confidence)],
      ["التنبيهات", val(s.alerts_count)],
      ["إجمالي الموظفين", val(s.total_employees)],
      ["نشط اليوم", val(s.active_employees_today)],
      ...section("ملخص الأطباق"),
      ["معلّق للمراجعة", val(s.pending_reviews)],
      ["المعتمد اليوم", val(s.approved_today)],
      ["المرفوض اليوم", val(s.rejected_today)],
      ["الأطباق اليوم", val(s.dishes_today ?? s.dishes_count)],
      ["أكثر موظف مراجعات (الاسم)", val(s.top_employee_review_name)],
      ["عدد مراجعاته", val(s.top_employee_review_count)],
      ["أكثر طبق مسجّل", val(s.most_common_dish)],
      ["أكثر طبق يحتاج مراجعة", val(s.most_reviewed_dish)],
      ...section("ملخص المخالفات"),
      ["عدد المخالفات (ملخص الخادم)", val(s.violations_count)],
      ["إجمالي سجلات التقرير المحمّل", val(violationsReportStats.total)],
      ["مفتوح / غير المعالج", val(violationsReportStats.openCount)],
      ["تمت المعالجة", val(violationsReportStats.resolvedCount)],
      ["أكثر نوع تكرارًا (ضمن التقرير)", val(violationsReportStats.topRepeated.label)],
      ["عدد تكرار ذلك النوع", val(violationsReportStats.topRepeated.count)],
      ...VIOLATION_REPORT_CATEGORY_ORDER.map((c) => [
        `عدد — ${c.label}`,
        val(violationsReportStats.typeCounts[c.key]),
      ]),
      ...(violationsReportStats.typeCounts._other > 0
        ? [[`عدد — أخرى`, val(violationsReportStats.typeCounts._other)]]
        : []),
      ["", ""],
      ["تحليل الأطباق حسب الفرع والفترة (البيانات المصفّاة)", "", "", ""],
      ["الطبق", "الفرع", "عدد السجلات", "الفترة الزمنية"],
      ...dishAnalysisExportRows.map((r) => [r.dish, r.branch, r.count, r.periodLabel]),
    ];
    downloadUtf8Csv(filename, [], rows, { preambleRows });
    setToast({ type: "success", text: "تم تنزيل تقرير CSV للملخص." });
  }, [
    dishAnalysisExportRows,
    reviewFilters.dateFrom,
    reviewFilters.dateTo,
    setToast,
    supervisorSummary,
    violationsReportFrom,
    violationsReportStats,
    violationsReportTo,
  ]);

  const exportReviewRecordsCsv = useCallback(() => {
    if (!reviewRecords.length) {
      setToast({ type: "error", text: "لا توجد سجلات مراجعة للتصدير." });
      return;
    }
    const branchLabel =
      String(supervisorSummary?.branch_name || "").trim() ||
      String(reviewRecords.find((r) => r.branch_name || r.branch)?.branch_name ||
        reviewRecords.find((r) => r.branch_name || r.branch)?.branch ||
        "").trim() ||
      "—";
    const preambleRows = [
      [REPORT_PLATFORM_TITLE_AR, ""],
      [REPORT_PLATFORM_TAGLINE_AR, ""],
      ["تقرير مراجعة الأطباق", ""],
      ["تاريخ إنشاء التقرير", formatReportDateYmd()],
      ["الفرع", branchLabel],
      ["الفترة الزمنية", formatReportPeriodLabel(reviewFilters.dateFrom, reviewFilters.dateTo)],
      ["", ""],
    ];
    downloadUtf8Csv(
      taeenReportFilename("dish-review"),
      ["رقم", "اسم الموظف", "اسم الطبق المقترح", "اسم الطبق المعتمد", "الكمية", "الحالة", "وقت التسجيل", "وقت المراجعة"],
      reviewRecords.map((r, idx) => [
        idx + 1,
        r.employee_name || "—",
        r.predicted_label || "—",
        r.confirmed_label || "—",
        r.quantity ?? "",
        dishReviewStatusArExport(r.status),
        r.recorded_at ? formatSaudiDateTime(r.recorded_at) : "—",
        r.reviewed_at ? formatSaudiDateTime(r.reviewed_at) : "—",
      ]),
      { preambleRows },
    );
    setToast({ type: "success", text: "تم تنزيل سجلات المراجعة." });
  }, [reviewFilters.dateFrom, reviewFilters.dateTo, reviewRecords, setToast, supervisorSummary]);

  const exportViolationsReportLatestCsv = useCallback(() => {
    if (!violationsSortedForExport.length) {
      setToast({ type: "error", text: "لا توجد صفوف مخالفات للتصدير." });
      return;
    }
    const branchLabel =
      String(supervisorSummary?.branch_name || "").trim() ||
      String(
        violationsSortedForExport.find((r) => r.branch_name || r.branch)?.branch_name ||
          violationsSortedForExport.find((r) => r.branch_name || r.branch)?.branch ||
          "",
      ).trim() ||
      "—";
    const preambleRows = [
      [REPORT_PLATFORM_TITLE_AR, ""],
      [REPORT_PLATFORM_TAGLINE_AR, ""],
      ["تقرير مخالفات المراقبة", ""],
      ["تاريخ إنشاء التقرير", formatReportDateYmd()],
      ["الفرع", branchLabel],
      ["الفترة الزمنية", formatReportPeriodLabel(violationsReportFrom, violationsReportTo)],
      ["", ""],
    ];
    downloadUtf8Csv(
      taeenReportFilename("monitoring"),
      [
        "رقم",
        "نوع المخالفة",
        "التفاصيل",
        "الكاميرا",
        "الفرع / المنطقة",
        "نسبة الثقة",
        "مستوى الخطورة",
        "الحالة",
        "التاريخ والوقت",
      ],
      violationsSortedForExport.map((row, idx) => [
        idx + 1,
        violationTypeLabelForReport(row),
        String(row.details || "—")
          .replace(/\s+/g, " ")
          .trim(),
        row.camera_name || "—",
        formatAlertBranchArea(row),
        formatMonitoringConfidencePercent(row.confidence),
        monitoringSeverityLabelAr(row.confidence),
        monitoringAlertStatusArExport(row.status),
        formatSaudiDateTime(row.created_at),
      ]),
      { preambleRows },
    );
    setToast({ type: "success", text: "تم تنزيل CSV لتقرير المخالفات." });
  }, [
    setToast,
    supervisorSummary,
    violationsReportFrom,
    violationsReportTo,
    violationsSortedForExport,
  ]);

  const printViolationsReportPdf = useCallback(() => {
    if (!violationsReportStats.total) {
      setToast({ type: "error", text: "لا يوجد تقرير للطباعة أو التصدير." });
      return;
    }
    const el = document.getElementById("ska-violations-report-print");
    if (!el || !el.querySelector("tbody tr")) {
      setToast({ type: "error", text: "تعذر تجهيز صفحة التقرير." });
      return;
    }
    document.body.classList.add("ska-print-violations-only");
    const prevTitle = document.title;
    document.title = `taeen-quality-monitoring-report-${formatReportDateYmd()}`;
    const onAfterPrint = () => {
      document.body.classList.remove("ska-print-violations-only");
      document.title = prevTitle;
      window.removeEventListener("afterprint", onAfterPrint);
    };
    window.addEventListener("afterprint", onAfterPrint);
    setTimeout(() => window.print(), 100);
  }, [violationsReportStats.total, setToast]);

  const printDishReviewReportPdf = useCallback(() => {
    if (!reviewRecords.length) {
      setToast({ type: "error", text: "لا توجد سجلات مراجعة للتصدير." });
      return;
    }
    const el = document.getElementById("ska-dish-review-report-print");
    if (!el || !el.querySelector("tbody tr")) {
      setToast({ type: "error", text: "تعذر تجهيز صفحة التقرير." });
      return;
    }
    document.body.classList.add("ska-print-dish-review-only");
    const prevTitle = document.title;
    document.title = `taeen-quality-dish-review-report-${formatReportDateYmd()}`;
    const onAfterPrint = () => {
      document.body.classList.remove("ska-print-dish-review-only");
      document.title = prevTitle;
      window.removeEventListener("afterprint", onAfterPrint);
    };
    window.addEventListener("afterprint", onAfterPrint);
    setTimeout(() => window.print(), 100);
  }, [reviewRecords.length, setToast]);

  const supervisorCards = useMemo(
    () => {
      const loading = supervisorSummaryLoading;
      const numOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const qualityScore = numOrNull(supervisorSummary?.quality_score ?? supervisorSummary?.compliance_rate);
      const alertsCount = numOrNull(supervisorSummary?.alerts_count);
      const violationsCount = numOrNull(supervisorSummary?.violations_count);
      const dishesCount = numOrNull(supervisorSummary?.dishes_count ?? supervisorSummary?.dishes_today);
      const valueText = (n) => (loading ? "..." : n == null ? "غير متوفر" : String(n));
      const valueClass = (n, isAlert = false) => {
        if (loading) return "text-white";
        if (n == null) return "text-slate-500";
        if (isAlert && n >= 10) return "text-red-300";
        if (n === 0) return "text-slate-400";
        return "text-white";
      };
      return [
      {
        label: "مؤشر الجودة",
        value: valueText(qualityScore),
        valueClass: valueClass(qualityScore),
        icon: IconChart,
        glow: "from-brand-sky/10",
      },
      {
        label: "عدد التنبيهات",
        value: valueText(alertsCount),
        valueClass: valueClass(alertsCount, true),
        icon: IconActivity,
        glow: "from-accent-amber/10",
      },
      {
        label: "عدد المخالفات",
        value: valueText(violationsCount),
        valueClass: valueClass(violationsCount),
        icon: IconBell,
        glow: "from-accent-red/10",
      },
      {
        label: "عدد الأطباق",
        value: valueText(dishesCount),
        valueClass: valueClass(dishesCount),
        icon: IconDish,
        glow: "from-accent-green/10",
      },
      ];
    },
    [supervisorSummary, supervisorSummaryLoading],
  );

  const hasMonitoringData =
    Number(supervisorSummary?.dishes_today || 0) > 0 || Number(supervisorSummary?.violations_count || 0) > 0;
  const supervisorBranchHighlights = useMemo(() => {
    const noData = "لا توجد بيانات كافية";
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthRecords = reviewRecords.filter((r) => {
      const t = new Date(r?.recorded_at || "").getTime();
      return Number.isFinite(t) && t >= startOfMonth.getTime();
    });

    const preferredMonthRecords = monthRecords.filter((r) => String(r?.status || "") === "approved");
    const monthSource = preferredMonthRecords.length ? preferredMonthRecords : monthRecords;
    const employeeMonthCounter = new Map();
    monthSource.forEach((r) => {
      const key = String(r?.employee_name || r?.employee_email || "").trim();
      if (!key) return;
      employeeMonthCounter.set(key, (employeeMonthCounter.get(key) || 0) + 1);
    });
    let employeeMonth = null;
    for (const [name, count] of employeeMonthCounter.entries()) {
      if (!employeeMonth || count > employeeMonth.count) employeeMonth = { name, count };
    }

    let mostActive = null;
    supervisorEmployees.forEach((e) => {
      const total = Number(e?.total_dishes);
      if (!Number.isFinite(total)) return;
      const label = String(e?.full_name || e?.username || "").trim();
      if (!label) return;
      if (!mostActive || total > mostActive.count) {
        mostActive = { name: label, count: total };
      }
    });

    const dishCounter = new Map();
    monthRecords.forEach((r) => {
      const dish = String(r?.confirmed_label || r?.predicted_label || "").trim();
      if (!dish) return;
      dishCounter.set(dish, (dishCounter.get(dish) || 0) + 1);
    });
    let dishMonth = null;
    for (const [name, count] of dishCounter.entries()) {
      if (!dishMonth || count > dishMonth.count) dishMonth = { name, count };
    }

    const violationCounter = new Map();
    alertsList.forEach((a) => {
      const key = String(a?.label_ar || a?.type || "—").trim();
      if (!key || key === "—") return;
      violationCounter.set(key, (violationCounter.get(key) || 0) + 1);
    });
    let topViolation = null;
    for (const [name, count] of violationCounter.entries()) {
      if (!topViolation || count > topViolation.count) topViolation = { name, count };
    }

    const pendingReviewsCount =
      Number.isFinite(Number(supervisorSummary?.pending_reviews))
        ? Number(supervisorSummary?.pending_reviews)
        : reviewRecords.filter((r) => {
            const s = String(r?.status || "");
            return s === "needs_review" || s === "pending_review";
          }).length;

    return [
      {
        key: "employee-month",
        title: "موظف الشهر",
        value: employeeMonth ? `${employeeMonth.name} (${employeeMonth.count})` : noData,
        subtitle: "حسب سجلات هذا الشهر",
        icon: IconChart,
      },
      {
        key: "employee-most-active",
        title: "أكثر موظف نشاطًا",
        value: mostActive ? `${mostActive.name} (${mostActive.count})` : noData,
        subtitle: "حسب بيانات الفرع",
        icon: IconActivity,
      },
      {
        key: "dish-month",
        title: "طبق الشهر",
        value: dishMonth ? `${dishMonth.name} (${dishMonth.count})` : noData,
        subtitle: "حسب سجلات هذا الشهر",
        icon: IconDish,
      },
      {
        key: "top-violation",
        title: "أكثر مخالفة تكرارًا",
        value: topViolation ? `${topViolation.name} (${topViolation.count})` : noData,
        subtitle: "حسب بيانات الفرع",
        icon: IconBell,
      },
      {
        key: "pending-reviews",
        title: "طلبات تحتاج مراجعة",
        value: Number.isFinite(pendingReviewsCount) ? String(pendingReviewsCount) : noData,
        subtitle: "الحالة الحالية",
        icon: IconActivity,
      },
    ];
  }, [alertsList, reviewRecords, supervisorEmployees, supervisorSummary]);

  const loadSupervisorSummary = useCallback(async () => {
    if (!(role === "supervisor" || role === "admin")) return;
    const token = getAccessToken();
    if (!token) return;
    setSupervisorSummaryLoading(true);
    try {
      const res = await fetch(SUPERVISOR_SUMMARY_URL, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (handleProtectedAuthFailure(res.status, body?.detail)) {
        setSupervisorSummary(null);
        return;
      }
      if (!res.ok || !body || typeof body !== "object") {
        setSupervisorSummary(null);
        return;
      }
      setSupervisorSummary(body);
    } finally {
      setSupervisorSummaryLoading(false);
    }
  }, [getAccessToken, handleProtectedAuthFailure, role]);

  const loadSupervisorEmployees = useCallback(async () => {
    if (!(role === "supervisor" || role === "admin")) return;
    const token = getAccessToken();
    if (!token) return;
    setSupervisorEmployeesLoading(true);
    try {
      const qp = new URLSearchParams();
      if (employeeFilters.search.trim()) qp.set("search", employeeFilters.search.trim());
      if (employeeFilters.role) qp.set("role", employeeFilters.role);
      if (employeeFilters.activeToday) qp.set("active_today", "true");
      if (employeeFilters.hasPendingReviews) qp.set("has_pending_reviews", "true");
      const res = await fetch(`${SUPERVISOR_EMPLOYEES_URL}?${qp.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => []);
      if (handleProtectedAuthFailure(res.status, body?.detail)) {
        setSupervisorEmployees([]);
        return;
      }
      if (!res.ok || !Array.isArray(body)) {
        setSupervisorEmployees([]);
        return;
      }
      setSupervisorEmployees(body);
    } finally {
      setSupervisorEmployeesLoading(false);
    }
  }, [employeeFilters, getAccessToken, handleProtectedAuthFailure, role]);

  const loadSupervisorReviews = useCallback(async () => {
    if (!(role === "supervisor" || role === "admin")) return;
    const token = getAccessToken();
    if (!token) return;
    setReviewLoading(true);
    try {
      const qp = new URLSearchParams();
      if (reviewFilters.employee.trim()) qp.set("employee", reviewFilters.employee.trim());
      if (reviewFilters.dishType.trim()) qp.set("dish_type", reviewFilters.dishType.trim());
      if (reviewFilters.dateFrom) qp.set("date_from", `${reviewFilters.dateFrom}T00:00:00Z`);
      if (reviewFilters.dateTo) qp.set("date_to", `${reviewFilters.dateTo}T23:59:59Z`);
      if (reviewFilters.confidenceMin !== "") qp.set("confidence_min", String(reviewFilters.confidenceMin));
      if (reviewFilters.confidenceMax !== "") qp.set("confidence_max", String(reviewFilters.confidenceMax));
      if (reviewFilters.status) qp.set("status_filter", reviewFilters.status);
      const u = `${SUPERVISOR_REVIEWS_URL}?${qp.toString()}`;
      const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => []);
      if (handleProtectedAuthFailure(res.status, data?.detail)) return;
      if (!res.ok || !Array.isArray(data)) {
        setToast({ type: "error", text: protectedApiErrorText(res.status, data?.detail) || "تعذر تحميل سجلات المراجعة." });
        return;
      }
      const rank = (status) => {
        if (status === "pending_review" || status === "needs_review") return 0;
        if (status === "approved") return 1;
        if (status === "rejected") return 2;
        return 3;
      };
      const sorted = [...data].sort((a, b) => {
        const ra = rank(a?.status);
        const rb = rank(b?.status);
        if (ra !== rb) return ra - rb;
        return new Date(b?.recorded_at || 0).getTime() - new Date(a?.recorded_at || 0).getTime();
      });
      setReviewRecords(sorted);
    } catch {
      setToast({ type: "error", text: "تعذر تحميل سجلات المراجعة." });
    } finally {
      setReviewLoading(false);
    }
  }, [getAccessToken, handleProtectedAuthFailure, reviewFilters, role, setToast]);

  const loadSupervisorCameras = useCallback(async () => {
    if (!(role === "supervisor" || role === "admin")) return;
    const token = getAccessToken();
    if (!token) return;
    setCameraCardsLoading(true);
    setCameraCardsError("");
    try {
      const res = await fetch(SUPERVISOR_CAMERAS_URL, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => []);
      if (handleProtectedAuthFailure(res.status, body?.detail)) {
        setCameraCards([]);
        return;
      }
      if (!res.ok || !Array.isArray(body)) {
        setCameraCardsError("تعذر تحميل بيانات الكاميرات.");
        setCameraCards([]);
        return;
      }
      setCameraCards(body);
    } catch {
      setCameraCards([]);
      setCameraCardsError("تعذر تحميل بيانات الكاميرات.");
    } finally {
      setCameraCardsLoading(false);
    }
  }, [getAccessToken, handleProtectedAuthFailure, role]);

  const loadSupervisorAlerts = useCallback(async () => {
    if (!(role === "supervisor" || role === "admin")) return;
    const token = getAccessToken();
    if (!token) return;
    setAlertsLoading(true);
    setAlertsError("");
    try {
      const res = await fetchWithTimeout(
        SUPERVISOR_ALERTS_URL,
        { headers: { Authorization: `Bearer ${token}` } },
        DEFAULT_FETCH_TIMEOUT_MS,
      );
      const body = await res.json().catch(() => []);
      if (handleProtectedAuthFailure(res.status, body?.detail)) {
        setAlertsList([]);
        return;
      }
      if (!res.ok || !Array.isArray(body)) {
        setAlertsError("تعذر تحميل التنبيهات.");
        setAlertsList([]);
        return;
      }
      setAlertsList(body);
    } catch {
      setAlertsError("تعذر تحميل التنبيهات.");
      setAlertsList([]);
    } finally {
      setAlertsLoading(false);
    }
  }, [getAccessToken, handleProtectedAuthFailure, role]);

  const fetchViolationsReport = useCallback(
    async (fromStr, toStr) => {
      if (!(role === "supervisor" || role === "admin")) return;
      const token = getAccessToken();
      if (!token) return;
      const from = String(fromStr || "").trim();
      const to = String(toStr || "").trim();
      if (from && to && from > to) {
        setViolationsReportError("تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية.");
        setViolationsReportRows([]);
        return;
      }
      setViolationsReportLoading(true);
      setViolationsReportError("");
      try {
        const qp = new URLSearchParams();
        qp.set("limit", "500");
        if (from && isValidYmdDate(from)) qp.set("date_from", from);
        if (to && isValidYmdDate(to)) qp.set("date_to", to);
        const res = await fetch(`${SUPERVISOR_ALERTS_URL}?${qp}`, { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json().catch(() => []);
        if (handleProtectedAuthFailure(res.status, body?.detail)) {
          setViolationsReportRows([]);
          return;
        }
        if (!res.ok || !Array.isArray(body)) {
          setViolationsReportError(
            protectedApiErrorText(res.status, body?.detail) || "تعذر تحميل بيانات المخالفات.",
          );
          setViolationsReportRows([]);
          return;
        }
        setViolationsReportRows(body);
      } catch {
        setViolationsReportError("تعذر تحميل بيانات المخالفات.");
        setViolationsReportRows([]);
      } finally {
        setViolationsReportLoading(false);
      }
    },
    [getAccessToken, handleProtectedAuthFailure, role],
  );

  useEffect(() => {
    if (!(role === "supervisor" || role === "admin")) return;
    void loadSupervisorReviews();
  }, [role, loadSupervisorReviews]);

  useEffect(() => {
    if (!(role === "supervisor" || role === "admin")) return;
    void loadSupervisorSummary();
  }, [role, loadSupervisorSummary]);

  useEffect(() => {
    if (!(role === "supervisor" || role === "admin")) return;
    void loadSupervisorEmployees();
  }, [role, loadSupervisorEmployees]);

  useEffect(() => {
    if (!(role === "supervisor" || role === "admin")) return;
    void loadSupervisorCameras();
    void loadSupervisorAlerts();
  }, [role, loadSupervisorCameras, loadSupervisorAlerts]);

  useEffect(() => {
    if (!(role === "supervisor" || role === "admin")) {
      setApiReachable(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const ok = await wakeApiBeforeAuth();
      if (!cancelled) setApiReachable(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  useEffect(() => {
    if (!(role === "supervisor" || role === "admin")) {
      setViolationsReportRows([]);
      setViolationsReportError("");
      return undefined;
    }
    void fetchViolationsReport("", "");
    return undefined;
  }, [role, fetchViolationsReport]);

  async function approveReviewRecord(record) {
    const token = getAccessToken();
    if (!token) return;
    setReviewActionLoadingId(record.id);
    try {
      const res = await fetch(`${SUPERVISOR_REVIEWS_URL}/${record.id}/approve`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ type: "error", text: body?.detail || "تعذر اعتماد السجل." });
        return;
      }
      setToast({ type: "success", text: "تم اعتماد السجل." });
      window.dispatchEvent(new CustomEvent(DISH_REVIEW_UPDATED_EVENT, { detail: { id: record.id, status: "approved" } }));
      await loadSupervisorReviews();
      await loadSupervisorSummary();
      await loadSupervisorEmployees();
    } catch {
      setToast({ type: "error", text: "تعذر اعتماد السجل." });
    } finally {
      setReviewActionLoadingId(null);
    }
  }

  async function confirmRejectReviewRecord() {
    if (!rejectTarget || !rejectReason.trim()) return;
    const token = getAccessToken();
    if (!token) return;
    setReviewActionLoadingId(rejectTarget.id);
    try {
      const res = await fetch(`${SUPERVISOR_REVIEWS_URL}/${rejectTarget.id}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: rejectReason.trim(), supervisor_notes: rejectNotes.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ type: "error", text: body?.detail || "تعذر رفض السجل." });
        return;
      }
      setToast({ type: "success", text: "تم رفض السجل." });
      window.dispatchEvent(
        new CustomEvent(DISH_REVIEW_UPDATED_EVENT, { detail: { id: rejectTarget.id, status: "rejected" } }),
      );
      setRejectTarget(null);
      setRejectReason("");
      setRejectNotes("");
      await loadSupervisorReviews();
      await loadSupervisorSummary();
      await loadSupervisorEmployees();
    } catch {
      setToast({ type: "error", text: "تعذر رفض السجل." });
    } finally {
      setReviewActionLoadingId(null);
    }
  }

  async function submitEditApproveReviewRecord() {
    if (!editApproveTarget || !editApproveForm.dishName.trim()) return;
    const token = getAccessToken();
    if (!token) return;
    setReviewActionLoadingId(editApproveTarget.id);
    try {
      const res = await fetch(`${SUPERVISOR_REVIEWS_URL}/${editApproveTarget.id}/edit-approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          dish_name: editApproveForm.dishName.trim(),
          quantity: Number(editApproveForm.quantity) || 1,
          source: editApproveForm.source.trim() || "غير محدد",
          notes: editApproveForm.notes.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ type: "error", text: body?.detail || "تعذر تعديل واعتماد السجل." });
        return;
      }
      setToast({ type: "success", text: "تم تعديل السجل واعتماده." });
      window.dispatchEvent(
        new CustomEvent(DISH_REVIEW_UPDATED_EVENT, { detail: { id: editApproveTarget.id, status: "approved" } }),
      );
      setEditApproveTarget(null);
      await loadSupervisorReviews();
      await loadSupervisorSummary();
      await loadSupervisorEmployees();
    } catch {
      setToast({ type: "error", text: "تعذر تعديل واعتماد السجل." });
    } finally {
      setReviewActionLoadingId(null);
    }
  }

  // Shared fetch helper used by image upload, video frames, and live 1 Hz monitoring.
  const callAnalyzeFrameEndpoint = useCallback(
    async (imageFile, token, { analysisMode = "manual" } = {}) => {
      // Skip wake ping in live mode — server is active if live analysis is running.
      // For manual mode use cached check: wakeApiBeforeAuth skips if API was alive within 90s.
      if (analysisMode !== "live") await wakeApiBeforeAuth();

      const fd = new FormData();
      fd.append("image", imageFile);
      fd.append("analysis_mode", analysisMode === "live" ? "live" : "manual");
      if (monitoringCameraSelectId) {
        const idNum = Number(monitoringCameraSelectId);
        if (Number.isFinite(idNum)) fd.append("camera_id", String(idNum));
      }
      const sel = cameraCards.find((c) => String(c.id) === String(monitoringCameraSelectId));
      const zoneMeta = MONITORING_ZONE_DEFINITIONS.find((z) => z.id === selectedMonitoringZoneId);
      const savedZoneCam = restaurantCamConfigs[selectedMonitoringZoneId];
      let name = (newCameraForm.name || "").trim() || (sel?.name || "").trim();
      let loc = (newCameraForm.location || "").trim() || (sel?.location || "").trim();
      if (savedZoneCam?.cameraName?.trim()) name = savedZoneCam.cameraName.trim();
      if (!name && zoneMeta) name = zoneMeta.displayNameAr;
      if (!loc && zoneMeta) loc = zoneMeta.zoneAr;
      if (name) fd.append("camera_name", name);
      if (loc) fd.append("location", loc);
      const res = await fetchWithTimeout(
        MONITORING_ANALYZE_URL,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        },
        MONITORING_FETCH_TIMEOUT_MS,
      );
      const body = await res.json().catch(() => ({}));
      // Mark API as alive so subsequent manual calls skip the wake probe.
      if (res.ok || (res.status >= 200 && res.status < 502)) {
        markApiAlive();
      }
      return { ok: res.ok, status: res.status, body };
    },
    [
      monitoringCameraSelectId,
      cameraCards,
      newCameraForm.name,
      newCameraForm.location,
      selectedMonitoringZoneId,
      restaurantCamConfigs,
    ],
  );

  const tickLiveMonitoringAnalysis = useCallback(async () => {
    if (!(role === "supervisor" || role === "admin")) return;
    if (!monitoringWebcamOn || !monitoringLiveAutoOn) return;
    const video = monitoringLiveVideoRef.current;
    if (!video || video.readyState < 2) return;
    if (liveAnalysisInFlightRef.current) return;
    const gen = liveGenRef.current;
    const token = getAccessToken();
    if (!token) return;

    liveAnalysisInFlightRef.current = true;
    setLiveTickBusy(true);
    try {
      const blob = await captureLiveMonitoringBlob(video);
      if (!blob || gen !== liveGenRef.current) return;
      const file = new File([blob], `live-${Date.now()}.jpg`, { type: "image/jpeg" });
      const { ok, status, body } = await callAnalyzeFrameEndpoint(file, token, { analysisMode: "live" });
      if (gen !== liveGenRef.current) return;
      if (handleProtectedAuthFailure(status, body?.detail)) return;
      if (isMonitoringSkippedResponse(status, body)) return;
      if (!isMonitoringAnalyzeSuccess(status, body)) {
        const errDetail = typeof body?.detail === "string" && body.detail.trim() ? body.detail : null;
        const msg = errDetail || `فشل التحليل التلقائي (${status || "—"}).`;
        setLiveAnalysisError(msg);
        return;
      }
      setLiveAnalysisError("");

      setMonitoringAnalysisResult(body);
      setMonitoringLastAnalyzedAt(new Date().toISOString());

      const zoneId = selectedMonitoringZoneIdRef.current;
      const tier = liveRiskToTier(body?.frame_report?.overall_risk_level, body?.violations);
      const violationsSummary = summarizeLiveViolations(body?.violations);

      setLiveSlotStates((prev) => ({
        ...prev,
        [zoneId]: {
          tier,
          statusLabel: body?.frame_report?.overall_risk_ar || "—",
          violationsSummary,
          peopleCount: typeof body?.people_count === "number" ? body.people_count : null,
          lastAtLabel: formatSaudiDateTime(new Date().toISOString()),
        },
      }));

      const now = Date.now();
      if (now - liveAlertsThrottleRef.current >= 2800) {
        liveAlertsThrottleRef.current = now;
        void loadSupervisorAlerts();
      }
      void loadSupervisorSummary();
    } catch (err) {
      if (gen === liveGenRef.current) {
        const msg = formatMonitoringFetchError(err, "تعذر إكمال التحليل التلقائي.");
        setLiveAnalysisError(msg);
        console.error("[Monitoring] live tick failed:", MONITORING_ANALYZE_URL, err);
      }
    } finally {
      liveAnalysisInFlightRef.current = false;
      setLiveTickBusy(false);
      // Use tickLiveRef so this closure always calls the latest version, never a stale one.
      if (gen === liveGenRef.current) {
        if (liveAnalysisScheduleRef.current != null) {
          clearTimeout(liveAnalysisScheduleRef.current);
        }
        liveAnalysisScheduleRef.current = window.setTimeout(
          () => void tickLiveRef.current?.(),
          LIVE_ANALYSIS_GAP_MS,
        );
      }
    }
  }, [
    role,
    getAccessToken,
    monitoringWebcamOn,
    monitoringLiveAutoOn,
    callAnalyzeFrameEndpoint,
    handleProtectedAuthFailure,
    loadSupervisorAlerts,
    loadSupervisorSummary,
  ]);

  // Keep tickLiveRef in sync so timers always call the freshest version.
  useEffect(() => {
    tickLiveRef.current = tickLiveMonitoringAnalysis;
  }, [tickLiveMonitoringAnalysis]);

  useEffect(() => {
    selectedMonitoringZoneIdRef.current = selectedMonitoringZoneId;
  }, [selectedMonitoringZoneId]);

  useEffect(() => {
    const stream = monitoringWebcamStreamRef.current;
    const targets = [monitoringLiveVideoRef, livePrevKitchenRef, livePrevStorageRef, livePrevPrepRef];
    targets.forEach((r) => {
      if (r.current) r.current.srcObject = monitoringWebcamOn && stream ? stream : null;
    });
  }, [monitoringWebcamOn]);

  // Start / stop the live analysis cycle. Only depends on on/off flags — NOT on the callback
  // identity, so form-state changes don't restart the timer every re-render.
  useEffect(() => {
    if (!monitoringLiveAutoOn || !monitoringWebcamOn) {
      if (liveAnalysisScheduleRef.current != null) {
        clearTimeout(liveAnalysisScheduleRef.current);
        liveAnalysisScheduleRef.current = null;
      }
      return undefined;
    }
    void tickLiveRef.current?.();
    return () => {
      if (liveAnalysisScheduleRef.current != null) {
        clearTimeout(liveAnalysisScheduleRef.current);
        liveAnalysisScheduleRef.current = null;
      }
    };
  }, [monitoringLiveAutoOn, monitoringWebcamOn]);

  /** Capture one JPEG frame from the in-browser preview and reuse the same analyze-frame API. */
  async function analyzeMonitoringWebcamFrame() {
    if (!(role === "supervisor" || role === "admin")) return;
    const token = getAccessToken();
    if (!token) {
      setToast({ type: "error", text: "يجب تسجيل الدخول." });
      return;
    }
    const video = monitoringLiveVideoRef.current;
    if (!video || video.readyState < 2) {
      setToast({ type: "error", text: "شغّل كاميرا الجهاز ثم انتظر ظهور المعاينة." });
      return;
    }
    setMonitoringWebcamBusy(true);
    setMonitoringAnalyzeLoading(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no_canvas");
      ctx.drawImage(video, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
      if (!blob) throw new Error("no_blob");
      const file = new File([blob], "device-camera.jpg", { type: "image/jpeg" });
      const { ok, status, body } = await callAnalyzeFrameEndpoint(file, token, { analysisMode: "manual" });
      if (handleProtectedAuthFailure(status, body?.detail)) return;
      if (!isMonitoringAnalyzeSuccess(status, body)) {
        const errDetail = typeof body?.detail === "string" && body.detail.trim() ? body.detail : null;
        setToast({ type: "error", text: errDetail || "فشل تحليل اللقطة." });
        return;
      }
      setMonitoringAnalysisResult(body);
      setMonitoringLastAnalyzedAt(new Date().toISOString());
      setToast({
        type: "success",
        text: Number(body?.alerts_created) > 0 ? "تم تسجيل مخالفة" : "تم تحليل اللقطة.",
      });
      await loadSupervisorAlerts();
      await loadSupervisorCameras();
      await loadSupervisorSummary();
    } catch (err) {
      console.error("[Monitoring] manual webcam frame failed:", MONITORING_ANALYZE_URL, err);
      setToast({
        type: "error",
        text: formatMonitoringFetchError(err, "تعذر التقاط أو تحليل الصورة من الكاميرا."),
      });
    } finally {
      setMonitoringWebcamBusy(false);
      setMonitoringAnalyzeLoading(false);
    }
  }

  async function analyzeMonitoringFrameUpload() {
    if (!(role === "supervisor" || role === "admin")) return;
    const token = getAccessToken();
    if (!token || !cameraTestFile) {
      setToast({ type: "error", text: "يرجى اختيار صورة للتحليل." });
      return;
    }
    setMonitoringAnalyzeLoading(true);
    try {
      const { ok, status, body } = await callAnalyzeFrameEndpoint(cameraTestFile, token, {
        analysisMode: "manual",
      });
      if (handleProtectedAuthFailure(status, body?.detail)) return;
      if (!isMonitoringAnalyzeSuccess(status, body)) {
        const errDetail = typeof body?.detail === "string" && body.detail.trim() ? body.detail : null;
        if (status === 503) {
          setToast({ type: "error", text: errDetail || "تعذر تحليل الصورة. تحقق من إعدادات الذكاء الاصطناعي أو فعّل وضع التجريبي." });
        } else if (status === 400) {
          setToast({ type: "error", text: errDetail || "الصورة غير صالحة." });
        } else {
          setToast({ type: "error", text: errDetail || "فشل تحليل الصورة. تحقق من إعدادات الذكاء الاصطناعي." });
        }
        return;
      }
      setMonitoringAnalysisResult(body);
      setMonitoringLastAnalyzedAt(new Date().toISOString());
      if (Number(body?.alerts_created) > 0) {
        setToast({ type: "success", text: "تم تسجيل مخالفة" });
      }
      await loadSupervisorAlerts();
      await loadSupervisorCameras();
      await loadSupervisorSummary();
    } catch (err) {
      console.error("[Monitoring] image upload analyze failed:", MONITORING_ANALYZE_URL, err);
      setToast({
        type: "error",
        text: formatMonitoringFetchError(err, "فشل تحليل الصورة. تحقق من إعدادات الذكاء الاصطناعي."),
      });
    } finally {
      setMonitoringAnalyzeLoading(false);
    }
  }

  function onSelectMonitoringVideoFile(file) {
    if (!file) {
      setCameraVideoFile(null);
      setCameraVideoError("");
      setMonitoringVideoResults([]);
      setMonitoringVideoFrameResults([]);
      setMonitoringVideoAlertsCreated(0);
      return;
    }
    if (!String(file.type || "").startsWith("video/")) {
      setCameraVideoFile(null);
      setCameraVideoError("الملف المحدد ليس فيديو صالحاً. الرجاء اختيار ملف mp4 أو mov أو webm.");
      return;
    }
    setCameraVideoError("");
    setCameraVideoFile(file);
    setMonitoringVideoResults([]);
    setMonitoringVideoFrameResults([]);
    setMonitoringVideoAlertsCreated(0);
  }

  function extractFrameBlobAt(videoEl, atSecond) {
    return new Promise((resolve, reject) => {
      const onSeeked = () => {
        videoEl.removeEventListener("seeked", onSeeked);
        const canvas = document.createElement("canvas");
        canvas.width = videoEl.videoWidth || 1280;
        canvas.height = videoEl.videoHeight || 720;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("ctx_failed"));
          return;
        }
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("blob_failed"));
            return;
          }
          resolve(blob);
        }, "image/jpeg", 0.9);
      };
      videoEl.addEventListener("seeked", onSeeked, { once: true });
      videoEl.currentTime = Math.max(0, atSecond);
    });
  }

  async function analyzeMonitoringVideoUpload() {
    if (!(role === "supervisor" || role === "admin")) return;
    const token = getAccessToken();
    if (!token || !cameraVideoFile) {
      setToast({ type: "error", text: "يرجى اختيار فيديو للتحليل." });
      return;
    }
    setMonitoringVideoAnalyzeLoading(true);
    setMonitoringVideoProgressText("جاري تجهيز الفيديو...");
    setMonitoringVideoResults([]);
    setMonitoringVideoFrameResults([]);
    setMonitoringVideoAlertsCreated(0);
    try {
      const url = URL.createObjectURL(cameraVideoFile);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.src = url;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("video_metadata_failed"));
      });
      const duration = Number(video.duration);
      const times = makeVideoFrameTimes(duration, 24);
      if (!times.length) {
        setToast({ type: "error", text: "تعذر قراءة مدة الفيديو للتحليل." });
        URL.revokeObjectURL(url);
        return;
      }
      const frameRows = [];
      let alertsCreated = 0;
      let apiErrorShown = false;
      for (let i = 0; i < times.length; i += 1) {
        const t = times[i];
        setMonitoringVideoProgressText(`جاري تحليل الفيديو... (${i + 1}/${times.length})`);
        const frameBlob = await extractFrameBlobAt(video, t);
        const frameUrl = URL.createObjectURL(frameBlob);
        const frameFile = new File([frameBlob], `video-frame-${Math.round(t * 1000)}.jpg`, { type: "image/jpeg" });
        // Use the same endpoint/FormData/auth as the working single-image upload.
        const { ok, status, body } = await callAnalyzeFrameEndpoint(frameFile, token, {
          analysisMode: "manual",
        });
        if (handleProtectedAuthFailure(status, body?.detail)) {
          URL.revokeObjectURL(url);
          return;
        }
        if (!isMonitoringAnalyzeSuccess(status, body)) {
          if (!apiErrorShown) {
            apiErrorShown = true;
            const errDetail = typeof body?.detail === "string" && body.detail.trim() ? body.detail : null;
            setToast({ type: "error", text: errDetail || "تعذر تحليل بعض اللقطات. تحقق من إعدادات الذكاء الاصطناعي." });
          }
          frameRows.push({
            id: `frame-${i}`,
            atSecond: t,
            frameUrl,
            violations: [],
            errorText: typeof body?.detail === "string" && body.detail.trim() ? body.detail : "تعذر تحليل هذه اللقطة",
          });
          continue;
        }
        alertsCreated += Number(body?.alerts_created || 0);
        const violations = Array.isArray(body?.violations) ? body.violations : [];
        const normalized = violations
          .filter((v) => v && !v.alias_of)
          .map((v, idx) => ({
          id: `${i}-${idx}-${v?.type || "x"}`,
          atSecond: t,
          type: v?.label_ar || v?.type || "غير محدد",
          typeKey: canonicalMonitoringViolationType(
            String(v?.type || v?.label_ar || `unknown-${idx}`).trim().toLowerCase(),
          ),
          confidence: Number(v?.confidence || 0),
          status: v?.status || "open",
          reason: v?.reason_ar || "",
          personIndex: v?.person_index ?? null,
          aliasOf: v?.alias_of ?? null,
          frameId: `frame-${i}`,
        }));
        frameRows.push({
          id: `frame-${i}`,
          atSecond: t,
          frameUrl,
          violations: normalized,
          frameReport: body?.frame_report || null,
          errorText: "",
        });
      }
      URL.revokeObjectURL(url);
      const flatViolations = [];
      frameRows.forEach((frame) => {
        if (frame.errorText) return;
        (frame.violations || []).forEach((v) => {
          if (v.aliasOf) return;
          flatViolations.push(v);
        });
      });
      const aggregated = mergeNearbyMonitoringViolations(flatViolations, 0.9).sort(
        (a, b) => Number(b.confidence || 0) - Number(a.confidence || 0),
      );
      setMonitoringVideoFrameResults(frameRows);
      setMonitoringVideoResults(aggregated);
      setMonitoringVideoAlertsCreated(alertsCreated);
      setMonitoringLastAnalyzedAt(new Date().toISOString());
      if (!apiErrorShown) {
        if (alertsCreated > 0) {
          setToast({ type: "success", text: `تم تسجيل ${alertsCreated} مخالفة من تحليل الفيديو.` });
        } else if (aggregated.length > 0) {
          setToast({ type: "success", text: "تم تحليل الفيديو وعرض المخالفات المكتشفة." });
        } else {
          setToast({ type: "success", text: "تم تحليل اللقطات ولم يتم اكتشاف مخالفات." });
        }
      }
      await loadSupervisorAlerts();
      await loadSupervisorCameras();
      await loadSupervisorSummary();
    } catch (_err) {
      setToast({ type: "error", text: "تعذر تحليل الفيديو حالياً." });
    } finally {
      setMonitoringVideoAnalyzeLoading(false);
      setMonitoringVideoProgressText("");
    }
  }

  async function resolveMonitoringAlert(alertId) {
    const token = getAccessToken();
    if (!token) return;
    setMonitoringResolveLoadingId(alertId);
    try {
      const res = await fetch(`${SUPERVISOR_ALERTS_URL}/${alertId}/resolve`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ type: "error", text: body?.detail ? String(body.detail) : "تعذر تحديث التنبيه." });
        return;
      }
      await loadSupervisorAlerts();
      await loadSupervisorSummary();
    } catch {
      setToast({ type: "error", text: "تعذر تحديث التنبيه." });
    } finally {
      setMonitoringResolveLoadingId(null);
    }
  }

  async function addSupervisorCamera() {
    const token = getAccessToken();
    if (!token || !newCameraForm.name.trim() || !newCameraForm.location.trim()) return;
    try {
      const res = await fetch(SUPERVISOR_CAMERAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: newCameraForm.name.trim(),
          location: newCameraForm.location.trim(),
          stream_url: newCameraForm.stream_url.trim() || null,
          is_connected: true,
          ai_enabled: true,
        }),
      });
      if (!res.ok) {
        setToast({ type: "error", text: "تعذر إضافة الكاميرا." });
        return;
      }
      setNewCameraForm({ name: "", location: "", stream_url: "" });
      setToast({ type: "success", text: "تمت إضافة الكاميرا." });
      await loadSupervisorCameras();
    } catch {
      setToast({ type: "error", text: "تعذر إضافة الكاميرا." });
    }
  }

  useEffect(() => {
    if (role !== "staff") return;
    void reloadStaffDishes();
  }, [role, reloadStaffDishes]);

  useEffect(() => {
    if (role !== "staff") return undefined;
    const onReviewUpdated = () => {
      void reloadStaffDishes();
    };
    window.addEventListener(DISH_REVIEW_UPDATED_EVENT, onReviewUpdated);
    return () => window.removeEventListener(DISH_REVIEW_UPDATED_EVENT, onReviewUpdated);
  }, [role, reloadStaffDishes]);

  const stopCameraStream = useCallback(() => {
    const stream = cameraStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => () => stopCameraStream(), [stopCameraStream]);

  async function startCameraPreview() {
    if (cameraLoading) return;
    setCameraError("");
    setCaptureMode("camera");
    setCameraLoading(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("camera_unsupported");
      }
      stopCameraStream();
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play().catch(() => {});
      }
    } catch (err) {
      const name = err?.name || "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setCameraError("تم رفض إذن الكاميرا. اسمح بالوصول للكاميرا ثم أعد المحاولة.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setCameraError("لم يتم العثور على كاميرا متاحة على هذا الجهاز.");
      } else {
        setCameraError("تعذر تشغيل الكاميرا حاليًا.");
      }
    } finally {
      setCameraLoading(false);
    }
  }

  function closeCaptureModal() {
    setCaptureModalOpen(false);
    setCaptureMode("choice");
    setCameraError("");
    setCameraLoading(false);
    stopCameraStream();
  }

  function openCaptureModal() {
    setCaptureModalOpen(true);
    setCaptureMode("camera");
    setCameraError("");
    void startCameraPreview();
  }

  async function captureFromCamera() {
    const video = cameraVideoRef.current;
    if (!video || video.videoWidth < 2 || video.videoHeight < 2) {
      setCameraError("الكاميرا غير جاهزة بعد. انتظر لحظة ثم أعد الالتقاط.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("تعذر معالجة الصورة الملتقطة.");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      setCameraError("فشل التقاط الصورة. حاول مرة أخرى.");
      return;
    }
    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
    setSelectedImage(file);
    closeCaptureModal();
    void handleDetectDish(file);
  }

  async function submitDishRecord() {
    if (!selectedImage) {
      setDishNotice({ type: "error", text: "يرجى رفع صورة أولًا." });
      return;
    }
    if (detectResult?.proteinConflict) {
      const pick = manualDish.trim() || selectedAlternative.trim();
      if (!pick) {
        setDishNotice({
          type: "error",
          text: "يوجد تعارض بين الاقتراحات. اختر أحد الخيارات أو اكتب اسم الطبق يدويًا قبل الحفظ.",
        });
        return;
      }
    }
    const confirmed =
      manualDish.trim() ||
      selectedAlternative ||
      (detectResult?.proteinConflict ? "" : detectResult?.detected) ||
      "";
    if (!confirmed.trim()) {
      setDishNotice({
        type: "error",
        text: detectResult
          ? "أدخل اسم الطبق أو اختر أحد الاقتراحات قبل الحفظ."
          : "اكتب اسم الطبق في الحقل أدناه (التعرف التلقائي غير متاح أو لم يكتمل بعد).",
      });
      return;
    }
    let imageDataUrl;
    try {
      imageDataUrl = await readImageFileAsDataURL(selectedImage);
    } catch {
      setDishNotice({ type: "error", text: "تعذر قراءة ملف الصورة. أعد المحاولة." });
      return;
    }
    if (imageDataUrl.length > DISH_IMAGE_DATA_URL_MAX_CHARS) {
      setDishNotice({
        type: "error",
        text: "صورة الطبق كبيرة جدًا. جرّب صورة أصغر أو أقل دقة ثم احفظ مجددًا.",
      });
      return;
    }
    const predictedFromAi =
      detectResult?.suggestions?.[0]?.name ||
      detectResult?.detected ||
      manualDish.trim() ||
      "طبق غير معروف";
    await saveDishEntry({
      imageDataUrl,
      predictedFromAi,
      confirmed,
      quantityValue: positiveIntQuantity(quantity),
      sourceEntity,
      staffMe,
      onSaved: () => {
        setSelectedImage(null);
        setDetectResult(null);
        setSelectedAlternative("");
        setManualDish("");
        setQuantity(1);
        setSourceEntity("");
      },
      onNetworkError: (_err) => {
        setDishNotice({
          type: "error",
          text: "تعذر الاتصال بالخادم أو قراءة الاستجابة. تحقق من تشغيل الـ backend والشبكة.",
        });
      },
    });
  }

  function openEditRecord(record) {
    if (record?.reviewStatus === "approved") return;
    setEditingRecord(record);
    setEditForm({
      label: record.label,
      quantity: record.quantity,
      source: record.sourceEntity || "",
    });
  }

  async function saveEditedRecord() {
    await saveEditedDishRecord({
      editingRecord,
      editForm,
      quantityValue: positiveIntQuantity(editForm.quantity),
    });
  }

  async function confirmDeleteRecord(recordOverride) {
    await confirmDeleteDishRecord({ recordOverride, deleteTarget });
  }

  const videoAllFramesFailed =
    monitoringVideoFrameResults.length > 0 &&
    monitoringVideoFrameResults.every((f) => Boolean(f.errorText));

  const selectedZoneMeta = useMemo(
    () =>
      MONITORING_ZONE_DEFINITIONS.find((z) => z.id === selectedMonitoringZoneId) ||
      MONITORING_ZONE_DEFINITIONS[0],
    [selectedMonitoringZoneId],
  );

  const mergedRestaurantCamConfigs = useMemo(
    () => mergeRestaurantCameraDefaults(MONITORING_ZONE_DEFINITIONS, restaurantCamConfigs),
    [restaurantCamConfigs],
  );

  const cctvDashboardSummary = useMemo(() => {
    const ymd = todayIsoDateLocal();
    const todayAlerts = alertsList.filter((a) => isAlertToday(a, ymd));
    let worstZone = MONITORING_ZONE_DEFINITIONS[0];
    let worstN = -1;
    for (const z of MONITORING_ZONE_DEFINITIONS) {
      const n = alertsForZone(z, todayAlerts).length;
      if (n > worstN) {
        worstN = n;
        worstZone = z;
      }
    }
    const apiStreams = cameraCards.filter(
      (c) => c?.is_connected && String(c?.stream_url || c?.streamUrl || "").trim(),
    ).length;
    const deviceLiveStream = monitoringWebcamOn && monitoringLiveAutoOn ? 1 : 0;
    const connectedCams = apiStreams + deviceLiveStream;
    const people =
      supervisorSummary?.total_employees ??
      supervisorSummary?.active_employees_today ??
      "—";
    return {
      totalZones: MONITORING_ZONE_DEFINITIONS.length,
      activeStreams: connectedCams,
      violationsToday: todayAlerts.length,
      worstZoneLabel: worstN > 0 ? worstZone.zoneAr : "لا يوجد",
      peopleCount: people,
    };
  }, [
    alertsList,
    cameraCards,
    supervisorSummary,
    monitoringWebcamOn,
    monitoringLiveAutoOn,
  ]);

  const resetLiveAnalysisState = useCallback((opts = {}) => {
    const { stopAuto = false } = opts;
    liveGenRef.current += 1;
    liveAnalysisInFlightRef.current = false;
    setLiveTickBusy(false);
    setMonitoringAnalyzeLoading(false);
    setMonitoringWebcamBusy(false);
    setLiveAnalysisError("");
    // Clear the analysis result display so the panel doesn't show stale data after reset.
    setMonitoringAnalysisResult(null);
    setMonitoringLastAnalyzedAt(null);
    setLiveSlotStates({});
    if (stopAuto) setMonitoringLiveAutoOn(false);
    if (liveAnalysisScheduleRef.current != null) {
      clearTimeout(liveAnalysisScheduleRef.current);
      liveAnalysisScheduleRef.current = null;
    }
  }, []);

  const stopMonitoringWebcam = useCallback(() => {
    resetLiveAnalysisState({ stopAuto: true });
    try {
      monitoringWebcamStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    monitoringWebcamStreamRef.current = null;
    const targets = [monitoringLiveVideoRef, livePrevKitchenRef, livePrevStorageRef, livePrevPrepRef];
    targets.forEach((r) => {
      if (r.current) r.current.srcObject = null;
    });
    setMonitoringWebcamOn(false);
  }, [resetLiveAnalysisState]);

  const startMonitoringWebcam = useCallback(async () => {
    setMonitoringWebcamError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMonitoringWebcamError("المتصفح لا يدعم الكاميرا.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      monitoringWebcamStreamRef.current = stream;
      const el = monitoringLiveVideoRef.current;
      if (el) {
        el.srcObject = stream;
        await el.play().catch(() => {});
      }
      setMonitoringWebcamOn(true);
    } catch {
      setMonitoringWebcamError("تعذر الوصول إلى كاميرا الجهاز. تحقق من أذونات المتصفح.");
      stopMonitoringWebcam();
    }
  }, [stopMonitoringWebcam]);

  const handleRestaurantCameraSave = useCallback(
    (zoneId, draft) => {
      const zone = MONITORING_ZONE_DEFINITIONS.find((z) => z.id === zoneId);
      const errs = validateRestaurantCameraDraft(draft);
      if (errs.length) {
        setToast({ type: "error", text: errs[0] });
        return;
      }
      setCameraSetupBusy((b) => ({ ...b, save: zoneId }));
      try {
        setRestaurantCamConfigs((prev) => {
          const payload = prepareSavePayload(draft, prev[zoneId], zone?.displayNameAr || "");
          const next = { ...prev, [zoneId]: payload };
          persistRestaurantCameraConfigs(next);
          return next;
        });
        setToast({ type: "success", text: "تم حفظ إعدادات الكاميرا." });
      } finally {
        setCameraSetupBusy((b) => ({ ...b, save: null }));
      }
    },
    [setToast],
  );

  const handleRestaurantCameraTest = useCallback(
    async (zoneId, draft) => {
      const errs = validateRestaurantCameraDraft(draft);
      if (errs.length) {
        setToast({ type: "error", text: errs[0] });
        return;
      }
      setCameraSetupBusy((b) => ({ ...b, test: zoneId }));
      const nowIso = new Date().toISOString();
      let ok = false;

      try {
        await new Promise((r) => setTimeout(r, 450));
        const t = draft.connectionType;

        if (t === RESTAURANT_CONNECTION_TYPES.DEVICE_WEBCAM) {
          if (!navigator.mediaDevices?.getUserMedia) {
            ok = false;
          } else {
            try {
              const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
              s.getTracks().forEach((tr) => tr.stop());
              ok = true;
            } catch {
              ok = false;
            }
          }
        } else if (t === RESTAURANT_CONNECTION_TYPES.UPLOADED_VIDEO) {
          ok = true;
        } else {
          ok = true;
        }

        setRestaurantCamConfigs((prev) => {
          const defaults = mergeRestaurantCameraDefaults(MONITORING_ZONE_DEFINITIONS, prev);
          const base = defaults[zoneId];
          const updated = { ...base, lastConnectionTestAt: nowIso, lastConnectionTestOk: ok };
          const next = { ...prev, [zoneId]: updated };
          persistRestaurantCameraConfigs(next);
          return next;
        });

        const needsBackendNote =
          t === RESTAURANT_CONNECTION_TYPES.IP_CAMERA || t === RESTAURANT_CONNECTION_TYPES.RTSP_URL;

        setToast({
          type: ok ? "success" : "error",
          text: ok
            ? needsBackendNote
              ? "نجح التحقق من الإعدادات. خدمة البث في الخادم مطلوبة للاتصال الفعلي بكاميرات IP/RTSP."
              : "تم التحقق بنجاح."
            : "فشل اختبار الاتصال (تأكد من الأذونات أو الإعدادات).",
        });
      } finally {
        setCameraSetupBusy((b) => ({ ...b, test: null }));
      }
    },
    [setToast],
  );

  const handleStartRestaurantLiveMonitoring = useCallback(
    async (zoneId) => {
      const defaults = mergeRestaurantCameraDefaults(MONITORING_ZONE_DEFINITIONS, restaurantCamConfigs);
      const cfg = defaults[zoneId];
      const mode = cfg?.connectionType || RESTAURANT_CONNECTION_TYPES.IP_CAMERA;

      if (mode === RESTAURANT_CONNECTION_TYPES.IP_CAMERA || mode === RESTAURANT_CONNECTION_TYPES.RTSP_URL) {
        setToast({
          type: "info",
          text: "تم تجهيز إعدادات RTSP/IP في الواجهة. لتفعيل البث الفعلي يُطلَب تشغيل خدمة البث في الخادم (Backend streaming).",
        });
        return;
      }

      if (mode === RESTAURANT_CONNECTION_TYPES.UPLOADED_VIDEO) {
        setSelectedMonitoringZoneId(zoneId);
        setCameraAnalyzeMode("video");
        window.setTimeout(() => {
          supervisorMonitoringAiRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
        setToast({ type: "info", text: "انتقل إلى قسم تحليل الفيديو أدناه لرفع ملف الاختبار." });
        return;
      }

      setSelectedMonitoringZoneId(zoneId);
      await startMonitoringWebcam();
      setMonitoringLiveAutoOn(true);
    },
    [restaurantCamConfigs, setToast, startMonitoringWebcam],
  );

  const handleStopRestaurantLiveMonitoring = useCallback(
    (zoneId) => {
      if (selectedMonitoringZoneId !== zoneId) {
        setToast({ type: "info", text: "المراقبة المباشرة النشطة مسجَّلة لمنطقة أخرى." });
        return;
      }
      resetLiveAnalysisState({ stopAuto: true });
    },
    [selectedMonitoringZoneId, setToast, resetLiveAnalysisState],
  );

  const handleGoUploadedVideoMonitoringSection = useCallback((zoneId) => {
    setSelectedMonitoringZoneId(zoneId);
    setCameraAnalyzeMode("video");
    window.setTimeout(() => {
      supervisorMonitoringAiRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }, []);

  useEffect(() => {
    return () => {
      try {
        monitoringWebcamStreamRef.current?.getTracks?.().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    if (role !== "staff") return undefined;
    if (location.pathname === ROUTES.supervisorLegacy || location.pathname === ROUTES.monitoringLegacy) {
      navigate(ROUTES.dashboard, { replace: true });
    }
    return undefined;
  }, [role, location.pathname, navigate]);

  const monitoringFrameGroups = useMemo(() => {
    const groups = [];
    for (const frame of monitoringVideoFrameResults) {
      const cleanViolations = sortMonitoringViolationsReadable((frame.violations || []).filter((vv) => !vv.aliasOf));
      const violationKeys = cleanViolations
        .map((v) => canonicalMonitoringViolationType(v.typeKey || v.type))
        .filter((k) => k && ALLOWED_MONITORING_VIOLATION_KEYS.has(k));
      const uniqueKeys = Array.from(new Set(violationKeys));
      const riskRaw = String(frame?.frameReport?.overall_risk_level || "").toLowerCase();
      const riskLevel = riskRaw === "high" || riskRaw === "medium" || riskRaw === "low"
        ? riskRaw
        : uniqueKeys.length >= 3
          ? "high"
          : uniqueKeys.length > 0
            ? "medium"
            : "low";
      const signature = `${uniqueKeys.slice().sort().join("|")}::${riskLevel}::${frame.errorText ? "err" : "ok"}`;
      const summaryLabel = uniqueKeys.length
        ? uniqueKeys.map((k) => getViolationLabel(k)).join("، ")
        : "لا توجد مخالفات";

      const item = {
        id: frame.id,
        frameUrl: frame.frameUrl,
        timeStart: frame.atSecond,
        timeEnd: frame.atSecond,
        count: 1,
        riskLevel,
        violations: uniqueKeys,
        summaryLabel,
        errorText: frame.errorText || "",
        signature,
      };

      const prev = groups[groups.length - 1];
      if (prev && prev.signature === signature && !item.errorText && !prev.errorText) {
        prev.timeEnd = frame.atSecond;
        prev.count += 1;
      } else {
        groups.push(item);
      }
    }
    return groups;
  }, [monitoringVideoFrameResults]);

  const filteredMonitoringFrameGroups = useMemo(() => {
    if (monitoringFrameFilter === "violations") {
      return monitoringFrameGroups.filter((g) => g.violations.length > 0);
    }
    if (monitoringFrameFilter === "high") {
      return monitoringFrameGroups.filter((g) => g.riskLevel === "high");
    }
    return monitoringFrameGroups;
  }, [monitoringFrameFilter, monitoringFrameGroups]);

  const monitoringSummary = useMemo(() => {
    const totalFrames = monitoringVideoFrameResults.length;
    const typeCount = new Map();
    let totalViolations = 0;
    let hasHigh = false;
    let hasMedium = false;
    monitoringFrameGroups.forEach((g) => {
      if (g.riskLevel === "high") hasHigh = true;
      else if (g.riskLevel === "medium") hasMedium = true;
      g.violations.forEach((k) => {
        typeCount.set(k, (typeCount.get(k) || 0) + g.count);
        totalViolations += g.count;
      });
    });
    let topType = "";
    let topCount = 0;
    for (const [k, n] of typeCount.entries()) {
      if (n > topCount) {
        topType = k;
        topCount = n;
      }
    }
    const overallRisk = hasHigh ? "high" : hasMedium ? "medium" : "low";
    return {
      totalFrames,
      totalViolations,
      mostCommon: topType ? getViolationLabel(topType) : "—",
      overallRisk,
    };
  }, [monitoringFrameGroups, monitoringVideoFrameResults.length]);

  return (
    <div
      className={`min-h-screen bg-surface text-slate-100 ${
        role === "supervisor" || role === "admin"
          ? "scroll-pt-28 sm:scroll-pt-32"
          : "scroll-pt-20 sm:scroll-pt-24"
      }`}
      dir="rtl"
    >
      {role === "admin" || role === "supervisor" ? (
        <style>
          {`
@media print {
  html, body {
    background: #ffffff !important;
  }
  .ska-dashboard-no-print {
    display: none !important;
  }
  #ska-violations-report-print,
  #ska-dish-review-report-print {
    display: none !important;
  }
  body.ska-print-violations-only #ska-violations-report-print,
  body.ska-print-dish-review-only #ska-dish-review-report-print {
    display: block !important;
    position: static !important;
    left: auto !important;
    top: auto !important;
    width: 100% !important;
    max-width: 100% !important;
    min-height: auto !important;
    box-sizing: border-box !important;
    background: #ffffff !important;
    color: #0f172a !important;
    direction: rtl !important;
    padding: 10mm !important;
    overflow: visible !important;
    z-index: auto !important;
    font-family: system-ui, "Segoe UI", Tahoma, Arial, sans-serif !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body.ska-print-violations-only #ska-dish-review-report-print,
  body.ska-print-dish-review-only #ska-violations-report-print {
    display: none !important;
  }
  body.ska-print-violations-only #ska-violations-report-print table,
  body.ska-print-dish-review-only #ska-dish-review-report-print table {
    table-layout: fixed;
    width: 100% !important;
  }
  body.ska-print-violations-only #ska-violations-report-print table th,
  body.ska-print-dish-review-only #ska-dish-review-report-print table th {
    background: #1e3a8a !important;
    color: #ffffff !important;
  }
  body.ska-print-violations-only #ska-violations-report-print .ska-print-section-title,
  body.ska-print-dish-review-only #ska-dish-review-report-print .ska-print-section-title {
    background: #bfdbfe !important;
    color: #0f172a !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  @page {
    size: A4 portrait;
    margin: 10mm;
  }
}
`}
        </style>
      ) : null}
      <div className="ska-dashboard-no-print">

      <DashboardNav
        role={role}
        navLinks={navLinks}
        mobileNavOpen={mobileNavOpen}
        setMobileNavOpen={setMobileNavOpen}
        logout={logout}
        dashboardTitle={dashboardTitle}
      />

      <main
        id="home"
        className="relative z-0 mx-auto max-w-7xl px-3 pb-6 pt-14 sm:px-6 sm:pb-8 sm:pt-16 lg:px-8 lg:pb-10"
      >
        {(role === "supervisor" || role === "admin") ? (
          <StickyAnalyticsSummaryBar
            qualityLabel={executiveQualityLabel}
            alertsOpenCount={unresolvedAlertsCount}
            violationsCount={
              supervisorSummaryLoading
                ? "…"
                : supervisorSummary?.violations_count != null
                  ? supervisorSummary.violations_count
                  : "—"
            }
            systemStatusLabel={alertsError ? "تعذّر تحميل التنبيهات" : monitoringHealthLine}
            activeCamerasCount={cctvDashboardSummary.activeStreams}
            loading={supervisorSummaryLoading || alertsLoading}
          />
        ) : null}
        {role === "staff" ? (
          <section
            className={`${staffElevatedCard} mb-6 p-4 sm:mb-8 sm:p-6 lg:p-8`}
            data-aos="fade-up"
            data-aos-duration="720"
          >
            <StaffProfileCard staffProfileLoading={staffProfileLoading} staffMe={staffMe} />
          </section>
        ) : (
          <section className={`${glassCard} mb-6 p-4 sm:mb-8 sm:p-6 lg:p-8`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-sky">نظرة تحليلية</p>
                <h2 className="mt-1 text-2xl font-bold text-white sm:text-3xl">{dashboardTitle}</h2>
                <p className="mt-2 max-w-2xl text-sm text-slate-400">{PLATFORM_BRAND.taglineAr}</p>
                {(role === "supervisor" || role === "admin") && !supervisorSummaryLoading ? (
                  <p className="mt-2 text-sm text-slate-300">
                    {role === "admin" ? (
                      "النطاق: جميع الفروع"
                    ) : (
                      <>الفرع: {supervisorSummary?.branch_name || "—"}</>
                    )}
                  </p>
                ) : null}
              </div>
              {!supervisorSummaryLoading && supervisorSummary && !hasMonitoringData ? (
                <span className="inline-flex w-fit max-w-[min(100%,20rem)] items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-400">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-slate-500" />
                  لا يوجد نشاط مسجّل بعد في مؤشرات المراقبة (صفر أطباق اليوم ومخالفات).
                </span>
              ) : null}
            </div>
          </section>
        )}

        {role === "staff" ? (
          <section id="dish-docs" className="grid gap-10 lg:gap-12">
            <div
              id={STAFF_SECTION_IDS.doc}
              ref={staffDocSectionRef}
              className="scroll-mt-28 sm:scroll-mt-32 lg:scroll-mt-36"
            >
            <DishDocSection
              staffCount={staffCount}
              selectedImage={selectedImage}
              selectedPreviewUrl={selectedPreviewUrl}
              detecting={detecting}
              detectResult={detectResult}
              manualDish={manualDish}
              setManualDish={setManualDish}
              selectedAlternative={selectedAlternative}
              setSelectedAlternative={setSelectedAlternative}
              quantity={quantity}
              setQuantity={setQuantity}
              sourceEntity={sourceEntity}
              setSourceEntity={setSourceEntity}
              saveLoading={saveLoading}
              dishNotice={dishNotice}
              captureModalOpen={captureModalOpen}
              videoRef={cameraVideoRef}
              cameraLoading={cameraLoading}
              cameraError={cameraError}
              dishFileInputRef={dishFileInputRef}
              onOpenCapture={openCaptureModal}
              onCloseCapture={closeCaptureModal}
              onCapturePhoto={() => void captureFromCamera()}
              onFileSelected={(file) => {
                setSelectedImage(file);
                closeCaptureModal();
                void handleDetectDish(file);
              }}
              onRetakeImage={() => {
                setSelectedImage(null);
                setDetectResult(null);
                setManualDish("");
                setSelectedAlternative("");
                setDishNotice(null);
              }}
              onDetectDish={handleDetectDish}
              onSave={submitDishRecord}
            />
            </div>

            <div
              id={STAFF_SECTION_IDS.search}
              ref={staffSearchSectionRef}
              className="scroll-mt-28 sm:scroll-mt-32 lg:scroll-mt-36"
            >
            <article
              className={`${staffElevatedCard} space-y-6 p-4 sm:space-y-7 sm:p-6`}
              data-aos="fade-up"
              data-aos-duration="760"
            >
              <DishFilters
                filterSearch={filterSearch}
                setFilterSearch={setFilterSearch}
                filterStatus={filterStatus}
                setFilterStatus={setFilterStatus}
                quickPreset={quickPreset}
                setQuickPreset={setQuickPreset}
                filtersAreDefault={filtersAreDefault}
                filterDateFrom={filterDateFrom}
                setFilterDateFrom={setFilterDateFrom}
                filterDateTo={filterDateTo}
                setFilterDateTo={setFilterDateTo}
                filterDateErrors={filterDateErrors}
                setFilterDateErrors={setFilterDateErrors}
                dishStats={dishStats}
                filterDishType={filterDishType}
                setFilterDishType={setFilterDishType}
                filterQtyMin={filterQtyMin}
                setFilterQtyMin={setFilterQtyMin}
                filterQtyMax={filterQtyMax}
                setFilterQtyMax={setFilterQtyMax}
                sortKey={sortKey}
                setSortKey={setSortKey}
                onResetFilters={resetAllFilters}
              />
            </article>
            </div>

            <div
              id={STAFF_SECTION_IDS.records}
              ref={staffRecordsSectionRef}
              className="scroll-mt-28 sm:scroll-mt-32 lg:scroll-mt-36"
            >
            <article
              className={`${staffElevatedCard} space-y-6 p-4 sm:space-y-8 sm:p-6 lg:p-8`}
              data-aos="fade-up"
              data-aos-duration="760"
            >
              <RecordsList
                staffRecords={staffRecords}
                displayedRecords={displayedRecords}
                staffRecordsLoading={staffRecordsLoading}
                staffRecordsLastUpdated={staffRecordsLastUpdated}
                highlightRawId={highlightRawId}
                onEdit={openEditRecord}
                onDelete={setDeleteTarget}
              />
            </article>
            </div>


            {captureModalOpen ? (
              <CameraCaptureSection
                videoRef={cameraVideoRef}
                cameraLoading={cameraLoading}
                cameraError={cameraError}
                onClose={closeCaptureModal}
                onCapture={() => void captureFromCamera()}
              />
            ) : null}

            <Toast toast={toast} />

            <DeleteConfirmModal
              deleteTarget={deleteTarget}
              onCancel={() => setDeleteTarget(null)}
              onConfirm={confirmDeleteRecord}
              isDeleting={deleteLoading}
            />

            <EditRecordModal
              editingRecord={editingRecord}
              editForm={editForm}
              setEditForm={setEditForm}
              onCancel={() => setEditingRecord(null)}
              onSave={saveEditedRecord}
              isSaving={editSaving}
            />
          </section>
        ) : (
          <>
            <SupervisorExecutiveHero
              branchLabel={executiveBranchLabel}
              liveMonitoringLabel={executiveLiveLabel}
              qualityPercentLabel={executiveQualityLabel}
            />

            <SupervisorSummaryCards
              cameraCount={cameraCards.length}
              activeAlertsCount={unresolvedAlertsCount}
              totalViolations={supervisorSummary?.violations_count}
              qualityPercent={supervisorSummary?.quality_score ?? supervisorSummary?.compliance_rate}
              loading={supervisorSummaryLoading || cameraCardsLoading}
            />

            <SupervisorMonitoringOverview
              cctvSummary={cctvDashboardSummary}
              highlights={supervisorBranchHighlights}
              liveLine={monitoringLiveLine}
              healthLine={monitoringHealthLine}
            />

            <section
              id="analytics"
              ref={supervisorAnalyticsRef}
              className={`${SECTION_THEME.quality} mb-10 scroll-mt-28 space-y-8 sm:scroll-mt-32`}
            >
              <div className="border-b border-white/10 pb-4">
                <h3 className="text-lg font-bold tracking-tight text-white">مؤشرات الأداء والتحليلات</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{PLATFORM_BRAND.taglineAr}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
              {supervisorCards.map((m) => (
                <article
                  key={m.label}
                  className={`${glassCard} relative overflow-hidden p-5 hover:-translate-y-0.5`}
                >
                  <div
                    className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${m.glow} to-transparent opacity-60`}
                  />
                  <div className="relative flex items-start justify-between gap-3">
                    <m.icon className="h-8 w-8 shrink-0 text-slate-400" />
                  </div>
                  <p className={`relative mt-4 text-[28px] font-bold leading-none tabular-nums ${m.valueClass}`}>{m.value}</p>
                  <p className="relative mt-2 text-xs font-medium text-slate-500">{m.label}</p>
                </article>
              ))}
              </div>
              <div className="grid gap-8 lg:grid-cols-2">
                <SupervisorAnalyticsRecharts loading={supervisorSummaryLoading} supervisorSummary={supervisorSummary} />
                <SupervisorAnalyticsBars loading={supervisorSummaryLoading} supervisorSummary={supervisorSummary} />
              </div>
            </section>

            <section
              id="alerts"
              ref={supervisorAlertsRef}
              className={`${SECTION_THEME.alerts} mb-8 scroll-mt-28 sm:scroll-mt-32`}
            >
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
                <h3 className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
                  <IconBell className="h-5 w-5 text-accent-amber" />
                  آخر التنبيهات
                </h3>
                {!alertsLoading && alertsList.length > 0 ? (
                  <p className="text-xs tabular-nums text-slate-500">{alertsList.length} تنبيهًا في القائمة</p>
                ) : null}
              </div>
              {alertsLoading ? (
                <div className="space-y-3" aria-busy="true">
                  {[1, 2, 3, 4].map((i) => (
                    <SkeletonPulse key={i} className="h-[4.5rem] w-full" />
                  ))}
                </div>
              ) : alertsError ? (
                <div className="rounded-xl border border-accent-red/35 bg-accent-red/10 px-3 py-6 text-center text-sm text-red-200">
                  {alertsError}
                </div>
              ) : alertsList.length > 0 ? (
                <ExpandMoreList initialVisible={3} listClassName="flex flex-col gap-4">
                  {alertsList.map((a) => {
                    const sev = alertSeverityBadgeMeta(a.confidence);
                    const typeLabel =
                      String(a.label_ar || "").trim() ||
                      getViolationLabel(canonicalMonitoringViolationType(a.type));
                    const st = String(a?.status || "").toLowerCase();
                    const canResolve = st === "open" || st === "new";
                    return (
                      <article
                        key={a.id}
                        className={`group rounded-xl border bg-[#0B1327]/80 px-4 py-4 text-start text-sm transition duration-200 hover:-translate-y-px hover:bg-[#0c162e]/92 ${alertWorkflowCardRing(a.status)}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold leading-snug text-slate-100">{a.label_ar || a.details || typeLabel}</p>
                            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                              نوع المخالفة: <span className="text-slate-300">{typeLabel}</span>
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${alertWorkflowBadgeClass(a.status)}`}
                            >
                              {monitoringAlertStatusAr(a.status)}
                            </span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sev.cls}`}>
                              {sev.label}
                            </span>
                          </div>
                        </div>
                        <dl className="mt-4 grid gap-2 text-[11px] leading-relaxed text-slate-400 sm:grid-cols-2">
                          <div>
                            <dt className="text-slate-600">الكاميرا</dt>
                            <dd className="font-medium text-slate-200">{a.camera_name || "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-slate-600">الفرع / المنطقة</dt>
                            <dd className="font-medium text-slate-200">
                              {a.branch_name || a.branch || a.location || "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-600">الوقت</dt>
                            <dd className="font-mono text-slate-300">{formatSaudiDateTime(a.created_at)}</dd>
                          </div>
                          <div>
                            <dt className="text-slate-600">الثقة</dt>
                            <dd className="tabular-nums text-slate-200">{displayAiConfidence(a.confidence)}</dd>
                          </div>
                        </dl>
                        {canResolve ? (
                          <button
                            type="button"
                            disabled={monitoringResolveLoadingId === a.id}
                            onClick={() => void resolveMonitoringAlert(a.id)}
                            className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/15 disabled:opacity-50"
                          >
                            {monitoringResolveLoadingId === a.id ? "جاري…" : "تمييز كمعالَج"}
                          </button>
                        ) : null}
                      </article>
                    );
                  })}
                </ExpandMoreList>
              ) : (
                <EmptyState
                  icon="🎉"
                  title="لا توجد تنبيهات حالية"
                  hint="عند ظهور مخالفات من المراقبة ستُعرض هنا مع حالة المعالجة والثقة."
                />
              )}
            </section>

            <section
              id="cameras"
              ref={supervisorCamerasRef}
              className={`${SECTION_THEME.cameras} mb-8 scroll-mt-28 overflow-hidden !p-0 sm:scroll-mt-32`}
            >
              <div className="border-b border-white/10 bg-[#020617]/95 px-5 py-4">
                <h3 className="text-lg font-bold text-white">مراقبة الكاميرات — {PLATFORM_BRAND.nameShortAr}</h3>
                <p className="mt-1 text-xs text-slate-400">
                  ثلاث مناطق تشغيل ثابتة (CAM-01 … CAM-03). التحليل عبر واجهات API الحالية؛ جاهزة لربط RTSP/IP مع خدمة البث.
                </p>
              </div>

              <div className="border-b border-white/10 bg-[#0b1224]/95 px-4 py-4 sm:px-5">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">ملخص المراقبة</p>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <article className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
                    <p className="text-[11px] text-slate-500">إجمالي الكاميرات (مناطق)</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-white">{cctvDashboardSummary.totalZones}</p>
                  </article>
                  <article className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
                    <p className="text-[11px] text-slate-500">كاميرات بنشاط بث</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-emerald-200">{cctvDashboardSummary.activeStreams}</p>
                  </article>
                  <article className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
                    <p className="text-[11px] text-slate-500">تنبيهات اليوم</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-amber-200">{cctvDashboardSummary.violationsToday}</p>
                  </article>
                  <article className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
                    <p className="text-[11px] text-slate-500">أعلى منطقة خطورة اليوم</p>
                    <p className="mt-1 text-sm font-semibold leading-snug text-red-100">{cctvDashboardSummary.worstZoneLabel}</p>
                  </article>
                  <article className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 sm:col-span-2 xl:col-span-1">
                    <p className="text-[11px] text-slate-500">عدد الأفراد (تقديري من النظام)</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-sky-100">{cctvDashboardSummary.peopleCount}</p>
                  </article>
                </div>
              </div>

              <div className="grid gap-4 border-b border-white/10 bg-[#030712] px-4 py-5 sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
                {MONITORING_ZONE_DEFINITIONS.map((zone, idx) => {
                  const matched = findCameraForZone(zone, cameraCards);
                  const za = alertsForZone(zone, alertsList);
                  const openV = za.filter((a) => String(a?.status || "").toLowerCase() !== "resolved").length;
                  const cfg = mergedRestaurantCamConfigs[zone.id];
                  const ct = cfg?.connectionType || RESTAURANT_CONNECTION_TYPES.IP_CAMERA;
                  const ipOrRtsp =
                    ct === RESTAURANT_CONNECTION_TYPES.IP_CAMERA ||
                    ct === RESTAURANT_CONNECTION_TYPES.RTSP_URL;

                  const streamConnected = monitoringWebcamOn && selectedMonitoringZoneId === zone.id;

                  const st = liveSlotStates[zone.id];
                  let riskTier = st?.tier || "neutral";
                  if (streamConnected && (riskTier === "neutral" || !st?.tier)) riskTier = "green";

                  const connLabel = ipOrRtsp
                    ? "منقطع — يتطلب خادم بث"
                    : streamConnected
                      ? monitoringLiveAutoOn
                        ? "متصل — تحليل تلقائي"
                        : "متصل — معاينة"
                      : "منقطع";

                  const lastTestLabel = cfg?.lastConnectionTestAt
                    ? `${cfg.lastConnectionTestOk === true ? "✓ " : cfg.lastConnectionTestOk === false ? "✗ " : ""}${formatSaudiDateTime(cfg.lastConnectionTestAt)}`
                    : "لم يُجرَ اختبار اتصال بعد";

                  const lastAnalysisLabel =
                    st?.lastAtLabel ||
                    (matched?.last_analysis_at ? formatSaudiDateTime(matched.last_analysis_at) : "—");

                  const previewRefs = [livePrevKitchenRef, livePrevStorageRef, livePrevPrepRef];

                  return (
                    <RestaurantCameraCard
                      key={zone.id}
                      zone={zone}
                      config={cfg}
                      riskTier={riskTier}
                      connected={streamConnected}
                      liveAnalyzing={
                        streamConnected &&
                        monitoringLiveAutoOn &&
                        liveTickBusy &&
                        selectedMonitoringZoneId === zone.id
                      }
                      connectionStatusLabel={connLabel}
                      lastConnectionTestLabel={lastTestLabel}
                      lastAnalysisLabel={lastAnalysisLabel}
                      riskLevelLabel={st?.statusLabel || "—"}
                      activeViolationsCount={openV}
                      peopleCount={typeof st?.peopleCount === "number" ? st.peopleCount : "—"}
                      streamPreviewRef={previewRefs[idx]}
                      onSave={(draft) => void handleRestaurantCameraSave(zone.id, draft)}
                      onTestConnection={(draft) => void handleRestaurantCameraTest(zone.id, draft)}
                      onStartLiveMonitoring={() => void handleStartRestaurantLiveMonitoring(zone.id)}
                      onStopMonitoring={() => handleStopRestaurantLiveMonitoring(zone.id)}
                      onGoToUploadedVideoTest={() => handleGoUploadedVideoMonitoringSection(zone.id)}
                      testBusy={cameraSetupBusy.test === zone.id}
                      saveBusy={cameraSetupBusy.save === zone.id}
                    />
                  );
                })}
              </div>

              <div className="flex flex-col gap-6 px-4 pb-6 pt-5 sm:px-6">
                <div className="rounded-xl border border-white/10 bg-[#060d1f]/40 px-4 py-3">
                  <p className="text-xs font-semibold text-slate-200">تسجيل كاميرا في الخادم (اختياري)</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    يُستخدم عند ربط الكاميرات بقاعدة البيانات؛ إعدادات IP أعلاه تُحفظ محلياً إلى أن يكتمل التكامل.
                  </p>
                </div>
                <div className="mb-3 grid gap-2 sm:grid-cols-3">
                  <input
                    type="text"
                    placeholder="اسم الكاميرا (جديدة)"
                    value={newCameraForm.name}
                    onChange={(e) => setNewCameraForm((f) => ({ ...f, name: e.target.value }))}
                    className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-white"
                  />
                  <input
                    type="text"
                    placeholder="الفرع/المنطقة"
                    value={newCameraForm.location}
                    onChange={(e) => setNewCameraForm((f) => ({ ...f, location: e.target.value }))}
                    className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-white"
                  />
                  <input
                    type="text"
                    placeholder="رابط البث (اختياري)"
                    value={newCameraForm.stream_url}
                    onChange={(e) => setNewCameraForm((f) => ({ ...f, stream_url: e.target.value }))}
                    className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void addSupervisorCamera()}
                    className="rounded-xl border border-brand-sky/35 bg-brand/15 px-3 py-2 text-xs font-semibold text-brand-sky"
                  >
                    إضافة كاميرا
                  </button>
                </div>

                <div
                  ref={supervisorMonitoringAiRef}
                  id="supervisor-monitoring-ai"
                  className="rounded-xl border border-white/10 bg-[#060d1f]/50 p-4"
                >
                  <p className="mb-2 text-sm font-semibold text-white">مراقبة بالذكاء الاصطناعي</p>
                  <div className="mb-3 rounded-xl border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
                    التحليل يتم على الخادم عبر YOLO (وليس Gemini للمراقبة). راجع في{" "}
                    <span className="font-mono text-slate-200" dir="ltr">backend/.env</span>{" "}
                    <span className="font-mono text-slate-200" dir="ltr">YOLO_MODEL_PATH</span>: الكمامة، القفازات،
                    غطاء الرأس، الزي، والنظافة (نفايات على الأرض / موقع الحاويات). اختياريًا{" "}
                    <span className="font-mono text-slate-200" dir="ltr">YOLO_WASTE_MODEL_PATH</span> لنموذج مخصص
                    للنفايات إن لم تكن الفئات ضمن النموذج الأساسي. لا يُفرض رصد النظارات.
                    حقل «الذكاء الاصطناعي» في بطاقة الكاميرا يخص التسجيل فقط ولا يوقف رفع الصورة/الفيديو للتحليل.
                  </div>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setCameraAnalyzeMode("image")}
                      className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                        cameraAnalyzeMode === "image"
                          ? "border-brand-sky/45 bg-brand/20 text-sky-100"
                          : "border-white/15 bg-[#0B1327]/60 text-slate-300 hover:text-white"
                      }`}
                    >
                      تحليل صورة
                    </button>
                    <button
                      type="button"
                      onClick={() => setCameraAnalyzeMode("video")}
                      className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                        cameraAnalyzeMode === "video"
                          ? "border-brand-sky/45 bg-brand/20 text-sky-100"
                          : "border-white/15 bg-[#0B1327]/60 text-slate-300 hover:text-white"
                      }`}
                    >
                      تحليل فيديو
                    </button>
                  </div>
                  <label className="mb-1 block text-xs text-slate-400">منطقة المراقبة (تُرسَل مع التحليل كـ location)</label>
                  <select
                    value={selectedMonitoringZoneId}
                    onChange={(e) => setSelectedMonitoringZoneId(e.target.value)}
                    className="mb-2 w-full max-w-md rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-white"
                  >
                    {MONITORING_ZONE_DEFINITIONS.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.zoneAr} · {z.camCode}
                      </option>
                    ))}
                  </select>
                  <p className="mb-3 text-[11px] text-slate-500">
                    الجلسة الحالية: <span className="font-semibold text-slate-300">{selectedZoneMeta.zoneAr}</span>
                  </p>
                  <label className="mb-2 block text-xs text-slate-400">ربط التحليل بكاميرا مسجلة (اختياري)</label>
                  <select
                    value={monitoringCameraSelectId}
                    onChange={(e) => setMonitoringCameraSelectId(e.target.value)}
                    className="mb-3 w-full max-w-md rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-white"
                  >
                    <option value="">بدون ربط بكاميرا</option>
                    {cameraCards.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name} — {c.location}
                      </option>
                    ))}
                  </select>
                  {cameraAnalyzeMode === "image" ? (
                    <>
                      <label className="mb-1 block text-xs font-medium text-slate-300">اختيار صورة اختبار</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setCameraTestFile(e.target.files?.[0] || null)}
                        className="mb-3 w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-200"
                      />
                      {!cameraTestFile ? (
                        <div className="mb-3 rounded-xl border border-dashed border-white/15 bg-[#0B1327]/40 px-3 py-4 text-center text-sm text-slate-400">
                          اختر صورة مطبخ لاختبار فحص السلامة
                        </div>
                      ) : null}
                      {cameraTestPreviewUrl ? (
                        <div className="mb-3 rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                          <img src={cameraTestPreviewUrl} alt="" className="block max-h-72 w-full object-contain" />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <label className="mb-1 block text-xs font-medium text-slate-300">اختيار فيديو اختبار</label>
                      <input
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                        onChange={(e) => onSelectMonitoringVideoFile(e.target.files?.[0] || null)}
                        className="mb-3 w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-200"
                      />
                      {cameraVideoError ? (
                        <div className="mb-3 rounded-xl border border-accent-red/35 bg-accent-red/10 px-3 py-3 text-sm text-red-200">
                          {cameraVideoError}
                        </div>
                      ) : null}
                      {cameraVideoFile ? (
                        <div className="mb-3 rounded-xl border border-white/10 bg-[#060d1f]/80 p-3 text-xs text-slate-300">
                          <p>الاسم: <span className="text-slate-100">{cameraVideoFile.name}</span></p>
                          <p className="mt-1">الحجم: <span className="text-slate-100">{formatFileBytes(cameraVideoFile.size)}</span></p>
                          <p className="mt-1">المدة: <span className="text-slate-100">{formatVideoDuration(cameraVideoDurationSec)}</span></p>
                        </div>
                      ) : (
                        <div className="mb-3 rounded-xl border border-dashed border-white/15 bg-[#0B1327]/40 px-3 py-4 text-center text-sm text-slate-400">
                          اختر فيديو مطبخ بصيغة mp4 أو mov أو webm
                        </div>
                      )}
                      {cameraVideoPreviewUrl ? (
                        <div className="mb-3 rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                          <video
                            src={cameraVideoPreviewUrl}
                            controls
                            className="block max-h-72 w-full rounded-lg bg-black object-contain"
                            onLoadedMetadata={(e) => {
                              const dur = Number(e.currentTarget.duration);
                              setCameraVideoDurationSec(Number.isFinite(dur) ? dur : null);
                            }}
                          />
                        </div>
                      ) : null}
                      <div className="mb-3 rounded-xl border border-sky-500/35 bg-sky-500/10 px-3 py-3 text-sm text-sky-100">
                        سيتم تحليل الفيديو على شكل لقطات متتابعة باستخدام endpoint التحليل الحالي.
                      </div>
                    </>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {cameraAnalyzeMode === "image" ? (
                      <button
                        type="button"
                        disabled={monitoringAnalyzeLoading || !cameraTestFile}
                        onClick={() => void analyzeMonitoringFrameUpload()}
                        className="rounded-xl border border-brand-sky/35 bg-brand/15 px-4 py-2 text-xs font-semibold text-brand-sky disabled:opacity-50"
                      >
                        {monitoringAnalyzeLoading ? (
                          <span className="inline-flex items-center gap-2">
                            <Spinner className="h-4 w-4 border-2 border-white/30 border-t-white" />
                            جاري التحليل…
                          </span>
                        ) : (
                          "تحليل الصورة"
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={monitoringVideoAnalyzeLoading || !cameraVideoFile}
                        onClick={() => void analyzeMonitoringVideoUpload()}
                        className="rounded-xl border border-brand-sky/35 bg-brand/15 px-4 py-2 text-xs font-semibold text-brand-sky disabled:opacity-50"
                      >
                        {monitoringVideoAnalyzeLoading ? (
                          <span className="inline-flex items-center gap-2">
                            <Spinner className="h-4 w-4 border-2 border-white/30 border-t-white" />
                            جاري تحليل الفيديو...
                          </span>
                        ) : (
                          "تحليل الفيديو"
                        )}
                      </button>
                    )}
                  </div>
                  <div className="mt-4 rounded-xl border border-emerald-500/25 bg-[#041014]/80 p-4">
                    <p className="mb-2 text-sm font-semibold text-emerald-100">مراقبة مباشرة — كاميرا الجهاز</p>
                    <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
                      يبقى البث مفتوحاً طوال الجلسة؛ التحليل التلقائي يرسل إطاراً كل ~10 ثوانٍ بعد اكتمال تحليل YOLO على الخادم (أول لقطة قد تستغرق 1–3 دقائق).
                      المعاينة الحالية تُعرض على المناطق الثلاث حتى يُربط لاحقاً بث RTSP/IP منفصل لكل بطاقة دون تغيير الواجهة.
                    </p>
                    <LiveMonitoringZoneCards
                      zones={MONITORING_ZONE_DEFINITIONS}
                      selectedZoneId={selectedMonitoringZoneId}
                      onSelectZone={(id) => setSelectedMonitoringZoneId(id)}
                      slotStates={liveSlotStates}
                      previewRefs={[livePrevKitchenRef, livePrevStorageRef, livePrevPrepRef]}
                      liveAutoOn={monitoringLiveAutoOn}
                      liveTickBusy={liveTickBusy}
                    />
                    <p className="mb-2 mt-4 text-[11px] text-slate-500">
                      المنطقة النشطة للتحليل (تتطابق مع القائمة أعلاه):{" "}
                      <span className="font-semibold text-slate-300">{selectedZoneMeta.zoneAr}</span>
                    </p>
                    <video
                      ref={monitoringLiveVideoRef}
                      className="mb-3 max-h-64 w-full rounded-lg border border-white/10 bg-black object-cover"
                      playsInline
                      muted
                      autoPlay
                    />
                    <div className="mb-2 flex flex-wrap gap-2">
                      {!monitoringWebcamOn ? (
                        <button
                          type="button"
                          onClick={() => void startMonitoringWebcam()}
                          className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/25"
                        >
                          تشغيل كاميرا الجهاز
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={stopMonitoringWebcam}
                          className="rounded-xl border border-white/20 bg-[#0B1327]/80 px-4 py-2 text-xs font-semibold text-slate-200"
                        >
                          إيقاف الكاميرا
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!monitoringWebcamOn || monitoringLiveAutoOn}
                        onClick={() => setMonitoringLiveAutoOn(true)}
                        className="rounded-xl border border-violet-500/40 bg-violet-500/15 px-4 py-2 text-xs font-semibold text-violet-100 disabled:opacity-40"
                      >
                        بدء التحليل المباشر (YOLO)
                      </button>
                      <button
                        type="button"
                        disabled={!monitoringLiveAutoOn}
                        onClick={() => resetLiveAnalysisState({ stopAuto: true })}
                        className="rounded-xl border border-white/20 bg-[#0B1327]/80 px-4 py-2 text-xs font-semibold text-slate-300 disabled:opacity-40"
                      >
                        إيقاف التحليل المباشر
                      </button>
                      <button
                        type="button"
                        disabled={!monitoringWebcamOn || monitoringWebcamBusy || monitoringAnalyzeLoading}
                        onClick={() => void analyzeMonitoringWebcamFrame()}
                        className="rounded-xl border border-brand-sky/40 bg-brand/15 px-4 py-2 text-xs font-semibold text-brand-sky disabled:opacity-50"
                      >
                        {monitoringWebcamBusy || monitoringAnalyzeLoading ? "جاري التحليل…" : "تحليل لقطة يدوي"}
                      </button>
                      {(liveTickBusy || liveAnalysisError || monitoringAnalyzeLoading) && monitoringWebcamOn ? (
                        <button
                          type="button"
                          onClick={() => resetLiveAnalysisState({ stopAuto: false })}
                          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-100"
                        >
                          إعادة ضبط حالة التحليل
                        </button>
                      ) : null}
                    </div>
                    {monitoringLiveAutoOn && monitoringWebcamOn ? (
                      <p className="mb-2 text-[11px] text-emerald-200/90">
                        التحليل التلقائي نشط — إطار جديد كل ~10 ثوانٍ بعد اكتمال YOLO. للتسجيل الفوري استخدم «تحليل لقطة يدوي».
                      </p>
                    ) : null}
                    {liveAnalysisError ? (
                      <p className="mb-2 text-[11px] text-red-300" role="alert">
                        {liveAnalysisError}
                      </p>
                    ) : null}
                    {monitoringWebcamError ? (
                      <p className="mt-2 text-xs text-red-300">{monitoringWebcamError}</p>
                    ) : null}
                  </div>
                  {cameraAnalyzeMode === "video" ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      يتم حفظ المخالفات المكتشفة عبر تنبيهات النظام عند توفر شروط الحفظ في backend.
                    </p>
                  ) : null}
                  {cameraAnalyzeMode === "video" && monitoringVideoProgressText ? (
                    <p className="mt-1 text-xs text-slate-400">{monitoringVideoProgressText}</p>
                  ) : null}
                  {monitoringLastAnalyzedAt ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      آخر تحليل: {formatSaudiDateTime(monitoringLastAnalyzedAt)}
                    </p>
                  ) : null}
                </div>

                {monitoringAnalysisResult &&
                (cameraAnalyzeMode === "image" || monitoringWebcamOn) ? (() => {
                  const res = monitoringAnalysisResult;
                  const qualityPct = typeof res.quality_pct === "number" ? res.quality_pct : 100;
                  const overallStatus = res.overall_status || "clean";
                  const realViolations = Array.isArray(res.violations)
                    ? res.violations.filter((v) => !v.alias_of)
                    : [];
                  const hasNoPerson = realViolations.some((v) => v.type === "no_person_in_zone");
                  const hasCameraWarning = realViolations.some((v) => v.type === "unclear_camera_angle");
                  const displayViolations = realViolations.filter(
                    (v) => v.type !== "no_person_in_zone" && v.type !== "unclear_camera_angle"
                  );
                  const ppeNotice = res.frame_report?.ppe_notice_ar;

                  const qualityColor =
                    qualityPct >= 95 ? "text-emerald-400" : qualityPct >= 70 ? "text-amber-400" : "text-red-400";
                  const statusBg =
                    overallStatus === "clean"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                      : overallStatus === "warning"
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                      : "border-red-500/30 bg-red-500/10 text-red-200";
                  const statusLabel =
                    overallStatus === "clean"
                      ? "مطابق للمعايير"
                      : overallStatus === "warning"
                      ? "تحذير — مخالفات بسيطة"
                      : "خطر — مخالفات حرجة";

                  const sevCardClass = (sev) =>
                    sev === "high"
                      ? "border-red-500/35 bg-red-500/8"
                      : sev === "medium"
                      ? "border-amber-500/35 bg-amber-500/8"
                      : "border-sky-500/25 bg-sky-500/8";
                  const sevBadgeClass = (sev) =>
                    sev === "high"
                      ? "border-red-500/40 bg-red-500/20 text-red-200"
                      : sev === "medium"
                      ? "border-amber-500/40 bg-amber-500/20 text-amber-200"
                      : "border-sky-500/30 bg-sky-500/15 text-sky-200";
                  const sevLabel = (sev) =>
                    sev === "high" ? "عالي" : sev === "medium" ? "متوسط" : "منخفض";
                  const catLabel = (cat) => {
                    const m = { PPE: "معدات الوقاية", hygiene: "النظافة", waste: "النفايات", cleanliness: "النظافة العامة", staff_behavior: "سلوك العمال", food_safety: "سلامة الغذاء" };
                    return m[cat] || cat;
                  };

                  return (
                    <div className="mt-4 space-y-3">
                      {/* Status header */}
                      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#060d1f]/80 px-4 py-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusBg}`}>
                              {statusLabel}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {res.violation_count ?? displayViolations.length} مخالفة
                            </span>
                          </div>
                          <p className="mt-1.5 text-[10px] text-slate-500">
                            المنطقة: {selectedZoneMeta.zoneAr}
                            {typeof res.people_count === "number" && res.people_count > 0
                              ? ` · الأشخاص المرصودون: ${res.people_count}`
                              : ""}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`text-3xl font-bold leading-none ${qualityColor}`}>{qualityPct}%</p>
                          <p className="mt-1 text-[10px] text-slate-500">مؤشر الجودة</p>
                        </div>
                      </div>

                      {/* Camera / person warnings */}
                      {(hasNoPerson || hasCameraWarning || ppeNotice) ? (
                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-[11px] text-amber-300 space-y-1">
                          {hasNoPerson && <p>⚠ لم يُرصد أشخاص في المنطقة — يرجى توجيه الكاميرا نحو منطقة عمل المطبخ.</p>}
                          {hasCameraWarning && <p>⚠ زاوية الكاميرا غير واضحة — أعد توجيهها نحو منطقة العمل.</p>}
                          {ppeNotice && !hasNoPerson && <p>⚠ {ppeNotice}</p>}
                        </div>
                      ) : null}

                      {/* Violations or clean */}
                      {displayViolations.length > 0 ? (
                        <div className="space-y-2">
                          {displayViolations.map((v, idx) => (
                            <article
                              key={`vc-${idx}`}
                              className={`rounded-xl border p-3 text-start ${sevCardClass(v.severity || "medium")}`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-white">{v.label_ar}</p>
                                  <p className="mt-1 text-[11px] leading-snug text-slate-300">{v.reason_ar}</p>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1.5">
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sevBadgeClass(v.severity || "medium")}`}>
                                    {sevLabel(v.severity || "medium")}
                                  </span>
                                  <span className="text-[10px] text-slate-400">ثقة: {v.confidence}%</span>
                                </div>
                              </div>
                              {v.suggested_action ? (
                                <p className="mt-2 text-[10px] text-slate-400">
                                  <span className="font-medium text-slate-300">الإجراء المقترح: </span>
                                  {v.suggested_action}
                                </p>
                              ) : null}
                              <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-500">
                                {v.category ? <span>{catLabel(v.category)}</span> : null}
                                {v.person_index != null ? <span>العامل رقم: {v.person_index}</span> : null}
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : !hasNoPerson && !hasCameraWarning ? (
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-center">
                          <p className="text-sm font-semibold text-emerald-300">🟢 لا توجد مخالفات</p>
                          <p className="mt-1 text-[10px] text-emerald-600">
                            {res.frame_report?.summary_ar ||
                              "لم يُرصد أي مخالفة — المطبخ مطابق لمعايير السلامة الغذائية."}
                          </p>
                        </div>
                      ) : null}

                      {/* Low-confidence fallback notice */}
                      {res.overall_confidence != null && res.overall_confidence < 40 && displayViolations.length === 0 && !hasNoPerson ? (
                        <p className="text-[10px] text-slate-500">
                          لم يتم رصد مخالفة مؤكدة، يرجى توجيه الكاميرا لمنطقة العمل بوضوح.
                        </p>
                      ) : null}

                      {/* Footer: timestamp */}
                      <div className="flex items-center justify-between text-[10px] text-slate-600">
                        <span>{res.provider === "yolo" ? "YOLO PPE" : res.provider === "gemini" ? "Gemini Vision" : res.provider}</span>
                        {(res.frame_report?.analyzed_at || monitoringLastAnalyzedAt) ? (
                          <span dir="ltr">{formatSaudiDateTime(res.frame_report?.analyzed_at || monitoringLastAnalyzedAt)}</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })() : null}

                {cameraAnalyzeMode === "video" ? (
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-white">نتائج تحليل الفيديو</span>
                      <span className="text-xs text-slate-400">تنبيهات محفوظة: {monitoringVideoAlertsCreated}</span>
                    </div>
                    <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <article className="rounded-xl border border-white/10 bg-[#060d1f]/70 p-3">
                        <p className="text-[11px] text-slate-400">إجمالي اللقطات</p>
                        <p className="mt-1 text-lg font-bold text-white">{monitoringSummary.totalFrames}</p>
                      </article>
                      <article className="rounded-xl border border-white/10 bg-[#060d1f]/70 p-3">
                        <p className="text-[11px] text-slate-400">إجمالي المخالفات</p>
                        <p className="mt-1 text-lg font-bold text-white">{monitoringSummary.totalViolations}</p>
                      </article>
                      <article className="rounded-xl border border-white/10 bg-[#060d1f]/70 p-3">
                        <p className="text-[11px] text-slate-400">الأكثر تكرارًا</p>
                        <p className="mt-1 text-sm font-semibold text-slate-100">{monitoringSummary.mostCommon}</p>
                      </article>
                      <article className="rounded-xl border border-white/10 bg-[#060d1f]/70 p-3">
                        <p className="text-[11px] text-slate-400">مستوى الخطر العام</p>
                        <p
                          className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            MONITORING_RISK_META[monitoringSummary.overallRisk]?.chip || MONITORING_RISK_META.low.chip
                          }`}
                        >
                          {MONITORING_RISK_META[monitoringSummary.overallRisk]?.label || MONITORING_RISK_META.low.label}
                        </p>
                      </article>
                    </div>

                    <div className="mb-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setMonitoringFrameFilter("all")}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          monitoringFrameFilter === "all"
                            ? "border-brand-sky/45 bg-brand/20 text-sky-100"
                            : "border-white/15 bg-[#0B1327]/60 text-slate-300"
                        }`}
                      >
                        كل اللقطات
                      </button>
                      <button
                        type="button"
                        onClick={() => setMonitoringFrameFilter("violations")}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          monitoringFrameFilter === "violations"
                            ? "border-orange-500/45 bg-orange-500/15 text-orange-100"
                            : "border-white/15 bg-[#0B1327]/60 text-slate-300"
                        }`}
                      >
                        لقطات فيها مخالفات
                      </button>
                      <button
                        type="button"
                        onClick={() => setMonitoringFrameFilter("high")}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          monitoringFrameFilter === "high"
                            ? "border-red-500/45 bg-red-500/15 text-red-100"
                            : "border-white/15 bg-[#0B1327]/60 text-slate-300"
                        }`}
                      >
                        عالية الخطورة
                      </button>
                    </div>

                    {monitoringVideoFrameResults.length > 0 ? (
                      <div className="mb-4">
                        <p className="mb-2 text-xs font-semibold text-slate-300">نتيجة كل لقطة</p>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {filteredMonitoringFrameGroups.map((frame) => {
                            const riskMeta = MONITORING_RISK_META[frame.riskLevel] || MONITORING_RISK_META.low;
                            return (
                              <article
                                key={frame.id}
                                className={`rounded-xl border p-3 text-xs ${
                                  frame.violations.length > 0
                                    ? "border-white/10 bg-[#0B1327]/75 text-slate-200"
                                    : "border-white/10 bg-[#0B1327]/45 text-slate-300 opacity-80"
                                }`}
                              >
                                {frame.frameUrl ? (
                                  <img
                                    src={frame.frameUrl}
                                    alt=""
                                    className={`mb-2 w-full rounded-lg object-cover ${
                                      frame.violations.length > 0 ? "h-24" : "h-16"
                                    }`}
                                  />
                                ) : null}
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <p className="text-slate-400">
                                    الوقت:{" "}
                                    <span className="text-slate-100">
                                      {formatVideoDuration(frame.timeStart)}
                                      {frame.count > 1 ? ` - ${formatVideoDuration(frame.timeEnd)}` : ""}
                                    </span>
                                  </p>
                                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${riskMeta.chip}`}>
                                    {riskMeta.label}
                                  </span>
                                </div>
                                {frame.errorText ? (
                                  <p className="mt-1 text-red-200">{frame.errorText}</p>
                                ) : frame.violations.length === 0 ? (
                                  <p className="mt-1 text-emerald-200">🟢 لا توجد مخالفات</p>
                                ) : (
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {frame.violations.map((typeKey) => {
                                      const chip = monitoringViolationChipMeta(typeKey);
                                      return (
                                        <span key={`${frame.id}-${typeKey}`} className={`rounded-full border px-2 py-1 text-[11px] ${chip.cls}`}>
                                          {chip.label}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                                {frame.count > 1 ? (
                                  <p className="mt-2 text-[11px] text-slate-500">حالة متكررة في {frame.count} لقطات متتالية</p>
                                ) : null}
                              </article>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {monitoringVideoResults.length === 0 ? (
                      videoAllFramesFailed ? (
                        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-5 text-center text-sm text-red-200">
                          تعذر تحليل الفيديو. تحقق من إعدادات الذكاء الاصطناعي.
                        </div>
                      ) : monitoringVideoFrameResults.length > 0 ? (
                        <div className="rounded-xl border border-dashed border-white/15 bg-[#0B1327]/50 px-3 py-5 text-center text-sm text-slate-400">
                          تم تحليل اللقطات — لا توجد مخالفات مكتشفة.
                        </div>
                      ) : null
                    ) : null}
                  </div>
                ) : null}

                {cameraCardsLoading ? (
                  <div className="space-y-3" aria-busy="true">
                    <SkeletonPulse className="h-24 w-full" />
                    <SkeletonPulse className="h-24 w-full" />
                  </div>
                ) : cameraCardsError ? (
                  <p className="rounded-xl border border-accent-red/35 bg-accent-red/10 px-3 py-4 text-sm text-red-200">{cameraCardsError}</p>
                ) : cameraCards.length === 0 ? (
                  <EmptyState
                    icon="📹"
                    title="لم يتم ربط أي كاميرا بعد"
                    hint="سجِّل الكاميرات من الخادم أو اضبط مناطق المراقبة أعلاه."
                  />
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-400">حالة الكاميرات</p>
                    {cameraCards.some((c) => c?.is_connected && String(c?.stream_url || c?.streamUrl || "").trim()) ? null : (
                      <div className="rounded-xl border border-dashed border-white/15 bg-[#0B1327]/50 px-3 py-4 text-center text-sm text-slate-400">
                        لا يوجد بث مباشر متصل حاليًا
                      </div>
                    )}
                    <ExpandMoreList initialVisible={3} listClassName="space-y-2">
                      {cameraCards.map((c) => (
                        <article
                          key={c.id}
                          className="rounded-xl border border-white/10 bg-gradient-to-br from-[#0B1327]/90 to-[#060d1f]/80 p-4 text-xs text-slate-200 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] transition hover:border-sky-500/25"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-white/5 pb-2">
                            <p className="text-sm font-semibold text-white">{c.name}</p>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                c.is_connected ? "bg-emerald-500/15 text-emerald-200" : "bg-slate-600/30 text-slate-400"
                              }`}
                            >
                              {c.is_connected ? "🟢 متصل" : "🔴 غير متصل"}
                            </span>
                          </div>
                          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                            <p>
                              <span className="text-slate-500">الموقع:</span> {c.location}
                            </p>
                            <p>
                              <span className="text-slate-500">الذكاء الاصطناعي:</span>{" "}
                              {c.ai_enabled ? "مفعّل" : "غير مفعّل"}
                            </p>
                            <p className="sm:col-span-2">
                              <span className="text-slate-500">آخر تحليل:</span>{" "}
                              {c.last_analysis_at ? formatSaudiDateTime(c.last_analysis_at) : "لا يوجد"}
                            </p>
                          </div>
                        </article>
                      ))}
                    </ExpandMoreList>
                  </div>
                )}
              </div>
            </section>

            <section className={`${glassCard} mb-8 p-5`}>
              <div className="mb-4 border-b border-white/10 pb-3">
                <h3 className="text-lg font-bold text-white">نظرة عامة على الأداء</h3>
                <p className="mt-1 text-xs text-slate-400">أرقام تشغيلية من خادم النظام.</p>
              </div>
              {supervisorSummaryLoading ? (
                <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
                  {[1, 2, 3, 4].map((i) => (
                    <SkeletonPulse key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : supervisorSummary ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-[#020617]/60 p-4">
                    <p className="text-xs text-slate-500">إجمالي الأطباق</p>
                    <p className="mt-1 text-xl font-bold text-white">{supervisorSummary.total_dishes}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#020617]/60 p-4">
                    <p className="text-xs text-slate-500">عدد الأطباق هذا الأسبوع</p>
                    <p className="mt-1 text-xl font-bold text-white">{supervisorSummary.dishes_week}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#020617]/60 p-4">
                    <p className="text-xs text-slate-500">إجمالي الكمية</p>
                    <p className="mt-1 text-xl font-bold text-white">{supervisorSummary.total_quantity}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#020617]/60 p-4">
                    <p className="text-xs text-slate-500">عدد الأطباق التي تحتاج مراجعة</p>
                    <p className="mt-1 text-xl font-bold text-amber-200">{supervisorSummary.pending_reviews}</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-[#020617]/60 px-4 py-10 text-center text-sm text-slate-400">
                  لا توجد بيانات كافية
                </div>
              )}
            </section>

            <section
              id="reports"
              ref={supervisorReportsRef}
              className={`${SECTION_THEME.reports} mb-8 scroll-mt-28 sm:scroll-mt-32`}
            >
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <h3 className="text-lg font-bold text-white">التقارير</h3>
                  <p className="mt-1 text-xs text-slate-400">مؤشرات ملخّصة من الخادم؛ تصدير CSV للملفات والتحليل الخارجي.</p>
                </div>
                <button
                  type="button"
                  disabled={!supervisorSummary}
                  onClick={() => exportSupervisorReportCsv()}
                  className="rounded-xl border border-brand-sky/40 bg-brand/15 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-brand/25 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  تصدير CSV
                </button>
              </div>
              {supervisorSummaryLoading ? (
                <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
                  {[1, 2, 3, 4].map((i) => (
                    <SkeletonPulse key={i} className="h-[4.5rem] w-full" />
                  ))}
                </div>
              ) : supervisorSummary ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-white/10 bg-[#0B1327]/70 p-3">
                        <p className="text-xs text-slate-500">أكثر موظف لديه مراجعات</p>
                        <p className="mt-1 text-sm font-semibold text-white">
                          {supervisorSummary.top_employee_review_name || "لا توجد بيانات كافية"}
                          {supervisorSummary.top_employee_review_count
                            ? ` (${supervisorSummary.top_employee_review_count})`
                            : ""}
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-[#0B1327]/70 p-3">
                        <p className="text-xs text-slate-500">أكثر طبق تم تسجيله</p>
                        <p className="mt-1 text-sm font-semibold text-white">
                          {supervisorSummary.most_common_dish || "لا توجد بيانات كافية"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-[#0B1327]/70 p-3">
                        <p className="text-xs text-slate-500">أكثر طبق يحتاج مراجعة</p>
                        <p className="mt-1 text-sm font-semibold text-white">
                          {supervisorSummary.most_reviewed_dish || "لا توجد بيانات كافية"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-[#0B1327]/70 p-3">
                        <p className="text-xs text-slate-500">متوسط الثقة</p>
                        <p className="mt-1 text-sm font-semibold text-white">
                          {supervisorSummary.average_confidence != null
                            ? `${supervisorSummary.average_confidence}%`
                            : "لا توجد بيانات كافية"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-white/10 bg-[#0B1327]/50 px-4 py-10 text-center text-sm text-slate-400">
                      لا توجد بيانات كافية للتقارير. تأكد من اتصال الخادم أو من صلاحيات المشرف.
                    </div>
                  )}
              {(role === "supervisor" || role === "admin") ? (
                <div className="mt-8 border-t border-white/10 pt-6">
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h4 className="text-base font-bold text-white">تقرير مخالفات المراقبة</h4>
                      <p className="mt-1 text-xs text-slate-400">
                        بيانات من تنبيهات المراقبة المحفوظة في النظام (حتى 500 سجلًا لكل استعلام).
                        {role === "supervisor" ? (
                          <span className="mt-1 block text-[11px] text-slate-500">
                            يعرض المشرف بيانات فرعه المرتبطة بحسابه فقط.
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setViolationsReportFrom("");
                          setViolationsReportTo("");
                          void fetchViolationsReport("", "");
                        }}
                        className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/25 hover:text-white"
                      >
                        إظهار الكل
                      </button>
                      <button
                        type="button"
                        onClick={() => void fetchViolationsReport(violationsReportFrom, violationsReportTo)}
                        className="rounded-xl border border-brand-sky/40 bg-brand/15 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-brand/25"
                      >
                        تطبيق الفلتر
                      </button>
                      <button
                        type="button"
                        disabled={violationsReportLoading || violationsReportStats.total === 0}
                        onClick={() => exportViolationsReportLatestCsv()}
                        className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-brand-sky/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        تصدير CSV
                      </button>
                      <button
                        type="button"
                        disabled={violationsReportLoading || violationsReportStats.total === 0}
                        onClick={() => printViolationsReportPdf()}
                        title="طباعة أو حفظ PDF عبر نافذة المتصفح (اختر «حفظ كملف PDF»)"
                        className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-brand-sky/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        تصدير PDF
                      </button>
                    </div>
                  </div>
                  <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                      <span className="text-xs text-slate-400">من تاريخ</span>
                      <input
                        type="date"
                        value={violationsReportFrom}
                        onChange={(e) => setViolationsReportFrom(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                      />
                    </label>
                    <label className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                      <span className="text-xs text-slate-400">إلى تاريخ</span>
                      <input
                        type="date"
                        value={violationsReportTo}
                        onChange={(e) => setViolationsReportTo(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                      />
                    </label>
                    <div className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3 sm:col-span-2">
                      <p className="text-xs text-slate-400">النطاق الزمني</p>
                      <p className="mt-2 text-xs leading-relaxed text-slate-500">
                        يعتمد تقويم الرياض. اترك الحقلين فارغَين ثم اضغط «تطبيق الفلتر» لعرض أحدث السجلات دون
                        تقييد بالتاريخ.
                      </p>
                    </div>
                  </div>

                  <div className="mb-6 rounded-2xl border border-white/10 bg-[#050c1c]/90 p-4">
                    <h4 className="mb-1 text-sm font-bold text-white">الرسوم التحليلية</h4>
                    <p className="mb-4 text-[11px] text-slate-500">
                      تُستخرَج من بيانات الخادم والفلاتر أعلاه؛ لا توجد بيانات وهمية.
                    </p>
                    <ReportsAnalyticsCharts
                      violationsRows={violationsReportRows}
                      reviewRecords={reviewRecords}
                      dateFrom={violationsReportFrom}
                      dateTo={violationsReportTo}
                    />
                  </div>

                  {violationsReportError ? (
                    <div className="mb-4 rounded-xl border border-accent-red/35 bg-accent-red/10 px-3 py-3 text-sm text-red-200">
                      {violationsReportError}
                    </div>
                  ) : null}
                  {violationsReportLoading ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
                      {[1, 2, 3, 4, 5, 6].map((i) => (
                        <SkeletonPulse key={i} className="h-24 w-full" />
                      ))}
                    </div>
                  ) : violationsReportStats.total === 0 ? (
                    <EmptyState
                      icon="📊"
                      title="لا توجد بيانات تقارير للفترة الحالية"
                      hint="جرّب توسيع نطاق التاريخ أو إظهار الكل من أزرار التصفية أعلاه."
                    />
                  ) : (
                    <>
                      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-xl border border-white/10 bg-[#020617]/70 p-4">
                          <p className="text-xs text-slate-500">إجمالي المخالفات</p>
                          <p className="mt-1 text-2xl font-bold tabular-nums text-white">{violationsReportStats.total}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-[#020617]/70 p-4">
                          <p className="text-xs text-slate-500">مفتوح</p>
                          <p className="mt-1 text-2xl font-bold tabular-nums text-red-200">
                            {violationsReportStats.openCount}
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-[#020617]/70 p-4">
                          <p className="text-xs text-slate-500">تمت المعالجة</p>
                          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-200">
                            {violationsReportStats.resolvedCount}
                          </p>
                        </div>
                        <div className="rounded-xl border border-brand-sky/25 bg-brand/10 p-4">
                          <p className="text-xs text-slate-500">أكثر مخالفة تكرارًا</p>
                          {violationsReportStats.topRepeated.count > 0 ? (
                            <>
                              <p className="mt-1 text-sm font-semibold text-white">
                                {violationsReportStats.topRepeated.label}
                              </p>
                              <p className="mt-1 text-xs text-slate-400">
                                {violationsReportStats.topRepeated.count} مرة
                              </p>
                            </>
                          ) : (
                            <p className="mt-1 text-sm text-slate-500">لا توجد بيانات</p>
                          )}
                        </div>
                      </div>
                      <div className="mb-6 grid gap-4 lg:grid-cols-2">
                        <div className="rounded-xl border border-white/10 bg-[#060d1f]/60 p-4">
                          <p className="mb-3 text-sm font-semibold text-white">المخالفات حسب النوع</p>
                          <ul className="space-y-2 text-sm">
                            {VIOLATION_REPORT_CATEGORY_ORDER.map((c) => (
                              <li key={c.key} className="flex items-center justify-between gap-2 text-slate-300">
                                <span>{c.label}</span>
                                <span className="tabular-nums font-semibold text-slate-100">
                                  {violationsReportStats.typeCounts[c.key]}
                                </span>
                              </li>
                            ))}
                            {violationsReportStats.typeCounts._other > 0 ? (
                              <li className="flex items-center justify-between gap-2 border-t border-white/10 pt-2 text-slate-400">
                                <span>أخرى</span>
                                <span className="tabular-nums font-semibold text-slate-200">
                                  {violationsReportStats.typeCounts._other}
                                </span>
                              </li>
                            ) : null}
                          </ul>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-[#060d1f]/60 p-4">
                          <p className="mb-3 text-sm font-semibold text-white">حسب الحالة</p>
                          <ul className="space-y-3 text-sm">
                            <li className="flex items-center justify-between gap-2">
                              <span className="text-slate-400">مفتوح</span>
                              <span className="tabular-nums font-bold text-red-200">
                                {violationsReportStats.openCount}
                              </span>
                            </li>
                            <li>
                              <div className="h-2 overflow-hidden rounded-full bg-[#020617]">
                                <div
                                  className="h-full rounded-full bg-red-500/70 transition-all"
                                  style={{
                                    width: `${violationsReportStats.total ? Math.round((violationsReportStats.openCount / violationsReportStats.total) * 100) : 0}%`,
                                  }}
                                />
                              </div>
                            </li>
                            <li className="flex items-center justify-between gap-2">
                              <span className="text-slate-400">تمت المعالجة</span>
                              <span className="tabular-nums font-bold text-emerald-200">
                                {violationsReportStats.resolvedCount}
                              </span>
                            </li>
                            <li>
                              <div className="h-2 overflow-hidden rounded-full bg-[#020617]">
                                <div
                                  className="h-full rounded-full bg-emerald-500/70 transition-all"
                                  style={{
                                    width: `${violationsReportStats.total ? Math.round((violationsReportStats.resolvedCount / violationsReportStats.total) * 100) : 0}%`,
                                  }}
                                />
                              </div>
                            </li>
                          </ul>
                        </div>
                      </div>
                      <div>
                        <p className="mb-3 text-sm font-semibold text-white">أحدث المخالفات</p>
                        <div className="overflow-x-auto rounded-xl border border-white/10">
                          <table className="min-w-full text-start text-xs sm:text-sm">
                            <thead className="border-b border-white/10 bg-[#0B1327]/80 text-slate-400">
                              <tr>
                                <th className="px-3 py-2">النوع</th>
                                <th className="px-3 py-2">التفاصيل</th>
                                <th className="px-3 py-2">الحالة</th>
                                <th className="px-3 py-2">الفرع</th>
                                <th className="px-3 py-2">الكاميرا</th>
                                <th className="px-3 py-2">الوقت</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 text-slate-200">
                              {violationsReportStats.latest.slice(0, violationsLatestExpand.limit).map((row) => (
                                <tr key={row.id} className="bg-[#060d1f]/40">
                                  <td className="px-3 py-2 font-medium text-white">
                                    {row.label_ar?.trim() || getViolationLabel(row.type)}
                                  </td>
                                  <td className="max-w-[14rem] truncate px-3 py-2 text-slate-400" title={row.details}>
                                    {row.details || "—"}
                                  </td>
                                  <td className="px-3 py-2">{monitoringAlertStatusAr(row.status)}</td>
                                  <td className="px-3 py-2">{row.branch || "—"}</td>
                                  <td className="px-3 py-2">{row.camera_name || "—"}</td>
                                  <td className="whitespace-nowrap px-3 py-2">{formatSaudiDateTime(row.created_at)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {violationsLatestExpand.hasMore ? (
                            <div className="flex justify-center border-t border-white/10 bg-[#060d1f]/30 py-3">
                              <button
                                type="button"
                                onClick={() => violationsLatestExpand.toggle()}
                                className="rounded-xl border border-white/15 bg-[#0B1327]/85 px-5 py-2 text-xs font-semibold text-slate-200 transition hover:border-brand-sky/35 hover:text-white"
                              >
                                {violationsLatestExpand.expanded ? "عرض أقل ↑" : "عرض المزيد ↓"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </section>

            <section
              id="dish-reviews"
              ref={supervisorReviewsRef}
              className={`${SECTION_THEME.neutral} mb-8 scroll-mt-28 sm:scroll-mt-32`}
            >
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-white">مراجعة الأطباق</h3>
                  <p className="text-sm text-slate-400">اعتماد أو رفض سجلات الأطباق مع تتبع سجل المراجعة.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!reviewRecords.length}
                    onClick={() => exportReviewRecordsCsv()}
                    className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-brand-sky/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    تصدير CSV ({reviewRecords.length})
                  </button>
                  <button
                    type="button"
                    disabled={!reviewRecords.length}
                    onClick={() => printDishReviewReportPdf()}
                    title="طباعة أو حفظ PDF عبر نافذة المتصفح (اختر «حفظ كملف PDF»)"
                    className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-brand-sky/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    تصدير PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadSupervisorReviews()}
                    className="rounded-xl border border-brand-sky/35 bg-brand/15 px-3 py-2 text-xs font-semibold text-brand-sky transition hover:bg-brand/25"
                  >
                    تحديث
                  </button>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                {[
                  { value: "needs_review", label: "يحتاج مراجعة" },
                  { value: "approved", label: "تم الاعتماد" },
                  { value: "rejected", label: "مرفوض" },
                  { value: "all", label: "الكل" },
                ].map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setReviewFilters((f) => ({ ...f, status: t.value }))}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      reviewFilters.status === t.value
                        ? "border-brand-sky/60 bg-brand/30 text-sky-100"
                        : "border-white/15 bg-[#0B1327]/70 text-slate-300"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                  <p className="text-xs text-slate-500">عدد الأطباق التي تحتاج مراجعة</p>
                    <p className="mt-1 text-xl font-bold text-amber-200">{supervisorSummary?.pending_reviews ?? "لا توجد بيانات كافية"}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                  <p className="text-xs text-slate-500">عدد المقبولة اليوم</p>
                    <p className="mt-1 text-xl font-bold text-emerald-200">{supervisorSummary?.approved_today ?? "لا توجد بيانات كافية"}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                  <p className="text-xs text-slate-500">عدد المرفوضة اليوم</p>
                    <p className="mt-1 text-xl font-bold text-red-200">{supervisorSummary?.rejected_today ?? "لا توجد بيانات كافية"}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                    <p className="text-xs text-slate-500">إجمالي الموظفين</p>
                    <p className="mt-1 text-xl font-bold text-brand-sky">{supervisorSummary?.total_employees ?? "لا توجد بيانات كافية"}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                    <p className="text-xs text-slate-500">الموظفين النشطين اليوم</p>
                    <p className="mt-1 text-xl font-bold text-slate-100">{supervisorSummary?.active_employees_today ?? "لا توجد بيانات كافية"}</p>
                </div>
              </div>

              <div className="mb-5 grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-[#060d1f]/70 p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                <input
                  type="search"
                  placeholder="فلتر الموظف"
                  value={reviewFilters.employee}
                  onChange={(e) => setReviewFilters((f) => ({ ...f, employee: e.target.value }))}
                  className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                />
                <input
                  type="search"
                  placeholder="نوع الطبق"
                  value={reviewFilters.dishType}
                  onChange={(e) => setReviewFilters((f) => ({ ...f, dishType: e.target.value }))}
                  className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                />
                <input
                  type="date"
                  value={reviewFilters.dateFrom}
                  onChange={(e) => setReviewFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                  className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                />
                <input
                  type="date"
                  value={reviewFilters.dateTo}
                  onChange={(e) => setReviewFilters((f) => ({ ...f, dateTo: e.target.value }))}
                  className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="الثقة من"
                  value={reviewFilters.confidenceMin}
                  onChange={(e) => setReviewFilters((f) => ({ ...f, confidenceMin: e.target.value }))}
                  className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="الثقة إلى"
                  value={reviewFilters.confidenceMax}
                  onChange={(e) => setReviewFilters((f) => ({ ...f, confidenceMax: e.target.value }))}
                  className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                />
                <select
                  value={reviewFilters.status}
                  onChange={(e) => setReviewFilters((f) => ({ ...f, status: e.target.value }))}
                  className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                >
                  <option value="needs_review">يحتاج مراجعة</option>
                  <option value="approved">مقبول</option>
                  <option value="rejected">مرفوض</option>
                  <option value="all">الكل</option>
                </select>
              </div>

              {reviewLoading ? (
                <div className="space-y-3" aria-busy="true">
                  {[1, 2, 3].map((i) => (
                    <SkeletonPulse key={i} className="h-40 w-full" />
                  ))}
                </div>
              ) : reviewRecords.length === 0 ? (
                <EmptyState
                  icon="🍽️"
                  title={
                    reviewFiltersAreActive
                      ? "لا توجد سجلات تطابق الفلاتر الحالية"
                      : "لا توجد سجلات مراجعة في العرض الحالي"
                  }
                  hint={
                    reviewFiltersAreActive
                      ? "جرّب توسيع نطاق البحث أو تغيير حالة المراجعة."
                      : "عادة ما تظهر هنا الأطباق التي تحتاج مراجعة فور تسجيلها من الموظفين."
                  }
                />
              ) : (
                <div className="space-y-4">
                  <p className="text-center text-[11px] tabular-nums text-slate-500">
                    إجمالي {reviewRecords.length} سجلًا
                  </p>
                  <ExpandMoreList initialVisible={3} listClassName="space-y-4">
                  {reviewRecords.map((r) => {
                    const conf = Number(r.ai_confidence);
                    const confText = displayAiConfidence(conf);
                    const badge =
                      r.status === "approved"
                        ? "border-accent-green/45 bg-accent-green/15 text-emerald-200"
                        : r.status === "rejected"
                          ? "border-accent-red/45 bg-accent-red/15 text-red-100"
                          : "border-accent-amber/45 bg-accent-amber/15 text-amber-100";
                    const statusLabel =
                      r.status === "approved" ? "تم الاعتماد" : r.status === "rejected" ? "مرفوض" : "يحتاج مراجعة";
                    const suggestions = Array.isArray(r.ai_suggestions) ? r.ai_suggestions.slice(0, 3) : [];
                    return (
                      <article key={r.id} className="rounded-2xl border border-white/10 bg-[#060d1f]/85 p-4 shadow-glass sm:p-5">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
                          <FoodImageThumb src={apiUrl(r.image_url)} alt={r.confirmed_label || r.predicted_label || "dish"} sizeClass="h-32 w-32 shrink-0 rounded-xl sm:h-36 sm:w-36" />
                          <div className="min-w-0 flex-1 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${badge}`}>
                                {statusLabel}
                              </span>
                            </div>
                            <p className="text-sm text-slate-400">
                              اقتراح الذكاء الاصطناعي: <span className="font-semibold text-brand-sky">{r.predicted_label || "—"}</span>
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {suggestions.length ? (
                                suggestions.map((s, idx) => (
                                  <span key={`${r.id}-${idx}`} className="rounded-lg border border-white/10 bg-[#0B1327]/80 px-2 py-1 text-xs text-slate-200">
                                    {s?.name || "—"} ({formatConfidencePercentDisplay(s?.confidence)})
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-slate-500">لا توجد اقتراحات إضافية</span>
                              )}
                            </div>
                            <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
                              <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
                              <p>اسم الطبق النهائي: <span className="font-semibold text-white">{r.confirmed_label || "—"}</span></p>
                              <p>الكمية: <span className="font-semibold text-white">{r.quantity}</span></p>
                              <p>المصدر: <span className="font-semibold text-white">{r.source_entity || "—"}</span></p>
                              <p>الثقة: <span className="font-semibold text-white">{confText}</span></p>
                              <p>وقت التسجيل: <span className="font-semibold text-white">{formatSaudiDateTime(r.recorded_at)}</span></p>
                              <p>الحالة/السبب: <span className="font-semibold text-white">{r.rejected_reason || supervisorStatusText(r.status)}</span></p>
                              <p>راجع بواسطة: <span className="font-semibold text-white">{r.reviewed_by_name || "—"}</span></p>
                              <p>وقت المراجعة: <span className="font-semibold text-white">{r.reviewed_at ? formatSaudiDateTime(r.reviewed_at) : "—"}</span></p>
                              </div>
                              <aside className="rounded-xl border border-white/10 bg-[#0B1327]/70 p-3 text-xs text-slate-300">
                                <p className="font-semibold text-slate-200">بيانات الموظف</p>
                                <p className="mt-2">الاسم: <span className="text-white">{r.employee_name || "—"}</span></p>
                                <p className="mt-1" dir="ltr">البريد: <span className="text-white">{r.employee_email || "—"}</span></p>
                              </aside>
                            </div>
                            {r.supervisor_notes ? (
                              <p className="rounded-lg border border-white/10 bg-[#0B1327]/70 px-3 py-2 text-xs text-slate-300">
                                ملاحظات: {r.supervisor_notes}
                              </p>
                            ) : null}
                            <div className="flex flex-wrap gap-2 pt-1">
                              <button
                                type="button"
                                disabled={reviewActionLoadingId === r.id}
                                onClick={() => void approveReviewRecord(r)}
                                className="rounded-xl border border-emerald-500/45 bg-emerald-600/20 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-600/30 disabled:opacity-50"
                              >
                                قبول
                              </button>
                              <button
                                type="button"
                                disabled={reviewActionLoadingId === r.id}
                                onClick={() => {
                                  setRejectTarget(r);
                                  setRejectReason("");
                                  setRejectNotes(r.supervisor_notes || "");
                                }}
                                className="rounded-xl border border-accent-red/45 bg-accent-red/15 px-3 py-2 text-xs font-semibold text-red-100 transition hover:bg-accent-red/25 disabled:opacity-50"
                              >
                                رفض
                              </button>
                              <button
                                type="button"
                                disabled={reviewActionLoadingId === r.id}
                                onClick={() => {
                                  setEditApproveTarget(r);
                                  setEditApproveForm({
                                    dishName: r.confirmed_label || r.predicted_label || "",
                                    quantity: r.quantity || 1,
                                    source: r.source_entity || "",
                                    notes: r.supervisor_notes || "",
                                  });
                                }}
                                className="rounded-xl border border-brand-sky/45 bg-brand/15 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-brand/25 disabled:opacity-50"
                              >
                                تعديل واعتماد
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                  </ExpandMoreList>
                </div>
              )}
            </section>

            <section
              id="employees"
              ref={supervisorEmployeesRef}
              className={`${SECTION_THEME.neutral} mb-8 scroll-mt-28 sm:scroll-mt-32`}
            >
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-white">الموظفين</h3>
                  <p className="text-sm text-slate-400">عرض الموظفين مع إحصائيات السجلات الحقيقية.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadSupervisorEmployees()}
                  className="rounded-xl border border-brand-sky/35 bg-brand/15 px-3 py-2 text-xs font-semibold text-brand-sky transition hover:bg-brand/25"
                >
                  تحديث
                </button>
              </div>
              <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-[#060d1f]/70 p-3 sm:grid-cols-2 lg:grid-cols-4">
                <input
                  type="search"
                  placeholder="بحث بالاسم/البريد"
                  value={employeeFilters.search}
                  onChange={(e) => setEmployeeFilters((f) => ({ ...f, search: e.target.value }))}
                  className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                />
                <select
                  value={employeeFilters.role}
                  onChange={(e) => setEmployeeFilters((f) => ({ ...f, role: e.target.value }))}
                  className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                >
                  <option value="">كل الأدوار</option>
                  <option value="staff">staff</option>
                  <option value="supervisor">supervisor</option>
                  <option value="admin">admin</option>
                </select>
                <label className="flex items-center gap-2 rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={employeeFilters.activeToday}
                    onChange={(e) => setEmployeeFilters((f) => ({ ...f, activeToday: e.target.checked }))}
                  />
                  نشط اليوم
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={employeeFilters.hasPendingReviews}
                    onChange={(e) => setEmployeeFilters((f) => ({ ...f, hasPendingReviews: e.target.checked }))}
                  />
                  لديه مراجعات معلّقة
                </label>
              </div>
              {supervisorEmployeesLoading ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <SkeletonPulse key={i} className="h-36 w-full" />
                  ))}
                </div>
              ) : supervisorEmployees.length === 0 ? (
                <EmptyState
                  icon="👥"
                  title={
                    employeeFiltersAreActive
                      ? "لا يوجد موظفون يطابقون الفلاتر"
                      : "لا توجد بيانات موظفين بعد"
                  }
                  hint={
                    employeeFiltersAreActive
                      ? "عدّل معايير البحث أو أزل الفلاتر النشطة."
                      : "سيُعبَأ هذا القسم تلقائيًا عند توفر موظفين مسجلين من الخادم."
                  }
                />
              ) : (
                <ExpandMoreList
                  initialVisible={3}
                  listClassName="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {supervisorEmployees.map((e) => (
                    <article key={e.id} className="rounded-2xl border border-white/10 bg-[linear-gradient(145deg,#071224,#0b1731)] p-4 shadow-[0_10px_22px_-18px_rgba(59,130,246,0.8)] transition hover:border-white/18">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <p className="font-semibold text-white">
                        {e.full_name || e.username}
                        <span className="ms-2 text-xs font-normal text-slate-400">
                          ({e.branch_name?.trim() ? e.branch_name : "—"})
                        </span>
                        </p>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${e.status === "نشط" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-white/15 bg-white/5 text-slate-400"}`}>
                          {e.status || "غير معروف"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400" dir="ltr">{e.email}</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
                        <p>الدور: <span className="text-white">{roleAr(e.role)}</span></p>
                        <p>سجلات اليوم: <span className="text-white">{e.dishes_today ?? "لا توجد بيانات كافية"}</span></p>
                        <p>إجمالي السجلات: <span className="text-white">{e.total_dishes ?? "لا توجد بيانات كافية"}</span></p>
                        <p>مراجعات معلّقة: <span className="text-white">{e.pending_reviews ?? "لا توجد بيانات كافية"}</span></p>
                        <p className="col-span-2">آخر نشاط: <span className="text-white">{e.last_activity ? formatSaudiDateTime(e.last_activity) : "لا توجد بيانات كافية"}</span></p>
                        <button
                          type="button"
                          onClick={() => {
                            setReviewFilters((f) => ({ ...f, employee: e.email || e.username }));
                            document.getElementById("dish-reviews")?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                          className="col-span-2 mt-2 rounded-lg border border-brand-sky/40 bg-brand/15 px-2 py-1 text-xs font-semibold text-sky-100"
                        >
                          عرض سجلات الموظف
                        </button>
                      </div>
                    </article>
                  ))}
                </ExpandMoreList>
              )}
            </section>

            {role === "admin" ? (
            <section
              id="settings"
              ref={supervisorSettingsRef}
              className={`${glassCard} mt-6 scroll-mt-28 sm:scroll-mt-32`}
            >
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <h3 className="text-lg font-bold text-white">إعدادات النظام</h3>
                  <p className="text-xs text-slate-400">هذه الإعدادات محلية على المتصفح الحالي فقط (localStorage).</p>
                </div>
                {role === "admin" ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={resetAdminSettings}
                      className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:text-white"
                    >
                      إعادة الافتراضي
                    </button>
                    <button
                      type="button"
                      onClick={saveAdminSettings}
                      disabled={adminSettingsSaving}
                      className="rounded-xl border border-brand-sky/40 bg-brand/20 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-brand/30 disabled:opacity-60"
                    >
                      {adminSettingsSaving ? "جارٍ الحفظ..." : "حفظ الإعدادات"}
                    </button>
                  </div>
                ) : null}
              </div>

              {role !== "admin" ? (
                <div className="rounded-xl border border-dashed border-white/15 bg-[#0B1327]/60 px-4 py-6 text-sm text-slate-300">
                  هذه الإعدادات متاحة لمدير النظام فقط
                </div>
              ) : (
                <div className="space-y-5">
                  <article className="rounded-2xl border border-white/10 bg-[#0B1327]/70 p-4">
                    <h4 className="text-sm font-semibold text-white">
                      أ — إعدادات الذكاء الاصطناعي
                    </h4>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                        <span className="text-xs text-slate-400">الحد الأدنى للثقة</span>
                        <div className="mt-2 flex items-center gap-3">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={adminSettings.ai.minConfidence}
                            onChange={(e) =>
                              setAdminSettings((prev) => ({
                                ...prev,
                                ai: { ...prev.ai, minConfidence: Number(e.target.value) || 0 },
                              }))
                            }
                            className="w-full accent-sky-400"
                          />
                          <span className="min-w-10 text-sm font-semibold text-sky-100">
                            {adminSettings.ai.minConfidence}%
                          </span>
                        </div>
                      </label>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {[
                        ["mask", "الكمامة"],
                        ["gloves", "القفازات"],
                        ["headCover", "غطاء الرأس"],
                        ["wetFloor", "الأرضيات المبللة"],
                        ["containers", "الحاويات"],
                      ].map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center justify-between rounded-xl border border-white/10 bg-[#060d1f]/80 px-3 py-2 text-sm text-slate-200"
                        >
                          <span>{label}</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={Boolean(adminSettings.ai.violations[key])}
                            onClick={() =>
                              setAdminSettings((prev) => ({
                                ...prev,
                                ai: {
                                  ...prev.ai,
                                  violations: {
                                    ...prev.ai.violations,
                                    [key]: !prev.ai.violations[key],
                                  },
                                },
                              }))
                            }
                            className={`relative h-6 w-11 rounded-full transition ${
                              adminSettings.ai.violations[key] ? "bg-sky-500/70" : "bg-slate-700"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                                adminSettings.ai.violations[key] ? "right-0.5" : "right-[1.35rem]"
                              }`}
                            />
                          </button>
                        </label>
                      ))}
                    </div>
                  </article>

                  <article className="rounded-2xl border border-white/10 bg-[#0B1327]/70 p-4">
                    <h4 className="text-sm font-semibold text-white">ب — إعدادات الكاميرات</h4>
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">
                      تهيئة كاميرات IP و RTSP والمعاينة تتم من قسم «الكاميرات». كلمات المرور لا تُعرض بعد الحفظ، وتُخزَّن
                      مؤقتاً على المتصفح إلى أن يُفعَّل التخزين في الخادم.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        navigate(ROUTES.cameras);
                      }}
                      className="mt-3 rounded-xl border border-brand-sky/35 bg-brand/15 px-4 py-2 text-xs font-semibold text-sky-100 transition hover:bg-brand/25"
                    >
                      فتح إعدادات الكاميرات
                    </button>
                  </article>

                  <article className="rounded-2xl border border-white/10 bg-[#0B1327]/70 p-4">
                    <h4 className="text-sm font-semibold text-white">
                      ج — إعدادات التنبيهات
                    </h4>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="flex items-center justify-between rounded-xl border border-white/10 bg-[#060d1f]/80 px-3 py-2 text-sm text-slate-200">
                        <span>تفعيل التنبيهات محلياً</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={adminSettings.alerts.enabled}
                          onClick={() =>
                            setAdminSettings((prev) => ({
                              ...prev,
                              alerts: { ...prev.alerts, enabled: !prev.alerts.enabled },
                            }))
                          }
                          className={`relative h-6 w-11 rounded-full transition ${
                            adminSettings.alerts.enabled ? "bg-sky-500/70" : "bg-slate-700"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                              adminSettings.alerts.enabled ? "right-0.5" : "right-[1.35rem]"
                            }`}
                          />
                        </button>
                      </label>
                      <label className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                        <span className="text-xs text-slate-400">الحدّة الافتراضية للتنبيه</span>
                        <select
                          value={adminSettings.alerts.defaultSeverity}
                          onChange={(e) =>
                            setAdminSettings((prev) => ({
                              ...prev,
                              alerts: { ...prev.alerts, defaultSeverity: e.target.value },
                            }))
                          }
                          className="mt-2 w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                        >
                          <option value="low">منخفض</option>
                          <option value="medium">متوسط</option>
                          <option value="high">عالي</option>
                        </select>
                      </label>
                    </div>
                  </article>

                  <article className="rounded-2xl border border-white/10 bg-[#0B1327]/70 p-4">
                    <h4 className="text-sm font-semibold text-white">
                      د — إعدادات التقارير
                    </h4>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={!hasPdfExport}
                        onClick={() =>
                          setAdminSettings((prev) => ({
                            ...prev,
                            reports: { ...prev.reports, pdfEnabled: !prev.reports.pdfEnabled },
                          }))
                        }
                        className="flex items-center justify-between rounded-xl border border-white/10 bg-[#060d1f]/80 px-3 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span>تفعيل تصدير PDF</span>
                        <span className="text-xs text-slate-400">{hasPdfExport ? "متاح" : "غير متاح حالياً"}</span>
                      </button>
                      <button
                        type="button"
                        disabled={!hasExcelExport}
                        onClick={() =>
                          setAdminSettings((prev) => ({
                            ...prev,
                            reports: { ...prev.reports, excelEnabled: !prev.reports.excelEnabled },
                          }))
                        }
                        className="flex items-center justify-between rounded-xl border border-white/10 bg-[#060d1f]/80 px-3 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span>تفعيل تصدير Excel</span>
                        <span className="text-xs text-slate-400">{hasExcelExport ? "متاح" : "غير متاح حالياً"}</span>
                      </button>
                    </div>
                  </article>

                  <article className="rounded-2xl border border-white/10 bg-[#0B1327]/70 p-4">
                    <h4 className="text-sm font-semibold text-white">
                      هـ — إعدادات النظام العامة
                    </h4>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <label className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                        <span className="text-xs text-slate-400">اسم المنصة المعروض</span>
                        <input
                          type="text"
                          value={adminSettings.system.platformName}
                          onChange={(e) =>
                            setAdminSettings((prev) => ({
                              ...prev,
                              system: { ...prev.system, platformName: e.target.value },
                            }))
                          }
                          className="mt-2 w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                        />
                      </label>
                      <label className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                        <span className="text-xs text-slate-400">اللغة الافتراضية</span>
                        <input
                          type="text"
                          value={adminSettings.system.defaultLanguage}
                          disabled
                          className="mt-2 w-full rounded-xl border border-white/10 bg-[#0B1327]/50 px-3 py-2 text-sm text-slate-300"
                        />
                      </label>
                      <label className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3">
                        <span className="text-xs text-slate-400">المنطقة الزمنية</span>
                        <input
                          type="text"
                          value={adminSettings.system.timezone}
                          disabled
                          className="mt-2 w-full rounded-xl border border-white/10 bg-[#0B1327]/50 px-3 py-2 text-sm text-slate-300"
                        />
                      </label>
                    </div>
                  </article>

                  <article className="rounded-2xl border border-white/10 bg-[#0B1327]/70 p-4">
                    <h4 className="text-sm font-semibold text-white">و — إدارة المستخدمين</h4>
                    <p className="mt-2 text-xs text-slate-400">إنشاء وتعديل حسابات الموظفين والمشرفين والمدراء.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        to="/admin/users"
                        className="inline-flex rounded-xl border border-brand-sky/40 bg-brand/15 px-4 py-2 text-xs font-semibold text-sky-100 transition hover:bg-brand/25"
                      >
                        المستخدمون
                      </Link>
                      <Link
                        to="/admin/requests"
                        className="inline-flex rounded-xl border border-white/15 bg-[#0B1327]/80 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-brand-sky/35"
                      >
                        طلبات الحساب الإداري
                      </Link>
                    </div>
                  </article>
                </div>
              )}
            </section>
            ) : null}
          </>
        )}

        {role !== "staff" ? <Toast toast={toast} /> : null}

        {rejectTarget ? (
          <div
            className="fixed inset-0 z-[185] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget) setRejectTarget(null);
            }}
          >
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0F172A] p-5 shadow-2xl">
              <h4 className="text-lg font-bold text-white">سبب رفض السجل</h4>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="اكتب سبب الرفض (إجباري)"
                className="mt-3 min-h-[6rem] w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-white outline-none focus:border-brand-sky/50"
              />
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="ملاحظات إضافية (اختياري)"
                className="mt-2 min-h-[4rem] w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-white outline-none focus:border-brand-sky/50"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectTarget(null)}
                  className="rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={!rejectReason.trim() || reviewActionLoadingId === rejectTarget.id}
                  onClick={() => void confirmRejectReviewRecord()}
                  className="rounded-xl border border-accent-red/45 bg-accent-red/15 px-4 py-2 text-sm font-semibold text-red-100 disabled:opacity-50"
                >
                  تأكيد الرفض
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {editApproveTarget ? (
          <div
            className="fixed inset-0 z-[185] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget) setEditApproveTarget(null);
            }}
          >
            <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0F172A] p-5 shadow-2xl">
              <h4 className="text-lg font-bold text-white">تعديل واعتماد السجل</h4>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-400">اسم الطبق</label>
                  <input
                    value={editApproveForm.dishName}
                    onChange={(e) => setEditApproveForm((f) => ({ ...f, dishName: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-white outline-none focus:border-brand-sky/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">الكمية</label>
                  <input
                    type="number"
                    min="1"
                    value={editApproveForm.quantity}
                    onChange={(e) => setEditApproveForm((f) => ({ ...f, quantity: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-white outline-none focus:border-brand-sky/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">المصدر</label>
                  <input
                    value={editApproveForm.source}
                    onChange={(e) => setEditApproveForm((f) => ({ ...f, source: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-white outline-none focus:border-brand-sky/50"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-400">ملاحظات</label>
                  <textarea
                    value={editApproveForm.notes}
                    onChange={(e) => setEditApproveForm((f) => ({ ...f, notes: e.target.value }))}
                    className="mt-1 min-h-[5rem] w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-white outline-none focus:border-brand-sky/50"
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditApproveTarget(null)}
                  className="rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={!editApproveForm.dishName.trim() || reviewActionLoadingId === editApproveTarget.id}
                  onClick={() => void submitEditApproveReviewRecord()}
                  className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  حفظ واعتماد
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
      </div>
      {(role === "supervisor" || role === "admin") && violationsReportStats.total > 0 ? (
        <div
          id="ska-violations-report-print"
          dir="rtl"
          lang="ar"
          style={{
            position: "fixed",
            left: "-9999px",
            top: 0,
            width: "210mm",
            pointerEvents: "none",
          }}
          aria-hidden
        >
          <header className="mb-4 border-b-2 border-slate-300 pb-3">
            <p className="text-xs font-semibold text-[#1e3a8a]">{REPORT_PLATFORM_TITLE_AR}</p>
            <p className="text-[11px] leading-relaxed text-slate-600">{REPORT_PLATFORM_TAGLINE_AR}</p>
            <h1 className="mt-3 text-xl font-bold text-slate-900">تقرير مخالفات المراقبة</h1>
            <p className="mt-1 text-xs text-slate-600">
              تاريخ التصدير: {formatSaudiDateTime(new Date())}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              الفرع: {String(supervisorSummary?.branch_name || "").trim() || "—"}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              الفترة الزمنية للمخالفات: من {violationsReportFrom?.trim() || "—"} إلى{" "}
              {violationsReportTo?.trim() || "—"}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              الفترة الزمنية لتحليل الأطباق (عدد السجلات):{" "}
              {formatReportPeriodLabel(violationsReportFrom, violationsReportTo)}
            </p>
          </header>
          <section className="mb-5">
            <h2 className="ska-print-section-title mb-2 rounded-md px-2 py-1.5 text-sm font-bold text-slate-900">
              ملخص
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">إجمالي المخالفات</p>
                <p className="text-lg font-bold tabular-nums text-slate-900">{violationsReportStats.total}</p>
              </div>
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">مفتوح</p>
                <p className="text-lg font-bold tabular-nums text-red-700">{violationsReportStats.openCount}</p>
              </div>
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">تمت المعالجة</p>
                <p className="text-lg font-bold tabular-nums text-emerald-700">{violationsReportStats.resolvedCount}</p>
              </div>
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">أكثر مخالفة تكرارًا</p>
                {violationsReportStats.topRepeated.count > 0 ? (
                  <>
                    <p className="text-sm font-semibold leading-snug text-slate-900">
                      {violationsReportStats.topRepeated.label}
                    </p>
                    <p className="text-[11px] text-slate-600">{violationsReportStats.topRepeated.count} مرة</p>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">لا توجد بيانات</p>
                )}
              </div>
            </div>
          </section>
          <section className="mb-5">
            <h2 className="ska-print-section-title mb-2 rounded-md px-2 py-1.5 text-sm font-bold text-slate-900">
              تحليل الأطباق حسب الفرع والفترة الزمنية
            </h2>
            <p className="mb-2 text-[11px] text-slate-600">
              المحور الأفقي: عدد السجلات خلال الفترة المحددة · البيانات من سجلات المراجعة المصفّاة بنفس فترة تقرير
              المخالفات.
            </p>
            {dishChartBarsForPrint.length === 0 ? (
              <p className="text-xs text-slate-500">لا توجد سجلات أطباق ضمن هذه الفترة.</p>
            ) : (
              <div dir="ltr" className="overflow-hidden rounded-lg border border-slate-300 bg-white">
                <svg
                  width="100%"
                  height={Math.min(520, 56 + dishChartBarsForPrint.length * 26)}
                  viewBox={`0 0 640 ${Math.min(520, 56 + dishChartBarsForPrint.length * 26)}`}
                  preserveAspectRatio="xMidYMin meet"
                  role="img"
                  aria-label="تحليل الأطباق حسب الفرع والفترة الزمنية"
                >
                  <text x={320} y={22} textAnchor="middle" fontSize={13} fontWeight={700} fill="#0f172a">
                    الأطباق ↔ عدد السجلات
                  </text>
                  {dishChartBarsForPrint.map((r, i) => {
                    const rowH = 26;
                    const y0 = 36 + i * rowH;
                    const maxC = Math.max(1, ...dishChartBarsForPrint.map((x) => x.count));
                    const barMax = 280;
                    const barW = (r.count / maxC) * barMax;
                    const label =
                      r.dish.length > 34 ? `${r.dish.slice(0, 34)}…` : r.dish;
                    return (
                      <g key={`${r.dish}-${i}`}>
                        <text x={308} y={y0 + 16} fontSize={11} fill="#0f172a" textAnchor="end">
                          {label}
                        </text>
                        <rect x={318} y={y0} width={barW} height={18} fill="#38bdf8" rx={3} stroke="#1e3a8a" strokeWidth={0.5} />
                        <text x={318 + barW + 6} y={y0 + 15} fontSize={11} fill="#0f172a">
                          {r.count}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </section>
          <section className="mb-5">
            <h2 className="ska-print-section-title mb-2 rounded-md px-2 py-1.5 text-sm font-bold text-slate-900">
              المخالفات حسب النوع
            </h2>
            <table className="w-full border-collapse border border-slate-300 text-sm text-slate-900">
              <thead>
                <tr>
                  <th className="border border-slate-300 px-2 py-2 text-center font-semibold">النوع</th>
                  <th className="border border-slate-300 px-2 py-2 text-center font-semibold">العدد</th>
                </tr>
              </thead>
              <tbody>
                {VIOLATION_REPORT_CATEGORY_ORDER.map((c, idx) => (
                  <tr
                    key={c.key}
                    style={{ backgroundColor: idx % 2 === 0 ? "#f8fafc" : "#eff6ff" }}
                    className="border-b border-slate-200"
                  >
                    <td className="border border-slate-200 px-2 py-1.5 break-words">{c.label}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">
                      {violationsReportStats.typeCounts[c.key]}
                    </td>
                  </tr>
                ))}
                {violationsReportStats.typeCounts._other > 0 ? (
                  <tr style={{ backgroundColor: "#f8fafc" }} className="border-b border-slate-200">
                    <td className="border border-slate-200 px-2 py-1.5 break-words">أخرى</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">
                      {violationsReportStats.typeCounts._other}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
          <section>
            <h2 className="ska-print-section-title mb-2 rounded-md px-2 py-1.5 text-sm font-bold text-slate-900">
              تفاصيل المخالفات
            </h2>
            <table className="w-full border-collapse border border-slate-300 text-[10px] leading-snug text-slate-900">
              <thead>
                <tr>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">رقم</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">نوع المخالفة</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">التفاصيل</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">الكاميرا</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">الفرع / المنطقة</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">نسبة الثقة</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">مستوى الخطورة</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">الحالة</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">التاريخ والوقت</th>
                </tr>
              </thead>
              <tbody>
                {violationsSortedForExport.map((row, index) => (
                  <tr
                    key={row.id}
                    style={{ backgroundColor: index % 2 === 0 ? "#f8fafc" : "#eff6ff" }}
                    className="align-top"
                  >
                    <td className="border border-slate-200 px-1 py-1.5 text-center tabular-nums">{index + 1}</td>
                    <td className="border border-slate-200 px-1 py-1.5 break-words font-medium">
                      {violationTypeLabelForReport(row)}
                    </td>
                    <td className="border border-slate-200 px-1 py-1.5 break-words text-slate-800">
                      {row.details || "—"}
                    </td>
                    <td className="border border-slate-200 px-1 py-1.5 break-words">{row.camera_name || "—"}</td>
                    <td className="border border-slate-200 px-1 py-1.5 break-words">
                      {formatAlertBranchArea(row)}
                    </td>
                    <td className="border border-slate-200 px-1 py-1.5 text-center tabular-nums">
                      {formatMonitoringConfidencePercent(row.confidence)}
                    </td>
                    <td
                      className="border border-slate-200 px-1 py-1.5 text-center text-[10px] font-semibold"
                      style={monitoringSeverityPrintStyle(row.confidence)}
                    >
                      {monitoringSeverityLabelAr(row.confidence)}
                    </td>
                    <td
                      className="border border-slate-200 px-1 py-1.5 text-center text-[10px] font-semibold"
                      style={monitoringAlertStatusPrintStyle(row.status)}
                    >
                      {monitoringAlertStatusAr(row.status)}
                    </td>
                    <td className="border border-slate-200 px-1 py-1.5 whitespace-normal break-words text-center font-mono">
                      {formatSaudiDateTime(row.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      ) : null}
      {(role === "supervisor" || role === "admin") && reviewRecords.length > 0 ? (
        <div
          id="ska-dish-review-report-print"
          dir="rtl"
          lang="ar"
          style={{
            position: "fixed",
            left: "-9999px",
            top: 0,
            width: "210mm",
            pointerEvents: "none",
          }}
          aria-hidden
        >
          <header className="mb-4 border-b-2 border-slate-300 pb-3">
            <h1 className="text-xl font-bold text-slate-900">تقرير مراجعة الأطباق</h1>
            <p className="mt-2 text-xs font-semibold text-[#1e3a8a]">{REPORT_PLATFORM_TITLE_AR}</p>
            <p className="text-[11px] leading-relaxed text-slate-600">{REPORT_PLATFORM_TAGLINE_AR}</p>
            <p className="mt-1 text-xs text-slate-600">
              تاريخ التقرير: {formatSaudiDateTime(new Date())}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              اسم الفرع:{" "}
              {String(supervisorSummary?.branch_name || "").trim() ||
                String(
                  reviewRecords.find((r) => r.branch_name || r.branch)?.branch_name ||
                    reviewRecords.find((r) => r.branch_name || r.branch)?.branch ||
                    "",
                ).trim() ||
                "—"}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              الفترة الزمنية: {formatReportPeriodLabel(reviewFilters.dateFrom, reviewFilters.dateTo)}
            </p>
          </header>
          <section className="mb-5">
            <h2 className="ska-print-section-title mb-2 rounded-md px-2 py-1.5 text-sm font-bold text-slate-900">
              ملخص
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">إجمالي الأطباق</p>
                <p className="text-lg font-bold tabular-nums text-slate-900">{dishReviewPdfStats.total}</p>
              </div>
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">عدد الأطباق التي تحتاج مراجعة</p>
                <p className="text-lg font-bold tabular-nums text-orange-700">{dishReviewPdfStats.pending}</p>
              </div>
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">عدد الأطباق المعتمدة</p>
                <p className="text-lg font-bold tabular-nums text-emerald-700">{dishReviewPdfStats.approved}</p>
              </div>
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">عدد الأطباق المرفوضة</p>
                <p className="text-lg font-bold tabular-nums text-red-700">{dishReviewPdfStats.rejected}</p>
              </div>
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">أكثر طبق تكرارًا</p>
                <p className="text-sm font-semibold leading-snug text-slate-900">{dishReviewPdfStats.topDish}</p>
              </div>
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">أكثر موظف لديه مراجعات</p>
                <p className="text-sm font-semibold leading-snug text-slate-900">{dishReviewPdfStats.topEmployee}</p>
              </div>
            </div>
          </section>
          <section className="mb-5">
            <h2 className="ska-print-section-title mb-2 rounded-md px-2 py-1.5 text-sm font-bold text-slate-900">
              الأطباق حسب حالة المراجعة
            </h2>
            <p className="mb-2 text-[11px] text-slate-600">
              الأشرطة المكدّسة: معتمد (أخضر) · يحتاج مراجعة (برتقالي) · مرفوض (أحمر) · أخرى (رمادي).
            </p>
            {dishReviewChartBarsForPrint.length === 0 ? (
              <p className="text-xs text-slate-500">لا توجد بيانات كافية للرسم.</p>
            ) : (
              <div dir="ltr" className="overflow-hidden rounded-lg border border-slate-300 bg-white">
                <svg
                  width="100%"
                  height={Math.min(520, 72 + dishReviewChartBarsForPrint.length * 28)}
                  viewBox={`0 0 640 ${Math.min(520, 72 + dishReviewChartBarsForPrint.length * 28)}`}
                  preserveAspectRatio="xMidYMin meet"
                  role="img"
                  aria-label="الأطباق حسب حالة المراجعة"
                >
                  <text x={320} y={22} textAnchor="middle" fontSize={13} fontWeight={700} fill="#0f172a">
                    الأطباق حسب حالة المراجعة
                  </text>
                  <text x={320} y={42} textAnchor="middle" fontSize={10} fill="#475569">
                    المحور الأفقي: عدد السجلات · على الجانب: أسماء الأطباق
                  </text>
                  {dishReviewChartBarsForPrint.map((r, i) => {
                    const rowH = 28;
                    const y0 = 52 + i * rowH;
                    const barMax = 260;
                    const total = Math.max(1, r.total);
                    const x0 = 296;
                    let x = x0;
                    const parts = [
                      { n: r.approved, fill: "#15803d" },
                      { n: r.pending, fill: "#ea580c" },
                      { n: r.rejected, fill: "#dc2626" },
                      { n: r.other, fill: "#94a3b8" },
                    ];
                    const label = r.dish.length > 28 ? `${r.dish.slice(0, 28)}…` : r.dish;
                    return (
                      <g key={`${r.dish}-${i}`}>
                        <text x={284} y={y0 + 18} fontSize={11} fill="#0f172a" textAnchor="end">
                          {label}
                        </text>
                        {parts.map((p, j) => {
                          if (p.n <= 0) return null;
                          const w = Math.max(1.5, (p.n / total) * barMax);
                          const nextX = x + w;
                          const node = (
                            <rect
                              key={`bar-${r.dish}-${i}-${j}`}
                              x={x}
                              y={y0}
                              width={w}
                              height={20}
                              fill={p.fill}
                              rx={2}
                              stroke="#ffffff"
                              strokeWidth={0.75}
                            />
                          );
                          x = nextX;
                          return node;
                        })}
                        <text x={x0 + barMax + 10} y={y0 + 16} fontSize={11} fill="#0f172a">
                          {r.total}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                <div className="flex flex-wrap gap-4 border-t border-slate-200 px-3 py-2 text-[10px] text-slate-700">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded-sm bg-[#15803d]" /> معتمد
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded-sm bg-[#ea580c]" /> يحتاج مراجعة
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded-sm bg-[#dc2626]" /> مرفوض
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded-sm bg-[#94a3b8]" /> أخرى
                  </span>
                </div>
              </div>
            )}
          </section>
          <section className="mb-5">
            <h2 className="ska-print-section-title mb-2 rounded-md px-2 py-1.5 text-sm font-bold text-slate-900">
              ملخص حسب الطبق والحالة
            </h2>
            <table className="w-full border-collapse border border-slate-300 text-xs text-slate-900">
              <thead>
                <tr>
                  <th className="border border-slate-300 px-2 py-2 text-center font-semibold">الطبق</th>
                  <th className="border border-slate-300 px-2 py-2 text-center font-semibold">الحالة</th>
                  <th className="border border-slate-300 px-2 py-2 text-center font-semibold">عدد السجلات</th>
                </tr>
              </thead>
              <tbody>
                {dishReviewStatusSummaryRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="border border-slate-200 px-2 py-3 text-center text-slate-500">
                      لا توجد بيانات
                    </td>
                  </tr>
                ) : (
                  dishReviewStatusSummaryRows.map((row, idx) => (
                    <tr
                      key={`${row.dish}-${row.statusAr}-${idx}`}
                      style={{ backgroundColor: idx % 2 === 0 ? "#f8fafc" : "#eff6ff" }}
                    >
                      <td className="border border-slate-200 px-2 py-1.5 break-words">{row.dish}</td>
                      <td
                        className="border border-slate-200 px-2 py-1.5 text-center font-semibold"
                        style={dishReviewArabicStatusPrintStyle(row.statusAr)}
                      >
                        {row.statusAr}
                      </td>
                      <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{row.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
          <section>
            <h2 className="ska-print-section-title mb-2 rounded-md px-2 py-1.5 text-sm font-bold text-slate-900">
              تفاصيل السجلات
            </h2>
            <table className="w-full border-collapse border border-slate-300 text-[10px] leading-snug text-slate-900">
              <thead>
                <tr>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">رقم</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">اسم الموظف</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">الطبق المقترح</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">الطبق المعتمد</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">الكمية</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">الحالة</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">وقت التسجيل</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">وقت المراجعة</th>
                </tr>
              </thead>
              <tbody>
                {reviewRecords.map((row, index) => (
                  <tr
                    key={row.id}
                    style={{ backgroundColor: index % 2 === 0 ? "#f8fafc" : "#eff6ff" }}
                    className="align-top"
                  >
                    <td className="border border-slate-200 px-1 py-1.5 text-center tabular-nums">{index + 1}</td>
                    <td className="border border-slate-200 px-1 py-1.5 break-words">{row.employee_name || "—"}</td>
                    <td className="border border-slate-200 px-1 py-1.5 break-words">{row.predicted_label || "—"}</td>
                    <td className="border border-slate-200 px-1 py-1.5 break-words">{row.confirmed_label || "—"}</td>
                    <td className="border border-slate-200 px-1 py-1.5 text-center tabular-nums">{row.quantity ?? "—"}</td>
                    <td
                      className="border border-slate-200 px-1 py-1.5 text-center font-semibold"
                      style={dishReviewStatusPrintStyle(row.status)}
                    >
                      {dishReviewStatusArExport(row.status)}
                    </td>
                    <td className="border border-slate-200 px-1 py-1.5 whitespace-normal break-words text-center font-mono">
                      {row.recorded_at ? formatSaudiDateTime(row.recorded_at) : "—"}
                    </td>
                    <td className="border border-slate-200 px-1 py-1.5 whitespace-normal break-words text-center font-mono">
                      {row.reviewed_at ? formatSaudiDateTime(row.reviewed_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      ) : null}
    </div>
  );
}
