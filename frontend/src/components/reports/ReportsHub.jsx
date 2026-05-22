import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import ReportSection from "./ReportSection.jsx";
import { formatSaudiDateTime } from "../../utils/datetime.js";
import {
  exportCamerasExcel,
  exportDishRecordsExcel,
  exportEmployeesExcel,
  exportExecutiveSummaryExcel,
  exportViolationsExcel,
} from "../../utils/reportExcelExport.js";
import {
  getPresetDateRange,
  REPORT_DATE_PRESETS,
} from "../../utils/reportDatePresets.js";
import {
  formatReportPeriodLabel,
  monitoringAlertStatusArExport,
  violationTypeLabelForReport,
} from "../../utils/reportExportHelpers.js";
import { canonicalViolationType, getViolationLabel } from "../../utils/violationLabels.js";

const ReportsAnalyticsCharts = lazy(
  () => import("../supervisor/ReportsAnalyticsCharts.jsx"),
);

const PAGE_SIZE = 25;

function KpiCard({ label, value, accent = "text-white" }) {
  return (
    <div className="rounded-xl border border-white/8 bg-[#060d1f] px-3 py-3">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

function filterViolations(rows, { search, typeFilter, statusFilter, cameraFilter, branchFilter }) {
  let list = Array.isArray(rows) ? rows : [];
  const q = String(search || "").trim().toLowerCase();
  if (q) {
    list = list.filter((r) => {
      const hay = [
        r.label_ar,
        r.type,
        r.details,
        r.camera_name,
        r.branch,
        r.branch_name,
        r.location,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }
  if (typeFilter && typeFilter !== "all") {
    list = list.filter((r) => canonicalViolationType(r.type) === typeFilter);
  }
  if (statusFilter && statusFilter !== "all") {
    const st = statusFilter.toLowerCase();
    list = list.filter((r) => {
      const s = String(r.status || "").toLowerCase();
      if (st === "open") return s !== "resolved";
      if (st === "resolved") return s === "resolved";
      if (st === "review") return s === "needs_review" || s === "new";
      return true;
    });
  }
  if (cameraFilter && cameraFilter !== "all") {
    list = list.filter((r) => String(r.camera_name || "") === cameraFilter);
  }
  if (branchFilter && branchFilter !== "all") {
    list = list.filter(
      (r) =>
        String(r.branch_name || r.branch || "") === branchFilter ||
        String(r.location || "") === branchFilter,
    );
  }
  return list;
}

function highestRiskAreaFromRows(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const area = String(r.location || r.branch_name || r.branch || r.camera_name || "").trim();
    if (!area) continue;
    map.set(area, (map.get(area) || 0) + 1);
  }
  let best = "—";
  let max = 0;
  for (const [k, n] of map) {
    if (n > max) {
      max = n;
      best = k;
    }
  }
  return max > 0 ? best : "—";
}

/**
 * Enterprise reporting hub — REAL backend data only.
 */
function ReportsHub({
  sectionRef,
  sectionClassName = "",
  supervisorSummary,
  supervisorSummaryLoading,
  violationsReportRows,
  violationsReportLoading,
  violationsReportError,
  violationsReportFrom,
  violationsReportTo,
  setViolationsReportFrom,
  setViolationsReportTo,
  fetchViolationsReport,
  violationsReportStats,
  reviewRecords = [],
  cameraCards = [],
  cameraCardsLoading = false,
  supervisorEmployees = [],
  employeesLoading = false,
  apiReachable = null,
  onExportCsvSummary,
  onExportCsvViolations,
  onPrintViolationsPdf,
  onPrintDishPdf,
  onExportCsvDish,
  setToast,
}) {
  const [datePreset, setDatePreset] = useState("month");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [cameraFilter, setCameraFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [page, setPage] = useState(0);

  const applyPreset = useCallback(
    (presetId) => {
      setDatePreset(presetId);
      if (presetId === "custom") return;
      const { from, to } = getPresetDateRange(presetId);
      setViolationsReportFrom(from);
      setViolationsReportTo(to);
      void fetchViolationsReport(from, to);
    },
    [fetchViolationsReport, setViolationsReportFrom, setViolationsReportTo],
  );

  useEffect(() => {
    if (datePreset === "month" && !violationsReportFrom && !violationsReportTo) {
      applyPreset("month");
    }
  }, [applyPreset, datePreset, violationsReportFrom, violationsReportTo]);

  const filteredViolations = useMemo(
    () =>
      filterViolations(violationsReportRows, {
        search,
        typeFilter,
        statusFilter,
        cameraFilter,
        branchFilter,
      }),
    [violationsReportRows, search, typeFilter, statusFilter, cameraFilter, branchFilter],
  );

  const paginatedViolations = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filteredViolations.slice(start, start + PAGE_SIZE);
  }, [filteredViolations, page]);

  const totalPages = Math.max(1, Math.ceil(filteredViolations.length / PAGE_SIZE));

  const cameraNames = useMemo(() => {
    const s = new Set();
    for (const r of violationsReportRows || []) {
      if (r.camera_name) s.add(r.camera_name);
    }
    for (const c of cameraCards || []) {
      if (c.name) s.add(c.name);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ar"));
  }, [violationsReportRows, cameraCards]);

  const branchNames = useMemo(() => {
    const s = new Set();
    for (const r of violationsReportRows || []) {
      const b = r.branch_name || r.branch;
      if (b) s.add(b);
    }
    if (supervisorSummary?.branch_name) s.add(supervisorSummary.branch_name);
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ar"));
  }, [violationsReportRows, supervisorSummary]);

  const violationTypes = useMemo(() => {
    const s = new Set();
    for (const r of violationsReportRows || []) {
      const k = canonicalViolationType(r.type);
      if (k) s.add(k);
    }
    return Array.from(s);
  }, [violationsReportRows]);

  const compliancePct = supervisorSummaryLoading
    ? "…"
    : supervisorSummary?.quality_score != null
      ? `${Math.round(Number(supervisorSummary.quality_score))}%`
      : supervisorSummary?.compliance_rate != null
        ? `${Math.round(Number(supervisorSummary.compliance_rate))}%`
        : "—";

  const activeCameras = cameraCards.filter((c) => c.is_connected).length;
  const totalCameras = cameraCards.length;
  const riskArea = highestRiskAreaFromRows(filteredViolations);
  const branchLabel = String(supervisorSummary?.branch_name || "").trim() || "—";

  const aiUptimeLabel =
    apiReachable === null
      ? "جاري التحقق…"
      : apiReachable === false
        ? "غير متصل"
        : "متصل";

  const topCompliantEmployees = useMemo(() => {
    return [...(supervisorEmployees || [])]
      .filter((e) => (e.pending_reviews ?? 0) === 0 && (e.dishes_today ?? 0) > 0)
      .slice(0, 5);
  }, [supervisorEmployees]);

  const needsReviewEmployees = useMemo(() => {
    return [...(supervisorEmployees || [])]
      .filter((e) => (e.pending_reviews ?? 0) > 0)
      .sort((a, b) => (b.pending_reviews || 0) - (a.pending_reviews || 0))
      .slice(0, 5);
  }, [supervisorEmployees]);

  const handleExcelExecutive = () => {
    const ok = exportExecutiveSummaryExcel({
      summary: supervisorSummary,
      violationsStats: violationsReportStats,
      periodFrom: violationsReportFrom,
      periodTo: violationsReportTo,
    });
    setToast?.({
      type: ok ? "success" : "error",
      text: ok ? "تم تنزيل Excel للملخص التنفيذي." : "لا توجد بيانات للتصدير.",
    });
  };

  const handleExcelViolations = () => {
    const ok = exportViolationsExcel({
      rows: filteredViolations,
      branchLabel,
      periodFrom: violationsReportFrom,
      periodTo: violationsReportTo,
    });
    setToast?.({
      type: ok ? "success" : "error",
      text: ok ? "تم تنزيل Excel للمخالفات." : "لا توجد مخالفات للتصدير.",
    });
  };

  const executiveSummary = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard label="درجة الامتثال" value={compliancePct} accent="text-emerald-300" />
      <KpiCard
        label="إجمالي المخالفات"
        value={violationsReportStats?.total ?? "—"}
        accent="text-red-200"
      />
      <KpiCard
        label="الكاميرات النشطة"
        value={totalCameras ? `${activeCameras}/${totalCameras}` : "—"}
        accent="text-sky-200"
      />
      <KpiCard label="أعلى منطقة خطر" value={riskArea} accent="text-amber-200" />
    </div>
  );

  return (
    <section
      id="reports"
      ref={sectionRef}
      className={`dashboard-section-cv ${sectionClassName} mb-8 scroll-mt-28 sm:scroll-mt-32`}
    >
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-violet-500/20 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white">مركز التقارير</h2>
          <p className="mt-1 text-xs text-slate-400">
            تقارير تشغيلية من بيانات الخادم الحقيقية — توقيت الرياض — جاهزة للطباعة والتصدير.
          </p>
        </div>
      </div>

      {/* 1 — Executive Summary (always visible first) */}
      <ReportSection
        id="report-executive"
        title="الملخص التنفيذي"
        subtitle="نظرة سريعة للمدير — الامتثال، المخالفات، الكاميرات، ومناطق الخطر."
        accentClass="border-violet-500/25"
        defaultOpen
        summary={executiveSummary}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label="أكثر مخالفة تكرارًا"
            value={
              violationsReportStats?.topRepeated?.count > 0
                ? `${violationsReportStats.topRepeated.label} (${violationsReportStats.topRepeated.count})`
                : "لا توجد بيانات"
            }
          />
          <KpiCard label="التنبيهات المفتوحة (ملخص)" value={supervisorSummary?.alerts_count ?? "—"} />
          <KpiCard label="حالة خدمة المراقبة" value={aiUptimeLabel} />
          <KpiCard label="الفرع" value={branchLabel} />
          <KpiCard label="الأطباق اليوم" value={supervisorSummary?.dishes_today ?? "—"} />
          <KpiCard
            label="الموظفون النشطون"
            value={supervisorSummary?.active_employees_today ?? "—"}
          />
        </div>
      </ReportSection>

      {/* Filters bar — shared across violation reports */}
      <div className="mb-6 rounded-2xl border border-white/8 bg-[#060d1f] p-4">
        <p className="mb-3 text-xs font-semibold text-slate-300">تصفية التقارير</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {REPORT_DATE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                datePreset === p.id
                  ? "border-violet-500/50 bg-violet-500/15 text-violet-100"
                  : "border-white/10 bg-[#0f172a] text-slate-400 hover:text-white"
              }`}
            >
              {p.labelAr}
            </button>
          ))}
        </div>
        {datePreset === "custom" ? (
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <label className="text-[11px] text-slate-400">
              من
              <input
                type="date"
                value={violationsReportFrom}
                onChange={(e) => setViolationsReportFrom(e.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-[#0B1327] px-2 py-1.5 text-sm text-white"
              />
            </label>
            <label className="text-[11px] text-slate-400">
              إلى
              <input
                type="date"
                value={violationsReportTo}
                onChange={(e) => setViolationsReportTo(e.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-[#0B1327] px-2 py-1.5 text-sm text-white"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() =>
                  void fetchViolationsReport(violationsReportFrom, violationsReportTo)
                }
                className="w-full rounded border border-violet-500/40 bg-violet-500/10 py-2 text-xs font-semibold text-violet-100"
              >
                تطبيق
              </button>
            </div>
          </div>
        ) : (
          <p className="mb-3 text-[10px] text-slate-500">
            الفترة: {formatReportPeriodLabel(violationsReportFrom, violationsReportTo)}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input
            type="search"
            placeholder="بحث…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="rounded border border-white/10 bg-[#0B1327] px-3 py-2 text-sm text-white"
          />
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(0);
            }}
            className="rounded border border-white/10 bg-[#0B1327] px-2 py-2 text-sm text-white"
          >
            <option value="all">كل أنواع المخالفات</option>
            {violationTypes.map((t) => (
              <option key={t} value={t}>
                {getViolationLabel(t)}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            className="rounded border border-white/10 bg-[#0B1327] px-2 py-2 text-sm text-white"
          >
            <option value="all">كل الحالات</option>
            <option value="open">مفتوح</option>
            <option value="resolved">تم الحل</option>
            <option value="review">يحتاج مراجعة</option>
          </select>
          <select
            value={cameraFilter}
            onChange={(e) => {
              setCameraFilter(e.target.value);
              setPage(0);
            }}
            className="rounded border border-white/10 bg-[#0B1327] px-2 py-2 text-sm text-white"
          >
            <option value="all">كل الكاميرات</option>
            {cameraNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <select
            value={branchFilter}
            onChange={(e) => {
              setBranchFilter(e.target.value);
              setPage(0);
            }}
            className="rounded border border-white/10 bg-[#0B1327] px-2 py-2 text-sm text-white"
          >
            <option value="all">كل الفروع</option>
            {branchNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 2 — Analytics charts (lazy) */}
      <ReportSection
        id="report-analytics"
        title="التحليلات"
        subtitle="مخططات من بيانات الخادم — لا بيانات وهمية."
        accentClass="border-sky-500/25"
        summary={
          <p className="text-xs text-slate-500">
            {filteredViolations.length} مخالفة بعد التصفية · {reviewRecords.length} سجل طبق
          </p>
        }
      >
        <Suspense
          fallback={
            <div className="h-48 animate-pulse rounded-xl bg-white/5" aria-busy="true" />
          }
        >
          <ReportsAnalyticsCharts
            violationsRows={filteredViolations}
            reviewRecords={reviewRecords}
            dateFrom={violationsReportFrom}
            dateTo={violationsReportTo}
          />
        </Suspense>
      </ReportSection>

      {/* 3 — Violations detail */}
      <ReportSection
        id="report-violations"
        title="تقرير المخالفات التفصيلي"
        subtitle="نوع المخالفة، الثقة، الكاميرا، المنطقة، الوقت، والدليل."
        accentClass="border-red-500/25"
        defaultOpen
        summary={
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiCard label="المعروض" value={filteredViolations.length} />
            <KpiCard label="مفتوح" value={violationsReportStats?.openCount ?? "—"} accent="text-red-200" />
            <KpiCard
              label="تم الحل"
              value={violationsReportStats?.resolvedCount ?? "—"}
              accent="text-emerald-200"
            />
          </div>
        }
      >
        {violationsReportError ? (
          <p className="mb-3 text-sm text-red-300">{violationsReportError}</p>
        ) : null}
        {violationsReportLoading ? (
          <p className="text-sm text-slate-400" aria-busy="true">
            جاري التحميل…
          </p>
        ) : filteredViolations.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد مخالفات للفترة أو الفلاتر المحددة.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-white/8">
              <table className="min-w-full text-start text-xs">
                <thead className="border-b border-white/10 bg-[#0B1327] text-slate-400">
                  <tr>
                    <th className="px-3 py-2">النوع</th>
                    <th className="px-3 py-2">الثقة</th>
                    <th className="px-3 py-2">الكاميرا</th>
                    <th className="px-3 py-2">المنطقة</th>
                    <th className="px-3 py-2">الحالة</th>
                    <th className="px-3 py-2">الوقت (الرياض)</th>
                    <th className="px-3 py-2">الدليل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-200">
                  {paginatedViolations.map((row) => (
                    <tr key={row.id} className="bg-[#060d1f]/50">
                      <td className="px-3 py-2 font-medium text-white">
                        {violationTypeLabelForReport(row)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {row.confidence != null ? `${Math.round(Number(row.confidence))}%` : "—"}
                      </td>
                      <td className="px-3 py-2">{row.camera_name || "—"}</td>
                      <td className="px-3 py-2">
                        {row.location || row.branch_name || row.branch || "—"}
                      </td>
                      <td className="px-3 py-2">{monitoringAlertStatusArExport(row.status)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {formatSaudiDateTime(row.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        {row.image_data_url ? (
                          <img
                            src={row.image_data_url}
                            alt=""
                            loading="lazy"
                            className="h-10 w-14 rounded object-cover"
                          />
                        ) : (
                          <span className="text-slate-500">لا توجد صورة</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 ? (
              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-400">
                <span>
                  صفحة {page + 1} من {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="rounded border border-white/10 px-3 py-1 disabled:opacity-40"
                  >
                    السابق
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    className="rounded border border-white/10 px-3 py-1 disabled:opacity-40"
                  >
                    التالي
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </ReportSection>

      {/* 4 — Employees */}
      <ReportSection
        id="report-employees"
        title="امتثال الموظفين"
        subtitle="الامتثال، المراجعات المعلقة، وآخر النشاط."
        accentClass="border-cyan-500/25"
        summary={
          <p className="text-xs text-slate-500">
            {supervisorEmployees.length} موظف · {needsReviewEmployees.length} يحتاجون مراجعة
          </p>
        }
      >
        {employeesLoading ? (
          <p className="text-sm text-slate-400">جاري التحميل…</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold text-emerald-300">أعلى امتثال</p>
              <ul className="space-y-2 text-sm text-slate-300">
                {topCompliantEmployees.length ? (
                  topCompliantEmployees.map((e) => (
                    <li key={e.id} className="rounded border border-white/5 px-3 py-2">
                      {e.full_name || e.username} — {e.dishes_today} طبق اليوم
                    </li>
                  ))
                ) : (
                  <li className="text-slate-500">لا توجد بيانات كافية</li>
                )}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-amber-300">يحتاج مراجعة</p>
              <ul className="space-y-2 text-sm text-slate-300">
                {needsReviewEmployees.length ? (
                  needsReviewEmployees.map((e) => (
                    <li key={e.id} className="rounded border border-white/5 px-3 py-2">
                      {e.full_name || e.username} — {e.pending_reviews} مراجعة معلقة
                    </li>
                  ))
                ) : (
                  <li className="text-slate-500">لا يوجد</li>
                )}
              </ul>
            </div>
          </div>
        )}
      </ReportSection>

      {/* 5 — Cameras */}
      <ReportSection
        id="report-cameras"
        title="تقرير صحة الكاميرات"
        subtitle="الاتصال، المراقبة الذكية، وآخر تحليل."
        accentClass="border-blue-500/25"
        summary={
          <KpiCard
            label="متصل / الإجمالي"
            value={cameraCardsLoading ? "…" : `${activeCameras} / ${totalCameras}`}
          />
        }
      >
        {cameraCardsLoading ? (
          <p className="text-sm text-slate-400">جاري التحميل…</p>
        ) : !cameraCards.length ? (
          <p className="text-sm text-slate-500">لا توجد كاميرات مسجّلة.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/8">
            <table className="min-w-full text-xs">
              <thead className="border-b border-white/10 bg-[#0B1327] text-slate-400">
                <tr>
                  <th className="px-3 py-2">الاسم</th>
                  <th className="px-3 py-2">الموقع</th>
                  <th className="px-3 py-2">الاتصال</th>
                  <th className="px-3 py-2">المراقبة الذكية</th>
                  <th className="px-3 py-2">آخر تحليل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-200">
                {cameraCards.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2 font-medium text-white">{c.name}</td>
                    <td className="px-3 py-2">{c.location || "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          c.is_connected ? "text-emerald-300" : "text-slate-500"
                        }
                      >
                        {c.is_connected ? "متصل" : "غير متصل"}
                      </span>
                    </td>
                    <td className="px-3 py-2">{c.ai_enabled ? "مفعّل" : "غير مفعّل"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {c.last_analysis_at
                        ? formatSaudiDateTime(c.last_analysis_at)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {/* 6 — Food documentation */}
      <ReportSection
        id="report-dishes"
        title="توثيق الأطباق"
        subtitle="الأطباق المسجّلة، الكميات، والمراجعات."
        accentClass="border-amber-500/20"
        summary={
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiCard label="السجلات" value={reviewRecords.length} />
            <KpiCard
              label="معلّق للمراجعة"
              value={supervisorSummary?.pending_reviews ?? "—"}
              accent="text-amber-200"
            />
            <KpiCard label="معتمد اليوم" value={supervisorSummary?.approved_today ?? "—"} />
          </div>
        }
      >
        <p className="text-xs text-slate-500">
          أكثر طبق: {supervisorSummary?.most_common_dish || "—"} · يحتاج مراجعة:{" "}
          {supervisorSummary?.most_reviewed_dish || "—"}
        </p>
      </ReportSection>

      {/* 7 — Export Center */}
      <ReportSection
        id="report-export"
        title="مركز التصدير"
        subtitle="PDF و CSV و Excel — بيانات حقيقية فقط."
        accentClass="border-emerald-500/25"
        defaultOpen
        summary={
          <p className="text-xs text-slate-400">
            التصدير يعكس الفلاتر النشطة للمخالفات ({filteredViolations.length} سجل).
          </p>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            disabled={!supervisorSummary}
            onClick={() => onExportCsvSummary?.()}
            className="rounded-xl border border-white/15 bg-[#0f172a] px-4 py-3 text-sm font-semibold text-slate-200 hover:border-violet-500/40 disabled:opacity-40"
          >
            تصدير CSV — الملخص
          </button>
          <button
            type="button"
            disabled={!supervisorSummary}
            onClick={handleExcelExecutive}
            className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-40"
          >
            تصدير Excel — الملخص
          </button>
          <button
            type="button"
            disabled={!filteredViolations.length}
            onClick={() => onExportCsvViolations?.()}
            className="rounded-xl border border-white/15 bg-[#0f172a] px-4 py-3 text-sm font-semibold text-slate-200 hover:border-violet-500/40 disabled:opacity-40"
          >
            تصدير CSV — المخالفات
          </button>
          <button
            type="button"
            disabled={!filteredViolations.length}
            onClick={handleExcelViolations}
            className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100 disabled:opacity-40"
          >
            تصدير Excel — المخالفات
          </button>
          <button
            type="button"
            disabled={!violationsReportStats?.total}
            onClick={() => onPrintViolationsPdf?.()}
            className="rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-3 text-sm font-semibold text-violet-100 hover:bg-violet-500/20 disabled:opacity-40"
          >
            تصدير PDF — المخالفات
          </button>
          <button
            type="button"
            disabled={!reviewRecords.length}
            onClick={() => onExportCsvDish?.()}
            className="rounded-xl border border-white/15 bg-[#0f172a] px-4 py-3 text-sm font-semibold text-slate-200 disabled:opacity-40"
          >
            تصدير CSV — الأطباق
          </button>
          <button
            type="button"
            disabled={!reviewRecords.length}
            onClick={() => {
              const ok = exportDishRecordsExcel({
                records: reviewRecords,
                branchLabel,
                periodFrom: violationsReportFrom,
                periodTo: violationsReportTo,
                formatDateTime: formatSaudiDateTime,
              });
              setToast?.({
                type: ok ? "success" : "error",
                text: ok ? "تم تنزيل Excel للأطباق." : "لا توجد سجلات.",
              });
            }}
            className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100 disabled:opacity-40"
          >
            تصدير Excel — الأطباق
          </button>
          <button
            type="button"
            disabled={!reviewRecords.length}
            onClick={() => onPrintDishPdf?.()}
            className="rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-3 text-sm font-semibold text-violet-100 disabled:opacity-40"
          >
            تصدير PDF — الأطباق
          </button>
          <button
            type="button"
            disabled={!cameraCards.length}
            onClick={() => {
              const ok = exportCamerasExcel({ cameras: cameraCards });
              setToast?.({
                type: ok ? "success" : "error",
                text: ok ? "تم تنزيل Excel للكاميرات." : "لا توجد كاميرات.",
              });
            }}
            className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100 disabled:opacity-40"
          >
            تصدير Excel — الكاميرات
          </button>
          <button
            type="button"
            disabled={!supervisorEmployees.length}
            onClick={() => {
              const ok = exportEmployeesExcel({ employees: supervisorEmployees });
              setToast?.({
                type: ok ? "success" : "error",
                text: ok ? "تم تنزيل Excel للموظفين." : "لا توجد بيانات.",
              });
            }}
            className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100 disabled:opacity-40"
          >
            تصدير Excel — الموظفون
          </button>
        </div>
      </ReportSection>
    </section>
  );
}

export default memo(ReportsHub);
