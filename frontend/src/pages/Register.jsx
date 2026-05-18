import { useEffect, useState } from "react";
import AOS from "aos";
import "aos/dist/aos.css";
import { Link, useNavigate } from "react-router-dom";
import { apiUrl } from "../config/apiBase.js";
import SKALogo from "../components/SKALogo.jsx";
import { PLATFORM_BRAND, PUBLIC_PAGE_TITLES } from "../constants/branding.js";
import { AUTH_FETCH_TIMEOUT_MS, fetchWithTimeout, formatFetchError } from "../utils/fetchWithTimeout.js";
import { wakeApiBeforeAuth } from "../utils/wakeApi.js";
import {
  buildRegisterPayload,
  formatAuthError,
  logAuthFailure,
} from "../utils/authApiError.js";
const BRANCH_OPTIONS = [
  { id: 1, name: "فرع تجريبي" },
  { id: 2, name: "فرع الرياض" },
  { id: 3, name: "فرع جدة" },
];

function UserIcon({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5 19v-1c0-2.8 2.2-5 5-5h4c2.8 0 5 2.2 5 5v1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MailIcon({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 11V8a5 5 0 0110 0v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect x="5" y="11" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="16" r="1.2" fill="currentColor" />
    </svg>
  );
}

function EyeIcon({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function EyeOffIcon({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M9.9 5.1A10.4 10.4 0 0112 5c6 0 10 7 10 7a18.7 18.7 0 01-4.8 5.2M6.3 6.3A18.3 18.3 0 002 12s4 7 10 7c1 1 0 0 2.3-.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

const inputInner =
  "w-full rounded-xl border border-white/12 bg-[#020617]/55 py-3 text-sm text-white shadow-inner shadow-black/20 transition focus:border-brand-sky/45 focus:bg-[#020617]/75 focus:outline-none focus:ring-2 focus:ring-brand/25";
const selectBase =
  `${inputInner} appearance-none cursor-pointer py-[0.7rem] ps-11 pe-10`;

export default function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState("staff");
  const [branchId, setBranchId] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    document.title = PUBLIC_PAGE_TITLES.signup;
    AOS.init({
      duration: 780,
      easing: "ease-out-cubic",
      once: true,
      offset: 32,
      anchorPlacement: "top-bottom",
      disable: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    const id = requestAnimationFrame(() => {
      AOS.refresh();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const safeEmail = email.trim().toLowerCase();
    const safeName = name.trim();
    const numericTenant = 1;
    const selectedBranch = BRANCH_OPTIONS.find((b) => b.id === Number(branchId)) || BRANCH_OPTIONS[0];

    if (!safeName) {
      setError("الاسم مطلوب.");
      return;
    }
    if (!safeEmail) {
      setError("البريد الإلكتروني مطلوب.");
      return;
    }
    if (!safeEmail.includes("@") || !safeEmail.includes(".")) {
      setError("أدخل بريداً إلكترونياً صالحاً.");
      return;
    }
    if (password.length < 6) {
      setError("كلمة المرور يجب أن تكون 6 أحرف على الأقل.");
      return;
    }
    if (password !== confirmPassword) {
      setError("تأكيد كلمة المرور غير مطابق.");
      return;
    }
    if (!["staff", "supervisor", "admin"].includes(role)) {
      setError("الدور غير صالح.");
      return;
    }
    setLoading(true);
    const registerUrl = apiUrl("/api/v1/auth/users");
    try {
      const apiReady = await wakeApiBeforeAuth();
      if (!apiReady) {
        setError(
          "الخادم لا يستجيب حالياً. انتظر دقيقة (قد يكون في وضع السكون على Render) ثم أعد المحاولة.",
        );
        return;
      }

      const payload = buildRegisterPayload({
        email: safeEmail,
        password,
        role,
        tenantId: numericTenant,
        fullName: safeName,
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
      });

      const res = await fetchWithTimeout(
        registerUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        },
        AUTH_FETCH_TIMEOUT_MS,
      );

      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        setSuccess("تم إنشاء الحساب بنجاح");
        setError("");
        setTimeout(() => navigate("/login"), 1500);
        return;
      }

      logAuthFailure("Register", registerUrl, res, data, { payload: { ...payload, password: "[redacted]" } });
      setError(formatAuthError(res.status, data, "تعذر إنشاء الحساب."));
    } catch (err) {
      console.error("[Register] request failed:", registerUrl, err);
      setError(formatFetchError(err, "تعذر إنشاء الحساب. تحقق من الاتصال بالإنترنت."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-surface text-slate-100" dir="rtl">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 hero-premium-base" />
        <div className="absolute inset-0 hero-premium-mesh hero-mesh-anim opacity-90" />
        <div className="absolute inset-0 opacity-45 hero-grid-lines" />
        <div className="hero-orb hero-orb-a" />
        <div className="hero-orb hero-orb-b" />
      </div>
      <div className="pointer-events-none absolute inset-0 hero-vignette" />

      <header className="relative z-10 border-b border-white/10 bg-[#0F172A]/78 shadow-[0_8px_24px_-16px_rgba(2,6,23,0.95)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand-sky/45 to-transparent" />
        <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-2.5 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center transition-opacity hover:opacity-90">
            <SKALogo />
          </Link>
          <div className="flex items-center justify-end gap-2 sm:gap-3">
            <Link
              to="/"
              className="rounded-md px-1.5 py-1 text-sm font-medium text-slate-400 transition hover:text-brand-sky"
            >
              الرئيسية
            </Link>
            <Link
              to="/login"
              className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-white/15 bg-[rgba(15,23,42,0.72)] px-3 text-xs font-semibold text-slate-100 backdrop-blur-md transition hover:border-brand-sky/40 hover:bg-[#1a2644] sm:px-4 sm:text-sm"
            >
              تسجيل الدخول
            </Link>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-3 py-8 sm:px-4 sm:py-12">
        <div
          className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/12 bg-[rgba(15,23,42,0.55)] p-5 shadow-[0_0_60px_-12px_rgba(56,189,248,0.22),0_25px_50px_-28px_rgba(0,0,0,0.65)] backdrop-blur-2xl ring-1 ring-white/[0.06] sm:rounded-3xl sm:p-8 lg:p-9"
          data-aos="fade-up"
          data-aos-duration="800"
          data-aos-delay="60"
        >
          <div className="pointer-events-none absolute -left-24 top-1/4 h-48 w-48 rounded-full bg-brand-sky/10 blur-3xl" />
          <div className="pointer-events-none absolute -right-20 bottom-0 h-40 w-40 rounded-full bg-blue-600/10 blur-3xl" />

          <div className="relative">
            <div
              className="inline-flex items-center gap-2 rounded-full border border-brand-sky/25 bg-brand-sky/10 px-3 py-1 text-[11px] font-semibold text-brand-sky sm:text-xs"
              data-aos="zoom-in"
              data-aos-delay="100"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-sky shadow-[0_0_8px_2px_rgba(56,189,248,0.6)]" aria-hidden />
              حساب جديد
            </div>

            <h1
              className="mt-4 text-xl font-bold tracking-tight text-white sm:text-2xl lg:text-[1.65rem]"
              data-aos="fade-up"
              data-aos-delay="120"
            >
              مرحبًا بك في {PLATFORM_BRAND.nameAr}
            </h1>
            <p
              className="mt-2 text-sm leading-relaxed text-slate-400"
              data-aos="fade-up"
              data-aos-delay="160"
            >
              {PLATFORM_BRAND.taglineAr}
            </p>

            {error ? (
              <div
                className="mt-4 rounded-xl border border-accent-red/40 bg-accent-red/10 px-3 py-2.5 text-sm text-red-200"
                role="alert"
                data-aos="fade-in"
              >
                {error}
              </div>
            ) : null}

            {success ? (
              <div
                className="mt-4 rounded-xl border border-accent-green/40 bg-accent-green/10 px-3 py-2.5 text-sm text-green-200"
                role="status"
                data-aos="fade-in"
              >
                {success}
              </div>
            ) : null}

            <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
              <div data-aos="fade-up" data-aos-delay="180">
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
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className={`${inputInner} ps-11 pe-3`}
                    placeholder="الاسم كما سيظهر في المنصة"
                  />
                </div>
              </div>

              <div data-aos="fade-up" data-aos-delay="220">
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
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="أدخل بريدك الإلكتروني"
                    className={`${inputInner} pl-11 pr-3 text-left`}
                    dir="ltr"
                  />
                </div>
              </div>

              <div
                className="grid gap-5 sm:grid-cols-2 sm:gap-4"
                data-aos="fade-up"
                data-aos-delay="260"
              >
                <div>
                  <label
                    htmlFor="password"
                    className="mb-2 block text-sm font-semibold text-slate-300"
                  >
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
                      className="absolute inset-y-0 right-2 flex items-center rounded-lg px-2 text-slate-500 transition hover:bg-white/5 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
                      aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500">6 أحرف على الأقل</p>
                </div>

                <div>
                  <label
                    htmlFor="confirm-password"
                    className="mb-2 block text-sm font-semibold text-slate-300"
                  >
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
                      className="absolute inset-y-0 right-2 flex items-center rounded-lg px-2 text-slate-500 transition hover:bg-white/5 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
                      aria-label={showConfirmPassword ? "إخفاء تأكيد كلمة المرور" : "إظهار تأكيد كلمة المرور"}
                    >
                      {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2 sm:gap-4" data-aos="fade-up" data-aos-delay="320">
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
                      value={branchId}
                      onChange={(e) => setBranchId(Number(e.target.value))}
                      dir="rtl"
                      className={`${selectBase} text-start`}
                    >
                      {BRANCH_OPTIONS.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div data-aos="fade-up" data-aos-delay="380">
                <button
                  type="submit"
                  disabled={loading}
                  className="relative w-full overflow-hidden rounded-xl bg-gradient-to-l from-brand via-blue-600 to-brand py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition hover:shadow-[0_0_28px_-4px_rgba(56,189,248,0.55)] disabled:opacity-60 disabled:shadow-none"
                >
                  <span className="relative z-10">{loading ? "جاري إنشاء الحساب…" : "إنشاء الحساب"}</span>
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 transition hover:opacity-100" />
                </button>
              </div>
            </form>

            <p
              className="mt-6 text-center text-sm text-slate-400"
              data-aos="fade-up"
              data-aos-delay="420"
            >
              لديك حساب بالفعل؟{" "}
              <Link
                to="/login"
                className="font-semibold text-brand-sky underline-offset-4 transition hover:text-sky-300 hover:underline"
              >
                تسجيل الدخول
              </Link>
            </p>

            <p className="mt-3 text-center text-xs text-slate-500" data-aos="fade-up" data-aos-delay="460">
              <Link to="/" className="transition hover:text-brand-sky">
                العودة للرئيسية
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
