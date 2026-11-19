import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import DashboardNav from "../components/navigation/DashboardNav.jsx";
import QualityFormsSection from "../components/quality-forms/QualityFormsSection.jsx";
import Toast from "../components/shared/Toast.jsx";
import { useDashboardAuth } from "../hooks/useDashboardAuth.js";
import { useToastStore } from "../stores/useToastStore.js";
import { getNavLinks } from "../constants/appRoutes.js";
import { PLATFORM_BRAND, dashboardTitleForRole } from "../constants/branding.js";

export default function QualityFormsPage() {
  const toast = useToastStore((s) => s.toast);
  const setToast = useToastStore((s) => s.setToast);
  const clearToast = useToastStore((s) => s.clearToast);

  const { role, getAccessToken, logout } = useDashboardAuth({ setToast });
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Redirect staff — quality forms are supervisor/admin only
  useEffect(() => {
    if (role && role === "staff") {
      navigate("/dashboard", { replace: true });
    }
  }, [role, navigate]);

  useEffect(() => {
    document.title = PLATFORM_BRAND.documentTitle;
  }, []);

  // Auto-dismiss toast after 4.2 s (matches Dashboard.jsx behaviour)
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => clearToast(), 4200);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  const navLinks = useMemo(() => getNavLinks(role), [role]);
  const dashboardTitle = useMemo(() => dashboardTitleForRole(role), [role]);

  // Suppress brief flash while role is resolving (staff redirect pending)
  if (role === "staff") return null;

  return (
    <div
      className="min-h-screen bg-surface text-slate-100 scroll-pt-28 sm:scroll-pt-32"
      dir="rtl"
    >
      <DashboardNav
        role={role}
        navLinks={navLinks}
        mobileNavOpen={mobileNavOpen}
        setMobileNavOpen={setMobileNavOpen}
        logout={logout}
        dashboardTitle={dashboardTitle}
        onBeforeSectionNav={() => setMobileNavOpen(false)}
      />

      <main className="relative z-0 mx-auto max-w-7xl px-3 pb-6 pt-14 sm:px-6 sm:pb-8 sm:pt-16 lg:px-8 lg:pb-10">
        <div className="mb-5 mt-4">
          <Link
            to="/analytics"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-slate-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02z" clipRule="evenodd" />
            </svg>
            العودة إلى لوحة السوبرفايزر
          </Link>
        </div>
        <QualityFormsSection getAccessToken={getAccessToken} role={role} />
      </main>

      <Toast toast={toast} />
    </div>
  );
}
