import { apiUrl } from "../config/apiBase.js";

const MASK_DETECTION_URL = apiUrl("/api/v1/analyze-mask");

/**
 * POST a multipart image to POST /api/v1/analyze-mask.
 *
 * @param {string} token  JWT from localStorage
 * @param {File}   file   Image file selected by the user
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
export async function analyzeMask(token, file) {
  const form = new FormData();
  form.append("image", file);
  try {
    const res = await fetch(MASK_DETECTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = typeof data?.detail === "string" ? data.detail : `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}
