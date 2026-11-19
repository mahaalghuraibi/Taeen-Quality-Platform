import StageProgress from "./StageProgress.jsx";

const MEAL_PERIOD_LABEL = {
  breakfast: "الإفطار",
  lunch: "الغداء",
  dinner: "العشاء",
};

/**
 * Card displaying one quality-form session and its stage progress.
 * Props:
 *   session          — session object from API
 *   stageDefinitions — array of { stage_number, name_ar }
 *   onStageClick     — (stageNumber) => void
 */
export default function MealSessionCard({ session, stageDefinitions, onStageClick }) {
  const doneCount = session.submitted_stage_numbers?.length ?? 0;
  const total = 5;
  const periodLabel = MEAL_PERIOD_LABEL[session.meal_period] ?? session.meal_period;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#060d1f] p-4" dir="rtl">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">{periodLabel}</span>
            {session.is_complete ? (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                مكتمل
              </span>
            ) : (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                جارٍ
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {String(session.meal_date)} · بواسطة {session.created_by_name ?? "—"}
          </p>
        </div>
        <span className="text-xs text-slate-500">
          {doneCount}/{total} مراحل
        </span>
      </div>

      <StageProgress
        submittedNumbers={session.submitted_stage_numbers ?? []}
        totalStages={total}
        stageDefinitions={stageDefinitions}
        onStageClick={onStageClick}
      />
    </div>
  );
}
