/** Date-range presets for reports — always computed in Asia/Riyadh. */

export const RIYADH_TZ = "Asia/Riyadh";

/** @returns {string} YYYY-MM-DD in Riyadh */
export function riyadhYmd(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: RIYADH_TZ });
}

/** @param {string} ymd @param {number} days */
export function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export const REPORT_DATE_PRESETS = [
  { id: "today", labelAr: "اليوم" },
  { id: "yesterday", labelAr: "أمس" },
  { id: "week", labelAr: "هذا الأسبوع" },
  { id: "month", labelAr: "هذا الشهر" },
  { id: "custom", labelAr: "نطاق مخصص" },
];

/**
 * @param {string} presetId
 * @returns {{ from: string, to: string }}
 */
export function getPresetDateRange(presetId) {
  const today = riyadhYmd();
  if (presetId === "today") return { from: today, to: today };
  if (presetId === "yesterday") {
    const y = addDaysYmd(today, -1);
    return { from: y, to: y };
  }
  if (presetId === "week") {
    const d = new Date();
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: RIYADH_TZ, weekday: "short" }).format(d);
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayNum = map[weekday] ?? 0;
    const weekStart = addDaysYmd(today, -dayNum);
    return { from: weekStart, to: today };
  }
  if (presetId === "month") {
    const monthStart = `${today.slice(0, 7)}-01`;
    return { from: monthStart, to: today };
  }
  return { from: "", to: "" };
}
