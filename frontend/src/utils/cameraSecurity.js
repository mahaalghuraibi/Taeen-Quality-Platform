/**
 * Client-side camera / RTSP security checks (mirrors backend assess_camera_stream_url).
 * Used for immediate UI warnings before save — authoritative check is on the API.
 */

import { buildRtspUrlFromParts, resolveStoredPassword } from "../lib/restaurantCameraStorage.js";

export const CAMERA_SECURITY = {
  SAFE: "safe",
  REVIEW: "review",
  DANGER: "danger",
};

export const CAMERA_SECURITY_AR = {
  [CAMERA_SECURITY.SAFE]: "آمن",
  [CAMERA_SECURITY.REVIEW]: "يحتاج مراجعة",
  [CAMERA_SECURITY.DANGER]: "خطر",
};

const WEAK_PASSWORDS = new Set([
  "",
  "admin",
  "123456",
  "12345",
  "password",
  "1234",
  "123",
  "admin123",
  "888888",
  "666666",
  "000000",
  "111111",
  "root",
  "pass",
  "camera",
  "12345678",
  "user",
  "default",
  "hikvision",
  "dahua",
]);

const WEAK_USERS = new Set(["admin", "root", "user", "administrator", "default", ""]);

function parseIpv4(host) {
  const parts = String(host || "")
    .trim()
    .split(".")
    .map((p) => p.trim());
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPrivateIpv4(nums) {
  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function classifyHost(hostname) {
  const h = String(hostname || "").trim().toLowerCase();
  if (!h) return { kind: "none", private: true };
  if (h === "localhost" || h === "127.0.0.1") return { kind: "localhost", private: true };
  if (h.endsWith(".local")) return { kind: "hostname", private: true };
  const nums = parseIpv4(h);
  if (nums) {
    return { kind: isPrivateIpv4(nums) ? "private" : "public", private: isPrivateIpv4(nums) };
  }
  if (/ddns|no-ip|duckdns|myfritz|synology/i.test(h)) {
    return { kind: "hostname", private: false };
  }
  return { kind: "hostname", private: false };
}

function passwordWeak(pass, user) {
  if (pass == null || pass === undefined) return false;
  const p = String(pass);
  if (WEAK_PASSWORDS.has(p.toLowerCase())) return true;
  if (p.length < 8) return true;
  const u = String(user || "").toLowerCase();
  return WEAK_USERS.has(u) && WEAK_PASSWORDS.has(p.toLowerCase());
}

function bump(status, level) {
  const order = { safe: 0, review: 1, danger: 2 };
  return order[level] > order[status] ? level : status;
}

/**
 * @param {string | null | undefined} streamUrl
 * @param {{ username?: string, password?: string }} [extra]
 */
export function assessCameraStreamUrl(streamUrl, extra = {}) {
  let status = CAMERA_SECURITY.SAFE;
  const warnings = [];
  let hostKind = "unknown";

  const s = String(streamUrl || "").trim();
  if (!s) {
    warnings.push("لم يُضبط رابط البث بعد — استخدم IP محلي داخل شبكة المطعم (192.168.x.x).");
    return {
      security_status: CAMERA_SECURITY.REVIEW,
      security_status_ar: CAMERA_SECURITY_AR.review,
      security_warnings: warnings,
      security_host_kind: "none",
    };
  }

  const lower = s.toLowerCase();
  if (lower.startsWith("http://")) {
    warnings.push("رابط HTTP غير مشفّر — لا تعرّض البث على الإنترنت العام.");
    status = bump(status, CAMERA_SECURITY.DANGER);
  }

  if (!lower.startsWith("rtsp://") && !lower.startsWith("rtsps://")) {
    warnings.push("نوع الرابط غير RTSP — تأكد أن الكاميرا داخل الشبكة المحلية فقط.");
    status = bump(status, CAMERA_SECURITY.REVIEW);
    return finalize(status, warnings, hostKind);
  }

  let parsed;
  try {
    parsed = new URL(s.replace(/^rtsp/i, "http"));
  } catch {
    warnings.push("رابط RTSP غير صالح.");
    return finalize(CAMERA_SECURITY.DANGER, warnings, hostKind);
  }

  const host = parsed.hostname || "";
  const { kind, private: isPrivate } = classifyHost(host);
  hostKind = kind;

  if (kind === "public") {
    warnings.push("عنوان IP عام — يُمنع فتح منفذ RTSP (554) على الإنترنت. استخدم LAN/VLAN أو VPN.");
    status = bump(status, CAMERA_SECURITY.DANGER);
  } else if (kind === "hostname" && !isPrivate) {
    warnings.push("اسم مضيف قد يكون متاحاً من الإنترنت — يُفضّل IP محلي 192.168.x.x.");
    status = bump(status, CAMERA_SECURITY.REVIEW);
  } else if (kind === "localhost") {
    warnings.push("localhost للاختبار فقط — ليس للإنتاج.");
    status = bump(status, CAMERA_SECURITY.REVIEW);
  }

  const urlUser = parsed.username || "";
  const urlPass = parsed.password || "";
  const effUser = urlUser || extra.username || "";
  const effPass = urlPass || extra.password || "";

  if (passwordWeak(effPass, effUser)) {
    warnings.push("كلمة مرور ضعيفة أو افتراضية — غيّرها فوراً.");
    status = bump(status, CAMERA_SECURITY.DANGER);
  }
  if (effUser && WEAK_USERS.has(String(effUser).toLowerCase())) {
    warnings.push("اسم مستخدم افتراضي (admin/root) — غيّره.");
    status = bump(status, CAMERA_SECURITY.REVIEW);
  }

  if (lower.startsWith("rtsp://") && isPrivate) {
    warnings.push("تأكد من حظر المنفذ 554 من الجدار الناري الخارجي.");
  }

  return finalize(status, warnings, hostKind);
}

function finalize(status, warnings, hostKind) {
  const st = status || CAMERA_SECURITY.SAFE;
  return {
    security_status: st,
    security_status_ar: CAMERA_SECURITY_AR[st] || CAMERA_SECURITY_AR.safe,
    security_warnings: warnings,
    security_host_kind: hostKind,
  };
}

/** Assess restaurant zone draft (IP parts or full RTSP URL). */
export function assessRestaurantCameraDraft(draft, storedConfig = {}) {
  const pass =
    String(draft.passwordDraft || "").trim() ||
    resolveStoredPassword(storedConfig.passwordEnc);
  const url = buildRtspUrlFromParts({
    ipAddress: draft.ipAddress,
    port: draft.port,
    username: draft.username,
    password: pass,
    streamPath: draft.streamPath,
  });
  const rtsp =
    draft.connectionType === "rtsp_url"
      ? String(draft.rtspUrl || "").trim()
      : url;
  return assessCameraStreamUrl(rtsp, {
    username: draft.username,
    password: pass,
  });
}

export function securityStatusBadgeClass(status) {
  if (status === CAMERA_SECURITY.DANGER) {
    return "border-red-500/45 bg-red-500/15 text-red-100";
  }
  if (status === CAMERA_SECURITY.REVIEW) {
    return "border-amber-500/40 bg-amber-500/10 text-amber-100";
  }
  return "border-emerald-500/35 bg-emerald-500/10 text-emerald-100";
}
