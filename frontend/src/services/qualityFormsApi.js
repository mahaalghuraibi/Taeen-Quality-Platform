import { apiUrl } from "../config/apiBase.js";

const BASE = apiUrl("/api/v1/quality-forms");

function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export async function fetchStageDefinitions({ token }) {
  const res = await fetch(`${BASE}/stage-definitions`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, body: data };
  return { ok: true, data };
}

export async function fetchSessions({ token, mealDate }) {
  const params = mealDate ? `?meal_date=${mealDate}` : "";
  const res = await fetch(`${BASE}/sessions${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, body: data };
  return { ok: true, data };
}

export async function createSession({ token, meal_date, meal_period }) {
  const res = await fetch(`${BASE}/sessions`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ meal_date, meal_period }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, body: data };
  return { ok: true, data };
}

export async function fetchSession({ token, sessionId }) {
  const res = await fetch(`${BASE}/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, body: data };
  return { ok: true, data };
}

export async function submitStage({ token, sessionId, stageNumber, answers, measurements, notes }) {
  const res = await fetch(`${BASE}/sessions/${sessionId}/stages/${stageNumber}`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      answers: answers ?? {},
      measurements: measurements ?? null,
      notes: notes ?? null,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, body: data };
  return { ok: true, data };
}
