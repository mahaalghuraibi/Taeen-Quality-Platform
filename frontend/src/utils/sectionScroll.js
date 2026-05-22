/** Navbar + optional sticky KPI strip — must match scroll-mt / pt on <main>. */
export const SECTION_SCROLL_OFFSET_PX = 72;

/** Pause scroll-spy URL updates while programmatic section scroll runs. */
export const SECTION_NAV_LOCK_MS = 1100;

/**
 * Scroll to a section by id without browser "nearest" jitter.
 * Uses instant scroll (no smooth) for stable section jumps.
 */
export function scrollToSectionElement(sectionId, offsetPx = SECTION_SCROLL_OFFSET_PX) {
  if (typeof document === "undefined" || !sectionId) return;
  const el = document.getElementById(sectionId);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - offsetPx;
  window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
}

export function lockSectionNavigation(lockUntilRef, ms = SECTION_NAV_LOCK_MS) {
  if (lockUntilRef) lockUntilRef.current = Date.now() + ms;
}

export function isSectionNavigationLocked(lockUntilRef) {
  return lockUntilRef && Date.now() < lockUntilRef.current;
}
