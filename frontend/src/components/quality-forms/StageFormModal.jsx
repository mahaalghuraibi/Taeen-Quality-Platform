import { useEffect, useRef, useState } from "react";

/**
 * Modal for submitting one quality-form stage.
 * Props:
 *   stage        — { stage_number, name_ar } from stageDefinitions
 *   sessionId    — number
 *   onClose      — () => void
 *   onSubmit     — ({ notes }) => Promise<{ ok, error }>
 */
export default function StageFormModal({ stage, onClose, onSubmit }) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const result = await onSubmit({ notes: notes.trim() || null });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error || "حدث خطأ أثناء الحفظ. حاول مرة أخرى.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`نموذج المرحلة ${stage?.stage_number}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1526] p-6 shadow-2xl"
        dir="rtl"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-sky-400">
              المرحلة {stage?.stage_number}
            </p>
            <h3 className="mt-0.5 text-lg font-bold text-white">{stage?.name_ar}</h3>
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

        {/* Placeholder notice — remove when real questions are added in Phase 3 */}
        <div className="mb-5 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
          <p className="text-sm text-amber-200">
            أسئلة هذه المرحلة قيد الإعداد وستُضاف في الإصدار القادم.
          </p>
          <p className="mt-1 text-xs text-amber-300/70">
            يمكنك إضافة ملاحظاتك الآن وسيتم تحديث النموذج لاحقاً.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="stage-notes" className="mb-1.5 block text-sm font-medium text-slate-300">
              ملاحظات (اختياري)
            </label>
            <textarea
              id="stage-notes"
              ref={textareaRef}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="أضف أي ملاحظات أو مشاهدات خاصة بهذه المرحلة..."
              className="w-full rounded-xl border border-white/15 bg-[#0B1327]/80 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30 resize-none"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
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
      </div>
    </div>
  );
}
