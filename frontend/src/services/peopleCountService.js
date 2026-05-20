import { apiUrl } from "../config/apiBase.js";

const PEOPLE_COUNT_URL = apiUrl("/api/v1/analyze-people-count");
const PEOPLE_LIVE_URL = apiUrl("/api/v1/people-count-live-frame");

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
 * POST /api/v1/analyze-people-count — manual single-image analysis.
 *
 * @param {string}   token
 * @param {File}     file
 * @param {number}   [maxAllowed]  Override crowd limit for this call
 */
export async function analyzePeopleCount(token, file, maxAllowed) {
  return _post(PEOPLE_COUNT_URL, token, {
    image: file,
    max_allowed: maxAllowed ?? null,
  });
}

/**
 * POST /api/v1/people-count-live-frame — live CCTV frame.
 *
 * Returns {ok:true, data:{status:"skipped_busy"}} when model is busy.
 *
 * @param {string}     token
 * @param {File|Blob}  imageBlob
 * @param {object}     [opts]  { cameraId, cameraName, maxAllowed }
 */
export async function sendPeopleCountLiveFrame(token, imageBlob, opts = {}) {
  return _post(PEOPLE_LIVE_URL, token, {
    image: imageBlob,
    camera_id: opts.cameraId ?? null,
    camera_name: opts.cameraName ?? null,
    max_allowed: opts.maxAllowed ?? null,
  });
}

export function isLiveFrameSkipped(data) {
  return data?.status === "skipped_busy";
}
