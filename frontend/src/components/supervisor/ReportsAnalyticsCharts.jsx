import { memo, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  LineChart,
  Line,
  PieChart,
  Pie,
  Legend,
} from "recharts";

import { getViolationLabel } from "../../utils/violationLabels.js";
import { parseDishRecordedAt } from "../../utils/datetime.js";
import { riyadhDateKey } from "../../utils/dishRecordsDisplay.js";

const CHART_COLORS = ["#38bdf8", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb923c", "#2dd4bf"];

const CATEGORY_Y_TICK = { fill: "#f8fafc", fontSize: 13, fontWeight: 600 };
const X_VALUE_TICK = { fill: "#cbd5e1", fontSize: 12, fontWeight: 500 };

/** Short label for Y-axis (horizontal bar charts) — full text stays in tooltips */
function axisCategoryLabel(str, maxLen) {
  const s = String(str ?? "").trim() || "—";
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(4, maxLen - 1))}…`;
}

/** Readable tick under line chart (fixes confusing axis in RTL + shows dates clearly) */
function formatPeriodAxisLabel(s) {
  const v = String(s || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [, m, d] = v.split("-");
    return `${d}/${m}`;
  }
  if (/^\d{4}-W\d{2}$/i.test(v)) {
    const w = v.match(/W(\d+)/i);
    return w ? `الأسبوع ${w[1]}` : v;
  }
  if (/^\d{4}-\d{2}$/.test(v)) {
    const [y, mo] = v.split("-");
    return `${mo}/${y}`;
  }
  return v;
}
const TOOLTIP_SURFACE = {
  backgroundColor: "rgba(15,23,42,0.97)",
  border: "1px solid rgba(148,163,184,0.35)",
  borderRadius: "12px",
  fontSize: "13px",
  color: "#f8fafc",
  padding: "10px 14px",
  boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
};

function rtlTooltipWrapper(content) {
  return (
    <div dir="rtl" style={{ direction: "rtl", textAlign: "right" }}>
      {content}
    </div>
  );
}

function parseYmdBounds(fromStr, toStr) {
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

function inDateRange(iso, start, end) {
  if (start == null && end == null) return true;
  const t = new Date(iso || 0).getTime();
  if (!Number.isFinite(t)) return false;
  if (start != null && t < start) return false;
  if (end != null && t > end) return false;
  return true;
}

function DishReviewsTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const needs = Number(p.needsReviewCount || 0);
  const rej = Number(p.rejectedCount || 0);
  const appr = Number(p.approvedCount || 0);
  const other = Number(p.otherCount || 0);
  const parts = [];
  if (appr > 0) parts.push(`معتمد: ${appr}`);
  if (needs > 0) parts.push(`يحتاج مراجعة: ${needs}`);
  if (rej > 0) parts.push(`مرفوض: ${rej}`);
  if (other > 0) parts.push(`أخرى: ${other}`);
  const statusLine = parts.length ? parts.join(" · ") : "—";
  return rtlTooltipWrapper(
    <div style={TOOLTIP_SURFACE}>
      <p className="mb-1 font-semibold text-white">اسم الطبق</p>
      <p className="mb-2 leading-snug text-sky-100">{p.dishFull || "—"}</p>
      <p className="text-slate-200">
        <span className="text-slate-400">عدد السجلات:</span>{" "}
        <span className="tabular-nums font-bold text-white">{p.count}</span>
      </p>
      <p className="mt-2 border-t border-white/10 pt-2 text-slate-200">
        <span className="text-slate-400">توزيع الحالات:</span> {statusLine}
      </p>
    </div>,
  );
}

function BranchViolationsTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return rtlTooltipWrapper(
    <div style={TOOLTIP_SURFACE}>
      <p className="mb-1 font-semibold text-white">اسم الفرع</p>
      <p className="mb-2 leading-snug text-sky-100">{p.branchFull || "—"}</p>
      <p className="text-slate-200">
        <span className="text-slate-400">عدد المخالفات:</span>{" "}
        <span className="tabular-nums font-bold text-white">{p.count}</span>
      </p>
    </div>,
  );
}

function StaffReviewsTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return rtlTooltipWrapper(
    <div style={TOOLTIP_SURFACE}>
      <p className="mb-1 font-semibold text-white">اسم الموظف</p>
      <p className="mb-2 leading-snug text-sky-100">{p.employeeFull || "—"}</p>
      <p className="text-slate-200">
        <span className="text-slate-400">عدد السجلات:</span>{" "}
        <span className="tabular-nums font-bold text-white">{p.count}</span>
      </p>
    </div>,
  );
}

function PieViolationTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const name = item?.name ?? "";
  const value = item?.value ?? item?.payload?.count;
  return rtlTooltipWrapper(
    <div style={TOOLTIP_SURFACE}>
      <p className="mb-1 font-semibold text-white">نوع المخالفة</p>
      <p className="mb-2 leading-snug text-sky-100">{name}</p>
      <p className="text-slate-200">
        <span className="text-slate-400">العدد:</span>{" "}
        <span className="tabular-nums font-bold text-white">{value}</span>
      </p>
    </div>,
  );
}

function LineViolationsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value;
  return rtlTooltipWrapper(
    <div style={TOOLTIP_SURFACE}>
      <p className="mb-1 font-semibold text-white">الفترة</p>
      <p className="mb-2 font-mono text-sky-100">{label}</p>
      <p className="text-slate-200">
        <span className="text-slate-400">عدد المخالفات:</span>{" "}
        <span className="tabular-nums font-bold text-white">{v}</span>
      </p>
    </div>,
  );
}

/** Aggregations for reports tab — real data only; empty states built-in. */
function ReportsAnalyticsCharts({ violationsRows, reviewRecords, dateFrom, dateTo }) {
  const [branchFilter, setBranchFilter] = useState("");
  const [violationTypeFilter, setViolationTypeFilter] = useState("");
  const [alertGranularity, setAlertGranularity] = useState("day"); // day | week | month

  const range = useMemo(() => parseYmdBounds(dateFrom, dateTo), [dateFrom, dateTo]);

  const branchOptions = useMemo(() => {
    const set = new Set();
    (violationsRows || []).forEach((r) => {
      const b = String(r.branch_name || r.branch || "").trim();
      if (b) set.add(b);
    });
    (reviewRecords || []).forEach((r) => {
      const b = String(r.branch_name || r.branch || "").trim();
      if (b) set.add(b);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
  }, [violationsRows, reviewRecords]);

  const violationTypeOptions = useMemo(() => {
    const set = new Set();
    (violationsRows || []).forEach((r) => {
      const t = String(r.type || r.violation_type || "").trim();
      if (t) set.add(t);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
  }, [violationsRows]);

  const filteredViolations = useMemo(() => {
    let rows = Array.isArray(violationsRows) ? [...violationsRows] : [];
    rows = rows.filter((r) => inDateRange(r.created_at, range.start, range.end));
    if (branchFilter) {
      rows = rows.filter((r) => String(r.branch_name || r.branch || "").trim() === branchFilter);
    }
    if (violationTypeFilter) {
      rows = rows.filter(
        (r) => String(r.type || r.violation_type || "").trim() === violationTypeFilter,
      );
    }
    return rows;
  }, [violationsRows, range.start, range.end, branchFilter, violationTypeFilter]);

  const dishBarData = useMemo(() => {
    const dishMap = new Map();
    const records = Array.isArray(reviewRecords) ? reviewRecords : [];
    for (const r of records) {
      if (!inDateRange(r.recorded_at, range.start, range.end)) continue;
      if (branchFilter) {
        const b = String(r.branch_name || r.branch || "").trim();
        if (b !== branchFilter) continue;
      }
      const st = String(r.status || "").toLowerCase();
      const dishFull = String(r.confirmed_label || r.predicted_label || "").trim() || "غير محدد";
      if (!dishMap.has(dishFull)) {
        dishMap.set(dishFull, { needs: 0, rejected: 0, approved: 0, other: 0 });
      }
      const bucket = dishMap.get(dishFull);
      if (st === "rejected") bucket.rejected += 1;
      else if (st === "approved") bucket.approved += 1;
      else if (st === "needs_review" || st === "pending_review") bucket.needs += 1;
      else bucket.other += 1;
    }
    return Array.from(dishMap.entries())
      .map(([dishFull, { needs, rejected, approved, other }]) => {
        const count = needs + rejected + approved + other;
        return {
          dishFull,
          label: axisCategoryLabel(dishFull, 34),
          count,
          needsReviewCount: needs,
          rejectedCount: rejected,
          approvedCount: approved,
          otherCount: other,
        };
      })
      .sort((a, B) => B.count - a.count)
      .slice(0, 12);
  }, [reviewRecords, range.start, range.end, branchFilter]);

  const branchBarData = useMemo(() => {
    const counts = new Map();
    for (const r of filteredViolations) {
      const raw = String(r.branch_name || r.branch || "").trim();
      const branchFull = raw.length ? raw : "غير محدد";
      counts.set(branchFull, (counts.get(branchFull) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([branchFull, count]) => ({
        branchFull,
        label: axisCategoryLabel(branchFull, 36),
        count,
      }))
      .sort((a, B) => B.count - a.count)
      .slice(0, 12);
  }, [filteredViolations]);

  const timeSeriesData = useMemo(() => {
    // Bucket alerts by calendar day/week/month in Asia/Riyadh. The previous
    // implementation used local-time `getFullYear/getMonth/getDate`, which on
    // a non-Riyadh device would shift a late-night violation into the next
    // day. We now derive Y-M-D from the Riyadh calendar key.
    const bucketFormat = (raw) => {
      const dt = parseDishRecordedAt(raw);
      if (!Number.isFinite(dt.getTime())) return "";
      const ymd = riyadhDateKey(dt); // "YYYY-MM-DD" in Asia/Riyadh
      if (!ymd) return "";
      const [y, m, day] = ymd.split("-");
      if (alertGranularity === "day") return `${y}-${m}-${day}`;
      if (alertGranularity === "week") {
        // Week-of-year based on the Riyadh calendar date.
        const utcMid = new Date(Date.UTC(Number(y), Number(m) - 1, Number(day)));
        const oneJan = new Date(Date.UTC(Number(y), 0, 1));
        const dayOfYear = Math.floor((utcMid - oneJan) / 86400000) + 1;
        const week = Math.ceil((dayOfYear + oneJan.getUTCDay()) / 7);
        return `${y}-W${String(week).padStart(2, "0")}`;
      }
      return `${y}-${m}`;
    };

    const counts = new Map();
    for (const r of filteredViolations) {
      const key = bucketFormat(r.created_at);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(-36);
  }, [filteredViolations, alertGranularity]);

  /** Pie slices grouped by Arabic label (merges synonyms like improper_uniform / no_uniform). */
  const pieViolationData = useMemo(() => {
    const byLabel = new Map();
    for (const r of filteredViolations) {
      const raw = String(r.type || r.violation_type || "").trim();
      const labelAr = getViolationLabel(raw || "unknown");
      byLabel.set(labelAr, (byLabel.get(labelAr) || 0) + 1);
    }
    return Array.from(byLabel.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [filteredViolations]);

  const staffBarData = useMemo(() => {
    const counts = new Map();
    const records = Array.isArray(reviewRecords) ? reviewRecords : [];
    for (const r of records) {
      if (!inDateRange(r.recorded_at, range.start, range.end)) continue;
      if (branchFilter) {
        const b = String(r.branch_name || r.branch || "").trim();
        if (b !== branchFilter) continue;
      }
      const st = String(r.status || "").toLowerCase();
      if (!["needs_review", "pending_review", "rejected"].includes(st)) continue;
      const empFull = String(r.employee_name || r.employee_email || "").trim() || "غير محدد";
      counts.set(empFull, (counts.get(empFull) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([employeeFull, count]) => ({
        employeeFull,
        label: axisCategoryLabel(employeeFull, 34),
        count,
      }))
      .sort((a, B) => B.count - a.count)
      .slice(0, 12);
  }, [reviewRecords, range.start, range.end, branchFilter]);

  const emptyChart = (
    <div className="flex h-[240px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#060d1f]/40 text-sm text-slate-500">
      لا توجد بيانات ضمن الفلاتر الحالية
    </div>
  );

  /** Horizontal bars: one row ≈ 38px so labels stay readable */
  const categoryChartHeight = (n) => Math.min(560, Math.max(268, n * 38 + 40));

  const hBarMargin = { top: 12, right: 20, left: 12, bottom: 12 };

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex flex-wrap gap-3 rounded-xl border border-white/10 bg-[#070f24]/80 p-4">
        <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[11px] text-slate-400">
          الفرع
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded-xl border border-white/15 bg-[#0B1327]/90 px-3 py-2 text-sm text-white"
          >
            <option value="">كل الفروع</option>
            {branchOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[11px] text-slate-400">
          نوع المخالفة (مراقبة)
          <select
            value={violationTypeFilter}
            onChange={(e) => setViolationTypeFilter(e.target.value)}
            className="rounded-xl border border-white/15 bg-[#0B1327]/90 px-3 py-2 text-sm text-white"
          >
            <option value="">كل الأنواع</option>
            {violationTypeOptions.map((t) => (
              <option key={t} value={t}>
                {getViolationLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[11px] text-slate-400">
          تجميع المخالفات زمنياً
          <select
            value={alertGranularity}
            onChange={(e) => setAlertGranularity(e.target.value)}
            className="rounded-xl border border-white/15 bg-[#0B1327]/90 px-3 py-2 text-sm text-white"
          >
            <option value="day">يومي</option>
            <option value="week">أسبوعي</option>
            <option value="month">شهري</option>
          </select>
        </label>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-[#060d1f]/50 p-4 transition hover:border-white/14">
          <div className="mb-3">
            <h4 className="text-sm font-bold text-white">تحليل الأطباق حسب الفرع والفترة الزمنية</h4>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              المحور الأفقي: عدد السجلات خلال الفترة المحددة · الأطباق على الجانب؛ البيانات من سجلات المراجعة مع فلتر
              الفرع والتواريخ أعلاه.
            </p>
          </div>
          {dishBarData.length === 0 ? (
            emptyChart
          ) : (
            <div dir="ltr" className="w-full min-w-0 overflow-x-auto" style={{ height: categoryChartHeight(dishBarData.length) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={dishBarData} margin={hBarMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" horizontal={false} vertical strokeOpacity={0.9} />
                  <XAxis type="number" tick={X_VALUE_TICK} allowDecimals={false} stroke="rgba(148,163,184,0.28)" />
                  <YAxis
                    type="category"
                    dataKey="label"
                    orientation="right"
                    width={182}
                    tick={CATEGORY_Y_TICK}
                    interval={0}
                    stroke="rgba(148,163,184,0.28)"
                  />
                  <Tooltip content={<DishReviewsTooltip />} cursor={{ fill: "rgba(56,189,248,0.08)" }} />
                  <Bar dataKey="count" radius={[0, 8, 8, 0]} barSize={22} maxBarSize={26} animationDuration={0}>
                    {dishBarData.map((_, i) => (
                      <Cell key={`dish-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#060d1f]/50 p-4 transition hover:border-white/14">
          <div className="mb-3">
            <h4 className="text-sm font-bold text-white">مخالفات المراقبة حسب الفرع</h4>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              الفروع بجانب كل شريط؛ التلميح يعرض الاسم كاملاً عند الحاجة.
            </p>
          </div>
          {branchBarData.length === 0 ? (
            emptyChart
          ) : (
            <div dir="ltr" className="w-full min-w-0 overflow-x-auto" style={{ height: categoryChartHeight(branchBarData.length) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={branchBarData} margin={hBarMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" horizontal={false} vertical strokeOpacity={0.9} />
                  <XAxis type="number" tick={X_VALUE_TICK} allowDecimals={false} stroke="rgba(148,163,184,0.28)" />
                  <YAxis
                    type="category"
                    dataKey="label"
                    orientation="right"
                    width={182}
                    tick={CATEGORY_Y_TICK}
                    interval={0}
                    stroke="rgba(148,163,184,0.28)"
                  />
                  <Tooltip content={<BranchViolationsTooltip />} cursor={{ fill: "rgba(56,189,248,0.08)" }} />
                  <Bar dataKey="count" radius={[0, 8, 8, 0]} barSize={22} maxBarSize={26} animationDuration={0}>
                    {branchBarData.map((_, i) => (
                      <Cell key={`br-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-[#060d1f]/50 p-4 transition hover:border-white/14">
          <div className="mb-3">
            <h4 className="text-sm font-bold text-white">المخالفات عبر الزمن</h4>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              {`منحنى بعدد السجلات لكل فترة (${alertGranularity === "day" ? "يومي" : alertGranularity === "week" ? "أسبوعي" : "شهري"})`}
            </p>
          </div>
          {timeSeriesData.length === 0 ? (
            emptyChart
          ) : (
            <div dir="ltr" className="h-[320px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeSeriesData} margin={{ top: 16, right: 16, left: 8, bottom: 52 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                  <XAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: "#f1f5f9", fontSize: 12, fontWeight: 600 }}
                    stroke="rgba(148,163,184,0.35)"
                    tickFormatter={formatPeriodAxisLabel}
                    interval={0}
                    angle={timeSeriesData.length > 10 ? -38 : 0}
                    textAnchor={timeSeriesData.length > 10 ? "end" : "middle"}
                    height={timeSeriesData.length > 10 ? 62 : 40}
                    tickMargin={12}
                  />
                  <YAxis
                    type="number"
                    tick={{ fill: "#cbd5e1", fontSize: 12 }}
                    allowDecimals={false}
                    stroke="rgba(148,163,184,0.35)"
                    width={44}
                  />
                  <Tooltip content={<LineViolationsTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="count"
                    name="المخالفات"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#7dd3fc" }}
                    activeDot={{ r: 5 }}
                    animationDuration={0}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#060d1f]/50 p-4 transition hover:border-white/14">
          <div className="mb-3">
            <h4 className="text-sm font-bold text-white">أكثر المخالفات تكرارًا</h4>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">توزيع الأنواع بالعربية فقط ضمن الفلاتر الحالية.</p>
          </div>
          {pieViolationData.length === 0 ? (
            emptyChart
          ) : (
            <div dir="ltr" className="h-[340px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 4, right: 8, bottom: 88, left: 8 }}>
                  <Pie
                    data={pieViolationData}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="42%"
                    innerRadius={48}
                    outerRadius={78}
                    paddingAngle={2}
                    animationDuration={0}
                  >
                    {pieViolationData.map((_, i) => (
                      <Cell key={`pie-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="rgba(15,23,42,0.85)" />
                    ))}
                  </Pie>
                  <Tooltip content={<PieViolationTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    layout="horizontal"
                    align="center"
                    wrapperStyle={{
                      fontSize: "13px",
                      color: "#f1f5f9",
                      paddingTop: "16px",
                      lineHeight: "1.55",
                      fontWeight: 500,
                      width: "100%",
                    }}
                    formatter={(value) => (
                      <span style={{ color: "#f8fafc", fontWeight: 600 }}>{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6">
        <div className="rounded-2xl border border-white/10 bg-[#060d1f]/50 p-4 transition hover:border-white/14">
          <div className="mb-3">
            <h4 className="text-sm font-bold text-white">أكثر الموظفين ظهوراً في سجلات تحتاج مراجعة</h4>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              من سجلات الأطباق مع فلتر الفرع؛ الأسماء بجانب كل شريط.
            </p>
          </div>
          {staffBarData.length === 0 ? (
            emptyChart
          ) : (
            <div dir="ltr" className="w-full min-w-0 overflow-x-auto" style={{ height: categoryChartHeight(staffBarData.length) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={staffBarData} margin={hBarMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" horizontal={false} vertical strokeOpacity={0.9} />
                  <XAxis type="number" tick={X_VALUE_TICK} allowDecimals={false} stroke="rgba(148,163,184,0.28)" />
                  <YAxis
                    type="category"
                    dataKey="label"
                    orientation="right"
                    width={182}
                    tick={CATEGORY_Y_TICK}
                    interval={0}
                    stroke="rgba(148,163,184,0.28)"
                  />
                  <Tooltip content={<StaffReviewsTooltip />} cursor={{ fill: "rgba(56,189,248,0.08)" }} />
                  <Bar dataKey="count" radius={[0, 8, 8, 0]} barSize={22} maxBarSize={26} animationDuration={0}>
                    {staffBarData.map((_, i) => (
                      <Cell key={`st-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(ReportsAnalyticsCharts);
