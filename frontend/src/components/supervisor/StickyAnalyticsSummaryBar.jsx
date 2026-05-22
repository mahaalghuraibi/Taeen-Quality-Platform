import { memo } from "react";
import { PLATFORM_BRAND } from "../../constants/branding.js";

/** Sticky KPI strip directly under the fixed nav. */
function StickyAnalyticsSummaryBar({
  qualityLabel,
  alertsOpenCount,
  violationsCount,
  systemStatusLabel,
  activeCamerasCount,
  livePersonsCount,
  loading,
}) {
  const hasOpenAlerts =
    !loading && typeof alertsOpenCount === "number" && alertsOpenCount > 0;
  const hasViolations =
    !loading && typeof violationsCount === "number" && violationsCount > 0;

  // Solid sticky bar (no backdrop-blur) for GPU-friendly scroll performance.
  return (
    <div
      dir="rtl"
      className="sticky top-14 z-[55] border-b border-white/10 bg-[#0b1220] sm:top-16"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-6 lg:px-8">
        {/* Brand */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[11px] font-semibold text-slate-400">
            {PLATFORM_BRAND.nameShortAr}
          </span>
          <span className="hidden h-4 w-px bg-white/15 sm:block" aria-hidden />
          <span className="truncate text-[10px] text-slate-600 sm:text-[11px]">
            {PLATFORM_BRAND.taglineAr}
          </span>
        </div>

        {/* KPIs */}
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] sm:gap-x-6 sm:text-xs">
          <div className="flex items-center gap-1.5">
            <dt className="text-slate-500">الامتثال</dt>
            <dd className="font-bold tabular-nums text-emerald-300">
              {loading ? "…" : qualityLabel}
            </dd>
          </div>

          <div className="flex items-center gap-1.5">
            <dt className="text-slate-500">تنبيهات مفتوحة</dt>
            <dd
              className={`font-bold tabular-nums ${
                hasOpenAlerts ? "text-red-300" : "text-slate-400"
              }`}
            >
              {loading ? "…" : alertsOpenCount}
            </dd>
          </div>

          {livePersonsCount != null && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
              <dt className="text-slate-500">أشخاص مرصودون</dt>
              <dd className="font-bold tabular-nums text-sky-300">
                {loading ? "…" : livePersonsCount}
              </dd>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <dt className="text-slate-500">كاميرات نشطة</dt>
            <dd className="font-bold tabular-nums text-slate-300">
              {loading ? "…" : activeCamerasCount}
            </dd>
          </div>

          <div className="flex items-center gap-1.5 border-r border-white/10 pr-4 sm:pr-6">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                hasViolations ? "bg-red-400" : "bg-emerald-400"
              }`}
            />
            <dt className="text-slate-500">النظام</dt>
            <dd className="font-semibold text-slate-200">{systemStatusLabel}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export default memo(StickyAnalyticsSummaryBar);
