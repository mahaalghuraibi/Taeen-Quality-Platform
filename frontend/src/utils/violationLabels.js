/**
 * Canonical violation type keys for monitoring alerts + Arabic labels for reports/UI.
 * Unknown snake_case keys → "مخالفة غير محددة"; empty → "غير محدد".
 */

export const VIOLATION_CATEGORY_KEYS_ORDER = [
  "no_gloves",
  "no_headcover",
  "no_mask",
  "no_uniform",
  "improper_uniform",
  "improper_trash_location",
  "trash_floor",
  "wet_floor",
  "waste_area",
  "people_counting",
];

const LABEL_AR = {
  no_gloves: "عدم ارتداء القفازات",
  no_headcover: "عدم ارتداء غطاء الرأس",
  no_mask: "عدم ارتداء الكمامة",
  no_uniform: "عدم ارتداء الزي الرسمي",
  improper_uniform: "عدم ارتداء الزي الرسمي",
  improper_trash_location: "النفايات في مكان غير مخصص",
  trash_floor: "النفايات على الأرض",
  trash_on_floor: "النفايات على الأرض",
  wet_floor: "أرضية مبللة",
  waste_area: "موقع النفايات والحاويات",
  people_counting: "مخالفة عدد الأشخاص",
  unknown: "غير محدد",
};

/** Normalize legacy / alternate API codes to a stable key for grouping + labels. */
export function canonicalViolationType(type) {
  const raw = String(type ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "no_glove") return "no_gloves";
  if (raw === "no_helmet" || raw === "no_head_cover") return "no_headcover";
  if (raw === "improper_uniform") return "no_uniform";
  if (raw === "improper_waste_area") return "improper_trash_location";
  if (raw === "trash_location" || raw === "trash_wrong_location") return "improper_trash_location";
  if (raw === "trash_on_floor" || raw === "trash_floor") return "trash_floor";
  if (raw === "containers") return "waste_area";
  return raw;
}

function looksLikeTechnicalKey(s) {
  return /^[a-z][a-z0-9_]*$/i.test(String(s || "").trim());
}

/**
 * Arabic label for a violation type (raw or canonical).
 * - Explicit `unknown` → غير محدد
 * - Unrecognized technical keys → مخالفة غير محددة
 * - Non-snake_case strings (e.g. Arabic from API) returned as-is when not empty
 */
export function getViolationLabel(type) {
  const rawIn = String(type ?? "").trim();
  if (!rawIn) return "غير محدد";

  if (!looksLikeTechnicalKey(rawIn)) {
    return rawIn;
  }

  const key = canonicalViolationType(rawIn);
  if (key === "unknown") {
    return LABEL_AR.unknown;
  }
  if (LABEL_AR[key]) {
    return LABEL_AR[key];
  }

  return "مخالفة غير محددة";
}

/** Rows for report summary tables (consistent order). */
export function getViolationReportCategoryRows() {
  return VIOLATION_CATEGORY_KEYS_ORDER.map((key) => ({
    key,
    label: getViolationLabel(key),
  }));
}
