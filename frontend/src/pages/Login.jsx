import { useEffect, useState } from "react";
import AOS from "aos";
import "aos/dist/aos.css";
import { Link, useNavigate } from "react-router-dom";
import { ACCESS_TOKEN_KEY, CURRENT_USER_ME_URLS, USER_INFO_KEY, USER_ROLE_KEY } from "../constants.js";
import { apiUrl } from "../config/apiBase.js";
import SKALogo from "../components/SKALogo.jsx";
import { PLATFORM_BRAND, PUBLIC_PAGE_TITLES } from "../constants/branding.js";
import { AUTH_FETCH_TIMEOUT_MS, fetchWithTimeout, formatFetchError } from "../utils/fetchWithTimeout.js";
import {
  buildLoginFormBody,
  formatAuthError,
  logAuthFailure,
} from "../utils/authApiError.js";

const LOGIN_URL = apiUrl("/api/v1/auth/login");

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

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = PUBLIC_PAGE_TITLES.login;
    AOS.init({
      duration: 780,
      easing: "ease-out-cubic",
      once: true,
      offset: 32,
      anchorPlacement: "top-bottom",
      disable: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    const t = requestAnimationFrame(() => {
      AOS.refresh();
    });
    return () => cancelAnimationFrame(t);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const loginId = username.trim();
    if (!loginId) {
      setError("أدخل البريد الإلكتروني أو اسم المستخدم.");
      return;
    }
    if (!password) {
      setError("أدخل كلمة المرور.");
      return;
    }
    setLoading(true);
    try {
      const body = buildLoginFormBody(loginId, password);

      const res = await fetchWithTimeout(
        LOGIN_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: body.toString(),
        },
        AUTH_FETCH_TIMEOUT_MS,
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        logAuthFailure("Login", LOGIN_URL, res, data, { loginId });
        setError(formatAuthError(res.status, data, "تعذر تسجيل الدخول."));
        return;
      }

      if (data.access_token) {
        localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
        let meData = {};
        let meOk = false;
        for (const url of CURRENT_USER_ME_URLS) {
          const meRes = await fetchWithTimeout(
            url,
            {
              headers: {
                Authorization: `Bearer ${data.access_token}`,
              },
            },
            AUTH_FETCH_TIMEOUT_MS,
          );
          meData = await meRes.json().catch(() => ({}));
          if (meRes.ok && meData.role) {
            meOk = true;
            break;
          }
        }
        if (!meOk || !meData.role) {
          localStorage.removeItem(ACCESS_TOKEN_KEY);
          localStorage.removeItem(USER_ROLE_KEY);
          console.error("[Login/me] profile load failed", {
            urls: CURRENT_USER_ME_URLS,
            meData,
            loginId,
          });
          setError("تم تسجيل الدخول لكن تعذر تحميل بيانات الحساب. حاول مرة أخرى.");
          return;
        }
        const role = String(meData.role || "");
        localStorage.setItem(USER_ROLE_KEY, role);
        localStorage.setItem(USER_INFO_KEY, JSON.stringify({
          id: meData.id ?? null,
          role,
          branch_id: meData.branch_id ?? null,
          branch_name: meData.branch_name ?? null,
          email: meData.email ?? null,
          username: meData.username ?? null,
        }));
        if (role === "admin" || role === "supervisor") {
          navigate("/analytics", { replace: true });
        } else {
          navigate("/dashboard", { replace: true });
        }
      } else {
        logAuthFailure("Login", LOGIN_URL, res, data, { loginId, reason: "missing access_token" });
        setError(formatAuthError(res.status, data, "تعذر تسجيل الدخول."));
      }
    } catch (err) {
      console.error("[Login] request failed:", LOGIN_URL, err);
      setError(formatFetchError(err, "تعذر تسجيل الدخول. تحقق من الاتصال بالإنترنت."));
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

      <header
        className="relative z-10 border-b border-white/10 bg-[#0F172A]/78 shadow-[0_8px_24px_-16px_rgba(2,6,23,0.95)] backdrop-blur-2xl"
        data-aos="fade-down"
        data-aos-duration="600"
      >
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
              to="/signup"
              className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-white/15 bg-[rgba(15,23,42,0.72)] px-3 text-xs font-semibold text-slate-100 backdrop-blur-md transition hover:border-brand-sky/40 hover:bg-[#1a2644] sm:px-4 sm:text-sm"
            >
              إنشاء حساب
            </Link>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-3 py-8 sm:px-4 sm:py-12">
        <div
          className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/12 bg-[rgba(15,23,42,0.55)] p-5 shadow-[0_0_60px_-12px_rgba(56,189,248,0.22),0_25px_50px_-28px_rgba(0,0,0,0.65)] backdrop-blur-2xl ring-1 ring-white/[0.06] sm:rounded-3xl sm:p-8 lg:p-9"
          data-aos="fade-up"
          data-aos-duration="800"
          data-aos-delay="80"
        >
          <div className="pointer-events-none absolute -left-24 top-0 h-48 w-48 rounded-full bg-brand-sky/12 blur-3xl" />
          <div className="pointer-events-none absolute -right-16 bottom-0 h-40 w-40 rounded-full bg-blue-600/10 blur-3xl" />

          <div className="relative">
            <div
              className="inline-flex items-center gap-2 rounded-full border border-brand-sky/25 bg-brand-sky/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-sky sm:text-xs"
              data-aos="zoom-in"
              data-aos-delay="120"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-sky shadow-[0_0_8px_2px_rgba(56,189,248,0.6)]" aria-hidden />
              دخول آمن
            </div>

            <h1
              className="mt-4 text-xl font-bold tracking-tight text-white sm:text-2xl lg:text-[1.65rem]"
              data-aos="fade-up"
              data-aos-delay="140"
            >
              مرحبًا بعودتك
            </h1>
            <p
              className="mt-2 max-w-md text-sm leading-relaxed text-slate-400"
              data-aos="fade-up"
              data-aos-delay="180"
            >
              سجّل دخولك للمتابعة إلى{" "}
              <span className="font-medium text-slate-300">{PLATFORM_BRAND.nameAr}</span>
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

            <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
              <div data-aos="fade-up" data-aos-delay="220">
                <label
                  htmlFor="username"
                  className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300"
                >
                  البريد الإلكتروني
                </label>
                <div className="group relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500 transition group-focus-within:text-brand-sky">
                    <MailIcon className="opacity-90" />
                  </span>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    placeholder="أدخل بريدك الإلكتروني"
                    className="w-full rounded-xl border border-white/12 bg-[#020617]/55 py-3 pl-11 pr-3 text-left text-sm text-white shadow-inner shadow-black/20 placeholder:text-slate-600 transition focus:border-brand-sky/45 focus:bg-[#020617]/75 focus:outline-none focus:ring-2 focus:ring-brand/25"
                    dir="ltr"
                  />
                </div>
              </div>

              <div data-aos="fade-up" data-aos-delay="280">
                <label
                  htmlFor="password"
                  className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300"
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
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full rounded-xl border border-white/12 bg-[#020617]/55 py-3 pl-11 pr-12 text-sm text-white shadow-inner shadow-black/20 transition focus:border-brand-sky/45 focus:bg-[#020617]/75 focus:outline-none focus:ring-2 focus:ring-brand/25"
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
              </div>

              <div data-aos="fade-up" data-aos-delay="340">
                <button
                  type="submit"
                  disabled={loading}
                  className="relative w-full overflow-hidden rounded-xl bg-gradient-to-l from-brand via-blue-600 to-brand py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition hover:shadow-[0_0_28px_-4px_rgba(56,189,248,0.55)] disabled:opacity-60 disabled:shadow-none"
                >
                  <span className="relative z-10">{loading ? "جاري الدخول…" : "دخول"}</span>
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 transition hover:opacity-100" />
                </button>
              </div>
            </form>

            <p
              className="mt-6 text-center text-sm text-slate-400"
              data-aos="fade-up"
              data-aos-delay="400"
            >
              ليس لديك حساب؟{" "}
              <Link
                to="/signup"
                className="font-semibold text-brand-sky underline-offset-4 transition hover:text-sky-300 hover:underline"
              >
                إنشاء حساب جديد
              </Link>
            </p>
            <p
              className="mt-3 text-center text-xs text-slate-500"
              data-aos="fade-up"
              data-aos-delay="440"
            >
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
