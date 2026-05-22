/**
 * Real Excel (.xlsx) exports via SheetJS — data must come from API responses only.
 */
import * as XLSX from "xlsx";

import { dishReportImageLink } from "./dishHelpers.js";
import {
  REPORT_PLATFORM_TAGLINE_AR,
  REPORT_PLATFORM_TITLE_AR,
  dishReviewStatusArExport,
  formatAlertBranchArea,
  formatMonitoringConfidencePercent,
  formatReportDateYmd,
  formatReportPeriodLabel,
  monitoringAlertStatusArExport,
  monitoringSeverityLabelAr,
  violationTypeLabelForReport,
} from "./reportExportHelpers.js";

export function skaExcelFilename(kind) {
  return `ska_${kind}_report_${formatReportDateYmd()}.xlsx`;
}

function sheetFromRows(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!rtl"] = true;
  return ws;
}

function downloadWorkbook(wb, filename) {
  XLSX.writeFile(wb, filename, { bookType: "xlsx", compression: true });
}

/** Executive summary workbook */
export function exportExecutiveSummaryExcel({ summary, violationsStats, periodFrom, periodTo }) {
  if (!summary) return false;
  const s = summary;
  const val = (v) => (v === undefined || v === null ? "" : v);
  const rows = [
    [REPORT_PLATFORM_TITLE_AR],
    [REPORT_PLATFORM_TAGLINE_AR],
    ["تقرير الملخص التنفيذي"],
    ["تاريخ التصدير", formatReportDateYmd()],
    ["الفرع", String(s.branch_name || "").trim() || "—"],
    ["الفترة", formatReportPeriodLabel(periodFrom, periodTo)],
    [],
    ["المؤشر", "القيمة"],
    ["درجة الامتثال %", val(s.quality_score ?? s.compliance_rate)],
    ["التنبيهات المفتوحة", val(s.alerts_count)],
    ["المخالفات (ملخص)", val(s.violations_count)],
    ["الأطباق اليوم", val(s.dishes_today ?? s.dishes_count)],
    ["الموظفون النشطون اليوم", val(s.active_employees_today)],
    ["إجمالي الموظفين", val(s.total_employees)],
    [],
    ["ملخص المخالفات (التقرير المحمّل)"],
    ["إجمالي السجلات", val(violationsStats?.total)],
    ["مفتوح", val(violationsStats?.openCount)],
    ["تمت المعالجة", val(violationsStats?.resolvedCount)],
    ["أكثر مخالفة تكرارًا", val(violationsStats?.topRepeated?.label)],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(rows), "الملخص التنفيذي");
  downloadWorkbook(wb, skaExcelFilename("executive_summary"));
  return true;
}

/** Violations detail workbook */
export function exportViolationsExcel({ rows, branchLabel, periodFrom, periodTo }) {
  if (!rows?.length) return false;
  const header = [
    "رقم",
    "نوع المخالفة",
    "التفاصيل",
    "الكاميرا",
    "الفرع / المنطقة",
    "نسبة الثقة",
    "مستوى الخطورة",
    "الحالة",
    "التاريخ والوقت (الرياض)",
  ];
  const preamble = [
    [REPORT_PLATFORM_TITLE_AR],
    ["تقرير مخالفات المراقبة"],
    ["الفرع", branchLabel || "—"],
    ["الفترة", formatReportPeriodLabel(periodFrom, periodTo)],
    ["تاريخ التصدير", formatReportDateYmd()],
    [],
    header,
  ];
  const data = rows.map((row, idx) => [
    idx + 1,
    violationTypeLabelForReport(row),
    String(row.details || "—").replace(/\s+/g, " ").trim(),
    row.camera_name || "—",
    formatAlertBranchArea(row),
    formatMonitoringConfidencePercent(row.confidence),
    monitoringSeverityLabelAr(row.confidence),
    monitoringAlertStatusArExport(row.status),
    row.created_at || "—",
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows([...preamble, ...data]), "المخالفات");
  downloadWorkbook(wb, skaExcelFilename("violations"));
  return true;
}

/** Dish documentation workbook */
export function exportDishRecordsExcel({ records, branchLabel, periodFrom, periodTo, formatDateTime }) {
  if (!records?.length) return false;
  const fmt = formatDateTime || ((v) => v || "—");
  const rows = [
    [REPORT_PLATFORM_TITLE_AR],
    ["تقرير توثيق الأطباق"],
    ["الفرع", branchLabel || "—"],
    ["الفترة", formatReportPeriodLabel(periodFrom, periodTo)],
    [],
    [
      "رقم",
      "الموظف",
      "الطبق المقترح (AI)",
      "الطبق المعتمد",
      "الكمية",
      "المصدر/الوجهة",
      "الحالة",
      "وقت التسجيل",
      "وقت المراجعة",
      "رابط الصورة",
    ],
    ...records.map((r, idx) => [
      idx + 1,
      r.employee_name || "—",
      r.predicted_label || "—",
      r.confirmed_label || "—",
      r.quantity ?? "",
      r.source_entity || "—",
      dishReviewStatusArExport(r.status),
      r.recorded_at ? fmt(r.recorded_at) : "—",
      r.reviewed_at ? fmt(r.reviewed_at) : "—",
      dishReportImageLink(r),
    ]),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(rows), "توثيق الأطباق");
  downloadWorkbook(wb, skaExcelFilename("dish_documentation"));
  return true;
}

/** Camera health workbook */
export function exportCamerasExcel({ cameras }) {
  if (!cameras?.length) return false;
  const rows = [
    [REPORT_PLATFORM_TITLE_AR],
    ["تقرير صحة الكاميرات"],
    ["تاريخ التصدير", formatReportDateYmd()],
    [],
    ["الاسم", "الموقع", "متصل", "المراقبة الذكية", "آخر تحليل"],
    ...cameras.map((c) => [
      c.name || "—",
      c.location || "—",
      c.is_connected ? "متصل" : "غير متصل",
      c.ai_enabled ? "مفعّل" : "غير مفعّل",
      c.last_analysis_at || "—",
    ]),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(rows), "الكاميرات");
  downloadWorkbook(wb, skaExcelFilename("cameras"));
  return true;
}

/** Employee compliance workbook */
export function exportEmployeesExcel({ employees }) {
  if (!employees?.length) return false;
  const rows = [
    [REPORT_PLATFORM_TITLE_AR],
    ["تقرير امتثال الموظفين"],
    ["تاريخ التصدير", formatReportDateYmd()],
    [],
    ["الاسم", "الفرع", "الدور", "الحالة", "أطباق اليوم", "إجمالي الأطباق", "مراجعات معلقة", "آخر نشاط"],
    ...employees.map((e) => [
      e.full_name || e.username || "—",
      e.branch_name || "—",
      e.role || "—",
      e.status || "—",
      e.dishes_today ?? 0,
      e.total_dishes ?? 0,
      e.pending_reviews ?? 0,
      e.last_activity || "—",
    ]),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(rows), "الموظفون");
  downloadWorkbook(wb, skaExcelFilename("employees"));
  return true;
}
