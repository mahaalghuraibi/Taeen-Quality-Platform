import { useEffect, useMemo, useState } from "react";
import AOS from "aos";
import "aos/dist/aos.css";
import { Link } from "react-router-dom";
import SKALogo from "../components/SKALogo.jsx";
import { PLATFORM_BRAND, PUBLIC_PAGE_TITLES } from "../constants/branding.js";

function IconCamera({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h3l2-2h6l2 2h3a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconDish({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <ellipse cx="12" cy="14" rx="8" ry="4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4 14c0-4 3.5-8 8-8s8 4 8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconBell({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 22a2.5 2.5 0 002.45-2H9.55A2.5 2.5 0 0012 22z"
        fill="currentColor"
      />
      <path
        d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChart({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19V5M4 19h16M8 17V11M12 17V8M16 17v-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** CSS-only futuristic kitchen / dashboard preview */
function KitchenVisualMock() {
  return (
    <div
      className="relative mx-auto aspect-[4/3] w-full max-w-lg lg:max-w-none lg:aspect-[5/4]"
      data-aos="zoom-in"
      data-aos-duration="900"
      data-aos-delay="120"
    >
      <div className="absolute inset-0 rounded-2xl border border-white/12 bg-gradient-to-br from-slate-900/90 via-navy/80 to-brand/25 shadow-[0_0_40px_-12px_rgba(56,189,248,0.35)] shadow-glass-lg backdrop-blur-xl ring-1 ring-white/[0.06]">
        <div className="absolute inset-0 opacity-40 hero-grid-lines" />
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-t from-[#020617]/80 via-transparent to-brand-sky/5" />
        <div className="absolute inset-x-4 top-4 flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 backdrop-blur-md">
          <span className="flex items-center gap-2 text-[10px] font-medium text-slate-300 sm:text-xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-green opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-green" />
            </span>
            بث مباشر · منطقة الطهي A
          </span>
          <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] text-brand-sky">LIVE</span>
        </div>
        <div className="absolute inset-x-4 bottom-4 top-16 flex flex-col gap-2 sm:top-20">
          <div className="flex flex-1 items-end gap-2">
            {[44, 72, 56, 88, 52, 96, 64].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-md bg-gradient-to-t from-brand/40 to-brand-sky/60 opacity-80 shadow-[0_0_20px_-4px_rgba(56,189,248,0.4)]"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <div className="flex gap-2 text-[9px] text-slate-400 sm:text-[10px]">
            <span className="rounded border border-white/10 bg-white/5 px-2 py-1">AI: كشف السلامة</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-1">توثيق الأطباق</span>
          </div>
        </div>
      </div>

      <div
        className="absolute -end-2 top-[8%] z-10 max-w-[11rem] animate-stat-float rounded-xl border border-white/10 bg-white/5 p-3 shadow-glass backdrop-blur-xl sm:-end-4 sm:max-w-[13rem] sm:p-3.5"
        style={{ animationDelay: "-1s" }}
        data-aos="fade-up"
        data-aos-delay="380"
        data-aos-duration="700"
      >
        <p className="text-[10px] font-medium text-slate-400">تسجيل الأطباق</p>
        <p className="mt-0.5 text-lg font-bold tabular-nums text-white sm:text-xl">
          125 <span className="text-xs font-semibold text-accent-green">اليوم</span>
        </p>
      </div>
      <div
        className="absolute -start-2 top-[38%] z-10 max-w-[11rem] animate-stat-float rounded-xl border border-white/10 bg-white/5 p-3 shadow-glass backdrop-blur-xl sm:-start-4 sm:max-w-[13rem]"
        style={{ animationDelay: "-2.5s" }}
        data-aos="fade-up"
        data-aos-delay="460"
        data-aos-duration="700"
      >
        <p className="text-[10px] font-medium text-slate-400">تنبيهات اليوم</p>
        <p className="mt-0.5 text-lg font-bold tabular-nums text-accent-amber sm:text-xl">3</p>
      </div>
      <div
        className="absolute -end-1 bottom-[6%] z-10 max-w-[11rem] animate-stat-float rounded-xl border border-white/10 bg-white/5 p-3 shadow-glass backdrop-blur-xl sm:-end-3 sm:max-w-[13rem]"
        style={{ animationDelay: "-0.5s" }}
        data-aos="fade-up"
        data-aos-delay="540"
        data-aos-duration="700"
      >
        <p className="text-[10px] font-medium text-slate-400">الالتزام بالجودة</p>
        <p className="mt-0.5 text-lg font-bold tabular-nums text-brand-sky sm:text-xl">
          98<span className="text-sm">%</span>
        </p>
      </div>
    </div>
  );
}

const navLinkClass =
  "relative rounded-md px-1.5 py-1 text-sm text-slate-400 transition duration-200 hover:text-brand-sky hover:drop-shadow-[0_0_10px_rgba(56,189,248,0.28)] focus-visible:text-brand-sky";
const navActiveClass =
  "relative rounded-md px-1.5 py-1 text-sm font-medium text-white after:absolute after:-bottom-2.5 after:start-0 after:h-0.5 after:w-full after:rounded-full after:bg-gradient-to-r after:from-brand after:to-brand-sky after:shadow-[0_0_14px_rgba(56,189,248,0.6)]";

export default function LandingPage() {
  const [activeSection, setActiveSection] = useState("home");
  const navItems = useMemo(
    () => [
      { id: "home", label: "الرئيسية" },
      { id: "analytics", label: "الرقابة الذكية" },
      { id: "alerts", label: "التنبيهات" },
      { id: "reports", label: "جاهزية التشغيل" },
    ],
    []
  );

  useEffect(() => {
    AOS.init({
      duration: 820,
      easing: "ease-out-cubic",
      once: true,
      offset: 56,
      anchorPlacement: "top-bottom",
      disable: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    const id = requestAnimationFrame(() => {
      AOS.refresh();
    });
    const refreshAos = () => AOS.refresh();
    window.addEventListener("resize", refreshAos);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", refreshAos);
    };
  }, []);

  useEffect(() => {
    document.title = PUBLIC_PAGE_TITLES.home;
  }, []);

  useEffect(() => {
    const getSections = () =>
      navItems
        .map((item) => {
          const node = document.getElementById(item.id);
          if (!(node instanceof HTMLElement)) return null;
          return { id: item.id, top: node.offsetTop };
        })
        .filter(Boolean)
        .sort((a, b) => a.top - b.top);

    let sections = getSections();
    if (sections.length === 0) return undefined;

    const onScroll = () => {
      const y = window.scrollY;
      if (y < 48) {
        setActiveSection("home");
        return;
      }

      const docHeight = document.documentElement.scrollHeight;
      if (window.innerHeight + y >= docHeight - 24) {
        setActiveSection("reports");
        return;
      }

      const activationY = y + 140;
      let current = "home";
      for (const section of sections) {
        if (section.top <= activationY) current = section.id;
      }
      setActiveSection(current);
    };

    const onResize = () => {
      sections = getSections();
      onScroll();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [navItems]);

  const serviceModules = [
    {
      title: "مراقبة الامتثال اللحظي",
      desc: "متابعة مناطق التشغيل عبر الكاميرات والتنبيهات الذكية مع سجل تدقيق قابل للتتبع.",
      badge: "خدمة أساسية",
    },
    {
      title: "توثيق دورة الوجبة",
      desc: "تسجيل مراحل الإعداد والتقديم وربط الأحداث بالوقت والموقع لرفع الجاهزية التشغيلية.",
      badge: "جاهز للتكامل",
    },
    {
      title: "لوحة تقارير تنفيذية",
      desc: "مؤشرات أداء، إنذارات حرجة، وحالة النظام في واجهة واحدة مناسبة لفرق الإدارة والميدان.",
      badge: "قرارات أسرع",
    },
  ];

  const readinessSteps = [
    {
      title: "1) تهيئة المواقع والمطابخ",
      detail: "تعريف الفروع ومناطق العمل وتوزيع الصلاحيات لكل فريق تشغيل.",
    },
    {
      title: "2) ربط المصادر والأنظمة",
      detail: "الربط مع الكاميرات وقاعدة البيانات وتوحيد قنوات التنبيه والمتابعة.",
    },
    {
      title: "3) تشغيل ومتابعة يومية",
      detail: "قياس المؤشرات، إدارة البلاغات، وتحديث الحالة التشغيلية لحظيًا.",
    },
  ];

  return (
    <div className="min-h-screen bg-surface text-slate-100 antialiased">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(37,99,235,0.18),transparent)]" />

      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0F172A]/78 shadow-[0_8px_24px_-16px_rgba(2,6,23,0.95)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand-sky/45 to-transparent" />
        <div className="relative mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:gap-4 sm:px-6 lg:flex-nowrap lg:px-8">
          <Link to="/" className="flex min-w-0 shrink-0 items-center">
            <SKALogo />
          </Link>

          <nav className="hidden flex-1 items-center justify-center gap-6 lg:flex xl:gap-10">
            {navItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                aria-label={`الانتقال إلى قسم ${item.label}`}
                aria-current={activeSection === item.id ? "page" : undefined}
                className={activeSection === item.id ? navActiveClass : navLinkClass}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Link
              to="/signup"
              className="inline-flex min-h-[40px] min-w-[7rem] items-center justify-center rounded-xl border border-white/15 bg-[rgba(15,23,42,0.72)] px-3 text-xs font-semibold text-slate-100 backdrop-blur-md transition hover:border-brand-sky/40 hover:bg-[#1a2644] sm:min-w-0 sm:px-4 sm:text-sm"
            >
              إنشاء حساب
            </Link>
            <Link
              to="/login"
              className="inline-flex min-h-[40px] min-w-[7rem] items-center justify-center rounded-xl bg-brand px-3 text-xs font-semibold text-white shadow-md shadow-brand/30 transition hover:bg-blue-600 hover:shadow-glow-sm sm:min-w-0 sm:px-4 sm:text-sm"
            >
              تسجيل الدخول
            </Link>
          </div>
        </div>
        <nav className="flex gap-2.5 overflow-x-auto overscroll-x-contain border-t border-white/5 px-3 py-2 [-webkit-overflow-scrolling:touch] lg:hidden">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-label={`الانتقال إلى قسم ${item.label}`}
              aria-current={activeSection === item.id ? "page" : undefined}
              className={`shrink-0 ${activeSection === item.id ? `${navActiveClass} after:-bottom-1.5` : navLinkClass}`}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <main>
        <section id="home" className="scroll-mt-28 relative overflow-hidden pb-16 pt-8 sm:scroll-mt-32 sm:pb-20 sm:pt-12 lg:pb-24 lg:pt-16" aria-label="المقدمة">
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 hero-bg-zoom">
              <div className="absolute inset-0 hero-parallax-deep">
                <div className="absolute inset-0 hero-premium-base" />
              </div>
              <div className="absolute inset-0 hero-parallax-mid">
                <div className="absolute inset-0 hero-premium-mesh hero-mesh-anim" />
              </div>
              <div className="absolute inset-0 hero-parallax-mid">
                <div className="absolute inset-0 opacity-50 hero-grid-lines" />
              </div>
              <div className="absolute inset-0 hero-parallax-deep">
                <div className="hero-orb hero-orb-a" />
                <div className="hero-orb hero-orb-b" />
                <div className="hero-orb hero-orb-c" />
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-0 z-[1] hero-vignette" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-24 hero-bottom-bleed sm:h-28" />

          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div
              className="relative overflow-hidden rounded-2xl border border-white/12 bg-[rgba(15,23,42,0.62)] p-4 shadow-[0_0_70px_-18px_rgba(56,189,248,0.22)] shadow-glass-lg backdrop-blur-2xl ring-1 ring-white/[0.06] sm:p-6 md:p-8 lg:rounded-3xl lg:p-10 xl:p-12"
              data-aos="fade-up"
              data-aos-duration="880"
              data-aos-delay="40"
            >
              <div className="pointer-events-none absolute -left-32 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-brand-sky/10 blur-3xl" />
              <div className="pointer-events-none absolute -right-24 top-0 h-48 w-48 rounded-full bg-blue-600/10 blur-3xl" />
              <div className="relative grid items-center gap-10 lg:grid-cols-2 lg:gap-12 xl:gap-16">
                <div className="order-2 text-start lg:order-1">
                  <div
                    className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border border-brand-sky/25 bg-brand-sky/10 px-3 py-1.5 text-xs font-semibold text-brand-sky sm:text-sm"
                    data-aos="fade-up"
                    data-aos-delay="80"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-brand-sky shadow-[0_0_10px_rgba(56,189,248,0.65)]" aria-hidden />
                    {PLATFORM_BRAND.taglineAr}
                  </div>
                  <h1
                    className="mt-5 text-3xl font-extrabold leading-[1.12] tracking-tight text-white sm:text-4xl lg:text-5xl xl:text-[3.35rem]"
                    data-aos="fade-up"
                    data-aos-delay="140"
                  >
                    {PLATFORM_BRAND.nameAr}
                  </h1>
                  <p
                    className="mt-6 max-w-xl text-sm font-normal leading-relaxed text-slate-400 sm:text-[1.05rem] sm:leading-relaxed"
                    data-aos="fade-up"
                    data-aos-delay="200"
                  >
                    لوحة مراقبة حديثة للمطابخ الاحترافية: رؤية ذكاء اصطناعي، تنبيهات فورية، وتوثيق أدق —
                    بتجربة SaaS راقية وواجهة عربية كاملة مصممة لفرق الجودة والتشغيل.
                  </p>
                  <div
                    className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4"
                    data-aos="fade-up"
                    data-aos-delay="260"
                  >
                    <Link
                      to="/signup"
                      className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-white/20 bg-[rgba(15,23,42,0.72)] px-8 text-sm font-semibold text-white backdrop-blur-md transition hover:border-brand-sky/50 hover:bg-[#1a2644] hover:shadow-glow-sm sm:min-h-[50px]"
                    >
                      إنشاء حساب
                    </Link>
                    <Link
                      to="/login"
                      className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-gradient-to-l from-brand via-blue-600 to-brand px-8 text-sm font-semibold text-white shadow-lg shadow-brand/45 transition hover:shadow-[0_0_42px_-6px_rgba(56,189,248,0.55)] sm:min-h-[50px]"
                    >
                      الدخول للمنصة
                    </Link>
                    <a
                      href="#analytics"
                      className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-white/20 bg-[rgba(15,23,42,0.72)] px-8 text-sm font-semibold text-white backdrop-blur-md transition hover:border-brand-sky/50 hover:bg-[#1a2644] hover:shadow-glow-sm sm:min-h-[50px]"
                    >
                      استعراض الخدمات
                    </a>
                  </div>

                  <div
                    className="mt-10 grid grid-cols-3 gap-3 border-t border-white/10 pt-8 sm:gap-6"
                    data-aos="fade-up"
                    data-aos-delay="340"
                  >
                    {[
                      ["آمن", "اتصال مشفّر"],
                      ["فوري", "تنبيهات لحظية"],
                      ["عربي", "واجهة RTL كاملة"],
                    ].map(([title, sub]) => (
                      <div key={title} className="text-center sm:text-start">
                        <p className="text-lg font-bold tabular-nums text-white sm:text-xl">{title}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500 sm:text-xs">{sub}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="order-1 scale-[1.08] drop-shadow-[0_22px_50px_rgba(56,189,248,0.18)] sm:scale-[1.1] lg:order-2 lg:scale-[1.12]">
                  <KitchenVisualMock />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="analytics" className="scroll-mt-28 border-t border-white/5 px-4 py-10 sm:scroll-mt-32 sm:px-6 sm:py-12 lg:px-8 lg:py-14">
          <div
            className="mx-auto mb-6 max-w-7xl rounded-2xl border border-white/12 bg-[rgba(15,23,42,0.65)] p-5 shadow-glass backdrop-blur-xl ring-1 ring-white/[0.05] sm:p-6 lg:p-8"
            data-aos="fade-up"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-sky/90">منصة خدمة تشغيلية</p>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-white sm:text-2xl lg:text-[1.65rem]">
              منصة تشغيل ورقابة جاهزة للإنتاج
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-400">
              بنية متكاملة تجمع التسجيل، إدارة المستخدمين، لوحة تشغيل مركزية، وخدمات مراقبة الجودة في تجربة واحدة متسقة.
            </p>
          </div>

          <div className="mx-auto mb-8 grid max-w-7xl gap-4 lg:grid-cols-3">
            {serviceModules.map((module, mi) => (
              <article
                key={module.title}
                className="rounded-2xl border border-white/10 bg-[rgba(15,23,42,0.72)] p-5 shadow-glass backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-brand-sky/25 hover:shadow-[0_12px_40px_-24px_rgba(56,189,248,0.35)]"
                data-aos="fade-up"
                data-aos-delay={String(mi * 90)}
              >
                <span className="inline-flex rounded-full border border-brand-sky/30 bg-brand-sky/10 px-2.5 py-1 text-[11px] font-semibold text-brand-sky">
                  {module.badge}
                </span>
                <h3 className="mt-3 text-base font-bold text-white">{module.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{module.desc}</p>
              </article>
            ))}
          </div>

          <div className="mx-auto max-w-7xl">
            <div className="mb-5 text-start sm:mb-6" data-aos="fade-up">
              <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">لوحة تشغيل مباشرة</h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">
                معاينة تخطيطية لمؤشرات التشغيل والتنبيهات — تركز فرق الجودة على ما يهم فعلاً.
              </p>
            </div>

            <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { title: "إجمالي الأطباق", value: "1,248", delta: "+12%", icon: IconDish, tone: "text-accent-green" },
                { title: "التنبيهات النشطة", value: "3", delta: "تحتاج متابعة", icon: IconBell, tone: "text-accent-amber" },
                { title: "الالتزام بالجودة", value: "98%", delta: "+5%", icon: IconChart, tone: "text-brand-sky" },
                { title: "معاملات اليوم", value: "320", delta: "+18%", icon: IconCamera, tone: "text-brand" },
              ].map((m, i) => (
                <article
                  key={m.title}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[rgba(15,23,42,0.72)] p-5 shadow-glass backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-white/20"
                  data-aos="fade-up"
                  data-aos-delay={String(80 + i * 75)}
                >
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-sky/10 to-transparent opacity-60" />
                  <div className="relative flex items-center justify-between gap-3">
                    <m.icon className={`h-7 w-7 ${m.tone}`} />
                    <span className={`text-xs font-semibold ${m.tone}`}>{m.delta}</span>
                  </div>
                  <p className="relative mt-3 text-xs text-slate-400">{m.title}</p>
                  <p className="relative mt-1 text-3xl font-bold tabular-nums text-white">{m.value}</p>
                </article>
              ))}
            </div>

            <div id="dashboard-preview" className="grid gap-6 lg:grid-cols-12">
              <article
                className="rounded-2xl border border-white/10 bg-[rgba(15,23,42,0.72)] p-5 shadow-glass backdrop-blur-xl lg:col-span-7"
                data-aos="fade-up"
                data-aos-delay="60"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-lg font-bold text-white">نظرة عامة على الأداء</h3>
                  <span className="rounded-lg border border-white/10 bg-[#0B1327]/80 px-2 py-1 text-[10px] text-slate-400">آخر 7 أيام</span>
                </div>
                <div className="relative h-56 overflow-hidden rounded-xl border border-white/10 bg-[#020617]/70 p-4 sm:h-64">
                  <div className="absolute inset-0 opacity-25 hero-grid-lines" />
                  <svg viewBox="0 0 100 40" className="relative h-full w-full">
                    <defs>
                      <linearGradient id="lineGrad" x1="0" x2="1" y1="0" y2="0">
                        <stop offset="0%" stopColor="#2563EB" />
                        <stop offset="100%" stopColor="#38BDF8" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M2 34 C12 30, 18 22, 26 25 C34 28, 40 15, 48 18 C56 21, 62 12, 70 14 C78 16, 86 8, 98 4"
                      fill="none"
                      stroke="url(#lineGrad)"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M2 34 C12 30, 18 22, 26 25 C34 28, 40 15, 48 18 C56 21, 62 12, 70 14 C78 16, 86 8, 98 4 L98 40 L2 40 Z"
                      fill="url(#lineGrad)"
                      opacity="0.18"
                    />
                  </svg>
                </div>
              </article>

              <article id="alerts" className="landing-step-enter landing-step-enter-d2 rounded-2xl border border-white/10 bg-[rgba(15,23,42,0.72)] p-5 shadow-glass backdrop-blur-xl lg:col-span-3">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-lg font-bold text-white">آخر التنبيهات</h3>
                  <span className="text-xs text-brand-sky">عرض الكل</span>
                </div>
                <ul className="space-y-2.5">
                  {[
                    ["انخفاض في درجة حرارة الثلاجة", "منذ 10 دقائق", "bg-accent-red"],
                    ["دخول غير مصرح به", "منذ 25 دقيقة", "bg-accent-amber"],
                    ["انتهاء صلاحية منتج", "منذ ساعة", "bg-brand-sky"],
                  ].map(([title, time, dot]) => (
                    <li key={title} className="rounded-xl border border-white/10 bg-[#0B1327]/70 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-slate-200">{title}</p>
                        <span className={`mt-1 h-2 w-2 rounded-full ${dot}`} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{time}</p>
                    </li>
                  ))}
                </ul>
              </article>

              <article
                className="rounded-2xl border border-white/10 bg-[rgba(15,23,42,0.72)] p-5 shadow-glass backdrop-blur-xl lg:col-span-2"
                data-aos="fade-up"
                data-aos-delay="180"
              >
                <h3 className="mb-4 text-lg font-bold text-white">حالة الأنظمة</h3>
                <ul className="space-y-2.5">
                  {["الكاميرات", "أجهزة الاستشعار", "قاعدة البيانات", "الخوادم"].map((label) => (
                    <li key={label} className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0B1327]/70 px-3 py-2.5">
                      <span className="text-sm text-slate-300">{label}</span>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-accent-green">
                        <span className="h-2 w-2 rounded-full bg-accent-green shadow-[0_0_10px_rgba(34,197,94,0.65)]" />
                        متصل
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            </div>

            <div id="features" className="mt-8 grid scroll-mt-28 gap-4 sm:scroll-mt-32 sm:grid-cols-2 lg:grid-cols-4">
              {[
                "أمان عالي",
                "توثيق ذكي",
                "تحليلات فورية",
                "متوافق مع المعايير",
              ].map((item, i) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/10 bg-[rgba(15,23,42,0.72)] px-4 py-3.5 text-center text-sm font-medium text-slate-300 shadow-glass backdrop-blur-xl transition hover:border-brand-sky/20 hover:text-white"
                  data-aos="flip-up"
                  data-aos-delay={String(50 + i * 70)}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="reports" className="scroll-mt-28 border-t border-white/10 px-4 py-10 sm:scroll-mt-32 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="mb-5 text-start sm:mb-6" data-aos="fade-up">
              <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">خطة الجاهزية والتشغيل</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                مسار واضح للانتقال من الإعداد الأولي إلى منصة متابعة يومية قابلة للتوسع.
              </p>
            </div>
            <div id="dish-documentation" className="grid scroll-mt-28 gap-4 sm:scroll-mt-32 md:grid-cols-3">
              {readinessSteps.map((step, si) => (
                <article
                  key={step.title}
                  className="rounded-2xl border border-white/10 bg-[rgba(15,23,42,0.72)] p-5 shadow-glass backdrop-blur-xl transition hover:border-white/18"
                  data-aos="fade-up"
                  data-aos-delay={String(si * 100)}
                >
                  <h3 className="text-base font-semibold text-white">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <footer className="scroll-mt-24 border-t border-white/10 bg-[#0B1120] px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="mb-10 flex flex-col gap-8 border-b border-white/10 pb-10 md:flex-row md:items-start md:justify-between md:gap-12">
              <div className="max-w-lg" data-aos="fade-up">
                <div className="mb-4">
                  <SKALogo />
                </div>
                <h3 className="mb-2 text-base font-semibold text-white sm:text-lg">حول المنصة</h3>
                <p className="text-sm leading-relaxed text-slate-400 sm:text-[15px]">
                  {PLATFORM_BRAND.nameAr} تجمع بين الرؤية الحاسوبية والبيانات التشغيلية لدعم السلامة الغذائية والامتثال
                  وتحسين جودة الخدمة في بيئات الطهي الاحترافية.
                </p>
              </div>
              <div className="flex flex-col gap-2 text-sm" data-aos="fade-up" data-aos-delay="80">
                <span className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  روابط سريعة
                </span>
                <a
                  href="#features"
                  className="w-fit text-slate-400 underline-offset-4 transition hover:text-brand-sky hover:underline"
                >
                  المميزات
                </a>
                <Link
                  to="/login"
                  className="w-fit text-slate-400 underline-offset-4 transition hover:text-brand-sky hover:underline"
                >
                  الدخول للمنصة
                </Link>
              </div>
            </div>
            <p className="text-center text-[13px] text-slate-500" data-aos="fade-in">
              2026 عين الجودة<br />© icareway
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
