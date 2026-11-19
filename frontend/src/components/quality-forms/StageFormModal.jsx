import { useState } from "react";

const ANSWER_LABEL = { yes: "نعم", no: "لا" };

/**
 * Modal for a quality-form stage — three modes:
 *   readOnly    view submitted answers (done stages)
 *   hasQuestions  submit form with Yes/No questions (Stage 3)
 *   no questions  "not configured" notice — submission blocked (Stages 1,2,4,5)
 *
 * Props:
 *   stage         — { stage_number, name_ar, questions: [{id, text_ar, required}] }
 *   submittedData — { answers, notes, submitted_by_name } — required when readOnly
 *   readOnly      — boolean
 *   onClose       — () => void
 *   onSubmit      — ({ answers, notes }) => Promise<{ ok, error }>
 */
export default function StageFormModal({ stage, submittedData, readOnly, onClose, onSubmit }) {
  const questions = stage?.questions ?? [];
  const hasQuestions = questions.length > 0;

  const [answers, setAnswers] = useState({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [attempted, setAttempted] = useState(false);

  const requiredIds = questions.filter((q) => q.required).map((q) => q.id);
  const unansweredIds = new Set(
    requiredIds.filter((id) => !["yes", "no"].includes(answers[id]))
  );

  async function handleSubmit(e) {
    e.preventDefault();
    setAttempted(true);
    if (unansweredIds.size > 0) return;
    setSubmitError("");
    setSubmitting(true);
    const result = await onSubmit({ answers, notes: notes.trim() || null });
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error || "حدث خطأ أثناء الحفظ. حاول مرة أخرى.");
    }
  }

  // ── Shared modal shell ────────────────────────────────────────────────────
  function Shell({ children }) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-12"
        role="dialog"
        aria-modal="true"
        aria-label={`نموذج المرحلة ${stage?.stage_number}`}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1526] p-6 shadow-2xl"
          dir="rtl"
        >
          {/* Header */}
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-sky-400">
                المرحلة {stage?.stage_number}
              </p>
              <h3 className="mt-0.5 text-lg font-bold text-white">{stage?.name_ar}</h3>
              {readOnly && submittedData?.submitted_by_name && (
                <p className="mt-1 text-xs text-slate-500">
                  بواسطة {submittedData.submitted_by_name}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="إغلاق"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      </div>
    );
  }

  // ── Mode 1: View submitted answers ───────────────────────────────────────
  if (readOnly) {
    if (!submittedData) {
      return (
        <Shell>
          <p className="text-sm text-slate-400">جارٍ التحميل...</p>
        </Shell>
      );
    }
    return (
      <Shell>
        <div className="space-y-3">
          {hasQuestions ? (
            <ul className="space-y-2">
              {questions.map((q) => {
                const ans = submittedData.answers?.[q.id];
                return (
                  <li key={q.id} className="rounded-xl border border-white/10 bg-[#060d1f] p-3">
                    <p className="text-sm leading-relaxed text-slate-300">{q.text_ar}</p>
                    <p
                      className={`mt-2 text-sm font-bold ${
                        ans === "yes"
                          ? "text-emerald-400"
                          : ans === "no"
                          ? "text-red-400"
                          : "text-slate-500"
                      }`}
                    >
                      {ans ? ANSWER_LABEL[ans] ?? ans : "—"}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">لا توجد أسئلة مسجّلة لهذه المرحلة.</p>
          )}

          {submittedData.notes && (
            <div className="rounded-xl border border-white/10 bg-[#060d1f] p-3">
              <p className="mb-1 text-xs font-medium text-slate-500">ملاحظات</p>
              <p className="whitespace-pre-wrap text-sm text-slate-300">{submittedData.notes}</p>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
          >
            إغلاق
          </button>
        </div>
      </Shell>
    );
  }

  // ── Mode 2: Not configured — block submission ─────────────────────────────
  if (!hasQuestions) {
    return (
      <Shell>
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-4">
            <p className="text-sm font-semibold text-amber-200">
              لم يتم إعداد أسئلة هذه المرحلة بعد
            </p>
            <p className="mt-1.5 text-xs text-amber-300/70">
              ستُضاف أسئلة الفحص الخاصة بهذه المرحلة في الإصدار القادم بعد اعتماد النموذج الرسمي.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-white/15 bg-white/5 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
          >
            إغلاق
          </button>
        </div>
      </Shell>
    );
  }

  // ── Mode 3: Submit form with Yes/No questions ─────────────────────────────
  return (
    <Shell>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Questions */}
        <div className="space-y-3">
          {questions.map((q) => {
            const isInvalid = attempted && unansweredIds.has(q.id);
            return (
              <div
                key={q.id}
                className={`rounded-xl border p-3 transition ${
                  isInvalid
                    ? "border-red-500/50 bg-red-500/5"
                    : "border-white/10 bg-[#060d1f]"
                }`}
              >
                <p className="text-sm leading-relaxed text-slate-200">{q.text_ar}</p>
                {isInvalid && (
                  <p className="mt-1 text-xs text-red-400">يجب اختيار إجابة</p>
                )}
                <div className="mt-3 flex gap-2">
                  {["yes", "no"].map((val) => {
                    const selected = answers[q.id] === val;
                    return (
                      <label
                        key={val}
                        className={`flex flex-1 cursor-pointer select-none items-center justify-center rounded-xl border-2 py-2.5 text-sm font-bold transition ${
                          selected
                            ? val === "yes"
                              ? "border-emerald-500 bg-emerald-500/15 text-emerald-200"
                              : "border-red-500/70 bg-red-500/15 text-red-300"
                            : "border-white/15 bg-white/5 text-slate-400 hover:border-white/30"
                        }`}
                      >
                        <input
                          type="radio"
                          name={q.id}
                          value={val}
                          checked={selected}
                          onChange={() =>
                            setAnswers((prev) => ({ ...prev, [q.id]: val }))
                          }
                          className="sr-only"
                        />
                        {val === "yes" ? "نعم" : "لا"}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Validation summary */}
        {attempted && unansweredIds.size > 0 && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            يرجى الإجابة على جميع الأسئلة قبل التسليم ({unansweredIds.size} سؤال متبقٍ)
          </p>
        )}

        {/* Notes */}
        <div>
          <label htmlFor="stage-notes" className="mb-1.5 block text-sm font-medium text-slate-300">
            ملاحظات (اختياري)
          </label>
          <textarea
            id="stage-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="أضف أي ملاحظات إضافية عن هذه المرحلة..."
            className="w-full resize-none rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30"
          />
        </div>

        {submitError && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {submitError}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-xl border border-sky-500/40 bg-sky-500/15 py-2.5 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "جارٍ الحفظ..." : "تسليم المرحلة"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
          >
            إلغاء
          </button>
        </div>
      </form>
    </Shell>
  );
}
