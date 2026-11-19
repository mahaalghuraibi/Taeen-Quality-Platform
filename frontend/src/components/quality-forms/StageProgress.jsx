/**
 * Five-step progress indicator for a quality form session.
 * Props:
 *   submittedNumbers  — array of stage_number values already submitted
 *   totalStages       — total number of stages (always 5)
 *   stageDefinitions  — array of { stage_number, name_ar }
 *   onStageClick      — (stageNumber) => void — called when user clicks a step
 */
export default function StageProgress({
  submittedNumbers = [],
  totalStages = 5,
  stageDefinitions = [],
  onStageClick,
}) {
  const submittedSet = new Set(submittedNumbers);
  const nextStage = (() => {
    for (let i = 1; i <= totalStages; i++) {
      if (!submittedSet.has(i)) return i;
    }
    return null;
  })();

  return (
    <div className="mt-4" dir="rtl">
      <div className="flex items-start gap-0">
        {Array.from({ length: totalStages }, (_, i) => i + 1).map((num) => {
          const done = submittedSet.has(num);
          const isNext = num === nextStage;
          const def = stageDefinitions.find((d) => d.stage_number === num);
          const label = def?.name_ar ?? `المرحلة ${num}`;
          return (
            <div key={num} className="flex flex-1 flex-col items-center gap-1.5">
              {/* connector line before each step except the first */}
              <div className="relative flex w-full items-center justify-center">
                {num > 1 && (
                  <div
                    className={`absolute right-1/2 top-1/2 h-0.5 w-full -translate-y-1/2 ${
                      submittedSet.has(num - 1) ? "bg-emerald-500/70" : "bg-white/15"
                    }`}
                    aria-hidden
                  />
                )}
                <button
                  type="button"
                  onClick={() => onStageClick?.(num)}
                  title={done ? `عرض: ${label}` : isNext ? `افتح: ${label}` : label}
                  className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sky ${
                    done
                      ? "border-emerald-500 bg-emerald-500/20 text-emerald-300 cursor-pointer hover:bg-emerald-500/30"
                      : isNext
                        ? "border-sky-400 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30 cursor-pointer"
                        : "border-white/20 bg-white/5 text-slate-500 cursor-pointer hover:bg-white/10"
                  }`}
                >
                  {done ? (
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      aria-hidden
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    num
                  )}
                </button>
              </div>
              <span
                className={`text-center text-[10px] leading-tight ${
                  done ? "text-emerald-400" : isNext ? "text-sky-300" : "text-slate-600"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
