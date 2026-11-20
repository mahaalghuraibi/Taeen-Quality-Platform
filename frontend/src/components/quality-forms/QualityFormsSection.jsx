import { useCallback, useEffect, useState } from "react";
import {
  createSession,
  fetchBranches,
  fetchCurrentUser,
  fetchSession,
  fetchStageDefinitions,
  submitStage,
} from "../../services/qualityFormsApi.js";
import StageFormModal from "./StageFormModal.jsx";

const MEAL_PERIODS = [
  { value: "breakfast", label: "الإفطار" },
  { value: "lunch", label: "الغداء" },
  { value: "dinner", label: "العشاء" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function StageStatusBadge({ status }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
        مكتملة
      </span>
    );
  }
  if (status === "not_started") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/35 bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-400">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-400" aria-hidden />
        لم تبدأ
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-500">
      غير متاحة
    </span>
  );
}

/**
 * Quality Control Forms section.
 * Props:
 *   getAccessToken  — () => string | null
 *   role            — "supervisor" | "admin"
 */
export default function QualityFormsSection({ getAccessToken, role }) {
  const [mealDate, setMealDate] = useState(todayIso);
  const [mealPeriod, setMealPeriod] = useState("lunch");
  const [session, setSession] = useState(null);
  const [stageDefinitions, setStageDefinitions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Branch state
  const [currentUser, setCurrentUser] = useState(null);
  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(false);

  // Modal state
  const [modalStage, setModalStage] = useState(null);
  const [viewStage, setViewStage] = useState(null);

  useEffect(() => {
    const token = getAccessToken?.();
    if (!token) return;
    fetchStageDefinitions({ token }).then((r) => {
      if (r.ok && Array.isArray(r.data)) setStageDefinitions(r.data);
    });
    fetchCurrentUser({ token }).then((r) => {
      if (r.ok) setCurrentUser(r.data);
    });
  }, [getAccessToken]);

  useEffect(() => {
    if (role !== "admin") return;
    const token = getAccessToken?.();
    if (!token) return;
    setBranchesLoading(true);
    fetchBranches({ token }).then((r) => {
      setBranchesLoading(false);
      if (r.ok && Array.isArray(r.data)) {
        setBranches(r.data);
        if (r.data.length > 0) setSelectedBranchId(String(r.data[0].id));
      }
    });
  }, [role, getAccessToken]);

  const refreshSession = useCallback(async (sessionId) => {
    const token = getAccessToken?.();
    if (!token || !sessionId) return;
    const result = await fetchSession({ token, sessionId });
    if (result.ok) setSession(result.data);
  }, [getAccessToken]);

  const handleStart = useCallback(async () => {
    const token = getAccessToken?.();
    if (!token) return;
    if (role === "admin" && !selectedBranchId) {
      setError("يرجى اختيار المطبخ أولاً.");
      return;
    }
    setLoading(true);
    setError("");
    setSession(null);
    const result = await createSession({
      token,
      meal_date: mealDate,
      meal_period: mealPeriod,
      branch_id: role === "admin" ? Number(selectedBranchId) : undefined,
    });
    setLoading(false);
    if (!result.ok) {
      const msg = result.body?.detail ?? "تعذر فتح الجلسة. تحقق من إعدادات الحساب.";
      setError(typeof msg === "string" ? msg : "خطأ في فتح الجلسة");
      return;
    }
    setSession(result.data);
  }, [getAccessToken, mealDate, mealPeriod, role, selectedBranchId]);

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

  // Derive stage rows — names come from API data (backend source of truth)
  const stageRows = Array.from({ length: 5 }, (_, i) => {
    const stageNumber = i + 1;
    const def = stageDefinitions.find((d) => d.stage_number === stageNumber);
    const hasQuestions = Array.isArray(def?.questions) && def.questions.length > 0;
    const submittedStage = session?.stages?.find((s) => s.stage_number === stageNumber);

    let status = "unavailable";
    if (hasQuestions) status = submittedStage ? "completed" : "not_started";

    return { stageNumber, def, hasQuestions, submittedStage, status };
  });

  const branchLabel = role === "admin" ? null : (currentUser?.branch_name ?? "جارٍ التحميل...");

  const selectedMealLabel = MEAL_PERIODS.find((p) => p.value === mealPeriod)?.label ?? mealPeriod;

  return (
    <>
      <div dir="rtl" className="mx-auto max-w-2xl">

        {/* ── Step 1–3: Selection card ─────────────────────────────────── */}
        <div className="rounded-2xl border border-white/10 bg-[#0f172a] p-5 sm:p-6">
          <h2 className="mb-1 text-base font-bold text-white">نموذج مراقبة الجودة</h2>
          <p className="mb-5 text-xs text-slate-500">اختر المطبخ والتاريخ والوجبة ثم ابدأ الفحص.</p>

          <div className="flex flex-col gap-4">

            {/* Kitchen */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">المطبخ</label>
              {role === "admin" ? (
                branchesLoading ? (
                  <div className="rounded-xl border border-white/10 bg-[#0B1327]/80 px-3 py-2.5 text-sm text-slate-500">
                    جارٍ تحميل الفروع...
                  </div>
                ) : (
                  <select
                    value={selectedBranchId}
                    onChange={(e) => { setSelectedBranchId(e.target.value); setSession(null); setError(""); }}
                    className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500/50"
                  >
                    {branches.length === 0 && <option value="">لا توجد فروع</option>}
                    {branches.map((b) => (
                      <option key={b.id} value={String(b.id)}>{b.branch_name}</option>
                    ))}
                  </select>
                )
              ) : (
                <div className="rounded-xl border border-white/10 bg-[#0B1327]/60 px-3 py-2.5 text-sm text-slate-200">
                  {branchLabel}
                </div>
              )}
            </div>

            {/* Date + Meal */}
            <div className="flex flex-wrap gap-4">
              <div className="flex min-w-[140px] flex-1 flex-col gap-1.5">
                <label htmlFor="qf-date" className="text-xs font-semibold text-slate-400">التاريخ</label>
                <input
                  id="qf-date"
                  type="date"
                  value={mealDate}
                  onChange={(e) => { setMealDate(e.target.value); setSession(null); setError(""); }}
                  className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500/50"
                />
              </div>
              <div className="flex min-w-[140px] flex-1 flex-col gap-1.5">
                <label htmlFor="qf-period" className="text-xs font-semibold text-slate-400">الوجبة</label>
                <select
                  id="qf-period"
                  value={mealPeriod}
                  onChange={(e) => { setMealPeriod(e.target.value); setSession(null); setError(""); }}
                  className="rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500/50"
                >
                  {MEAL_PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={loading || (role === "admin" && branchesLoading)}
              className="mt-1 w-full rounded-xl border border-sky-500/40 bg-sky-500/15 py-2.5 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "جارٍ الفتح..." : session ? "تحديث الجلسة" : "بدء الفحص"}
            </button>
          </div>
        </div>

        {/* ── Step 4–5: Stage list ─────────────────────────────────────── */}
        {session && (
          <div className="mt-5">
            {/* Session context */}
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-300">مراحل الفحص</h3>
              <span className="text-xs text-slate-500">
                {selectedMealLabel} · {mealDate}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {stageRows.map(({ stageNumber, def, hasQuestions, submittedStage, status }) => (
                <div
                  key={stageNumber}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition ${
                    status === "completed"
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : status === "not_started"
                      ? "border-sky-500/20 bg-[#0f172a]"
                      : "border-white/8 bg-[#0f172a]/60"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                        status === "completed"
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                          : status === "not_started"
                          ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                          : "border-white/15 bg-white/5 text-slate-500"
                      }`}
                    >
                      {stageNumber}
                    </span>
                    <span className={`truncate text-sm font-medium ${status === "unavailable" ? "text-slate-500" : "text-slate-200"}`}>
                      {def?.name_ar ?? `المرحلة ${stageNumber}`}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <StageStatusBadge status={status} />
                    <button
                      type="button"
                      onClick={() => handleStageClick(stageNumber)}
                      disabled={!def}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        status === "completed"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                          : status === "not_started"
                          ? "border-sky-500/35 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"
                          : "border-white/10 bg-white/5 text-slate-500 hover:border-white/20 hover:text-slate-400"
                      }`}
                    >
                      {status === "completed" ? "عرض" : status === "not_started" ? "بدء" : "تفاصيل"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-3 text-xs text-slate-500">
              المراحل غير المتاحة لم يُضَف لها أسئلة بعد من قِبَل الإدارة ولا يمكن تعبئتها حالياً.
            </p>
          </div>
        )}
      </div>

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
