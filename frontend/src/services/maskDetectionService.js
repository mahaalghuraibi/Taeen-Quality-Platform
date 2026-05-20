import { apiUrl } from "../config/apiBase.js";

const MASK_DETECTION_URL = apiUrl("/api/v1/analyze-mask");
const MASK_LIVE_URL = apiUrl("/api/v1/mask-live-frame");

async function _post(url, token, fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) form.append(k, v);
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = typeof data?.detail === "string" ? data.detail : `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: msg };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message ?? err) };
  }
}

/**
 * POST /api/v1/analyze-mask  — manual single-image analysis.
 *
 * @param {string} token  JWT from localStorage
 * @param {File}   file   Image file
 */
export async function analyzeMask(token, file) {
  return _post(MASK_DETECTION_URL, token, { image: file });
}

/**
 * POST /api/v1/mask-live-frame  — CCTV / live feed frame.
 *
 * Returns {ok:true, data:{status:"skipped_busy"}} when model is already busy —
 * the caller should silently ignore that response and not display an error.
 *
 * @param {string}      token
 * @param {File|Blob}   imageBlob  Captured webcam frame
 * @param {object}      [opts]     { cameraId, cameraName }
 */
export async function sendLiveFrame(token, imageBlob, opts = {}) {
  return _post(MASK_LIVE_URL, token, {
    image: imageBlob,
    camera_id: opts.cameraId ?? null,
    camera_name: opts.cameraName ?? null,
  });
}

/** True when a live-frame response means the model was busy and the frame was dropped. */
export function isLiveFrameSkipped(data) {
  return data?.status === "skipped_busy";
}
