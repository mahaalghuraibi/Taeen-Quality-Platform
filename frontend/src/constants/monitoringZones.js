/**
 * Fixed monitoring zones for the smart-kitchen CCTV dashboard (UI only).
 * Matches API cameras by name/location substring when possible; otherwise shows synthetic CAM-xx panels.
 */

export const MONITORING_ZONE_DEFINITIONS = [
  {
    id: "kitchen",
    camCode: "CAM-01",
    zoneAr: "منطقة المطبخ",
    zoneEn: "Main Kitchen",
    /** Restaurant-facing title (CCTV card) */
    ownerTitleAr: "كاميرا المطبخ الرئيسية",
    displayNameAr: "كاميرا المطبخ الرئيسية",
    match: (cam) => {
      const s = `${cam?.name || ""} ${cam?.location || ""}`.toLowerCase();
      return /kitchen|مطبخ|طبخ|طباخ/i.test(s);
    },
  },
  {
    id: "storage",
    camCode: "CAM-02",
    zoneAr: "منطقة التخزين",
    zoneEn: "Storage Area",
    ownerTitleAr: "كاميرا منطقة التخزين",
    displayNameAr: "كاميرا التخزين",
    match: (cam) => {
      const s = `${cam?.name || ""} ${cam?.location || ""}`.toLowerCase();
      return /storage|store|تخزين|مخزن/i.test(s);
    },
  },
  {
    id: "prep",
    camCode: "CAM-03",
    zoneAr: "منطقة تحضير الطعام",
    zoneEn: "Food Preparation Area",
    ownerTitleAr: "كاميرا منطقة تحضير الطعام",
    displayNameAr: "كاميرا التحضير",
    match: (cam) => {
      const s = `${cam?.name || ""} ${cam?.location || ""}`.toLowerCase();
      return /prep|تحضير|preparation|food prep|جاهز/i.test(s);
    },
  },
];

export function findCameraForZone(zone, cameras) {
  const list = Array.isArray(cameras) ? cameras : [];
  return list.find((c) => zone.match(c)) || null;
}

function alertMatchesZone(zone, alert) {
  const fakeCam = {
    name: String(alert?.camera_name || ""),
    location: String(alert?.location || ""),
  };
  return zone.match(fakeCam);
}

/** Alerts whose stored camera name / location match this zone heuristic */
export function alertsForZone(zone, alerts) {
  const list = Array.isArray(alerts) ? alerts : [];
  return list.filter((a) => alertMatchesZone(zone, a));
}

// Dates here are derived from naive-UTC `created_at` strings produced by the
// backend. We must (a) parse them as UTC and (b) format the calendar day in
// Asia/Riyadh, otherwise a 22:00 UTC alert is counted on the wrong day.
import { parseDishRecordedAt } from "../utils/datetime.js";
import { riyadhDateKey } from "../utils/dishRecordsDisplay.js";

/** Today's YYYY-MM-DD in Asia/Riyadh. */
export function todayIsoDateLocal() {
  return riyadhDateKey(new Date());
}

export function isAlertToday(alert, ymdToday) {
  const raw = alert?.created_at || alert?.createdAt;
  if (!raw) return false;
  const d = parseDishRecordedAt(raw);
  if (Number.isNaN(d.getTime())) return false;
  return riyadhDateKey(d) === ymdToday;
}
