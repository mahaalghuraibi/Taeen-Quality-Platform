/**
 * Client-side camera configuration (interim). Replace with API persistence when backend is ready.
 * Passwords: stored obfuscated for RTSP URL rebuild only — not a security guarantee.
 */

const STORAGE_KEY = "ska_restaurant_camera_configs_v1";

export const RESTAURANT_CONNECTION_TYPES = {
  IP_CAMERA: "ip_camera",
  RTSP_URL: "rtsp_url",
  DEVICE_WEBCAM: "device_webcam",
  UPLOADED_VIDEO: "uploaded_video",
};

// Only real CCTV connection types are exposed in the UI now. DEVICE_WEBCAM and
// UPLOADED_VIDEO remain in RESTAURANT_CONNECTION_TYPES (above) for backward-compat
// with any saved local configs, but they are deliberately omitted from the labels
// map so the select dropdown shows only the two operator-facing options.
export const CONNECTION_TYPE_LABELS_AR = {
  [RESTAURANT_CONNECTION_TYPES.IP_CAMERA]: "كاميرا IP",
  [RESTAURANT_CONNECTION_TYPES.RTSP_URL]: "رابط RTSP",
};

/** @typedef {{
 *   cameraName: string,
 *   ipAddress: string,
 *   port: number,
 *   username: string,
 *   passwordEnc: string | null,
 *   streamPath: string,
 *   connectionType: string,
 *   rtspUrl: string,
 *   savedAt: string | null,
 *   lastConnectionTestAt: string | null,
 *   lastConnectionTestOk: boolean | null,
 * }} RestaurantCameraStored */

function encodeSecret(text) {
  if (typeof text !== "string" || !text.length) return null;
  try {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    bytes.forEach((b) => {
      bin += String.fromCharCode(b);
    });
    return btoa(bin);
  } catch {
    return null;
  }
}

function decodeSecret(enc) {
  if (typeof enc !== "string" || !enc.length) return "";
  try {
    const bin = atob(enc);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

/**
 * Build rtsp://user:pass@host:port/path — password omitted if empty.
 * Never log the returned URL with credentials in production UI.
 */
export function buildRtspUrlFromParts({ ipAddress, port, username, password, streamPath }) {
  const host = String(ipAddress || "").trim();
  const p = Number(port);
  const pathRaw = String(streamPath || "").trim() || "/stream1";
  const path = pathRaw.startsWith("/") ? pathRaw : `/${pathRaw}`;
  const user = String(username || "").trim();
  const pass = String(password || "").trim();

  if (!host) return "";

  let auth = "";
  if (user || pass) {
    const encUser = encodeURIComponent(user);
    const encPass = encodeURIComponent(pass);
    auth = `${encUser}:${encPass}@`;
  }

  const portPart = Number.isFinite(p) && p > 0 ? `:${Math.round(p)}` : ":554";
  return `rtsp://${auth}${host}${portPart}${path}`;
}

/** Mask credentials inside rtsp:// URLs for display after save. */
export function maskRtspUrlForDisplay(url) {
  const s = String(url || "").trim();
  if (!s.toLowerCase().startsWith("rtsp://")) return s || "—";
  try {
    const u = new URL(s.replace(/^rtsp/i, "http"));
    const host = u.hostname || "";
    const port = u.port || "554";
    const path = `${u.pathname || "/"}${u.search || ""}`;
    return `rtsp://***:***@${host}:${port}${path}`;
  } catch {
    return "rtsp://***:***@…";
  }
}

/** Mask IPv4 octets for UI display (avoid exposing full camera LAN IPs). */
export function maskIpv4Display(ip) {
  const s = String(ip || "").trim();
  if (!s) return "—";
  const parts = s.split(".").map((p) => p.trim());
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return "••••••••";
  const [a, b] = parts;
  return `${a}.${b}.••`;
}

export function resolveStoredPassword(passwordEnc) {
  return decodeSecret(passwordEnc || "");
}

export function normalizePort(raw) {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return 554;
  return n;
}

export function validateRestaurantCameraDraft(draft) {
  const errors = [];
  const type = draft.connectionType || RESTAURANT_CONNECTION_TYPES.IP_CAMERA;

  if (type === RESTAURANT_CONNECTION_TYPES.IP_CAMERA) {
    const ip = String(draft.ipAddress || "").trim();
    if (!ip) errors.push("عنوان IP مطلوب لنوع كاميرا IP.");
    const path = String(draft.streamPath || "").trim();
    if (!path) errors.push("مسار البث مطلوب.");
    const portStr = String(draft.port ?? "").trim();
    if (!portStr) errors.push("المنفذ مطلوب (افتراضي 554).");
    else {
      const p = Number.parseInt(portStr, 10);
      if (Number.isNaN(p) || p < 1 || p > 65535) errors.push("المنفذ يجب أن يكون رقماً بين 1 و 65535.");
    }
  }

  if (type === RESTAURANT_CONNECTION_TYPES.RTSP_URL) {
    const u = String(draft.rtspUrl || "").trim();
    if (!u) errors.push("رابط RTSP مطلوب لهذا النوع.");
    else if (!/^rtsp:\/\//i.test(u)) errors.push("يجب أن يبدأ الرابط بـ rtsp://");
  }

  return errors;
}

/** @param {Record<string, Partial<RestaurantCameraStored>>} configs */
export function mergeRestaurantCameraDefaults(zoneDefinitions, configs) {
  const out = {};
  for (const z of zoneDefinitions) {
    const saved = configs[z.id] || {};
    out[z.id] = {
      cameraName: typeof saved.cameraName === "string" && saved.cameraName.trim()
        ? saved.cameraName.trim()
        : z.displayNameAr,
      ipAddress: typeof saved.ipAddress === "string" ? saved.ipAddress : "",
      port: normalizePort(saved.port ?? 554),
      username: typeof saved.username === "string" ? saved.username : "",
      passwordEnc: saved.passwordEnc != null ? saved.passwordEnc : null,
      streamPath: typeof saved.streamPath === "string" && saved.streamPath.trim()
        ? saved.streamPath
        : "/stream1",
      connectionType: saved.connectionType || RESTAURANT_CONNECTION_TYPES.IP_CAMERA,
      rtspUrl: typeof saved.rtspUrl === "string" ? saved.rtspUrl : "",
      savedAt: saved.savedAt || null,
      lastConnectionTestAt: saved.lastConnectionTestAt || null,
      lastConnectionTestOk: typeof saved.lastConnectionTestOk === "boolean" ? saved.lastConnectionTestOk : null,
    };
  }
  return out;
}

export function loadRestaurantCameraConfigs(zoneDefinitions) {
  if (typeof window === "undefined") return mergeRestaurantCameraDefaults(zoneDefinitions, {});
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return mergeRestaurantCameraDefaults(zoneDefinitions, {});
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return mergeRestaurantCameraDefaults(zoneDefinitions, {});
    return mergeRestaurantCameraDefaults(zoneDefinitions, parsed);
  } catch {
    return mergeRestaurantCameraDefaults(zoneDefinitions, {});
  }
}

export function persistRestaurantCameraConfigs(configsByZoneId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(configsByZoneId));
  } catch {
    /* quota or private mode */
  }
}

export function prepareSavePayload(draft, previousStored, zoneDefaultName) {
  const passwordTrim = String(draft.passwordDraft || "").trim();
  let passwordEnc = previousStored?.passwordEnc ?? null;
  if (passwordTrim.length > 0) {
    passwordEnc = encodeSecret(passwordTrim);
  }

  const port = normalizePort(draft.port);
  const nameTrim = String(draft.cameraName || "").trim();
  return {
    cameraName: nameTrim || zoneDefaultName || "",
    ipAddress: String(draft.ipAddress || "").trim(),
    port,
    username: String(draft.username || "").trim(),
    passwordEnc,
    streamPath: String(draft.streamPath || "").trim() || "/stream1",
    connectionType: draft.connectionType || RESTAURANT_CONNECTION_TYPES.IP_CAMERA,
    rtspUrl: String(draft.rtspUrl || "").trim(),
    savedAt: new Date().toISOString(),
    lastConnectionTestAt: previousStored?.lastConnectionTestAt ?? null,
    lastConnectionTestOk: previousStored?.lastConnectionTestOk ?? null,
  };
}

export function getEffectiveRtspUrl(config, passwordOverride = "") {
  const type = config.connectionType;
  const pass =
    String(passwordOverride || "").trim() ||
    resolveStoredPassword(config.passwordEnc);

  if (type === RESTAURANT_CONNECTION_TYPES.RTSP_URL) {
    return String(config.rtspUrl || "").trim();
  }
  return buildRtspUrlFromParts({
    ipAddress: config.ipAddress,
    port: config.port,
    username: config.username,
    password: pass,
    streamPath: config.streamPath,
  });
}
