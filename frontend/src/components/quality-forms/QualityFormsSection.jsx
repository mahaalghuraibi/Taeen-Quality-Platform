import { useCallback, useEffect, useState } from "react";
import {
  createSession,
  fetchSession,
  fetchStageDefinitions,
  submitStage,
} from "../../services/qualityFormsApi.js";
import MealSessionCard from "./MealSessionCard.jsx";
import StageFormModal from "./StageFormModal.jsx";

const MEAL_PERIODS = [
  { value: "breakfast", label: "الإفطار" },
  { value: "lunch", label: "الغداء" },
  { value: "dinner", label: "العشاء" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Quality Control Forms section — rendered inside Dashboard.jsx.
 * Props:
 *   sectionRef      — forwarded to <section id="quality-forms">
 *   sectionClassName — Tailwind classes for the section wrapper
 *   getAccessToken  — () => string | null
 */
export default function QualityFormsSection({ sectionRef, sectionClassName = "", getAccessToken }) {
  const [mealDate, setMealDate] = useState(todayIso);
  const [mealPeriod, setMealPeriod] = useState("lunch");
  const [session, setSession] = useState(null);
  const [stageDefinitions, setStageDefinitions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modalStage, setModalStage] = useState(null);
  const [viewStage, setViewStage] = useState(null);

  useEffect(() => {
    const token = getAccessToken?.();
    if (!token) return;
    fetchStageDefinitions({ token }).then((r) => {
      if (r.ok && Array.isArray(r.data)) setStageDefinitions(r.data);
    });
  }, [getAccessToken]);

  const openSession = useCallback(async () => {
    const token = getAccessToken?.();
    if (!token) return;
    setLoading(true);
    setError("");
    const result = await createSession({ token, meal_date: mealDate, meal_period: mealPeriod });
    setLoading(false);
    if (!result.ok) {
      const msg = result.body?.detail ?? "تعذر فتح الجلسة. تحقق من إعدادات الحساب.";
      setError(typeof msg === "string" ? msg : "خطأ في فتح الجلسة");
      return;
    }
    setSession(result.data);
  }, [getAccessToken, mealDate, mealPeriod]);

  const refreshSession = useCallback(async (sessionId) => {
    const token = getAccessToken?.();
    if (!token || !sessionId) return;
    const result = await fetchSession({ token, sessionId });
    if (result.ok) setSession(result.data);
  }, [getAccessToken]);

  async function handleStageSubmit({ answers, notes }) {
    const token = getAccessToken?.();
    if (!token || !session || !modalStage) return { ok: false, error: "خطأ في المصادقة" };
    const result = await submitStage({
      token,
      sessionId: session.id,
      stageNumber: modalStage.stage_number,
      answers: answers ?? {},
      notes,
    });
    if (result.ok) {
      setModalStage(null);
      await refreshSession(session.id);
    }
    return result.ok
      ? { ok: true }
      : { ok: false, error: result.body?.detail ?? "تعذر الحفظ" };
  }

  function handleStageClick(stageNumber) {
    const def = stageDefinitions.find((d) => d.stage_number === stageNumber);
    if (!def) return;
    const submittedStage = session?.stages?.find((s) => s.stage_number === stageNumber);
    if (submittedStage) {
      setViewStage({ def, submitted: submittedStage });
    } else {
      setModalStage(def);
    }
  }

  return (
    <>
      <section
        id="quality-forms"
        ref={sectionRef}
        className={`${sectionClassName} mb-8 scroll-mt-28 sm:scroll-mt-32`}
        dir="rtl"
      >
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h3 className="text-lg font-bold text-white">نماذج مراقبة الجودة</h3>
            <p className="mt-0.5 text-sm text-slate-400">
              تتبع مراحل الجودة الخمس لكل وجبة بشكل منظم وموثق.
            </p>
          </div>
          {session && (
            <button
              type="button"
              onClick={() => void refreshSession(session.id)}
              className="rounded-xl border border-brand-sky/35 bg-brand/15 px-3 py-2 text-xs font-semibold text-brand-sky transition hover:bg-brand/25"
            >
              تحديث
            </button>
          )}
        </div>

        {/* Controls */}
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="qf-date" className="text-xs font-medium text-slate-400">
              التاريخ
            </label>
            <input
              id="qf-date"
              type="date"
              value={mealDate}
              onChange={(e) => { setMealDate(e.target.value); setSession(null); setError(""); }}
              className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500/50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="qf-period" className="text-xs font-medium text-slate-400">
              وجبة
            </label>
            <select
              id="qf-period"
              value={mealPeriod}
              onChange={(e) => { setMealPeriod(e.target.value); setSession(null); setError(""); }}
              className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500/50"
            >
              {MEAL_PERIODS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void openSession()}
            disabled={loading}
            className="rounded-xl border border-sky-500/40 bg-sky-500/15 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "جارٍ الفتح..." : session ? "تحديث الجلسة" : "فتح جلسة"}
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!session && !loading && !error && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/15 bg-[#060d1f]/60 py-10 text-center">
            <span className="text-3xl" aria-hidden>📋</span>
            <p className="text-sm font-semibold text-slate-300">لا توجد جلسة مفتوحة</p>
            <p className="text-xs text-slate-500">
              اختر التاريخ والوجبة ثم اضغط «فتح جلسة» لبدء متابعة مراحل الجودة.
            </p>
          </div>
        )}

        {session && (
          <MealSessionCard
            session={session}
            stageDefinitions={stageDefinitions}
            onStageClick={handleStageClick}
          />
        )}

      </section>

      {modalStage && (
        <StageFormModal
          stage={modalStage}
          onClose={() => setModalStage(null)}
          onSubmit={handleStageSubmit}
        />
      )}

      {viewStage && (
        <StageFormModal
          stage={viewStage.def}
          submittedData={viewStage.submitted}
          readOnly
          onClose={() => setViewStage(null)}
        />
      )}
    </>
  );
}
