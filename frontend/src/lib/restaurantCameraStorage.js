/**
 * Restaurant zone camera helpers — persistence is PostgreSQL via monitoringZoneApi.
 * Legacy localStorage key kept only for one-time migration import.
 */

export const LEGACY_CAMERA_CONFIGS_STORAGE_KEY = "ska_restaurant_camera_configs_v1";

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

export function resolveStoredPassword(passwordEnc, hasPassword = false) {
  if (passwordEnc) return decodeSecret(passwordEnc);
  if (hasPassword) return "";
  return "";
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
      hasPassword: Boolean(saved.hasPassword),
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

/** Read legacy browser configs (one-time migration only). */
export function readLegacyLocalStorageConfigs() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_CAMERA_CONFIGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLegacyLocalStorageConfigs() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_CAMERA_CONFIGS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Map API zone row (snake_case) to UI stored shape (camelCase). */
export function apiZoneToStored(zone) {
  if (!zone || typeof zone !== "object") return {};
  return {
    cameraName: zone.camera_name || "",
    ipAddress: zone.ip_address || "",
    port: normalizePort(zone.port ?? 554),
    username: zone.username || "",
    passwordEnc: null,
    hasPassword: Boolean(zone.has_password),
    streamPath: zone.stream_path || "/stream1",
    connectionType: zone.connection_type || RESTAURANT_CONNECTION_TYPES.IP_CAMERA,
    rtspUrl: zone.rtsp_url || "",
    savedAt: zone.saved_at || zone.updated_at || null,
    lastConnectionTestAt: zone.last_connection_test_at || null,
    lastConnectionTestOk:
      typeof zone.last_connection_test_ok === "boolean" ? zone.last_connection_test_ok : null,
    security_status: zone.security_status,
    security_status_ar: zone.security_status_ar,
    security_warnings: zone.security_warnings,
    security_host_kind: zone.security_host_kind,
  };
}

/** @param {Array<object>} zones API zones list */
export function apiZonesListToStoredMap(zones, zoneDefinitions) {
  const byId = {};
  for (const z of zones || []) {
    if (z?.zone_id) byId[z.zone_id] = apiZoneToStored(z);
  }
  return mergeRestaurantCameraDefaults(zoneDefinitions, byId);
}

/** Legacy localStorage camelCase → API import snake_case. */
export function legacyConfigsForImport(parsed) {
  const out = {};
  for (const [zoneId, saved] of Object.entries(parsed || {})) {
    if (!saved || typeof saved !== "object") continue;
    out[zoneId] = {
      camera_name: saved.cameraName,
      ip_address: saved.ipAddress,
      port: saved.port,
      username: saved.username,
      password_enc: saved.passwordEnc,
      stream_path: saved.streamPath,
      connection_type: saved.connectionType,
      rtsp_url: saved.rtspUrl,
    };
  }
  return out;
}

/** Draft form → API upsert body (snake_case). */
export function draftToApiUpsert(draft, previousStored, zoneDefaultName) {
  const passwordTrim = String(draft.passwordDraft || "").trim();
  const nameTrim = String(draft.cameraName || "").trim();
  return {
    camera_name: nameTrim || zoneDefaultName || "",
    connection_type: draft.connectionType || RESTAURANT_CONNECTION_TYPES.IP_CAMERA,
    ip_address: String(draft.ipAddress || "").trim() || null,
    port: normalizePort(draft.port),
    username: String(draft.username || "").trim() || null,
    password: passwordTrim || undefined,
    clear_password: false,
    stream_path: String(draft.streamPath || "").trim() || "/stream1",
    rtsp_url: String(draft.rtspUrl || "").trim() || null,
    linked_camera_id: previousStored?.linkedCameraId ?? null,
  };
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
    resolveStoredPassword(config.passwordEnc, config.hasPassword);

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
