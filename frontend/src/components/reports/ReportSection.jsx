import { memo, useState } from "react";

/**
 * Collapsible report section — summary visible first, full content behind [عرض المزيد].
 */
function ReportSection({
  id,
  title,
  subtitle,
  accentClass = "border-violet-500/30",
  defaultOpen = false,
  summary,
  children,
}) {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <section id={id} className={`mb-6 rounded-2xl border bg-[#0a1020] ${accentClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/5 px-4 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-white">{title}</h3>
          {subtitle ? <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((o) => !o)}
          className="shrink-0 rounded-lg border border-white/10 bg-[#0f172a] px-4 py-2 text-xs font-semibold text-slate-200 hover:border-white/20"
        >
          {expanded ? "عرض أقل ↑" : "عرض المزيد ↓"}
        </button>
      </div>
      {summary ? <div className="px-4 py-3">{summary}</div> : null}
      {expanded ? <div className="border-t border-white/5 px-4 py-4">{children}</div> : null}
    </section>
  );
}

export default memo(ReportSection);
