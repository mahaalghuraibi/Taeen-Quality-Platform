/**
 * Clean SaaS-style URL structure for production (e.g. https://taeen-aljawdah.com).
 * Single source of truth for dashboard section IDs ↔ paths.
 */
import { PLATFORM_BRAND } from "./branding.js";

const BRAND = PLATFORM_BRAND.nameAr;

/** DOM section ids (must match Dashboard.jsx elements & scroll-spy). */
export const STAFF_SECTION_IDS = {
  doc: "section-dish-doc",
  search: "section-search-filter",
  records: "section-dish-records",
};

export const SUPERVISOR_SECTION_IDS = {
  analytics: "analytics",
  cameras: "cameras",
  alerts: "alerts",
  reviews: "dish-reviews",
  reports: "reports",
  employees: "employees",
  qualityForms: "quality-forms",
  settings: "settings",
};

export const ROUTES = {
  home: "/",
  login: "/login",
  signup: "/signup",
  registerLegacy: "/register",
  dashboard: "/dashboard",
  dashboardSearch: "/dashboard/search",
  dashboardRecords: "/dashboard/records",
  analytics: "/analytics",
  alerts: "/alerts",
  cameras: "/cameras",
  reports: "/reports",
  dishReviews: "/dish-reviews",
  employees: "/employees",
  qualityForms: "/quality-forms",
  settings: "/settings",
  monitoringLegacy: "/monitoring",
  supervisorLegacy: "/supervisor",
};

/** Browser tab titles — unified platform name for every section. */
export const DASHBOARD_PAGE_TITLES = {
  staff: {
    [STAFF_SECTION_IDS.doc]: BRAND,
    [STAFF_SECTION_IDS.search]: BRAND,
    [STAFF_SECTION_IDS.records]: BRAND,
    default: BRAND,
  },
  supervisor: {
    [SUPERVISOR_SECTION_IDS.analytics]: BRAND,
    [SUPERVISOR_SECTION_IDS.cameras]: BRAND,
    [SUPERVISOR_SECTION_IDS.alerts]: BRAND,
    [SUPERVISOR_SECTION_IDS.reviews]: BRAND,
    [SUPERVISOR_SECTION_IDS.reports]: BRAND,
    [SUPERVISOR_SECTION_IDS.employees]: BRAND,
    [SUPERVISOR_SECTION_IDS.qualityForms]: BRAND,
    [SUPERVISOR_SECTION_IDS.settings]: BRAND,
    default: BRAND,
  },
};

export function staffPathFromSectionId(sectionId) {
  if (sectionId === STAFF_SECTION_IDS.search) return ROUTES.dashboardSearch;
  if (sectionId === STAFF_SECTION_IDS.records) return ROUTES.dashboardRecords;
  return ROUTES.dashboard;
}

export function supervisorPathFromSectionId(sectionId) {
  const map = {
    [SUPERVISOR_SECTION_IDS.analytics]: ROUTES.analytics,
    [SUPERVISOR_SECTION_IDS.cameras]: ROUTES.cameras,
    [SUPERVISOR_SECTION_IDS.alerts]: ROUTES.alerts,
    [SUPERVISOR_SECTION_IDS.reviews]: ROUTES.dishReviews,
    [SUPERVISOR_SECTION_IDS.reports]: ROUTES.reports,
    [SUPERVISOR_SECTION_IDS.employees]: ROUTES.employees,
    [SUPERVISOR_SECTION_IDS.qualityForms]: ROUTES.qualityForms,
    [SUPERVISOR_SECTION_IDS.settings]: ROUTES.settings,
  };
  return map[sectionId] || ROUTES.analytics;
}

/** Map staff URL → scroll-spy section id; null if not a staff dashboard path. */
export function getStaffSectionFromPathname(pathname) {
  if (pathname === ROUTES.dashboard || pathname === `${ROUTES.dashboard}/`) {
    return STAFF_SECTION_IDS.doc;
  }
  if (pathname === ROUTES.dashboardSearch) return STAFF_SECTION_IDS.search;
  if (pathname === ROUTES.dashboardRecords) return STAFF_SECTION_IDS.records;
  return null;
}

/** Map supervisor URL → section element id; null if not a supervisor dashboard path. */
export function getSupervisorSectionFromPathname(pathname) {
  if (pathname === ROUTES.analytics) return SUPERVISOR_SECTION_IDS.analytics;
  if (pathname === ROUTES.settings) return SUPERVISOR_SECTION_IDS.settings;
  if (pathname === ROUTES.qualityForms) return SUPERVISOR_SECTION_IDS.qualityForms;
  if (pathname.startsWith(`${ROUTES.alerts}/`) || pathname === ROUTES.alerts) {
    return SUPERVISOR_SECTION_IDS.alerts;
  }
  if (pathname.startsWith(`${ROUTES.cameras}/`) || pathname === ROUTES.cameras) {
    return SUPERVISOR_SECTION_IDS.cameras;
  }
  if (pathname.startsWith(`${ROUTES.reports}/`) || pathname === ROUTES.reports) {
    return SUPERVISOR_SECTION_IDS.reports;
  }
  if (pathname === ROUTES.dishReviews) return SUPERVISOR_SECTION_IDS.reviews;
  if (pathname.startsWith(`${ROUTES.employees}/`) || pathname === ROUTES.employees) {
    return SUPERVISOR_SECTION_IDS.employees;
  }
  return null;
}

export function isStaffDashboardPath(pathname) {
  return (
    pathname === ROUTES.dashboard ||
    pathname === ROUTES.dashboardSearch ||
    pathname === ROUTES.dashboardRecords ||
    pathname === `${ROUTES.dashboard}/`
  );
}

export function isSupervisorDashboardPath(pathname) {
  if (!pathname) return false;
  const p = pathname.split("?")[0];
  return (
    p === ROUTES.analytics ||
    p === ROUTES.settings ||
    p === ROUTES.dishReviews ||
    p === ROUTES.qualityForms ||
    p === ROUTES.alerts ||
    p.startsWith(`${ROUTES.alerts}/`) ||
    p === ROUTES.cameras ||
    p.startsWith(`${ROUTES.cameras}/`) ||
    p === ROUTES.reports ||
    p.startsWith(`${ROUTES.reports}/`) ||
    p === ROUTES.employees ||
    p.startsWith(`${ROUTES.employees}/`)
  );
}

/** Old hash bookmarks → pathname (without leading #). */
export const LEGACY_HASH_TO_SUPERVISOR_PATH = {
  "#analytics": ROUTES.analytics,
  "#cameras": ROUTES.cameras,
  "#alerts": ROUTES.alerts,
  "#dish-reviews": ROUTES.dishReviews,
  "#reports": ROUTES.reports,
  "#employees": ROUTES.employees,
  "#quality-forms": ROUTES.qualityForms,
  "#settings": ROUTES.settings,
};

export const LEGACY_HASH_TO_STAFF_PATH = {
  [`#${STAFF_SECTION_IDS.doc}`]: ROUTES.dashboard,
  [`#${STAFF_SECTION_IDS.search}`]: ROUTES.dashboardSearch,
  "#section-dish-search": ROUTES.dashboardSearch,
  [`#${STAFF_SECTION_IDS.records}`]: ROUTES.dashboardRecords,
};

export function legacyHashRedirectPath(hash, role) {
  const h = String(hash || "").trim();
  if (!h) return null;
  const norm = h.endsWith("/") ? h.slice(0, -1) : h;
  if (role === "staff") {
    return LEGACY_HASH_TO_STAFF_PATH[norm] || null;
  }
  if (role === "supervisor" || role === "admin") {
    return LEGACY_HASH_TO_SUPERVISOR_PATH[norm] || null;
  }
  return null;
}

/**
 * Active tab for top nav: compares pathname to `to` and detail routes.
 * `item` shape: { to, sectionId } from Dashboard navLinks.
 */
export function navItemIsActive(pathname, role, item) {
  if (!item?.to || !pathname) return false;
  const p = pathname.split("?")[0];
  if (role === "staff" && item.sectionId) {
    if (item.sectionId === STAFF_SECTION_IDS.doc) {
      return p === ROUTES.dashboard || p === `${ROUTES.dashboard}/`;
    }
    if (item.sectionId === STAFF_SECTION_IDS.search) return p === ROUTES.dashboardSearch;
    if (item.sectionId === STAFF_SECTION_IDS.records) return p === ROUTES.dashboardRecords;
    return false;
  }
  if ((role === "supervisor" || role === "admin") && item.sectionId) {
    const sid = item.sectionId;
    if (sid === SUPERVISOR_SECTION_IDS.employees) {
      return p === ROUTES.employees || p.startsWith(`${ROUTES.employees}/`);
    }
    if (sid === SUPERVISOR_SECTION_IDS.alerts) {
      return p === ROUTES.alerts || p.startsWith(`${ROUTES.alerts}/`);
    }
    if (sid === SUPERVISOR_SECTION_IDS.cameras) {
      return p === ROUTES.cameras || p.startsWith(`${ROUTES.cameras}/`);
    }
    if (sid === SUPERVISOR_SECTION_IDS.reports) {
      return p === ROUTES.reports || p.startsWith(`${ROUTES.reports}/`);
    }
    return p === item.to || p.startsWith(`${item.to}/`);
  }
  return false;
}
