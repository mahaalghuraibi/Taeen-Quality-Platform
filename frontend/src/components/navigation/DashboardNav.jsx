import { Link, useLocation } from "react-router-dom";
import SKALogo from "../SKALogo.jsx";
import { navItemIsActive } from "../../constants/appRoutes.js";

/**
 * Top dashboard navigation — clean path-based URLs (no hash routing).
 * Active tab derives from `location.pathname` for deep links & refresh-safe UX.
 */
export default function DashboardNav({
  role,
  navLinks,
  mobileNavOpen,
  setMobileNavOpen,
  logout,
  dashboardTitle,
  /** Called before route change — pauses scroll-spy to prevent scroll/URL fight. */
  onBeforeSectionNav,
}) {
  const location = useLocation();
  const pathname = location.pathname.split("?")[0];

  // Lightweight fixed navbar: solid bg (no backdrop-blur) for stable scroll performance.
  return (
    <header className="fixed inset-x-0 top-0 z-[60] w-full border-b border-white/10 bg-[#0f172a]">
      <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:min-h-16 sm:gap-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 lg:flex-none">
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 text-slate-200 transition hover:border-brand-sky/40 hover:bg-white/5 lg:hidden"
            aria-expanded={mobileNavOpen}
            aria-controls="dashboard-mobile-nav"
            aria-label={mobileNavOpen ? "إغلاق القائمة" : "فتح القائمة"}
            onClick={() => setMobileNavOpen((o) => !o)}
          >
            {mobileNavOpen ? (
              <span className="text-lg leading-none" aria-hidden>×</span>
            ) : (
              <span className="flex flex-col gap-1.5 p-0.5" aria-hidden>
                <span className="block h-0.5 w-5 rounded-full bg-current" />
                <span className="block h-0.5 w-5 rounded-full bg-current" />
                <span className="block h-0.5 w-5 rounded-full bg-current" />
              </span>
            )}
          </button>
          <Link to={role === "staff" ? "/dashboard" : "/analytics"} className="inline-flex" aria-label="الرئيسية">
            <SKALogo className="inline-flex" />
          </Link>
          {role === "staff" ? null : (
            <span className="hidden rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] font-medium text-slate-300 md:inline-flex">
              {dashboardTitle}
            </span>
          )}
        </div>

        <nav className="hidden flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-2 lg:flex" aria-label="التنقل الرئيسي">
          {navLinks.map((item) => {
            const isActive = navItemIsActive(pathname, role, item);
            return (
              <Link
                key={item.sectionId || item.to}
                to={item.to}
                onClick={() => onBeforeSectionNav?.()}
                aria-current={isActive ? "page" : undefined}
                className={`nav-tab whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-b-2 border-brand-sky text-white"
                    : "border-b-2 border-transparent text-slate-400 hover:text-white"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span>{item.label}</span>
                  {item.emoji ? (
                    <span className="text-base leading-none opacity-90" aria-hidden>
                      {item.emoji}
                    </span>
                  ) : null}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={logout}
            className="px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:text-red-400 sm:text-sm"
          >
            <span className="sm:hidden">خروج</span>
            <span className="hidden sm:inline">تسجيل الخروج</span>
          </button>
        </div>
      </div>

      <nav
        id="dashboard-mobile-nav"
        className={`border-t border-white/10 bg-[#0F172A] lg:hidden ${mobileNavOpen ? "block" : "hidden"}`}
        aria-hidden={!mobileNavOpen}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-3 py-3 sm:px-6">
          {navLinks.map((item) => {
            const isActive = navItemIsActive(pathname, role, item);
            return (
              <Link
                key={item.sectionId || item.to}
                to={item.to}
                onClick={() => {
                  onBeforeSectionNav?.();
                  setMobileNavOpen(false);
                }}
                aria-current={isActive ? "page" : undefined}
                className={`nav-tab rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[rgba(56,189,248,0.1)] text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <span>{item.label}</span>
                  {item.emoji ? (
                    <span className="text-lg leading-none opacity-90" aria-hidden>
                      {item.emoji}
                    </span>
                  ) : null}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
