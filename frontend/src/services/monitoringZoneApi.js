import { apiUrl } from "../config/apiBase.js";

const BASE = apiUrl("/api/v1/supervisor/zone-configs");

/**
 * @param {string} token
 */
export async function fetchZoneConfigs(token) {
  const res = await fetch(BASE, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = new Error(`zone-configs GET failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * @param {string} token
 * @param {string} zoneId
 * @param {object} body snake_case upsert payload
 */
export async function upsertZoneConfig(token, zoneId, body) {
  const res = await fetch(`${BASE}/${encodeURIComponent(zoneId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`zone-configs PUT failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * @param {string} token
 * @param {string} zoneId
 * @param {{ ok: boolean, tested_at?: string }} payload
 */
export async function patchZoneConnectionTest(token, zoneId, payload) {
  const res = await fetch(`${BASE}/${encodeURIComponent(zoneId)}/connection-test`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = new Error(`zone-configs PATCH test failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * One-time import from legacy localStorage shape.
 * @param {string} token
 * @param {Record<string, object>} configs snake_case per zone
 */
export async function importLegacyZoneConfigs(token, configs) {
  const res = await fetch(`${BASE}/import-legacy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ configs }),
  });
  if (!res.ok) {
    const err = new Error(`zone-configs import failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
