import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ACCESS_TOKEN_KEY } from "../constants.js";
import SKALogo from "../components/SKALogo.jsx";
import { PUBLIC_PAGE_TITLES } from "../constants/branding.js";
import { apiUrl } from "../config/apiBase.js";

const USERS_URL = apiUrl("/api/v1/users");
const ADMIN_CREATE_URL = apiUrl("/api/v1/users/admin-create");

export default function AdminUsersPage() {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY) || "";
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  useEffect(() => {
    document.title = PUBLIC_PAGE_TITLES.adminUsers;
  }, []);

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("staff");

  async function loadUsers() {
    setLoading(true);
    setError("");
    if (!token) {
      setUsers([]);
      setError("يجب تسجيل الدخول أولاً للوصول إلى إدارة المستخدمين.");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(USERS_URL, { headers: authHeaders });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        if (res.status === 401) {
          setError("401: الجلسة غير صالحة أو انتهت. يرجى تسجيل الدخول مرة أخرى.");
          setUsers([]);
          return;
        }
        if (res.status === 403) {
          setError("403: غير مصرح لك بالوصول إلى إدارة المستخدمين.");
          setUsers([]);
          return;
        }
        if (res.status === 404) {
          setError("المسار /api/v1/users غير متاح. يرجى إعادة تشغيل الـ backend بأحدث نسخة.");
          setUsers([]);
          return;
        }
        setError("تعذر تحميل المستخدمين.");
        setUsers([]);
        return;
      }
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      setUsers([]);
      setError("تعذر الاتصال بالخادم. يرجى التحقق من الشبكة والمحاولة مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateUser(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    try {
      const res = await fetch(ADMIN_CREATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          email: email.trim(),
          username: username.trim().toLowerCase(),
          password,
          role,
          tenant_id: 1,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.detail === "string" ? data.detail : "تعذر إنشاء المستخدم.");
        return;
      }
      setSuccess("تم إنشاء المستخدم بنجاح.");
      setEmail("");
      setUsername("");
      setPassword("");
      setRole("staff");
      await loadUsers();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    }
  }

  async function handleRoleChange(userId, nextRole) {
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${USERS_URL}/${userId}/role`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({ role: nextRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.detail === "string" ? data.detail : "تعذر تعديل صلاحية المستخدم.");
        return;
      }
      setSuccess("تم تحديث الصلاحية بنجاح.");
      await loadUsers();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    }
  }

  async function handleDeleteUser(userId) {
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${USERS_URL}/${userId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) {
        setError("تعذر حذف المستخدم.");
        return;
      }
      setSuccess("تم حذف المستخدم.");
      await loadUsers();
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
          <Link to="/analytics" className="text-sm font-medium text-slate-400 transition hover:text-brand-sky">
            العودة للوحة التحكم
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 sm:py-8 lg:px-8">
        <section className="rounded-2xl border border-white/10 bg-[#0f172a] p-4 sm:rounded-3xl sm:p-6">
          <h1 className="text-xl font-bold text-white sm:text-2xl">إدارة المستخدمين</h1>
          <p className="mt-1 text-sm text-slate-400">إضافة المستخدمين وتعديل الصلاحيات</p>
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

          <form className="mt-6 grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4" onSubmit={handleCreateUser}>
            <input
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              dir="ltr"
              className="rounded-xl border border-white/10 bg-[#020617]/60 px-3 py-2.5 text-sm text-white focus:border-brand-sky/50 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <input
              type="text"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              dir="ltr"
              className="rounded-xl border border-white/10 bg-[#020617]/60 px-3 py-2.5 text-sm text-white focus:border-brand-sky/50 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <input
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              dir="ltr"
              className="rounded-xl border border-white/10 bg-[#020617]/60 px-3 py-2.5 text-sm text-white focus:border-brand-sky/50 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-xl border border-white/10 bg-[#020617]/60 px-3 py-2.5 text-sm text-white focus:border-brand-sky/50 focus:outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="staff">staff</option>
              <option value="supervisor">supervisor</option>
              <option value="admin">admin</option>
            </select>
            <button
              type="submit"
              className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/35 transition hover:bg-blue-600"
            >
              إضافة مستخدم
            </button>
          </form>

          <div className="mt-6 overflow-x-auto">
            {loading ? (
              <div className="rounded-xl border border-white/10 bg-[#0B1327]/70 px-3 py-6 text-center text-sm text-slate-400">
                جاري تحميل المستخدمين...
              </div>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="px-3 py-2 text-start">الاسم</th>
                    <th className="px-3 py-2 text-start">البريد الإلكتروني</th>
                    <th className="px-3 py-2 text-start">الدور</th>
                    <th className="px-3 py-2 text-start">الحالة</th>
                    <th className="px-3 py-2 text-start">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-500">
                        لا يوجد مستخدمون لعرضهم. أضف مستخدماً جديداً أو تحقق من الصلاحيات.
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id} className="border-b border-white/5 text-slate-200">
                        <td className="px-3 py-2.5">{user.full_name || user.username || "—"}</td>
                        <td className="px-3 py-2.5">{user.email}</td>
                        <td className="px-3 py-2.5">
                          <select
                            value={user.role}
                            onChange={(e) => handleRoleChange(user.id, e.target.value)}
                            className="rounded-lg border border-white/10 bg-[#020617]/60 px-2 py-1 text-xs text-white"
                          >
                            <option value="staff">staff</option>
                            <option value="supervisor">supervisor</option>
                            <option value="admin">admin</option>
                          </select>
                        </td>
                        <td className="px-3 py-2.5">{user.status || "نشط"}</td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(user.id)}
                            className="rounded-lg border border-accent-red/40 bg-accent-red/10 px-2.5 py-1 text-xs text-red-200 transition hover:bg-accent-red/20"
                          >
                            حذف
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
