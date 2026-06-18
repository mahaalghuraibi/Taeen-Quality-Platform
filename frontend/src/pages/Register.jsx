import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiUrl } from "../config/apiBase.js";
import SKALogo from "../components/SKALogo.jsx";
import SignupSuccessModal from "../components/auth/SignupSuccessModal.jsx";
import { PLATFORM_BRAND, PUBLIC_PAGE_TITLES } from "../constants/branding.js";
import { AUTH_FETCH_TIMEOUT_MS, fetchWithTimeout, formatFetchError } from "../utils/fetchWithTimeout.js";
import { wakeApiBeforeAuth } from "../utils/wakeApi.js";
import {
  buildRegisterPayload,
  formatAuthError,
  logAuthFailure,
} from "../utils/authApiError.js";

/** Sentinel select value used to open the "Request New Branch" dialog. */
const REQUEST_BRANCH_VALUE = "__request_new__";

/** Fallback used only if the public branches endpoint is unreachable. */
const FALLBACK_BRANCHES = [{ id: 1, branch_name: "فرع تجريبي", city: "الرياض", is_active: true }];

function UserIcon({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 19v-1c0-2.8 2.2-5 5-5h4c2.8 0 5 2.2 5 5v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function MailIcon({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 11V8a5 5 0 0110 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="5" y="11" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="16" r="1.2" fill="currentColor" />
    </svg>
  );
}

function EyeIcon({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function EyeOffIcon({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9.9 5.1A10.4 10.4 0 0112 5c6 0 10 7 10 7a18.7 18.7 0 01-4.8 5.2M6.3 6.3A18.3 18.3 0 002 12s4 7 10 7c1 1 0 0 2.3-.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BuildingIcon({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 21h16M6 21V8l6-4 6 4v13" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 21v-5h6v5M9 13h2M13 13h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function BriefcaseIcon({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 8V6a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="8" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 14v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Spinner({ className = "" }) {
  return (
    <svg className={`animate-spin ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const inputInner =
  "w-full rounded-xl border border-white/12 bg-[#020617]/80 py-3 text-base text-white shadow-inner shadow-black/20 transition focus:border-brand-sky/45 focus:outline-none focus:ring-2 focus:ring-brand/25 sm:text-sm";
const selectBase = `${inputInner} appearance-none cursor-pointer py-[0.7rem] ps-11 pe-10`;

export default function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState("staff");
  const [branchId, setBranchId] = useState(null);
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState("");
  const inFlightRef = useRef(false);

  useEffect(() => {
    document.title = PUBLIC_PAGE_TITLES.signup;
  }, []);

  const loadBranches = useCallback(async () => {
    setBranchesLoading(true);
    try {
      await wakeApiBeforeAuth({
        maxAttempts: import.meta.env.PROD ? 2 : 1,
        timeoutMs: import.meta.env.PROD ? 25_000 : 15_000,
      });
      const res = await fetchWithTimeout(
        apiUrl("/api/v1/branches/public"),
        { headers: { Accept: "application/json" } },
        AUTH_FETCH_TIMEOUT_MS,
      );
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data) && data.length > 0) {
        setBranches(data);
        setBranchId((current) => current ?? data[0].id);
      } else {
        setBranches(FALLBACK_BRANCHES);
        setBranchId((current) => current ?? FALLBACK_BRANCHES[0].id);
      }
    } catch (err) {
      console.warn("[Register] failed to load branches:", err);
      setBranches(FALLBACK_BRANCHES);
      setBranchId((current) => current ?? FALLBACK_BRANCHES[0].id);
    } finally {
      setBranchesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  function validate() {
    const safeEmail = email.trim().toLowerCase();
    const safeName = name.trim();
    if (!safeName) return "الاسم مطلوب.";
    if (safeName.length < 2) return "الاسم يجب أن يكون حرفين على الأقل.";
    if (!safeEmail) return "البريد الإلكتروني مطلوب.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) return "أدخل بريدًا إلكترونيًا صالحًا.";
    if (password.length < 6) return "كلمة المرور يجب أن تكون 6 أحرف على الأقل.";
    if (password !== confirmPassword) return "تأكيد كلمة المرور غير مطابق.";
    if (!["staff", "supervisor", "admin"].includes(role)) return "الدور غير صالح.";
    return "";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (inFlightRef.current) return;
    setError("");

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const safeEmail = email.trim().toLowerCase();
    const safeName = name.trim();
    const selectedBranch =
      branches.find((b) => b.id === Number(branchId)) || branches[0] || FALLBACK_BRANCHES[0];
    if (!selectedBranch) {
      setError("الفرع غير متوفر. حدّث الصفحة وحاول مرة أخرى.");
      return;
    }

    inFlightRef.current = true;
    setLoading(true);
    const registerUrl = apiUrl("/api/v1/auth/users");
    try {
      const apiUp = await wakeApiBeforeAuth({
        maxAttempts: import.meta.env.PROD ? 2 : 1,
        timeoutMs: import.meta.env.PROD ? 25_000 : 15_000,
      });
      if (!apiUp) {
        setError(
          "تعذر الاتصال بالخادم. قد يكون متوقفاً أو قيد إعادة التشغيل — انتظر دقيقة ثم أعد المحاولة.",
        );
        return;
      }

      const payload = buildRegisterPayload({
        email: safeEmail,
        password,
        role,
        tenantId: 1,
        fullName: safeName,
        branchId: selectedBranch.id,
        branchName: selectedBranch.branch_name,
      });

      const res = await fetchWithTimeout(
        registerUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        },
        AUTH_FETCH_TIMEOUT_MS,
      );
      const data = await res.json().catch(() => ({}));

      if (res.status === 201 || res.status === 200) {
        setShowSuccess(true);
        return;
      }
      logAuthFailure("Register", registerUrl, res, data, {
        payload: { ...payload, password: "[redacted]" },
      });
      setError(formatAuthError(res.status, data, "تعذر إنشاء الحساب."));
    } catch (err) {
      console.error("[Register] request failed:", registerUrl, err);
      setError(formatFetchError(err, "تعذر إنشاء الحساب. تحقق من الاتصال بالإنترنت."));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-surface text-slate-100" dir="rtl">
      <div className="pointer-events-none absolute inset-0 admin-page-static-bg" />
      <div className="pointer-events-none absolute inset-0 hidden md:block">
        <div className="absolute inset-0 hero-premium-base" />
        <div className="absolute inset-0 hero-premium-mesh opacity-90" />
        <div className="hero-orb hero-orb-a" />
        <div className="hero-orb hero-orb-b" />
      </div>

      <header className="relative z-10 border-b border-white/10 bg-[#0F172A] sm:bg-[#0F172A]/85">
        <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-2.5 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center transition-opacity hover:opacity-90">
            <SKALogo />
          </Link>
          <div className="flex items-center justify-end gap-2 sm:gap-3">
            <Link to="/" className="rounded-md px-1.5 py-1 text-sm font-medium text-slate-400 transition hover:text-brand-sky">
              الرئيسية
            </Link>
            <Link
              to="/login"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/15 bg-[#1a2644] px-3.5 text-xs font-semibold text-slate-100 transition hover:border-brand-sky/40 sm:px-4 sm:text-sm"
            >
              تسجيل الدخول
            </Link>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-3 py-8 sm:px-4 sm:py-12">
        <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/12 bg-[rgba(15,23,42,0.92)] p-5 shadow-[0_25px_50px_-28px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.06] sm:rounded-3xl sm:bg-[rgba(15,23,42,0.66)] sm:p-8 sm:shadow-[0_0_60px_-12px_rgba(56,189,248,0.18),0_25px_50px_-28px_rgba(0,0,0,0.65)] sm:backdrop-blur-xl lg:p-9">
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-sky/25 bg-brand-sky/10 px-3 py-1 text-[11px] font-semibold text-brand-sky sm:text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-sky" aria-hidden />
              حساب جديد
            </div>

            <h1 className="mt-4 text-xl font-bold tracking-tight text-white sm:text-2xl lg:text-[1.65rem]">
              مرحبًا بك في {PLATFORM_BRAND.nameAr}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{PLATFORM_BRAND.taglineAr}</p>

            {error ? (
              <div
                className="mt-4 rounded-xl border border-accent-red/40 bg-accent-red/10 px-3 py-2.5 text-sm text-red-200"
                role="alert"
                aria-live="assertive"
              >
                {error}
              </div>
            ) : null}

            <form className="mt-7 space-y-5" onSubmit={handleSubmit} noValidate>
              <fieldset disabled={loading} className="space-y-5 disabled:opacity-80">
                <div>
                  <label htmlFor="name" className="mb-2 block text-sm font-semibold text-slate-300">
                    الاسم الكامل
                  </label>
                  <div className="group relative">
                    <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-500 transition group-focus-within:text-brand-sky">
                      <UserIcon className="opacity-90" />
                    </span>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className={`${inputInner} ps-11 pe-3`}
                      placeholder="الاسم كما سيظهر في المنصة"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="email" className="mb-2 block text-sm font-semibold text-slate-300">
                    البريد الإلكتروني
                  </label>
                  <div className="group relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500 transition group-focus-within:text-brand-sky">
                      <MailIcon className="opacity-90" />
                    </span>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="أدخل بريدك الإلكتروني"
                      className={`${inputInner} pl-11 pr-3 text-left`}
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
                  <div>
                    <label htmlFor="password" className="mb-2 block text-sm font-semibold text-slate-300">
                      كلمة المرور
                    </label>
                    <div className="group relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500 transition group-focus-within:text-brand-sky">
                        <LockIcon className="opacity-90" />
                      </span>
                      <input
                        id="password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className={`${inputInner} pl-11 pr-12`}
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute inset-y-0 right-2 flex h-full min-w-[44px] items-center justify-center rounded-lg px-2 text-slate-500 transition hover:bg-white/5 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
                        aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-500">6 أحرف على الأقل</p>
                  </div>

                  <div>
                    <label htmlFor="confirm-password" className="mb-2 block text-sm font-semibold text-slate-300">
                      تأكيد كلمة المرور
                    </label>
                    <div className="group relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500 transition group-focus-within:text-brand-sky">
                        <LockIcon className="opacity-90" />
                      </span>
                      <input
                        id="confirm-password"
                        name="confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        className={`${inputInner} pl-11 pr-12`}
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        className="absolute inset-y-0 right-2 flex h-full min-w-[44px] items-center justify-center rounded-lg px-2 text-slate-500 transition hover:bg-white/5 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
                        aria-label={showConfirmPassword ? "إخفاء تأكيد كلمة المرور" : "إظهار تأكيد كلمة المرور"}
                      >
                        {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
                  <div>
                    <label htmlFor="role" className="mb-2 block text-sm font-semibold text-slate-300">
                      الدور
                    </label>
                    <div className="group relative">
                      <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-slate-500 transition group-focus-within:text-brand-sky">
                        <BriefcaseIcon className="opacity-90" />
                      </span>
                      <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-slate-500">
                        <ChevronIcon />
                      </span>
                      <select
                        id="role"
                        name="role"
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        dir="rtl"
                        className={`${selectBase} text-start`}
                      >
                        <option value="staff">موظف</option>
                        <option value="supervisor">مشرف</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="branch_id" className="mb-2 block text-sm font-semibold text-slate-300">
                      الفرع
                    </label>
                    <div className="group relative">
                      <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-slate-500 transition group-focus-within:text-brand-sky">
                        <BuildingIcon className="opacity-90" />
                      </span>
                      <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-slate-500">
                        <ChevronIcon />
                      </span>
                      <select
                        id="branch_id"
                        name="branch_id"
                        value={branchId == null ? "" : String(branchId)}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === REQUEST_BRANCH_VALUE) {
                            setRequestModalOpen(true);
                            return;
                          }
                          setBranchId(Number(val));
                        }}
                        disabled={branchesLoading}
                        dir="rtl"
                        className={`${selectBase} text-start`}
                      >
                        {branchesLoading ? (
                          <option value="">جاري تحميل الفروع…</option>
                        ) : (
                          <>
                            {branches.map((branch) => (
                              <option key={branch.id} value={branch.id}>
                                {branch.branch_name}
                                {branch.city ? ` — ${branch.city}` : ""}
                              </option>
                            ))}
                            <option value={REQUEST_BRANCH_VALUE}>+ طلب فرع جديد…</option>
                          </>
                        )}
                      </select>
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      لا تجد فرعك في القائمة؟{" "}
                      <button
                        type="button"
                        onClick={() => setRequestModalOpen(true)}
                        className="font-semibold text-brand-sky transition hover:text-sky-300 hover:underline"
                      >
                        أرسل طلب لإضافته
                      </button>
                    </p>
                  </div>
                </div>

                {requestSuccess ? (
                  <div
                    className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-200"
                    role="status"
                  >
                    {requestSuccess}
                  </div>
                ) : null}

                <div>
                  <button
                    type="submit"
                    disabled={loading}
                    aria-busy={loading}
                    className="relative flex min-h-[48px] w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-l from-brand via-blue-600 to-brand py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
                  >
                    {loading ? <Spinner className="text-white" /> : null}
                    <span>{loading ? "جاري إنشاء الحساب…" : "إنشاء الحساب"}</span>
                  </button>
                </div>
              </fieldset>
            </form>

            <p className="mt-6 text-center text-sm text-slate-400">
              لديك حساب بالفعل؟{" "}
              <Link
                to="/login"
                className="font-semibold text-brand-sky underline-offset-4 transition hover:text-sky-300 hover:underline"
              >
                تسجيل الدخول
              </Link>
            </p>
            <p className="mt-3 text-center text-xs text-slate-500">
              <Link to="/" className="transition hover:text-brand-sky">
                العودة للرئيسية
              </Link>
            </p>
          </div>
        </div>
      </div>

      <SignupSuccessModal
        open={showSuccess}
        onClose={() => {
          setShowSuccess(false);
          navigate("/login", { replace: true });
        }}
      />

      <BranchRequestModal
        open={requestModalOpen}
        defaultEmail={email}
        defaultName={name}
        onClose={() => setRequestModalOpen(false)}
        onSubmitted={(submittedName) => {
          setRequestModalOpen(false);
          setRequestSuccess(
            `تم إرسال طلب إضافة "${submittedName}" — سيراجعه المسؤول وستظهر القائمة محدّثة لاحقاً.`,
          );
        }}
      />
    </div>
  );
}

function BranchRequestModal({ open, defaultName, defaultEmail, onClose, onSubmitted }) {
  const [branchName, setBranchName] = useState("");
  const [city, setCity] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setBranchName("");
      setCity("");
      setReason("");
      setContactName(defaultName || "");
      setContactEmail(defaultEmail || "");
      setErr("");
    }
  }, [open, defaultName, defaultEmail]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    const trimmedBranch = branchName.trim();
    const trimmedName = contactName.trim();
    const trimmedEmail = contactEmail.trim().toLowerCase();
    if (trimmedBranch.length < 2) {
      setErr("اسم الفرع يجب أن يكون حرفين على الأقل.");
      return;
    }
    if (!trimmedName) {
      setErr("الاسم مطلوب.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setErr("أدخل بريداً إلكترونياً صالحاً.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetchWithTimeout(
        apiUrl("/api/v1/branches/requests"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            branch_name: trimmedBranch,
            city: city.trim() || null,
            reason: reason.trim() || null,
            requested_by_name: trimmedName,
            requested_by_email: trimmedEmail,
          }),
        },
        AUTH_FETCH_TIMEOUT_MS,
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 201 || res.status === 200) {
        onSubmitted?.(trimmedBranch);
        return;
      }
      const detail = typeof data?.detail === "string" ? data.detail : "";
      setErr(detail || "تعذر إرسال الطلب. حاول مرة أخرى.");
    } catch (e2) {
      setErr(formatFetchError(e2, "تعذر إرسال الطلب. تحقق من الاتصال."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/12 bg-[#0f172a] p-5 shadow-[0_25px_50px_-28px_rgba(0,0,0,0.85)]"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">طلب إضافة فرع جديد</h2>
            <p className="mt-1 text-xs text-slate-400">
              سيُراجَع طلبك من قبل المسؤول. ستتمكن من اختيار الفرع بعد الموافقة.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded-md p-1 text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            ✕
          </button>
        </div>

        {err ? (
          <div className="mt-3 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-sm text-red-200">
            {err}
          </div>
        ) : null}

        <form className="mt-4 space-y-3" onSubmit={handleSubmit} noValidate>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">اسم الفرع *</label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              required
              className="w-full rounded-lg border border-white/12 bg-[#020617]/80 px-3 py-2 text-sm text-white focus:border-brand-sky/45 focus:outline-none focus:ring-2 focus:ring-brand/25"
              placeholder="مثال: فرع الدمام"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">المدينة</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-lg border border-white/12 bg-[#020617]/80 px-3 py-2 text-sm text-white focus:border-brand-sky/45 focus:outline-none focus:ring-2 focus:ring-brand/25"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">اسمك *</label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                required
                className="w-full rounded-lg border border-white/12 bg-[#020617]/80 px-3 py-2 text-sm text-white focus:border-brand-sky/45 focus:outline-none focus:ring-2 focus:ring-brand/25"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">بريدك الإلكتروني *</label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                required
                dir="ltr"
                className="w-full rounded-lg border border-white/12 bg-[#020617]/80 px-3 py-2 text-sm text-white focus:border-brand-sky/45 focus:outline-none focus:ring-2 focus:ring-brand/25"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">سبب الطلب</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-white/12 bg-[#020617]/80 px-3 py-2 text-sm text-white focus:border-brand-sky/45 focus:outline-none focus:ring-2 focus:ring-brand/25"
              placeholder="اختياري"
            />
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/5"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white shadow-brand/35 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "جاري الإرسال…" : "إرسال الطلب"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
