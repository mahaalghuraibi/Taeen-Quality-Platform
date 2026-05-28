import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ACCESS_TOKEN_KEY } from "../constants.js";
import { apiUrl } from "../config/apiBase.js";
import SKALogo from "../components/SKALogo.jsx";
import { PUBLIC_PAGE_TITLES } from "../constants/branding.js";

const BRANCHES_URL = apiUrl("/api/v1/branches");
const BRANCH_REQUESTS_URL = apiUrl("/api/v1/branches/requests");

const STATUS_FILTERS = [
  { id: "pending", label: "قيد المراجعة" },
  { id: "approved", label: "مقبولة" },
  { id: "rejected", label: "مرفوضة" },
];

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ar-SA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AdminBranchesPage() {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY) || "";
  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );

  useEffect(() => {
    document.title = PUBLIC_PAGE_TITLES.adminBranches || "إدارة الفروع — عين الجودة";
  }, []);

  const [branches, setBranches] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [newName, setNewName] = useState("");
  const [newCity, setNewCity] = useState("");
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editCity, setEditCity] = useState("");

  const [requestStatus, setRequestStatus] = useState("pending");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    if (!token) {
      setError("يجب تسجيل الدخول كمسؤول للوصول إلى إدارة الفروع.");
      setLoading(false);
      return;
    }
    try {
      const [branchesRes, requestsRes] = await Promise.all([
        fetch(BRANCHES_URL, { headers: authHeaders }),
        fetch(`${BRANCH_REQUESTS_URL}?status_filter=${encodeURIComponent(requestStatus)}`, {
          headers: authHeaders,
        }),
      ]);
      if (branchesRes.status === 401 || requestsRes.status === 401) {
        setError("الجلسة منتهية. يرجى تسجيل الدخول مرة أخرى.");
        setBranches([]);
        setRequests([]);
        return;
      }
      if (branchesRes.status === 403 || requestsRes.status === 403) {
        setError("ليس لديك صلاحية الوصول لإدارة الفروع.");
        setBranches([]);
        setRequests([]);
        return;
      }
      const branchesData = await branchesRes.json().catch(() => []);
      const requestsData = await requestsRes.json().catch(() => []);
      setBranches(Array.isArray(branchesData) ? branchesData : []);
      setRequests(Array.isArray(requestsData) ? requestsData : []);
    } catch {
      setError("تعذر الاتصال بالخادم. تحقق من الشبكة وأعد المحاولة.");
      setBranches([]);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, requestStatus, token]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function clearMessages() {
    setError("");
    setSuccess("");
  }

  async function handleCreate(e) {
    e.preventDefault();
    clearMessages();
    const trimmed = newName.trim();
    if (trimmed.length < 2) {
      setError("اسم الفرع يجب أن يكون حرفين على الأقل.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(BRANCHES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          branch_name: trimmed,
          city: newCity.trim() || null,
          is_active: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.detail === "string" ? data.detail : "تعذر إنشاء الفرع.");
        return;
      }
      setSuccess(`تم إنشاء الفرع "${data.branch_name}".`);
      setNewName("");
      setNewCity("");
      await loadAll();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(branch) {
    setEditingId(branch.id);
    setEditName(branch.branch_name);
    setEditCity(branch.city || "");
    clearMessages();
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditCity("");
  }

  async function saveEdit(branchId) {
    clearMessages();
    try {
      const res = await fetch(`${BRANCHES_URL}/${branchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          branch_name: editName.trim(),
          city: editCity.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.detail === "string" ? data.detail : "تعذر حفظ التعديل.");
        return;
      }
      setSuccess("تم حفظ التعديلات.");
      cancelEdit();
      await loadAll();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    }
  }

  async function toggleActive(branch) {
    clearMessages();
    const path = branch.is_active ? "disable" : "enable";
    try {
      const res = await fetch(`${BRANCHES_URL}/${branch.id}/${path}`, {
        method: "PATCH",
        headers: authHeaders,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.detail === "string" ? data.detail : "تعذر تحديث حالة الفرع.");
        return;
      }
      setSuccess(branch.is_active ? "تم تعطيل الفرع." : "تم تفعيل الفرع.");
      await loadAll();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    }
  }

  async function deleteBranch(branch) {
    clearMessages();
    if (!window.confirm(`حذف الفرع "${branch.branch_name}"؟ لا يمكن التراجع.`)) return;
    try {
      const res = await fetch(`${BRANCHES_URL}/${branch.id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (res.status === 204) {
        setSuccess("تم حذف الفرع.");
        await loadAll();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(typeof data?.detail === "string" ? data.detail : "تعذر حذف الفرع.");
    } catch {
      setError("تعذر الاتصال بالخادم.");
    }
  }

  async function decideRequest(req, decision) {
    clearMessages();
    let reviewNote = null;
    if (decision === "rejected") {
      reviewNote = window.prompt("سبب الرفض (اختياري):") || null;
    }
    try {
      const res = await fetch(`${BRANCH_REQUESTS_URL}/${req.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ status: decision, review_note: reviewNote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.detail === "string" ? data.detail : "تعذر تحديث الطلب.");
        return;
      }
      setSuccess(
        decision === "approved"
          ? `تمت الموافقة على طلب "${req.branch_name}".`
          : `تم رفض طلب "${req.branch_name}".`,
      );
      await loadAll();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-surface text-slate-100" dir="rtl">
      <div className="pointer-events-none absolute inset-0 overflow-hidden admin-page-static-bg" aria-hidden />
      <div className="pointer-events-none absolute inset-0 hero-vignette" />

      <header className="relative z-10 border-b border-white/10 bg-[#0F172A]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-6">
          <Link to="/analytics" className="flex items-center">
            <SKALogo compact />
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/admin/users" className="text-slate-400 transition hover:text-brand-sky">
              المستخدمون
            </Link>
            <Link to="/admin/requests" className="text-slate-400 transition hover:text-brand-sky">
              طلبات الأدمن
            </Link>
            <Link to="/analytics" className="font-medium text-slate-300 transition hover:text-brand-sky">
              العودة للوحة التحكم
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 sm:py-8 lg:px-8">
        <section className="rounded-2xl border border-white/10 bg-[#0f172a] p-4 sm:rounded-3xl sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-white sm:text-2xl">إدارة الفروع</h1>
              <p className="mt-1 text-sm text-slate-400">
                إضافة فروع جديدة، تعديلها، تعطيلها، ومراجعة طلبات إضافة فرع.
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadAll()}
              className="rounded-xl border border-white/10 bg-[#020617]/60 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-brand-sky/40 hover:text-white"
            >
              تحديث
            </button>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-accent-red/40 bg-accent-red/10 px-3 py-2.5 text-sm text-red-200">
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="mt-4 rounded-xl border border-accent-green/40 bg-accent-green/10 px-3 py-2.5 text-sm text-green-200">
              {success}
            </div>
          ) : null}

          {/* Create branch */}
          <form
            className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={handleCreate}
          >
            <input
              type="text"
              placeholder="اسم الفرع"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              className="rounded-xl border border-white/10 bg-[#020617]/60 px-3 py-2.5 text-sm text-white focus:border-brand-sky/50 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <input
              type="text"
              placeholder="المدينة (اختياري)"
              value={newCity}
              onChange={(e) => setNewCity(e.target.value)}
              className="rounded-xl border border-white/10 bg-[#020617]/60 px-3 py-2.5 text-sm text-white focus:border-brand-sky/50 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <button
              type="submit"
              disabled={creating}
              className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/35 transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? "جاري الإضافة…" : "إضافة فرع"}
            </button>
          </form>

          {/* Branches table */}
          <div className="mt-6 overflow-x-auto">
            {loading ? (
              <div className="rounded-xl border border-white/10 bg-[#0B1327]/70 px-3 py-6 text-center text-sm text-slate-400">
                جاري التحميل…
              </div>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="px-3 py-2 text-start">#</th>
                    <th className="px-3 py-2 text-start">اسم الفرع</th>
                    <th className="px-3 py-2 text-start">المدينة</th>
                    <th className="px-3 py-2 text-start">الحالة</th>
                    <th className="px-3 py-2 text-start">أنشئ في</th>
                    <th className="px-3 py-2 text-start">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {branches.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-500">
                        لا توجد فروع مسجلة بعد.
                      </td>
                    </tr>
                  ) : (
                    branches.map((b) => {
                      const isEditing = editingId === b.id;
                      return (
                        <tr key={b.id} className="border-b border-white/5 text-slate-200">
                          <td className="px-3 py-2.5 text-slate-500">{b.id}</td>
                          <td className="px-3 py-2.5">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-[#020617]/60 px-2 py-1 text-sm text-white"
                              />
                            ) : (
                              <span className="font-medium text-white">{b.branch_name}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editCity}
                                onChange={(e) => setEditCity(e.target.value)}
                                placeholder="—"
                                className="w-full rounded-lg border border-white/10 bg-[#020617]/60 px-2 py-1 text-sm text-white"
                              />
                            ) : (
                              b.city || "—"
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {b.is_active ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-accent-green/40 bg-accent-green/10 px-2 py-0.5 text-[11px] text-green-200">
                                <span className="h-1.5 w-1.5 rounded-full bg-green-400" /> مفعل
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">
                                معطل
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-400">
                            {formatDate(b.created_at)}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => saveEdit(b.id)}
                                    className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white shadow-brand/30 transition hover:brightness-110"
                                  >
                                    حفظ
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEdit}
                                    className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-white/5"
                                  >
                                    إلغاء
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => startEdit(b)}
                                    className="rounded-lg border border-white/10 bg-[#020617]/60 px-2.5 py-1 text-xs text-slate-200 transition hover:border-brand-sky/40 hover:text-white"
                                  >
                                    تعديل
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleActive(b)}
                                    className={
                                      b.is_active
                                        ? "rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200 transition hover:bg-amber-500/20"
                                        : "rounded-lg border border-accent-green/40 bg-accent-green/10 px-2.5 py-1 text-xs text-green-200 transition hover:bg-accent-green/20"
                                    }
                                  >
                                    {b.is_active ? "تعطيل" : "تفعيل"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteBranch(b)}
                                    className="rounded-lg border border-accent-red/40 bg-accent-red/10 px-2.5 py-1 text-xs text-red-200 transition hover:bg-accent-red/20"
                                  >
                                    حذف
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Branch requests */}
        <section className="mt-6 rounded-2xl border border-white/10 bg-[#0f172a] p-4 sm:rounded-3xl sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white sm:text-xl">طلبات إضافة فرع</h2>
              <p className="mt-1 text-sm text-slate-400">
                المستخدمون يرسلون طلبات لإضافة فروع جديدة — راجع ووافق أو ارفض.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setRequestStatus(s.id)}
                  className={
                    requestStatus === s.id
                      ? "rounded-lg bg-brand px-3 py-1.5 font-semibold text-white shadow-brand/30"
                      : "rounded-lg border border-white/10 bg-[#020617]/60 px-3 py-1.5 text-slate-300 transition hover:border-brand-sky/40"
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="px-3 py-2 text-start">اسم الفرع</th>
                  <th className="px-3 py-2 text-start">المدينة</th>
                  <th className="px-3 py-2 text-start">طلب من</th>
                  <th className="px-3 py-2 text-start">السبب</th>
                  <th className="px-3 py-2 text-start">التاريخ</th>
                  <th className="px-3 py-2 text-start">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-500">
                      لا توجد طلبات في هذه الحالة.
                    </td>
                  </tr>
                ) : (
                  requests.map((r) => (
                    <tr key={r.id} className="border-b border-white/5 text-slate-200">
                      <td className="px-3 py-2.5 font-medium text-white">{r.branch_name}</td>
                      <td className="px-3 py-2.5">{r.city || "—"}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col">
                          <span>{r.requested_by_name || "—"}</span>
                          <span dir="ltr" className="text-[11px] text-slate-500">
                            {r.requested_by_email || ""}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 max-w-[280px] truncate text-slate-300" title={r.reason || ""}>
                        {r.reason || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-400">{formatDate(r.created_at)}</td>
                      <td className="px-3 py-2.5">
                        {r.status === "pending" ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => decideRequest(r, "approved")}
                              className="rounded-lg border border-accent-green/40 bg-accent-green/10 px-2.5 py-1 text-xs text-green-200 transition hover:bg-accent-green/20"
                            >
                              قبول
                            </button>
                            <button
                              type="button"
                              onClick={() => decideRequest(r, "rejected")}
                              className="rounded-lg border border-accent-red/40 bg-accent-red/10 px-2.5 py-1 text-xs text-red-200 transition hover:bg-accent-red/20"
                            >
                              رفض
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {r.status === "approved" ? "✓ مقبول" : "✗ مرفوض"}
                            {r.reviewed_by_name ? ` — ${r.reviewed_by_name}` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
