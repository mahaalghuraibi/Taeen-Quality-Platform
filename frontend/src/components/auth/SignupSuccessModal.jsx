import { useEffect } from "react";

/**
 * Centered confirmation modal shown after a successful signup.
 * Auto-redirects after `autoCloseMs` and closes when the user taps the button.
 */
export default function SignupSuccessModal({
  open,
  onClose,
  autoCloseMs = 1800,
  message = "تم إنشاء الحساب بنجاح",
  ctaLabel = "متابعة لتسجيل الدخول",
}) {
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => onClose?.(), autoCloseMs);
    return () => clearTimeout(t);
  }, [open, autoCloseMs, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="signup-success-title"
    >
      <div className="w-full max-w-sm rounded-2xl border border-emerald-400/30 bg-[#0c1626] p-6 text-center shadow-2xl ring-1 ring-emerald-400/15">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/15">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="11" stroke="rgb(74 222 128)" strokeWidth="1.6" />
            <path d="M7.5 12.5l3 3 6-6" stroke="rgb(74 222 128)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 id="signup-success-title" className="mt-4 text-lg font-bold text-white">
          {message}
        </h2>
        <p className="mt-1 text-sm text-slate-400">سيتم تحويلك تلقائيًا إلى صفحة تسجيل الدخول.</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-emerald-500/90 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}
