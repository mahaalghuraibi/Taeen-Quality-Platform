/**
 * Dashboard section surfaces — solid dark theme.
 *
 * Performance notes (2026-05):
 *   - Removed `backdrop-blur-sm` from every theme. With 5–7 section cards
 *     stacked on a long page, the GPU was re-rasterizing a blur layer on
 *     every wheel tick → stutter + flickering cards.
 *   - Removed `transition duration-300 hover:border-*`. Hover transitions on
 *     wrapper sections triggered repaints during scroll inertia (the cursor
 *     drifts across cards while the page is still moving).
 *   - Solid background opacity raised to 0.96–1.0 so colors stay rich
 *     without translucency.
 *
 * Each entry is consumed as `<section className={SECTION_THEME.x}>` so RTL
 * and child layout remain intact.
 */
export const SECTION_THEME = {
  /** Quality & positive KPIs — emerald. */
  quality:
    "rounded-2xl border border-emerald-500/20 bg-[#061419] p-4 shadow-[0_8px_28px_-12px_rgba(52,211,153,0.18)] sm:p-6",
  /** Alerts — amber. */
  alerts:
    "rounded-2xl border border-amber-500/20 bg-[#191208] p-4 shadow-[0_8px_28px_-12px_rgba(251,191,36,0.16)] sm:p-6",
  /** Violations / risk — red. */
  violations:
    "rounded-2xl border border-red-500/20 bg-[#1c0a0c] p-4 shadow-[0_8px_28px_-12px_rgba(248,113,113,0.14)] sm:p-6",
  /** Cameras & streaming — sky / blue. */
  cameras:
    "rounded-2xl border border-sky-500/22 bg-[#081220] p-4 shadow-[0_8px_28px_-12px_rgba(56,189,248,0.16)] sm:p-6",
  /** Reports & analytics — violet. */
  reports:
    "rounded-2xl border border-violet-500/22 bg-[#120c1c] p-4 shadow-[0_8px_28px_-12px_rgba(167,139,250,0.14)] sm:p-6",
  /** Neutral secondary panels. */
  neutral:
    "rounded-2xl border border-white/10 bg-[#0f172a] p-4 sm:p-6",
};

/** Inner card — unified radius / padding. No hover transitions during scroll. */
export const dashboardCardInner =
  "rounded-xl border border-white/[0.08] bg-[#060d1f] px-4 py-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]";
