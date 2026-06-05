import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import LazyWhenVisible from "../components/shared/LazyWhenVisible.jsx";
import SupervisorAnalyticsRecharts from "../components/supervisor/SupervisorAnalyticsRecharts.jsx";
import ReportsHub from "../components/reports/ReportsHub.jsx";
import StickyAnalyticsSummaryBar from "../components/supervisor/StickyAnalyticsSummaryBar.jsx";
import ExpandMoreList from "../components/shared/ExpandMoreList.jsx";
import EmptyState from "../components/shared/EmptyState.jsx";
import FoodImageThumb from "../components/shared/FoodImageThumb.jsx";
import { dishReportImageLink, resolveDishImageUrl } from "../utils/dishHelpers.js";
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
import {
  API_STATUS,
  apiStatusLabelAr,
  probeApiHealth,
  supervisorDataLoadErrorAr,
} from "../utils/apiHealth.js";
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
import {
  isSectionNavigationLocked,
  lockSectionNavigation,
  scrollToSectionElement,
} from "../utils/sectionScroll.js";
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
  violationTypeLabelForReport,
} from "../utils/reportExportHelpers.js";
import { exportDishRecordsExcel } from "../utils/reportExcelExport.js";
import {
  MONITORING_ZONE_DEFINITIONS,
  findCameraForZone,
  alertsForZone,
  todayIsoDateLocal,
  isAlertToday,
} from "../constants/monitoringZones.js";
import {
  RESTAURANT_CONNECTION_TYPES,
  validateRestaurantCameraDraft,
  mergeRestaurantCameraDefaults,
  readLegacyLocalStorageConfigs,
  clearLegacyLocalStorageConfigs,
  legacyConfigsForImport,
  apiZonesListToStoredMap,
  apiZoneToStored,
  draftToApiUpsert,
} from "../lib/restaurantCameraStorage.js";
import {
  fetchZoneConfigs,
  upsertZoneConfig,
  patchZoneConnectionTest,
  importLegacyZoneConfigs,
} from "../services/monitoringZoneApi.js";
import {
  assessCameraStreamUrl,
  securityStatusBadgeClass,
  CAMERA_SECURITY,
} from "../utils/cameraSecurity.js";

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

/**
 * CSS-only relative bars from API numbers (no chart library).
 *
 * Wrapped with `React.memo` below so unrelated dashboard state changes
 * (toasts, monitoring frames, scroll position) don't re-render the bar chart.
 */
function SupervisorAnalyticsBarsImpl({ loading, supervisorSummary }) {
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
                  className={`h-full rounded-full bg-gradient-to-l ${r.barClass}`}
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

const SupervisorAnalyticsBars = memo(SupervisorAnalyticsBarsImpl);

// Performance: removed backdrop-blur-sm + shadow-glass + hover transitions from
// the shared card classes. These were applied to ~200 cards, so even at 60fps the
// browser was thrashing the compositor on every scroll. Solid backgrounds restore
// stable scrolling on long pages.
const glassCard =
  "rounded-2xl border border-white/10 bg-[#0f172a] p-4 sm:p-6";

const staffGlassCard =
  "rounded-2xl border border-white/10 bg-[#0f172a] p-4 sm:p-6";

/** Staff dish workflow — clearer depth + glow (scoped to staff sections only). */
const staffElevatedCard =
  `${staffGlassCard} border-white/12 shadow-[0_0_48px_-18px_rgba(56,189,248,0.16)] ring-1 ring-white/[0.05] hover:border-brand-sky/20`;

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
    pdfEnabled: true,
    excelEnabled: true,
    includeEvidence: true,
    includeSummary: true,
    format: "detailed", // "compact" | "detailed"
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
      // PDF/Excel are real, working features in this build — default ON.
      pdfEnabled: reportsObj.pdfEnabled !== false,
      excelEnabled: reportsObj.excelEnabled !== false,
      includeEvidence: reportsObj.includeEvidence !== false,
      includeSummary: reportsObj.includeSummary !== false,
      format: reportsObj.format === "compact" ? "compact" : "detailed",
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
const SUPERVISOR_ALERT_STATUS_URL = (id) => apiUrl(`/api/v1/supervisor/alerts/${id}/status`);
const AI_STATUS_URL = apiUrl("/api/v1/ai/status");
const AI_WARMUP_URL = apiUrl("/api/v1/ai/warmup");
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

function alertSeverityBadgeMeta(confidence) {
  const n = Number(confidence);
  if (!Number.isFinite(n)) {
    return { label: "خطورة غير محددة", cls: "border-slate-500/40 bg-slate-800/60 text-slate-300" };
  }
  if (n >= 85) return { label: "خطورة عالية", cls: "border-red-500/45 bg-red-500/15 text-red-100" };
  if (n >= 55) return { label: "تحذير", cls: "border-amber-500/45 bg-amber-500/15 text-amber-100" };
  return { label: "منخفض", cls: "border-emerald-500/45 bg-emerald-500/15 text-emerald-100" };
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
    imageAvailable: item.image_available !== false,
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

// Safety check definitions — PPE + environment hazards displayed as status cards.
// `source` controls which signal feeds the card:
//   - mask_model     → dedicated mask model entry under supplementary_checks
//   - supplementary  → dedicated PPE region pipeline (gloves, headcover, uniform)
//   - scene          → environment heuristic (wet floor, trash on floor)
const _CHECK_DEFS = [
  { key: "no_mask",        label: "الكمامة",       emoji: "😷", source: "mask_model"    },
  { key: "no_gloves",      label: "القفازات",      emoji: "🧤", source: "supplementary" },
  { key: "no_headcover",   label: "غطاء الرأس",    emoji: "🪖", source: "supplementary" },
  { key: "no_uniform",     label: "الزي الرسمي",   emoji: "👔", source: "supplementary" },
  { key: "trash_on_floor", label: "النفايات",      emoji: "🗑️", source: "scene"         },
  { key: "wet_floor",      label: "أرضية مبللة",   emoji: "💧", source: "scene"         },
];

const _CHECK_STATE_CFG = {
  violation: {
    card:   "border-red-500/50 bg-red-500/[0.10] shadow-[0_0_18px_-8px_rgba(239,68,68,0.30)]",
    badge:  "border-red-500/40 bg-red-500/20 text-red-200",
    dot:    "bg-red-400",
    symbol: "✕",
    label:  "مخالفة",
    color:  "text-red-300",
    pulse:  false,
  },
  compliant: {
    card:   "border-emerald-500/40 bg-emerald-500/[0.07] shadow-[0_0_16px_-10px_rgba(16,185,129,0.25)]",
    badge:  "border-emerald-500/30 bg-emerald-500/12 text-emerald-200",
    dot:    "bg-emerald-400",
    symbol: "✓",
    label:  "مطابق",
    color:  "text-emerald-300",
    pulse:  false,
  },
  verifying: {
    card:   "border-amber-400/45 bg-amber-400/[0.07]",
    badge:  "border-amber-400/35 bg-amber-400/12 text-amber-200",
    dot:    "bg-amber-400",
    symbol: "◷",
    label:  "جاري التحقق",
    color:  "text-amber-300",
    pulse:  true,
  },
  needs_review: {
    card:   "border-amber-500/35 bg-amber-500/[0.06]",
    badge:  "border-amber-500/30 bg-amber-500/10 text-amber-300",
    dot:    "bg-amber-500",
    symbol: "◌",
    label:  "يحتاج مراجعة",
    color:  "text-amber-400",
    pulse:  false,
  },
  unavailable: {
    card:   "border-white/[0.08] bg-white/[0.02]",
    badge:  "border-slate-600/20 bg-slate-600/10 text-slate-500",
    dot:    "bg-slate-600",
    symbol: "—",
    label:  "غير مفعّل",
    color:  "text-slate-500",
    pulse:  false,
  },
  no_person: {
    card:   "border-slate-700/30 bg-slate-700/[0.04]",
    badge:  "border-slate-600/20 bg-slate-600/10 text-slate-500",
    dot:    "bg-slate-600",
    symbol: "👤",
    label:  "لا يوجد أفراد",
    color:  "text-slate-500",
    pulse:  false,
  },
};

function _deriveCheckState(key, source, result) {
  if (!result) return { state: "unavailable", confidence: null, violatingCount: 0 };

  const violations    = (result.violations || []).filter((v) => !v.alias_of);
  const dbg           = result.frame_report?.debug || {};
  const supp          = (dbg.supplementary_checks || {})[key];
  const overallStatus = result.overall_status || "clean";
  const peopleCount   = typeof result.people_count === "number" ? result.people_count : (dbg.people_count ?? 0);

  // How many distinct persons are flagged for this check type
  const typeViolations = violations.filter((v) => v.type === key);
  const uniquePersons  = [...new Set(typeViolations.map((v) => v.person_index).filter((p) => p != null))];
  const violatingCount = typeViolations.length > 0 ? (uniquePersons.length || typeViolations.length) : 0;

  if (peopleCount === 0 && overallStatus !== "cannot_verify") {
    return { state: "no_person", confidence: null, violatingCount: 0 };
  }

  // Region-aware pipeline result (mask, headcover, gloves — crop-based inference)
  if (source === "supplementary" || source === "mask_model") {
    if (supp) {
      // supp.violating_count comes from the region pipeline (per-person aggregation).
      const suppViolCount = supp.violating_count ?? violatingCount;
      if (supp.status === "not_configured") return { state: "unavailable",   confidence: null,              violatingCount: 0             };
      if (supp.status === "violation")      return { state: "violation",      confidence: supp.confidence,   violatingCount: suppViolCount || 1 };
      // ok: region pipeline positively confirmed PPE for 3 consecutive frames → green
      if (supp.status === "ok")             return { state: "compliant",      confidence: supp.confidence || null, violatingCount: 0       };
      // verifying: streak building — pulsing amber "جاري التحقق", not green yet
      if (supp.status === "verifying")      return { state: "verifying",      confidence: supp.confidence || null, violatingCount: 0       };
      // needs_review: model silent, region not visible, or below threshold
      if (supp.status === "needs_review")   return { state: "needs_review",   confidence: supp.confidence || null, violatingCount: 0       };
      if (supp.status === "not_verified")   return { state: "needs_review",   confidence: supp.confidence || null, violatingCount: 0       };
      // ok_inferred (legacy): kept for backward compat but now maps to needs_review
      // per policy: model silence ≠ compliant.
      if (supp.status === "ok_inferred")    return { state: "needs_review",   confidence: null,              violatingCount: 0             };
      if (supp.status === "error")          return { state: "needs_review",   confidence: null,              violatingCount: 0             };
    }
    // Mask without supplementary entry: defer to main YOLO. If no violation → compliant.
    if (key === "no_mask") {
      const maskViol = violations.find((v) => v.type === "no_mask");
      if (maskViol)                          return { state: "violation",    confidence: maskViol.confidence, violatingCount: violatingCount || 1 };
      if (overallStatus === "clean")         return { state: "compliant",    confidence: null,                violatingCount: 0 };
      return { state: "needs_review", confidence: null, violatingCount: 0 };
    }
    // Gloves / headcover without supplementary entry
    const mainViol = violations.find((v) => v.type === key);
    if (mainViol)                      return { state: "violation",    confidence: mainViol.confidence, violatingCount: violatingCount || 1 };
    if (overallStatus === "clean")     return { state: "compliant",    confidence: null, violatingCount: 0 };
    if (overallStatus === "cannot_verify") return { state: "needs_review", confidence: null, violatingCount: 0 };
    return { state: "unavailable", confidence: null, violatingCount: 0 };
  }

  // Scene checks (wet floor, trash on floor) — heuristic data under supplementary_checks
  if (source === "scene") {
    // Backend emits a confirmed violation (main YOLO class fired) → red card.
    const mainViol = violations.find((v) => v.type === key);
    if (mainViol) return { state: "violation", confidence: mainViol.confidence, violatingCount: violatingCount || 1 };
    if (supp) {
      if (supp.status === "violation")     return { state: "violation",    confidence: supp.confidence,        violatingCount: 1 };
      if (supp.status === "needs_review")  return { state: "needs_review", confidence: supp.confidence || null, violatingCount: 0 };
      if (supp.status === "ok")            return { state: "compliant",    confidence: null,                    violatingCount: 0 };
      if (supp.status === "not_configured") return { state: "unavailable", confidence: null,                   violatingCount: 0 };
    }
    return { state: "needs_review", confidence: null, violatingCount: 0 };
  }

  // Main YOLO model checks (fallback for keys not covered above)
  const mainViol = violations.find((v) => v.type === key);
  if (mainViol)                      return { state: "violation",    confidence: mainViol.confidence, violatingCount: violatingCount || 1 };
  if (overallStatus === "clean")     return { state: "compliant",    confidence: null, violatingCount: 0 };
  if (overallStatus === "cannot_verify") return { state: "needs_review", confidence: null, violatingCount: 0 };
  return { state: "unavailable", confidence: null, violatingCount: 0 };
}

function PpeStatusDashboard({ result, liveActive, liveTickBusy, manualLoading, zoneName, lastAnalyzedAt, role }) {
  const [techOpen, setTechOpen] = useState(false);
  const isLoading = liveTickBusy || manualLoading;
  // Technical / diagnostic panel is admin-only — supervisors get a clean, simple view.
  const showTechPanel = role === "admin";

  if (!result) {
    return (
      <div className="mt-4 rounded-xl border border-white/10 bg-[#080f24]/60 p-5">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
              liveActive ? "animate-pulse bg-emerald-400" : "bg-slate-700"
            }`}
          />
          <p className="text-sm text-slate-400">
            {isLoading
              ? "جاري تحليل البيئة..."
              : liveActive
              ? "جاري تحميل نظام المراقبة..."
              : "المراقبة غير نشطة — شغّل الكاميرا لعرض حالة السلامة."}
          </p>
        </div>
        {liveActive && !isLoading && (
          <p className="mt-2 pr-5 text-[11px] text-slate-600">
            قد يستغرق التحميل الأول دقيقة أو دقيقتين عند أول تشغيل.
          </p>
        )}
      </div>
    );
  }

  const violations     = (result.violations || []).filter((v) => !v.alias_of);
  const displayViolations = violations.filter(
    (v) => v.type !== "no_person_in_zone" && v.type !== "unclear_camera_angle",
  );
  const hasNoPerson    = violations.some((v) => v.type === "no_person_in_zone");
  const overallStatus  = result.overall_status || "clean";
  const cannotVerify   = overallStatus === "cannot_verify";
  const qualityPct     = typeof result.quality_pct === "number" ? result.quality_pct : 100;
  const dbg            = result.frame_report?.debug || {};
  const peopleCount    = typeof result.people_count === "number" ? result.people_count : (dbg.people_count ?? 0);
  const analyzedAt     = result.frame_report?.analyzed_at || lastAnalyzedAt;
  const isFullyCompliant = overallStatus === "clean" && displayViolations.length === 0;

  const complianceCls = cannotVerify
    ? "text-amber-400"
    : qualityPct >= 95
    ? "text-emerald-400"
    : qualityPct >= 70
    ? "text-amber-400"
    : "text-red-400";

  const lastCheckedLabel = analyzedAt ? formatSaudiDateTime(analyzedAt) : "—";

  const checkStates = _CHECK_DEFS.map(({ key, source }) => ({
    key,
    ..._deriveCheckState(key, source, result),
  }));

  const violatingPeopleCount = Math.max(
    ...checkStates.filter((c) => c.state === "violation").map((c) => c.violatingCount || 0),
    0,
  );

  return (
    <div className="mt-4 space-y-3">
      {/* Professional summary strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] sm:grid-cols-4">
        {[
          {
            icon: "👤",
            value: peopleCount,
            valueCls: peopleCount > 0 ? "text-sky-300" : "text-slate-500",
            sub: "أشخاص مرصودون",
          },
          {
            icon: "⚠",
            value: displayViolations.length,
            valueCls: displayViolations.length > 0 ? "text-red-400" : "text-emerald-400",
            sub: displayViolations.length > 0
              ? `${violatingPeopleCount > 0 ? violatingPeopleCount + " شخص" : ""} مخالف`
              : "لا مخالفات",
          },
          {
            icon: "🕐",
            value: lastCheckedLabel,
            valueCls: "text-slate-300 text-[10px]",
            sub: "آخر تحليل",
          },
          {
            icon: cannotVerify ? "🔍" : qualityPct >= 95 ? "✅" : qualityPct >= 70 ? "⚠" : "❌",
            value: cannotVerify ? "—" : `${qualityPct}%`,
            valueCls: complianceCls,
            sub: "درجة الامتثال",
          },
        ].map(({ icon, value, valueCls, sub }, i) => (
          <div key={i} className="flex flex-col items-center gap-0.5 bg-[#060d1f]/80 px-3 py-3">
            <span className="text-base leading-none">{icon}</span>
            <p className={`text-sm font-bold tabular-nums leading-none ${valueCls}`}>{value}</p>
            <p className="mt-0.5 text-center text-[10px] text-slate-500">{sub}</p>
          </div>
        ))}
      </div>

      {/* Compliance score bar */}
      {!cannotVerify && (
        <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-[#060d1f]/80">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[10px] text-slate-500">
              {isLoading
                ? "جاري التحليل..."
                : isFullyCompliant && peopleCount > 0
                ? "جميع الموظفين ملتزمون ✓"
                : isFullyCompliant
                ? "لا يوجد أفراد في المجال"
                : `${displayViolations.length} مخالفة نشطة`}
            </span>
            {zoneName && <span className="text-[10px] text-slate-600">{zoneName}</span>}
            <span className={`text-[11px] font-bold tabular-nums ${complianceCls}`}>
              {cannotVerify ? "—" : `${qualityPct}%`}
            </span>
          </div>
          <div className="h-1 w-full bg-white/[0.05]">
            <div
              className={`h-full transition-[width,background-color] duration-500 ${
                qualityPct >= 95 ? "bg-emerald-500" : qualityPct >= 70 ? "bg-amber-500" : "bg-red-500"
              }`}
              style={{ width: `${cannotVerify ? 50 : qualityPct}%` }}
            />
          </div>
        </div>
      )}

      {/* PPE check cards — 3 cols on sm+, 2 cols on mobile */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {_CHECK_DEFS.map(({ key, label, emoji }) => {
          const { state, confidence, violatingCount } =
            checkStates.find((c) => c.key === key) || { state: "unavailable", confidence: null, violatingCount: 0 };
          const cfg = _CHECK_STATE_CFG[state] || _CHECK_STATE_CFG.unavailable;
          return (
            <div
              key={key}
              className={`relative overflow-hidden rounded-xl border p-3.5 transition-colors duration-300 ${cfg.card}`}
            >
              {/* Pulsing overlay for verifying state */}
              {cfg.pulse && (
                <span className="pointer-events-none absolute inset-0 animate-pulse rounded-xl bg-amber-400/[0.06]" />
              )}
              <div className="relative flex items-start justify-between">
                <span className="text-2xl leading-none">{emoji}</span>
                <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${cfg.badge} ${cfg.pulse ? "animate-pulse" : ""}`}>
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </span>
              </div>
              <p className="relative mt-2.5 text-[12px] font-semibold text-slate-200">{label}</p>
              {violatingCount > 0 && (
                <p className="relative mt-1 flex items-center gap-1 text-[11px] font-semibold text-red-300">
                  <span>👤</span>
                  <span>{violatingCount} {violatingCount === 1 ? "شخص مخالف" : "أشخاص مخالفون"}</span>
                </p>
              )}
              {state === "verifying" && (
                <p className="relative mt-1 text-[10px] text-amber-400/80">
                  جاري التحقق من {label}…
                </p>
              )}
              {state !== "unavailable" && state !== "no_person" && analyzedAt && (
                <p className="relative mt-1.5 text-[9px] leading-tight text-slate-600">
                  آخر فحص: {lastCheckedLabel}
                </p>
              )}
              {showTechPanel && techOpen && confidence != null && confidence > 0 && (
                <p className="relative mt-0.5 text-[9px] text-slate-600">ثقة: {confidence}%</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Cannot-verify warning */}
      {cannotVerify && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-[11px]">
          <p className="font-semibold text-amber-200">⚠ يتعذّر التحقق الكامل من معدات الحماية</p>
          <p className="mt-0.5 leading-relaxed text-amber-400/80">
            {result.summary ||
              "النظام رصد نشاطاً في المنطقة لكن لا يمكن تأكيد الامتثال الكامل. تأكد من توجيه الكاميرا نحو العمال بشكل مباشر."}
          </p>
        </div>
      )}

      {/* No-person notice */}
      {!cannotVerify && hasNoPerson && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-[11px] text-slate-400">
          لم يُرصد أفراد في مجال الكاميرا — وجّه الكاميرا نحو منطقة العمل للتحقق من الالتزام.
        </div>
      )}

      {/* Active violations list */}
      {displayViolations.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            المخالفات النشطة
          </p>
          {displayViolations.map((v, idx) => (
            <div
              key={`vio-${idx}`}
              className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2.5"
            >
              <span className="mt-px shrink-0 text-[11px] font-bold text-red-400">✕</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-100">{v.label_ar}</p>
                {v.reason_ar && (
                  <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{v.reason_ar}</p>
                )}
                {v.suggested_action && (
                  <p className="mt-1 text-[10px] text-slate-600">الإجراء: {v.suggested_action}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fully compliant confirmation */}
      {isFullyCompliant && !cannotVerify && !hasNoPerson && peopleCount > 0 && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3 text-center">
          <p className="text-sm font-semibold text-emerald-300">
            جميع الموظفين ملتزمون بمعايير السلامة
          </p>
          <p className="mt-0.5 text-[10px] text-emerald-800">
            {result.frame_report?.summary_ar || "لم تُرصد أي مخالفات في هذا الإطار."}
          </p>
        </div>
      )}

      {/* Technical diagnostics — admin only. Supervisors see a clean view. */}
      {showTechPanel && (
        <div>
          <button
            type="button"
            onClick={() => setTechOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10px] font-medium text-slate-500 transition-colors hover:border-white/10 hover:text-slate-400"
          >
            <span>معلومات تقنية (مشرف النظام)</span>
            <span className="text-[8px]">{techOpen ? "▲" : "▼"}</span>
          </button>
          {techOpen && (
            <div className="mt-1.5 space-y-0.5 rounded-lg border border-white/[0.06] bg-[#040b1e]/80 p-3 font-mono text-[10px] text-slate-500">
              <p>المزود: {result.frame_report?.provider || result.provider || "—"}</p>
              <p>الثقة الإجمالية: {result.overall_confidence ?? "—"}%</p>
              <p>النموذج: {dbg.model_used || "—"}</p>
              <p>الأشخاص (YOLO): {dbg.people_count ?? "—"}</p>
              {checkStates.map(({ key, state, confidence }) =>
                confidence != null ? (
                  <p key={key}>{key}: {state} ({confidence}%)</p>
                ) : null,
              )}
              {dbg.supplementary_checks && Object.keys(dbg.supplementary_checks).length > 0 && (
                <div className="mt-1 space-y-0.5 border-t border-white/[0.06] pt-1">
                  <p className="text-slate-600">نماذج تكميلية:</p>
                  {Object.entries(dbg.supplementary_checks).map(([k, sv]) => (
                    <p key={k} className="pr-2">
                      {k}: {sv.status || "—"}{sv.confidence ? ` (${sv.confidence}%)` : ""}
                    </p>
                  ))}
                </div>
              )}
              {dbg.missing_models?.length > 0 && (
                <p className="mt-1 text-amber-700">نماذج مفقودة: {dbg.missing_models.join("، ")}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  /** When true, next pathname sync must not scroll (coming from scroll-spy navigate). */
  const suppressScrollIntoViewFromSpyRef = useRef(false);
  /** Timestamp (ms) until which scroll-spy must not change the URL. */
  const sectionNavLockUntilRef = useRef(0);
  /** Last section id synced to URL — avoids redundant navigate() during scroll. */
  const lastSpySectionIdRef = useRef(null);
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
  const [apiConnectionStatus, setApiConnectionStatus] = useState(API_STATUS.CHECKING);
  const [alertStatusFilter, setAlertStatusFilter] = useState("all");
  const [alertTypeFilter, setAlertTypeFilter] = useState("all");
  const [evidenceAlertId, setEvidenceAlertId] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [aiStatusLoading, setAiStatusLoading] = useState(false);
  /** AI warmup state: "idle" | "loading" | "ready" | "failed" */
  const [aiWarmupStatus, setAiWarmupStatus] = useState("idle");
  const aiWarmupPollRef = useRef(null);
  const [alertUnderReviewLoadingId, setAlertUnderReviewLoadingId] = useState(null);
  const [newCameraForm, setNewCameraForm] = useState({
    name: "",
    location: "",
    stream_url: "",
    username: "",
    password: "",
  });

  const newCameraSecurityAssess = useMemo(() => {
    let streamUrl = (newCameraForm.stream_url || "").trim() || null;
    const u = (newCameraForm.username || "").trim();
    const p = (newCameraForm.password || "").trim();
    if (streamUrl && u) {
      try {
        const url = new URL(streamUrl);
        url.username = u;
        if (p) url.password = p;
        streamUrl = url.toString();
      } catch {
        if (streamUrl.includes("://")) {
          const [proto, rest] = streamUrl.split("://", 2);
          streamUrl = `${proto}://${u}${p ? `:${p}` : ""}@${rest}`;
        }
      }
    }
    return assessCameraStreamUrl(streamUrl, { username: u, password: p });
  }, [newCameraForm.stream_url, newCameraForm.username, newCameraForm.password]);

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
  /** Per-zone IP / RTSP connection UI — persisted in PostgreSQL (monitoring_zone_configs). */
  const [restaurantCamConfigs, setRestaurantCamConfigs] = useState(() =>
    mergeRestaurantCameraDefaults(MONITORING_ZONE_DEFINITIONS, {}),
  );
  const [cameraSetupBusy, setCameraSetupBusy] = useState({ test: null, save: null });
  const [detectResultModal, setDetectResultModal] = useState(null);
  const [adminSettings, setAdminSettings] = useState(ADMIN_SETTINGS_DEFAULTS);
  const [adminSettingsSaving, setAdminSettingsSaving] = useState(false);
  const [violationsReportFrom, setViolationsReportFrom] = useState("");
  const [violationsReportTo, setViolationsReportTo] = useState("");
  const [violationsReportRows, setViolationsReportRows] = useState([]);
  const [violationsReportLoading, setViolationsReportLoading] = useState(false);
  const [violationsReportError, setViolationsReportError] = useState("");
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
    let cancelled = false;
    (async () => {
      try {
        const token = getAccessToken?.();
        if (!token) return;
        const res = await fetch(apiUrl("/api/v1/admin/settings"), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const body = await res.json();
        const flat = body && typeof body.settings === "object" ? body.settings : null;
        if (!flat || cancelled) return;
        const nested = {
          ai: typeof flat.ai === "object" ? flat.ai : undefined,
          alerts: typeof flat.alerts === "object" ? flat.alerts : undefined,
          reports: typeof flat.reports === "object" ? flat.reports : undefined,
          system: typeof flat.system === "object" ? flat.system : undefined,
        };
        if (Object.values(nested).some(Boolean)) {
          setAdminSettings(normalizeAdminSettingsShape(nested));
        }
      } catch {
        /* offline / 401 — keep in-memory defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getAccessToken?.();
      if (!token) return;
      try {
        const legacy = readLegacyLocalStorageConfigs();
        if (legacy && Object.keys(legacy).length > 0) {
          await importLegacyZoneConfigs(token, legacyConfigsForImport(legacy));
          clearLegacyLocalStorageConfigs();
        }
        const data = await fetchZoneConfigs(token);
        if (cancelled) return;
        setRestaurantCamConfigs(apiZonesListToStoredMap(data.zones, MONITORING_ZONE_DEFINITIONS));
      } catch {
        if (!cancelled) {
          setRestaurantCamConfigs(mergeRestaurantCameraDefaults(MONITORING_ZONE_DEFINITIONS, {}));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

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

  const lockSectionNavForScroll = useCallback(() => {
    lockSectionNavigation(sectionNavLockUntilRef);
  }, []);

  /** Supervisor/admin: pathname → scroll to section (single shot, no fight with scroll-spy). */
  useEffect(() => {
    if (!(role === "supervisor" || role === "admin")) return undefined;
    const sec = getSupervisorSectionFromPathname(location.pathname);
    if (!sec) return undefined;
    lastSpySectionIdRef.current = sec;
    if (suppressScrollIntoViewFromSpyRef.current) {
      suppressScrollIntoViewFromSpyRef.current = false;
      return undefined;
    }
    lockSectionNavigation(sectionNavLockUntilRef);
    const raf = requestAnimationFrame(() => {
      scrollToSectionElement(sec);
    });
    return () => cancelAnimationFrame(raf);
  }, [location.pathname, role]);

  /** Staff: pathname → scroll to section. */
  useEffect(() => {
    if (role !== "staff") return undefined;
    const sec = getStaffSectionFromPathname(location.pathname);
    if (!sec) return undefined;
    lastSpySectionIdRef.current = sec;
    if (suppressScrollIntoViewFromSpyRef.current) {
      suppressScrollIntoViewFromSpyRef.current = false;
      return undefined;
    }
    lockSectionNavigation(sectionNavLockUntilRef);
    const raf = requestAnimationFrame(() => {
      scrollToSectionElement(sec);
    });
    return () => cancelAnimationFrame(raf);
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
        if (isSectionNavigationLocked(sectionNavLockUntilRef)) return;
        if (staffSpyRafRef.current != null) return;
        staffSpyRafRef.current = requestAnimationFrame(() => {
          staffSpyRafRef.current = null;
          if (isSectionNavigationLocked(sectionNavLockUntilRef)) return;
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
          if (!bestId || bestId === lastSpySectionIdRef.current) return;
          const nextPath = staffPathFromSectionId(bestId);
          if (typeof window !== "undefined" && window.location.pathname !== nextPath) {
            if (staffSpyNavigateTimerRef.current) window.clearTimeout(staffSpyNavigateTimerRef.current);
            staffSpyNavigateTimerRef.current = window.setTimeout(() => {
              staffSpyNavigateTimerRef.current = null;
              if (isSectionNavigationLocked(sectionNavLockUntilRef)) return;
              if (typeof window !== "undefined" && window.location.pathname !== nextPath) {
                lastSpySectionIdRef.current = bestId;
                suppressScrollIntoViewFromSpyRef.current = true;
                navigate(nextPath, { replace: true });
              }
            }, 280);
          }
        });
      },
      { root: null, rootMargin: "-22% 0px -58% 0px", threshold: [0, 0.12] },
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
          if (isSectionNavigationLocked(sectionNavLockUntilRef)) return;
          if (supervisorSpyRafRef.current != null) return;
          supervisorSpyRafRef.current = requestAnimationFrame(() => {
            supervisorSpyRafRef.current = null;
            if (isSectionNavigationLocked(sectionNavLockUntilRef)) return;
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
            if (!bestId || bestId === lastSpySectionIdRef.current) return;
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
                if (isSectionNavigationLocked(sectionNavLockUntilRef)) return;
                if (typeof window !== "undefined" && window.location.pathname !== nextPath) {
                  lastSpySectionIdRef.current = bestId;
                  suppressScrollIntoViewFromSpyRef.current = true;
                  navigate(nextPath, { replace: true });
                }
              }, 280);
            }
          });
        },
        { root: null, rootMargin: "-22% 0px -58% 0px", threshold: [0, 0.12] },
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

  /** AOS only on staff dish workflow — supervisor CCTV dashboard disables it (scroll jank). */
  useEffect(() => {
    if (role !== "staff") return undefined;
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
  }, [role]);

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

  const monitoringHealthLine =
    apiConnectionStatus === API_STATUS.CHECKING || alertsLoading
      ? apiStatusLabelAr(API_STATUS.CHECKING)
      : apiConnectionStatus === API_STATUS.OFFLINE
        ? apiStatusLabelAr(API_STATUS.OFFLINE)
        : apiConnectionStatus === API_STATUS.WAKING
          ? apiStatusLabelAr(API_STATUS.WAKING)
          : alertsError
            ? alertsError
            : apiStatusLabelAr(API_STATUS.ONLINE);
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

  const saveAdminSettings = useCallback(async () => {
    const normalized = normalizeAdminSettingsShape(adminSettings);
    setAdminSettingsSaving(true);
    try {
      const token = getAccessToken?.();
      if (!token) {
        setToast({ type: "error", text: "يجب تسجيل الدخول لحفظ الإعدادات." });
        return;
      }
      const res = await fetch(apiUrl("/api/v1/admin/settings"), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(normalized),
      });
      if (!res.ok) {
        setToast({ type: "error", text: "تعذر حفظ الإعدادات على الخادم." });
        return;
      }
      setAdminSettings(normalized);
      setToast({ type: "success", text: "تم حفظ الإعدادات على الخادم." });
    } catch {
      setToast({ type: "error", text: "تعذر حفظ الإعدادات." });
    } finally {
      setAdminSettingsSaving(false);
    }
  }, [adminSettings, getAccessToken, setToast]);

  const resetAdminSettings = useCallback(async () => {
    const normalized = normalizeAdminSettingsShape(ADMIN_SETTINGS_DEFAULTS);
    setAdminSettingsSaving(true);
    try {
      const token = getAccessToken?.();
      if (!token) {
        setToast({ type: "error", text: "يجب تسجيل الدخول لإعادة ضبط الإعدادات." });
        return;
      }
      const res = await fetch(apiUrl("/api/v1/admin/settings"), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(normalized),
      });
      if (!res.ok) {
        setToast({ type: "error", text: "تعذر إعادة ضبط الإعدادات على الخادم." });
        return;
      }
      setAdminSettings(normalized);
      setToast({ type: "success", text: "تمت إعادة الإعدادات للوضع الافتراضي على الخادم." });
    } catch {
      setToast({ type: "error", text: "تعذر إعادة ضبط الإعدادات." });
    } finally {
      setAdminSettingsSaving(false);
    }
  }, [getAccessToken, setToast]);

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

  const violationsSortedForExport = useMemo(() => {
    const list = Array.isArray(violationsReportRows) ? [...violationsReportRows] : [];
    list.sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
    );
    return list;
  }, [violationsReportRows]);

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
    document.title = `ska_violations_report_${formatReportDateYmd()}`;
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

  /**
   * General report PDF — reuses the violations printable section because it already
   * contains: executive summary KPIs + dishes-by-branch chart + violations breakdown.
   * If the violations section is empty we fall back to the dish review print so the
   * user still gets a meaningful PDF for the "التقرير العام" button.
   */
  const printGeneralSummaryPdf = useCallback(() => {
    if (violationsReportStats.total > 0) {
      const el = document.getElementById("ska-violations-report-print");
      if (el && el.querySelector("tbody tr")) {
        document.body.classList.add("ska-print-violations-only");
        const prevTitle = document.title;
        document.title = `taeen-quality-general-report-${formatReportDateYmd()}`;
        const onAfterPrint = () => {
          document.body.classList.remove("ska-print-violations-only");
          document.title = prevTitle;
          window.removeEventListener("afterprint", onAfterPrint);
        };
        window.addEventListener("afterprint", onAfterPrint);
        setTimeout(() => window.print(), 100);
        return;
      }
    }
    if (reviewRecords.length) {
      printDishReviewReportPdf();
      return;
    }
    setToast({ type: "error", text: "لا توجد بيانات كافية لتوليد التقرير العام." });
  }, [
    violationsReportStats.total,
    reviewRecords.length,
    printDishReviewReportPdf,
    setToast,
  ]);

  /** Precompute alert counts + the top-10 slice once per `alertsList` change.
   *  Without this we walked the array three times per render of the dashboard
   *  (open count, resolved count, slice), which is hot under scroll inertia
   *  + 1Hz live monitoring updates. */
  const recentAlerts = useMemo(() => {
    if (!Array.isArray(alertsList) || alertsList.length === 0) {
      return { items: [], openCount: 0, resolvedCount: 0 };
    }
    let openCount = 0;
    let resolvedCount = 0;
    for (const a of alertsList) {
      const st = String(a.status || "").toLowerCase();
      if (st === "open") openCount += 1;
      else if (st === "resolved") resolvedCount += 1;
    }
    return { items: alertsList.slice(0, 10), openCount, resolvedCount };
  }, [alertsList]);

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
    if (!token) {
      setCameraCardsError("يرجى تسجيل الدخول لتحميل بيانات الكاميرات.");
      return;
    }
    setCameraCardsLoading(true);
    setCameraCardsError("");
    try {
      const res = await fetchWithTimeout(
        SUPERVISOR_CAMERAS_URL,
        { headers: { Authorization: `Bearer ${token}` } },
        DEFAULT_FETCH_TIMEOUT_MS,
      );
      const body = await res.json().catch(() => []);
      if (handleProtectedAuthFailure(res.status, body?.detail)) {
        setCameraCards([]);
        return;
      }
      if (!res.ok || !Array.isArray(body)) {
        setCameraCardsError(
          supervisorDataLoadErrorAr("بيانات الكاميرات", {
            status: res.status,
            apiStatus: apiConnectionStatus,
            detail: body?.detail,
          }) || "تعذر تحميل بيانات الكاميرات.",
        );
        setCameraCards([]);
        return;
      }
      markApiAlive();
      setApiConnectionStatus(API_STATUS.ONLINE);
      setCameraCards(body);
    } catch (err) {
      setCameraCards([]);
      const msg = supervisorDataLoadErrorAr("بيانات الكاميرات", {
        err,
        apiStatus: apiConnectionStatus,
      });
      setCameraCardsError(msg || "تعذر تحميل بيانات الكاميرات.");
      if (err?.code === "TIMEOUT") setApiConnectionStatus(API_STATUS.WAKING);
      else if (err instanceof TypeError) setApiConnectionStatus(API_STATUS.OFFLINE);
    } finally {
      setCameraCardsLoading(false);
    }
  }, [apiConnectionStatus, getAccessToken, handleProtectedAuthFailure, role]);

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
        setAlertsError(
          supervisorDataLoadErrorAr("التنبيهات", {
            status: res.status,
            apiStatus: apiConnectionStatus,
            detail: body?.detail,
          }) || "تعذر تحميل التنبيهات.",
        );
        setAlertsList([]);
        return;
      }
      markApiAlive();
      setApiConnectionStatus(API_STATUS.ONLINE);
      setAlertsList(body);
    } catch (err) {
      const msg = supervisorDataLoadErrorAr("التنبيهات", { err, apiStatus: apiConnectionStatus });
      setAlertsError(msg || "تعذر تحميل التنبيهات.");
      setAlertsList([]);
      if (err?.code === "TIMEOUT") setApiConnectionStatus(API_STATUS.WAKING);
      else if (err instanceof TypeError) setApiConnectionStatus(API_STATUS.OFFLINE);
    } finally {
      setAlertsLoading(false);
    }
  }, [apiConnectionStatus, getAccessToken, handleProtectedAuthFailure, role]);

  const loadAiStatus = useCallback(async () => {
    if (!(role === "supervisor" || role === "admin")) return;
    const token = getAccessToken();
    if (!token) return;
    setAiStatusLoading(true);
    try {
      const res = await fetchWithTimeout(
        AI_STATUS_URL,
        { headers: { Authorization: `Bearer ${token}` } },
        DEFAULT_FETCH_TIMEOUT_MS,
      );
      const body = await res.json().catch(() => null);
      if (handleProtectedAuthFailure(res.status, body?.detail)) {
        setAiStatus(null);
        return;
      }
      if (res.ok && body && Array.isArray(body.models)) {
        markApiAlive();
        setApiConnectionStatus(API_STATUS.ONLINE);
        setAiStatus(body);
      } else if (!res.ok) {
        setAiStatus(null);
      }
    } catch (err) {
      setAiStatus(null);
      if (err?.code === "TIMEOUT") setApiConnectionStatus(API_STATUS.WAKING);
      else if (err instanceof TypeError) setApiConnectionStatus(API_STATUS.OFFLINE);
    } finally {
      setAiStatusLoading(false);
    }
  }, [getAccessToken, handleProtectedAuthFailure, role]);

  /**
   * Trigger background YOLO warmup so the first analyze-frame is fast
   * (avoids the 60–180s cold-start timeout the user was seeing).
   */
  const triggerAiWarmup = useCallback(async () => {
    if (!(role === "supervisor" || role === "admin")) return;
    const token = getAccessToken();
    if (!token) return;
    try {
      const res = await fetchWithTimeout(
        AI_WARMUP_URL,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        DEFAULT_FETCH_TIMEOUT_MS,
      );
      const body = await res.json().catch(() => ({}));
      if (res.ok && typeof body?.status === "string") {
        setAiWarmupStatus(body.status);
      }
    } catch {
      /* warmup is best-effort — first analyze will still trigger lazy load */
    }
  }, [getAccessToken, role]);

  const pollAiWarmup = useCallback(async () => {
    if (!(role === "supervisor" || role === "admin")) return null;
    const token = getAccessToken();
    if (!token) return null;
    try {
      const res = await fetchWithTimeout(
        AI_WARMUP_URL,
        { headers: { Authorization: `Bearer ${token}` } },
        DEFAULT_FETCH_TIMEOUT_MS,
      );
      const body = await res.json().catch(() => null);
      if (res.ok && body?.status) {
        setAiWarmupStatus(body.status);
        return body.status;
      }
    } catch {
      /* ignore */
    }
    return null;
  }, [getAccessToken, role]);

  const markAlertUnderReview = useCallback(
    async (alertId) => {
      const token = getAccessToken();
      if (!token) return;
      setAlertUnderReviewLoadingId(alertId);
      try {
        const res = await fetchWithTimeout(
          SUPERVISOR_ALERT_STATUS_URL(alertId),
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ status: "under_review" }),
          },
          DEFAULT_FETCH_TIMEOUT_MS,
        );
        if (res.ok) {
          await loadSupervisorAlerts();
          setToast({ type: "success", text: "تم وضع التنبيه تحت المراجعة." });
        } else {
          const body = await res.json().catch(() => ({}));
          setToast({ type: "error", text: body?.detail || "تعذر تحديث حالة التنبيه." });
        }
      } catch {
        setToast({ type: "error", text: "خطأ في الاتصال." });
      } finally {
        setAlertUnderReviewLoadingId(null);
      }
    },
    [getAccessToken, loadSupervisorAlerts, setToast],
  );

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
    if (!(role === "supervisor" || role === "admin")) return;
    void loadAiStatus();
    // Kick off background YOLO warmup so the first analyze-frame is fast.
    void triggerAiWarmup();
  }, [role, loadAiStatus, triggerAiWarmup]);

  // Poll warmup endpoint while loading, stop once ready or failed.
  useEffect(() => {
    if (!(role === "supervisor" || role === "admin")) return undefined;
    if (aiWarmupStatus !== "loading") {
      if (aiWarmupPollRef.current != null) {
        clearInterval(aiWarmupPollRef.current);
        aiWarmupPollRef.current = null;
      }
      return undefined;
    }
    const id = window.setInterval(() => {
      void pollAiWarmup();
    }, 5000);
    aiWarmupPollRef.current = id;
    return () => {
      clearInterval(id);
      aiWarmupPollRef.current = null;
    };
  }, [role, aiWarmupStatus, pollAiWarmup]);

  // When warmup transitions to ready, refresh AI status and clear stale "loading model" error.
  useEffect(() => {
    if (aiWarmupStatus === "ready") {
      void loadAiStatus();
      setLiveAnalysisError("");
    }
  }, [aiWarmupStatus, loadAiStatus]);

  useEffect(() => {
    if (!(role === "supervisor" || role === "admin")) {
      setApiConnectionStatus(API_STATUS.CHECKING);
      return undefined;
    }
    let cancelled = false;
    setApiConnectionStatus(API_STATUS.CHECKING);
    (async () => {
      const result = await probeApiHealth();
      if (cancelled) return;
      setApiConnectionStatus(result.status);
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
      // Wake /health before analyze (live mode too — Render may sleep between ticks).
      await wakeApiBeforeAuth();

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
    if (!video || video.readyState < 2) {
      console.log("[YOLO Live] video not ready, readyState=", video?.readyState ?? "no-ref");
      return;
    }
    if (liveAnalysisInFlightRef.current) return;
    const gen = liveGenRef.current;
    const token = getAccessToken();
    if (!token) return;

    liveAnalysisInFlightRef.current = true;
    setLiveTickBusy(true);
    try {
      const blob = await captureLiveMonitoringBlob(video);
      console.log("[YOLO Live] blob captured:", blob ? `${blob.size}B` : "null (capture failed)");
      if (!blob || gen !== liveGenRef.current) return;
      const file = new File([blob], `live-${Date.now()}.jpg`, { type: "image/jpeg" });
      const { ok, status, body } = await callAnalyzeFrameEndpoint(file, token, { analysisMode: "live" });
      console.log("[YOLO Live] response status=%d ok=%s body_status=%s violations=%d quality_pct=%s",
        status, ok, body?.status, body?.violations?.length ?? "?", body?.quality_pct ?? "?");
      if (gen !== liveGenRef.current) return;
      if (handleProtectedAuthFailure(status, body?.detail)) return;
      if (isMonitoringSkippedResponse(status, body)) {
        console.log("[YOLO Live] skipped_busy — YOLO still running previous frame, will retry");
        return;
      }
      if (!isMonitoringAnalyzeSuccess(status, body)) {
        const errDetail = typeof body?.detail === "string" && body.detail.trim() ? body.detail : null;
        // 503 with "نموذج" / "تحميل" or our timeout sentinel → cold-start, not a hard failure.
        const looksLikeColdStart =
          status === 503 ||
          (typeof errDetail === "string" &&
            (errDetail.includes("نموذج") ||
              errDetail.includes("تحميل") ||
              errDetail.includes("مهلة")));
        if (looksLikeColdStart) {
          setAiWarmupStatus("loading");
          void triggerAiWarmup();
          setLiveAnalysisError(
            "نموذج التحليل يُحمَّل لأول مرة بعد إقلاع الخادم — قد يستغرق دقيقة. التحليل سيستأنف تلقائياً.",
          );
          return;
        }
        const msg = errDetail || `فشل التحليل التلقائي (${status || "—"}).`;
        console.log("[YOLO Live] analysis failed:", msg);
        setLiveAnalysisError(msg);
        return;
      }
      setLiveAnalysisError("");
      console.log("[YOLO Live] ✓ result received — violations:", body?.violations?.length ?? 0,
        "quality:", body?.quality_pct ?? "n/a", "status:", body?.overall_status ?? "n/a");

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
        // Cold-start: model still downloading. Trigger warmup poll, show friendly state.
        if (err?.code === "TIMEOUT") {
          setAiWarmupStatus("loading");
          void triggerAiWarmup();
          setLiveAnalysisError(
            "نموذج التحليل يُحمَّل لأول مرة بعد إقلاع الخادم — قد يستغرق دقيقة. التحليل سيستأنف تلقائياً.",
          );
        } else {
          const msg = formatMonitoringFetchError(err, "تعذر إكمال التحليل التلقائي.");
          setLiveAnalysisError(msg);
        }
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
    triggerAiWarmup,
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
      const { status, body } = await callAnalyzeFrameEndpoint(file, token, { analysisMode: "manual" });
      if (handleProtectedAuthFailure(status, body?.detail)) return;
      if (!isMonitoringAnalyzeSuccess(status, body)) {
        const errDetail = typeof body?.detail === "string" && body.detail.trim() ? body.detail : null;
        const looksLikeColdStart =
          status === 503 ||
          (typeof errDetail === "string" &&
            (errDetail.includes("نموذج") || errDetail.includes("تحميل") || errDetail.includes("مهلة")));
        if (looksLikeColdStart) {
          setAiWarmupStatus("loading");
          void triggerAiWarmup();
          setToast({
            type: "info",
            text: "نموذج التحليل يُحمَّل لأول مرة بعد إقلاع الخادم — حاول مرة أخرى بعد دقيقة.",
          });
          return;
        }
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
      if (err?.code === "TIMEOUT") {
        setAiWarmupStatus("loading");
        void triggerAiWarmup();
        setToast({
          type: "info",
          text: "نموذج التحليل يُحمَّل لأول مرة بعد إقلاع الخادم — حاول مرة أخرى بعد دقيقة.",
        });
      } else {
        setToast({
          type: "error",
          text: formatMonitoringFetchError(err, "تعذر التقاط أو تحليل الصورة من الكاميرا."),
        });
      }
    } finally {
      setMonitoringWebcamBusy(false);
      setMonitoringAnalyzeLoading(false);
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
      // Embed user:pass into the RTSP/HTTP URL if both are present. This keeps the
      // backend schema unchanged (single stream_url field) while letting the operator
      // enter credentials in a clean UI.
      let streamUrl = (newCameraForm.stream_url || "").trim() || null;
      const u = (newCameraForm.username || "").trim();
      const p = (newCameraForm.password || "").trim();
      if (streamUrl && u) {
        try {
          const url = new URL(streamUrl);
          url.username = u;
          if (p) url.password = p;
          streamUrl = url.toString();
        } catch {
          // Fallback: best-effort string injection if URL parser fails (e.g. plain "192.168...").
          if (streamUrl.includes("://")) {
            const [proto, rest] = streamUrl.split("://", 2);
            streamUrl = `${proto}://${u}${p ? `:${p}` : ""}@${rest}`;
          }
        }
      }
      const res = await fetch(SUPERVISOR_CAMERAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: newCameraForm.name.trim(),
          location: newCameraForm.location.trim(),
          stream_url: streamUrl,
          is_connected: true,
          ai_enabled: true,
        }),
      });
      if (!res.ok) {
        setToast({ type: "error", text: "تعذر إضافة الكاميرا." });
        return;
      }
      const sec = assessCameraStreamUrl(streamUrl, { username: u, password: p });
      setNewCameraForm({ name: "", location: "", stream_url: "", username: "", password: "" });
      if (sec.security_status === CAMERA_SECURITY.DANGER) {
        setToast({
          type: "error",
          text: `تم حفظ الكاميرا — حالة أمان: خطر. ${sec.security_warnings[0] || "راجع إعدادات الشبكة."}`,
        });
      } else if (sec.security_status === CAMERA_SECURITY.REVIEW) {
        setToast({
          type: "success",
          text: `تمت إضافة الكاميرا (أمان: يحتاج مراجعة). ${sec.security_warnings[0] || ""}`,
        });
      } else {
        setToast({ type: "success", text: "تمت إضافة الكاميرا. سيتم تفعيل كل فحوصات السلامة تلقائياً." });
      }
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
    async (zoneId, draft) => {
      const zone = MONITORING_ZONE_DEFINITIONS.find((z) => z.id === zoneId);
      const errs = validateRestaurantCameraDraft(draft);
      if (errs.length) {
        setToast({ type: "error", text: errs[0] });
        return;
      }
      const token = getAccessToken?.();
      if (!token) {
        setToast({ type: "error", text: "يجب تسجيل الدخول لحفظ إعدادات الكاميرا." });
        return;
      }
      setCameraSetupBusy((b) => ({ ...b, save: zoneId }));
      try {
        const body = draftToApiUpsert(draft, restaurantCamConfigs[zoneId], zone?.displayNameAr || "");
        const saved = await upsertZoneConfig(token, zoneId, body);
        const stored = apiZoneToStored(saved);
        setRestaurantCamConfigs((prev) => ({ ...prev, [zoneId]: stored }));
        setToast({ type: "success", text: "تم حفظ إعدادات الكاميرا على الخادم." });
      } catch {
        setToast({ type: "error", text: "تعذر حفظ إعدادات الكاميرا." });
      } finally {
        setCameraSetupBusy((b) => ({ ...b, save: null }));
      }
    },
    [getAccessToken, restaurantCamConfigs, setToast],
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

        const token = getAccessToken?.();
        if (token) {
          try {
            const saved = await patchZoneConnectionTest(token, zoneId, {
              ok,
              tested_at: nowIso,
            });
            const stored = apiZoneToStored(saved);
            setRestaurantCamConfigs((prev) => ({ ...prev, [zoneId]: stored }));
          } catch {
            setRestaurantCamConfigs((prev) => {
              const defaults = mergeRestaurantCameraDefaults(MONITORING_ZONE_DEFINITIONS, prev);
              const base = defaults[zoneId];
              const updated = { ...base, lastConnectionTestAt: nowIso, lastConnectionTestOk: ok };
              return { ...prev, [zoneId]: updated };
            });
          }
        } else {
          setRestaurantCamConfigs((prev) => {
            const defaults = mergeRestaurantCameraDefaults(MONITORING_ZONE_DEFINITIONS, prev);
            const base = defaults[zoneId];
            const updated = { ...base, lastConnectionTestAt: nowIso, lastConnectionTestOk: ok };
            return { ...prev, [zoneId]: updated };
          });
        }

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
    [getAccessToken, setToast],
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
        setToast({ type: "info", text: "رفع ملفات الفيديو غير متاح في وضع المراقبة المباشرة." });
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
        onBeforeSectionNav={lockSectionNavForScroll}
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
            livePersonsCount={
              monitoringWebcamOn && monitoringAnalysisResult != null
                ? (typeof monitoringAnalysisResult.people_count === "number"
                    ? monitoringAnalysisResult.people_count
                    : null)
                : null
            }
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

            {/* AI Violation Detection Result Modal */}
            {detectResultModal && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
                onClick={() => setDetectResultModal(null)}
              >
                <div
                  className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/15 bg-[#0a1020] p-5 shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white" dir="rtl">
                      نتيجة الكشف:{" "}
                      {detectResultModal.violationType === "no_gloves" ? "القفازات" : "غطاء الرأس"}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setDetectResultModal(null)}
                      className="text-slate-400 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>

                  <div
                    className={`mb-3 rounded-xl border px-4 py-2.5 text-sm font-bold ${
                      detectResultModal.violation_detected
                        ? "border-red-500/50 bg-red-900/30 text-red-300"
                        : "border-emerald-500/50 bg-emerald-900/30 text-emerald-300"
                    }`}
                    dir="rtl"
                  >
                    {detectResultModal.violation_detected ? "⚠️ مخالفة" : "✅ ملتزم"}
                    <span className="ml-2 text-xs font-normal text-slate-300">
                      — {detectResultModal.status_message}
                    </span>
                  </div>

                  {detectResultModal.annotated_image && (
                    <img
                      src={`data:image/jpeg;base64,${detectResultModal.annotated_image}`}
                      alt="annotated"
                      className="mb-3 w-full rounded-xl"
                    />
                  )}

                  <div className="flex gap-3 text-xs text-slate-400" dir="rtl">
                    <span>
                      إجمالي الكشوف: <strong className="text-white">{detectResultModal.detection_count}</strong>
                    </span>
                    <span>
                      ثقة:{" "}
                      <strong className="text-white">{detectResultModal.confidence}%</strong>
                    </span>
                    {detectResultModal.alert_id && (
                      <span className="text-amber-300">
                        رقم التنبيه: #{detectResultModal.alert_id}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
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
              className={`dashboard-section-cv ${SECTION_THEME.quality} mb-10 scroll-mt-28 space-y-8 sm:scroll-mt-32`}
            >
              <div className="border-b border-white/10 pb-4">
                <h3 className="text-lg font-bold tracking-tight text-white">مؤشرات الأداء والتحليلات</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{PLATFORM_BRAND.taglineAr}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
              {supervisorCards.map((m) => (
                <article
                  key={m.label}
                  className={`${glassCard} relative overflow-hidden p-5`}
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
                <LazyWhenVisible minHeight={256}>
                  <SupervisorAnalyticsRecharts loading={supervisorSummaryLoading} supervisorSummary={supervisorSummary} />
                </LazyWhenVisible>
                <LazyWhenVisible minHeight={256}>
                  <SupervisorAnalyticsBars loading={supervisorSummaryLoading} supervisorSummary={supervisorSummary} />
                </LazyWhenVisible>
              </div>
            </section>

            {/* ── آخر 10 مخالفات — recent violations widget with evidence thumbnails ── */}
            {recentAlerts.items.length > 0 && (
              <div className="mb-6 rounded-xl border border-white/10 bg-[#060d1f]/80 overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/[0.07]">
                  <p className="text-xs font-semibold text-slate-200">
                    آخر 10 مخالفات
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                      {recentAlerts.openCount} مفتوحة
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {recentAlerts.resolvedCount} مُعالَجة
                    </span>
                  </div>
                </div>
                <ul className="divide-y divide-white/[0.04]">
                  {recentAlerts.items.map((a) => {
                    const typeLabel =
                      String(a.label_ar || "").trim() ||
                      getViolationLabel(canonicalMonitoringViolationType(a.type));
                    const st = String(a.status || "").toLowerCase();
                    const dotCls =
                      st === "resolved" ? "bg-emerald-500"
                      : st === "under_review" ? "bg-amber-500"
                      : "bg-red-500";
                    const evidence = a.image_data_url || a.evidence_image || a.snapshot || "";
                    return (
                      <li key={a.id} className="flex items-center gap-3 px-4 py-2">
                        {/* Evidence thumbnail (image of the violation) */}
                        {evidence ? (
                          <img
                            src={evidence}
                            alt="دليل المخالفة"
                            className="h-9 w-12 shrink-0 rounded-md border border-white/10 object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-9 w-12 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-[9px] text-slate-600">
                            بدون صورة
                          </div>
                        )}
                        <span className={`h-2 w-2 shrink-0 rounded-full ${dotCls}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11px] font-semibold text-slate-200">{typeLabel}</p>
                          <p className="mt-0.5 truncate text-[10px] text-slate-500">
                            {a.camera_name || "—"} · {a.location || a.branch_name || "—"}
                          </p>
                        </div>
                        <span className="shrink-0 text-[10px] text-slate-500" dir="ltr">
                          {formatSaudiDateTime(a.created_at)}
                        </span>
                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${alertWorkflowBadgeClass(a.status)}`}>
                          {monitoringAlertStatusAr(a.status)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <section
              id="alerts"
              ref={supervisorAlertsRef}
              className={`dashboard-section-cv ${SECTION_THEME.alerts} mb-8 scroll-mt-28 sm:scroll-mt-32`}
            >
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
                <h3 className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
                  <IconBell className="h-5 w-5 text-accent-amber" />
                  سجل التنبيهات الأمنية
                </h3>
                <div className="flex items-center gap-2">
                  {!alertsLoading && alertsList.length > 0 ? (
                    <p className="text-xs tabular-nums text-slate-500">{alertsList.length} تنبيه</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void loadSupervisorAlerts()}
                    className="rounded-lg border border-white/15 bg-[#0B1327]/60 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:bg-[#0B1327]/90 disabled:opacity-50"
                    disabled={alertsLoading}
                  >
                    {alertsLoading ? "جاري…" : "تحديث"}
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="mb-4 flex flex-wrap gap-2">
                {[
                  { key: "all", label: "الكل" },
                  { key: "open", label: "مفتوح" },
                  { key: "under_review", label: "تحت المراجعة" },
                  { key: "resolved", label: "تمت المعالجة" },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAlertStatusFilter(key)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      alertStatusFilter === key
                        ? "border-brand-sky/45 bg-brand/20 text-sky-100"
                        : "border-white/15 bg-[#0B1327]/60 text-slate-300 hover:border-white/25"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <select
                  value={alertTypeFilter}
                  onChange={(e) => setAlertTypeFilter(e.target.value)}
                  className="rounded-full border border-white/15 bg-[#0B1327]/60 px-3 py-1.5 text-xs font-semibold text-slate-300 focus:outline-none"
                >
                  <option value="all">كل الأنواع</option>
                  <option value="no_gloves">القفازات</option>
                  <option value="no_headcover">غطاء الرأس</option>
                  <option value="no_mask">الكمامة</option>
                  <option value="no_uniform">الزي الرسمي</option>
                </select>
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
              ) : (() => {
                const filtered = alertsList.filter((a) => {
                  const st = String(a?.status || "").toLowerCase();
                  const typ = String(a?.type || "").toLowerCase();
                  if (alertStatusFilter !== "all" && st !== alertStatusFilter) return false;
                  if (alertTypeFilter !== "all" && !typ.includes(alertTypeFilter)) return false;
                  return true;
                });
                if (filtered.length === 0) {
                  return (
                    <EmptyState
                      icon={alertStatusFilter !== "all" || alertTypeFilter !== "all" ? "🔍" : "🎉"}
                      title={alertStatusFilter !== "all" || alertTypeFilter !== "all" ? "لا توجد تنبيهات بهذه الفلاتر" : "لا توجد تنبيهات حالية"}
                      hint="عند ظهور مخالفات من المراقبة ستُعرض هنا مع حالة المعالجة والثقة."
                    />
                  );
                }
                return (
                  <ExpandMoreList initialVisible={6} listClassName="flex flex-col gap-2">
                    {filtered.map((a) => {
                      const sev = alertSeverityBadgeMeta(a.confidence);
                      const typeLabel =
                        String(a.label_ar || "").trim() ||
                        getViolationLabel(canonicalMonitoringViolationType(a.type));
                      const st = String(a?.status || "").toLowerCase();
                      const canResolve = st === "open" || st === "new";
                      const canMarkReview = st === "open" || st === "new";
                      const evidenceExpanded = evidenceAlertId === a.id;
                      const evidenceUrl = a.image_data_url || a.annotated_image_url || a.snapshot_url;
                      return (
                        <article
                          key={a.id}
                          className={`group rounded-xl border bg-[#0B1327]/80 text-start transition duration-200 hover:bg-[#0c162e]/92 ${alertWorkflowCardRing(a.status)}`}
                        >
                          {/* Compact card header */}
                          <div className="flex items-start gap-3 px-4 pt-3 pb-2">
                            {/* Severity color strip */}
                            <div className={`mt-0.5 h-full w-1 shrink-0 self-stretch rounded-full ${
                              sev.label === "خطورة عالية" ? "bg-red-500" : sev.label === "تحذير" ? "bg-amber-500" : "bg-sky-500"
                            }`} />
                            <div className="min-w-0 flex-1">
                              {/* Violation type + status row */}
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-[13px] font-semibold leading-tight text-slate-100">
                                  {typeLabel}
                                </p>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${alertWorkflowBadgeClass(a.status)}`}>
                                  {monitoringAlertStatusAr(a.status)}
                                </span>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sev.cls}`}>
                                  {displayAiConfidence(a.confidence)}
                                </span>
                              </div>
                              {/* Meta: camera, location, time */}
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                                {a.camera_name && (
                                  <span className="flex items-center gap-0.5">
                                    <span>📷</span>
                                    <span className="text-slate-400">{a.camera_name}</span>
                                  </span>
                                )}
                                {(a.branch_name || a.location) && (
                                  <span className="flex items-center gap-0.5">
                                    <span>📍</span>
                                    <span>{a.branch_name || a.location}</span>
                                  </span>
                                )}
                                <span dir="ltr" className="text-slate-600">{formatSaudiDateTime(a.created_at)}</span>
                              </div>
                              {/* Reason */}
                              {a.details && a.details !== "—" && (
                                <p className="mt-1 text-[10px] leading-snug text-slate-600 line-clamp-2">{a.details}</p>
                              )}
                            </div>
                          </div>
                          {/* Quick action buttons */}
                          <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.05] px-4 py-2">
                            {canMarkReview && (
                              <button
                                type="button"
                                disabled={alertUnderReviewLoadingId === a.id}
                                onClick={() => void markAlertUnderReview(a.id)}
                                className="rounded-md border border-amber-500/35 bg-amber-500/8 px-2.5 py-1 text-[10px] font-semibold text-amber-300 transition hover:bg-amber-500/14 disabled:opacity-50"
                              >
                                {alertUnderReviewLoadingId === a.id ? "…" : "قيد المراجعة"}
                              </button>
                            )}
                            {canResolve && (
                              <button
                                type="button"
                                disabled={monitoringResolveLoadingId === a.id}
                                onClick={() => void resolveMonitoringAlert(a.id)}
                                className="rounded-md border border-emerald-500/35 bg-emerald-500/8 px-2.5 py-1 text-[10px] font-semibold text-emerald-300 transition hover:bg-emerald-500/14 disabled:opacity-50"
                              >
                                {monitoringResolveLoadingId === a.id ? "…" : "تمّت المعالجة"}
                              </button>
                            )}
                            {evidenceUrl && (
                              <button
                                type="button"
                                onClick={() => setEvidenceAlertId(evidenceExpanded ? null : a.id)}
                                className="mr-auto rounded-md border border-sky-500/30 bg-sky-500/8 px-2.5 py-1 text-[10px] font-semibold text-sky-300 transition hover:bg-sky-500/14"
                              >
                                {evidenceExpanded ? "إخفاء" : "🖼 دليل"}
                              </button>
                            )}
                          </div>
                          {/* Evidence image */}
                          {evidenceExpanded && evidenceUrl && (
                            <div className="border-t border-white/[0.05] px-4 pb-3 pt-2">
                              <img
                                src={evidenceUrl}
                                alt="صورة دليل المخالفة"
                                className="max-h-56 w-full rounded-lg object-contain"
                              />
                              {a.resolved_by && (
                                <p className="mt-1.5 text-[10px] text-slate-600">
                                  معالَج بواسطة: <span className="text-slate-400">{a.resolved_by}</span>
                                </p>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </ExpandMoreList>
                );
              })()}
            </section>

            <section
              id="cameras"
              ref={supervisorCamerasRef}
              className={`dashboard-section-cv ${SECTION_THEME.cameras} mb-8 scroll-mt-28 overflow-hidden !p-0 sm:scroll-mt-32`}
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

              {/* System readiness panel — supervisor-friendly, no technical model names */}
              <div className="border-b border-white/10 bg-[#050e1f]/80 px-4 py-4 sm:px-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    حالة نظام المراقبة
                  </p>
                  {aiStatusLoading ? (
                    <Spinner className="h-4 w-4 border-2 border-white/15 border-t-sky-400" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => void loadAiStatus()}
                      className="text-[10px] text-slate-500 underline hover:text-slate-300"
                    >
                      تحديث
                    </button>
                  )}
                </div>
                {aiStatus ? (
                  (() => {
                    const monitorReady = !!aiStatus.monitoring_model_ready;
                    const personReady = !!aiStatus.person_detector_ready;
                    const systemReady = monitorReady && personReady;
                    const statusLabel = systemReady
                      ? "نظام المراقبة جاهز للعمل"
                      : monitorReady
                      ? "النظام يعمل بإمكانات محدودة"
                      : "النظام غير جاهز للمراقبة المباشرة";
                    const statusColor = systemReady
                      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                      : monitorReady
                      ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                      : "border-red-500/30 bg-red-500/10 text-red-300";
                    const dotColor = systemReady
                      ? "bg-emerald-400"
                      : monitorReady
                      ? "bg-amber-400"
                      : "bg-red-500";

                    const checks = [
                      { label: "رصد العاملين أمام الكاميرا",        ready: personReady },
                      { label: "فحص الكمامة وغطاء الرأس والقفازات", ready: monitorReady },
                      { label: "فحص الزي الرسمي",                   ready: monitorReady },
                      { label: "تنبيهات تلقائية فورية",             ready: monitorReady },
                    ];

                    return (
                      <div className="space-y-3">
                        <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${statusColor}`}>
                          <span className={`h-2 w-2 rounded-full ${dotColor} ${systemReady ? "" : "animate-pulse"}`} />
                          {statusLabel}
                        </div>
                        <ul className="grid gap-1.5 sm:grid-cols-2">
                          {checks.map((c, i) => (
                            <li
                              key={i}
                              className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-[11px] text-slate-300"
                            >
                              <span
                                className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                                  c.ready
                                    ? "bg-emerald-500/15 text-emerald-300"
                                    : "bg-slate-600/30 text-slate-500"
                                }`}
                              >
                                {c.ready ? "✓" : "—"}
                              </span>
                              <span className={c.ready ? "text-slate-200" : "text-slate-500"}>{c.label}</span>
                            </li>
                          ))}
                        </ul>
                        {!systemReady && (
                          <p className="text-[11px] leading-relaxed text-amber-300/90">
                            {monitorReady
                              ? "بعض الميزات قد لا تعمل بكامل الدقة. تواصل مع مسؤول النظام للتفعيل الكامل."
                              : "تواصل مع مسؤول النظام لإكمال إعداد المراقبة المباشرة."}
                          </p>
                        )}
                      </div>
                    );
                  })()
                ) : aiStatusLoading ? null : (
                  <p className="text-[11px] text-slate-600">
                    {apiConnectionStatus === API_STATUS.ONLINE
                      ? "تعذر التحقق من حالة النظام — أعد المحاولة."
                      : apiStatusLabelAr(apiConnectionStatus)}
                    {apiConnectionStatus !== API_STATUS.ONLINE ? (
                      <span className="mt-1 block text-slate-500">
                        يمكن تشغيل معاينة الكاميرا محلياً؛ التحليل الذكي يتطلب اتصال الخادم.
                      </span>
                    ) : null}
                  </p>
                )}
                {aiWarmupStatus === "loading" ? (
                  <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-100">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                    جاري تحميل نموذج التحليل لأول مرة — قد يستغرق دقيقة. التحليل التلقائي سيستأنف فور انتهاء التحميل.
                  </p>
                ) : aiWarmupStatus === "failed" ? (
                  <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200">
                    تعذر تحميل نموذج التحليل — يرجى تحديث الصفحة أو التواصل مع المسؤول.
                  </p>
                ) : null}
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
                      testBusy={cameraSetupBusy.test === zone.id}
                      saveBusy={cameraSetupBusy.save === zone.id}
                    />
                  );
                })}
              </div>

              <div className="flex flex-col gap-6 px-4 pb-6 pt-5 sm:px-6">
                {/* Clean, enterprise-style add-camera form. All AI checks are auto-enabled
                    on the backend — no per-camera toggles for the supervisor. */}
                <div className="rounded-2xl border border-sky-500/15 bg-gradient-to-br from-[#0a1525]/80 to-[#060d1f]/80 p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">إضافة كاميرا جديدة</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                        كل كاميرا تُضاف هنا تُفعَّل عليها جميع فحوصات السلامة تلقائياً: الكمامة، القفازات، غطاء الرأس، الزي الرسمي، الأرضية المبللة، النفايات.
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      تلقائي
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-[11px] text-slate-400">
                      اسم الكاميرا
                      <input
                        type="text"
                        placeholder="مثال: كاميرا التحضير 1"
                        value={newCameraForm.name}
                        onChange={(e) => setNewCameraForm((f) => ({ ...f, name: e.target.value }))}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-[#0B1327]/80 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                      />
                    </label>
                    <label className="text-[11px] text-slate-400">
                      الموقع / المنطقة
                      <input
                        type="text"
                        placeholder="مثال: المطبخ الرئيسي"
                        value={newCameraForm.location}
                        onChange={(e) => setNewCameraForm((f) => ({ ...f, location: e.target.value }))}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-[#0B1327]/80 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                      />
                    </label>
                    <label className="text-[11px] text-slate-400 sm:col-span-2">
                      رابط البث (RTSP أو IP)
                      <input
                        type="text"
                        placeholder="rtsp://192.168.1.10:554/Streaming/Channels/101"
                        value={newCameraForm.stream_url}
                        onChange={(e) => setNewCameraForm((f) => ({ ...f, stream_url: e.target.value }))}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-[#0B1327]/80 px-3 py-2 font-mono text-xs text-white outline-none focus:border-sky-400/40"
                        dir="ltr"
                      />
                    </label>
                    <label className="text-[11px] text-slate-400">
                      اسم المستخدم (اختياري)
                      <input
                        type="text"
                        placeholder="admin"
                        value={newCameraForm.username}
                        onChange={(e) => setNewCameraForm((f) => ({ ...f, username: e.target.value }))}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-[#0B1327]/80 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                        dir="ltr"
                        autoComplete="off"
                      />
                    </label>
                    <label className="text-[11px] text-slate-400">
                      كلمة المرور (اختياري)
                      <input
                        type="password"
                        placeholder="••••••••"
                        value={newCameraForm.password}
                        onChange={(e) => setNewCameraForm((f) => ({ ...f, password: e.target.value }))}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-[#0B1327]/80 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                        dir="ltr"
                        autoComplete="off"
                      />
                    </label>
                  </div>
                  {newCameraSecurityAssess.security_warnings?.length > 0 ? (
                    <div
                      className={`mt-3 space-y-1 rounded-xl border px-3 py-2 text-[11px] ${securityStatusBadgeClass(
                        newCameraSecurityAssess.security_status,
                      )}`}
                    >
                      <p className="font-bold">
                        أمان الشبكة: {newCameraSecurityAssess.security_status_ar}
                      </p>
                      <ul className="list-inside list-disc opacity-95">
                        {newCameraSecurityAssess.security_warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                      <p className="text-[10px] opacity-80">
                        الكاميرات يجب أن تبقى داخل شبكة المطعم المحلية — لا تفتح RTSP على الإنترنت العام.
                      </p>
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] text-slate-600">
                      يمكنك ترك رابط البث فارغاً لإنشاء سجل الكاميرا قبل ربطها بالخادم. راجع{" "}
                      <span className="text-sky-400/90">docs/CAMERA_SECURITY_AR.md</span> لفريق IT.
                    </p>
                    <button
                      type="button"
                      onClick={() => void addSupervisorCamera()}
                      disabled={!newCameraForm.name.trim() || !newCameraForm.location.trim()}
                      className="rounded-xl border border-sky-500/40 bg-sky-500/15 px-5 py-2 text-xs font-semibold text-sky-100 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      إضافة الكاميرا
                    </button>
                  </div>
                </div>

                <div
                  ref={supervisorMonitoringAiRef}
                  id="supervisor-monitoring-ai"
                  className="rounded-xl border border-white/10 bg-[#060d1f]/50 p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">مراقبة السلامة المباشرة</p>
                    <span
                      title="هذه واجهة لاختبار النموذج باستخدام كاميرا اللابتوب. الإنتاج النهائي يعتمد على كاميرات المراقبة (CCTV)."
                      className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      وضع الاختبار — كاميرا الجهاز
                    </span>
                  </div>
                  <p className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-200/80">
                    قسم كاميرا الجهاز يُستخدم لاختبار وظائف الذكاء الاصطناعي فقط. المراقبة الإنتاجية تعمل عبر كاميرات المراقبة المتصلة من قسم «الكاميرات» أعلاه.
                  </p>
                  <label className="mb-1 block text-xs text-slate-500">منطقة المراقبة</label>
                  <select
                    value={selectedMonitoringZoneId}
                    onChange={(e) => setSelectedMonitoringZoneId(e.target.value)}
                    className="mb-3 w-full max-w-md rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-white"
                  >
                    {MONITORING_ZONE_DEFINITIONS.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.zoneAr} · {z.camCode}
                      </option>
                    ))}
                  </select>
                  <label className="mb-1 block text-xs text-slate-500">الكاميرا المرتبطة</label>
                  <select
                    value={monitoringCameraSelectId}
                    onChange={(e) => setMonitoringCameraSelectId(e.target.value)}
                    className="mb-4 w-full max-w-md rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-white"
                  >
                    <option value="">بدون ربط بكاميرا</option>
                    {cameraCards.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name} — {c.location}
                      </option>
                    ))}
                  </select>
                  <div className="rounded-xl border border-emerald-500/25 bg-[#041014]/80 p-4">
                    <p className="mb-3 text-sm font-semibold text-emerald-100">الكاميرا المباشرة</p>
                    <LiveMonitoringZoneCards
                      zones={MONITORING_ZONE_DEFINITIONS}
                      selectedZoneId={selectedMonitoringZoneId}
                      onSelectZone={(id) => setSelectedMonitoringZoneId(id)}
                      slotStates={liveSlotStates}
                      previewRefs={[livePrevKitchenRef, livePrevStorageRef, livePrevPrepRef]}
                      liveAutoOn={monitoringLiveAutoOn}
                      liveTickBusy={liveTickBusy}
                    />
                    <p className="mb-2 mt-3 text-[11px] text-slate-500">
                      المنطقة النشطة:{" "}
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
                        بدء المراقبة التلقائية
                      </button>
                      <button
                        type="button"
                        disabled={!monitoringLiveAutoOn}
                        onClick={() => resetLiveAnalysisState({ stopAuto: true })}
                        className="rounded-xl border border-white/20 bg-[#0B1327]/80 px-4 py-2 text-xs font-semibold text-slate-300 disabled:opacity-40"
                      >
                        إيقاف المراقبة
                      </button>
                      <button
                        type="button"
                        disabled={!monitoringWebcamOn || monitoringWebcamBusy || monitoringAnalyzeLoading}
                        onClick={() => void analyzeMonitoringWebcamFrame()}
                        className="rounded-xl border border-brand-sky/40 bg-brand/15 px-4 py-2 text-xs font-semibold text-brand-sky disabled:opacity-50"
                      >
                        {monitoringWebcamBusy || monitoringAnalyzeLoading ? "جاري التحليل…" : "تحليل فوري"}
                      </button>
                      {(liveTickBusy || liveAnalysisError || monitoringAnalyzeLoading) && monitoringWebcamOn ? (
                        <button
                          type="button"
                          onClick={() => resetLiveAnalysisState({ stopAuto: false })}
                          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-100"
                        >
                          إعادة الضبط
                        </button>
                      ) : null}
                    </div>
                    {monitoringLiveAutoOn && monitoringWebcamOn ? (
                      <div className="mb-2 flex items-center gap-2 text-[11px] text-emerald-300/90">
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                        المراقبة التلقائية نشطة
                      </div>
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
                  {monitoringLastAnalyzedAt ? (
                    <p className="mt-2 text-[11px] text-slate-600">
                      آخر فحص: {formatSaudiDateTime(monitoringLastAnalyzedAt)}
                    </p>
                  ) : null}
                </div>

                {/* آخر نتيجة تحليل — always visible once live is active or a result exists */}
                {(monitoringAnalysisResult != null ||
                  (monitoringLiveAutoOn && monitoringWebcamOn) ||
                  monitoringWebcamBusy ||
                  monitoringAnalyzeLoading) ? (
                  <PpeStatusDashboard
                    result={monitoringAnalysisResult}
                    liveActive={monitoringLiveAutoOn && monitoringWebcamOn}
                    liveTickBusy={liveTickBusy}
                    manualLoading={monitoringAnalyzeLoading || monitoringWebcamBusy}
                    zoneName={selectedZoneMeta.zoneAr}
                    lastAnalyzedAt={monitoringLastAnalyzedAt}
                    role={role}
                  />
                ) : null}

                {cameraCardsLoading ? (
                  <div className="space-y-3" aria-busy="true">
                    <SkeletonPulse className="h-24 w-full" />
                    <SkeletonPulse className="h-24 w-full" />
                  </div>
                ) : cameraCardsError ? (
                  <div className="rounded-xl border border-accent-red/35 bg-accent-red/10 px-3 py-4 text-sm text-red-200">
                    <p>{cameraCardsError}</p>
                    {apiConnectionStatus !== API_STATUS.ONLINE ? (
                      <p className="mt-2 text-xs text-slate-400">
                        معاينة كاميرا الجهاز والتحليل الفوري متاحان عند عودة الخادم — لا حاجة لإعادة تحميل الصفحة بالكامل.
                      </p>
                    ) : null}
                  </div>
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
                          className="rounded-xl border border-white/10 bg-[#0B1327] p-4 text-xs text-slate-200 transition hover:border-sky-500/25"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-white/5 pb-2">
                            <p className="text-sm font-semibold text-white">{c.name}</p>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${securityStatusBadgeClass(
                                  c.security_status || "review",
                                )}`}
                              >
                                {c.security_status_ar || "يحتاج مراجعة"}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  c.is_connected ? "bg-emerald-500/15 text-emerald-200" : "bg-slate-600/30 text-slate-400"
                                }`}
                              >
                                {c.is_connected ? "🟢 متصل" : "🔴 غير متصل"}
                              </span>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                            <p>
                              <span className="text-slate-500">الموقع:</span> {c.location}
                            </p>
                            <p>
                              <span className="text-slate-500">المراقبة الذكية:</span>{" "}
                              {c.ai_enabled ? (
                                <span className="font-semibold text-emerald-300">مفعّلة</span>
                              ) : (
                                <span className="text-slate-400">غير مفعّلة</span>
                              )}
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

            {(role === "supervisor" || role === "admin") ? (
              <ReportsHub
                sectionRef={supervisorReportsRef}
                sectionClassName={SECTION_THEME.reports}
                supervisorSummary={supervisorSummary}
                supervisorSummaryLoading={supervisorSummaryLoading}
                violationsReportRows={violationsReportRows}
                violationsReportLoading={violationsReportLoading}
                violationsReportError={violationsReportError}
                violationsReportFrom={violationsReportFrom}
                violationsReportTo={violationsReportTo}
                setViolationsReportFrom={setViolationsReportFrom}
                setViolationsReportTo={setViolationsReportTo}
                fetchViolationsReport={fetchViolationsReport}
                violationsReportStats={violationsReportStats}
                reviewRecords={reviewRecords}
                cameraCards={cameraCards}
                cameraCardsLoading={cameraCardsLoading}
                supervisorEmployees={supervisorEmployees}
                employeesLoading={supervisorEmployeesLoading}
                apiReachable={
                  apiConnectionStatus === API_STATUS.ONLINE
                    ? true
                    : apiConnectionStatus === API_STATUS.CHECKING
                      ? null
                      : false
                }
                onPrintViolationsPdf={printViolationsReportPdf}
                onPrintDishPdf={printDishReviewReportPdf}
                onPrintGeneralPdf={printGeneralSummaryPdf}
                reportSettings={adminSettings.reports}
                setToast={setToast}
              />
            ) : null}

            <section
              id="dish-reviews"
              ref={supervisorReviewsRef}
              className={`dashboard-section-cv ${SECTION_THEME.neutral} mb-8 scroll-mt-28 sm:scroll-mt-32`}
            >
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-white">مراجعة الأطباق</h3>
                  <p className="text-sm text-slate-400">اعتماد أو رفض سجلات الأطباق مع تتبع سجل المراجعة.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!reviewRecords.length || !adminSettings.reports.pdfEnabled}
                    onClick={() => printDishReviewReportPdf()}
                    title="طباعة أو حفظ PDF عبر نافذة المتصفح (اختر «حفظ كملف PDF»)"
                    className="rounded-xl border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    تصدير PDF
                  </button>
                  <button
                    type="button"
                    disabled={!reviewRecords.length || !adminSettings.reports.excelEnabled}
                    onClick={() => {
                      const ok = exportDishRecordsExcel({
                        records: reviewRecords,
                        branchLabel:
                          String(supervisorSummary?.branch_name || "").trim() || "—",
                        periodFrom: reviewFilters.dateFrom,
                        periodTo: reviewFilters.dateTo,
                        formatDateTime: formatSaudiDateTime,
                      });
                      setToast({
                        type: ok ? "success" : "error",
                        text: ok
                          ? `تم تنزيل Excel (${reviewRecords.length} سجل).`
                          : "لا توجد سجلات للتصدير.",
                      });
                    }}
                    className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    تصدير Excel
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
                          <FoodImageThumb
                            src={resolveDishImageUrl(r.image_url, r.image_available !== false)}
                            alt={r.confirmed_label || r.predicted_label || "dish"}
                            sizeClass="h-32 w-32 shrink-0 rounded-xl sm:h-36 sm:w-36"
                            emptyLabel={
                              r.image_available === false
                                ? "الصورة غير متوفرة"
                                : "لا توجد صورة"
                            }
                          />
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
              className={`dashboard-section-cv ${SECTION_THEME.neutral} mb-8 scroll-mt-28 sm:scroll-mt-32`}
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
                    <article key={e.id} className="rounded-2xl border border-white/10 bg-[#0a1525] p-4 transition hover:border-white/18">
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
                            lockSectionNavForScroll();
                            scrollToSectionElement("dish-reviews");
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
                  <p className="text-xs text-slate-400">تُحفظ الإعدادات في PostgreSQL عبر الخادم.</p>
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
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                      <span aria-hidden className="text-base leading-none">🤖</span>
                      <span>إعدادات الذكاء الاصطناعي</span>
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
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                      <span aria-hidden className="text-base leading-none">📹</span>
                      <span>إعدادات الكاميرات</span>
                    </h4>
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
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                      <span aria-hidden className="text-base leading-none">🔔</span>
                      <span>إعدادات التنبيهات</span>
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
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                      <span aria-hidden className="text-base leading-none">📊</span>
                      <span>إعدادات التقارير</span>
                    </h4>
                    <p className="mt-2 text-xs text-slate-400">
                      التقارير المدعومة: PDF و Excel — تُولَّد من بيانات الخادم الحقيقية.
                    </p>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {[
                        { key: "pdfEnabled", label: "تفعيل تصدير PDF" },
                        { key: "excelEnabled", label: "تفعيل تصدير Excel" },
                        { key: "includeEvidence", label: "تضمين صور الأدلة في التقرير" },
                        { key: "includeSummary", label: "تضمين ملخص الإدارة" },
                      ].map(({ key, label }) => (
                        <label
                          key={key}
                          className="flex items-center justify-between rounded-xl border border-white/10 bg-[#060d1f]/80 px-3 py-2 text-sm text-slate-200"
                        >
                          <span>{label}</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={Boolean(adminSettings.reports[key])}
                            onClick={() =>
                              setAdminSettings((prev) => ({
                                ...prev,
                                reports: { ...prev.reports, [key]: !prev.reports[key] },
                              }))
                            }
                            className={`relative h-6 w-11 rounded-full transition ${
                              adminSettings.reports[key] ? "bg-sky-500/70" : "bg-slate-700"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                                adminSettings.reports[key] ? "right-0.5" : "right-[1.35rem]"
                              }`}
                            />
                          </button>
                        </label>
                      ))}

                      <label className="rounded-xl border border-white/10 bg-[#060d1f]/80 p-3 sm:col-span-2">
                        <span className="text-xs text-slate-400">تنسيق التقرير</span>
                        <select
                          value={adminSettings.reports.format}
                          onChange={(e) =>
                            setAdminSettings((prev) => ({
                              ...prev,
                              reports: {
                                ...prev.reports,
                                format: e.target.value === "compact" ? "compact" : "detailed",
                              },
                            }))
                          }
                          className="mt-2 w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-sky/50"
                        >
                          <option value="detailed">تفصيلي</option>
                          <option value="compact">مختصر</option>
                        </select>
                      </label>
                    </div>
                  </article>

                  {/* General platform settings (language, timezone, brand name) were removed in v2:
                      fixed system constants — not operator-editable. */}

                  <article className="rounded-2xl border border-white/10 bg-[#0B1327]/70 p-4">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                      <span aria-hidden className="text-base leading-none">👥</span>
                      <span>إدارة المستخدمين</span>
                    </h4>
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

                  <article className="rounded-2xl border border-white/10 bg-[#0B1327]/70 p-4">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                      <span aria-hidden className="text-base leading-none">🏢</span>
                      <span>إدارة الفروع</span>
                    </h4>
                    <p className="mt-2 text-xs text-slate-400">
                      إضافة فروع جديدة، تعديل الأسماء والمدن، تعطيل الفروع، ومراجعة طلبات الفروع الجديدة.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        to="/admin/branches"
                        className="inline-flex rounded-xl border border-brand-sky/40 bg-brand/15 px-4 py-2 text-xs font-semibold text-sky-100 transition hover:bg-brand/25"
                      >
                        فتح إدارة الفروع
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
            className="fixed inset-0 z-[185] flex items-center justify-center bg-black/75 p-4"
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
            className="fixed inset-0 z-[185] flex items-center justify-center bg-black/75 p-4"
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
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">المصدر</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">الحالة</th>
                  <th className="border border-slate-300 px-1 py-2 text-center font-semibold">صورة</th>
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
                    <td className="border border-slate-200 px-1 py-1.5 break-words text-center">
                      {row.source_entity || "—"}
                    </td>
                    <td
                      className="border border-slate-200 px-1 py-1.5 text-center font-semibold"
                      style={dishReviewStatusPrintStyle(row.status)}
                    >
                      {dishReviewStatusArExport(row.status)}
                    </td>
                    <td className="border border-slate-200 px-1 py-1.5 text-center">
                      {resolveDishImageUrl(row.image_url, row.image_available !== false) ? (
                        <img
                          src={resolveDishImageUrl(row.image_url, row.image_available !== false)}
                          alt=""
                          width={56}
                          height={56}
                          style={{ objectFit: "cover", borderRadius: 4 }}
                        />
                      ) : (
                        "—"
                      )}
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
