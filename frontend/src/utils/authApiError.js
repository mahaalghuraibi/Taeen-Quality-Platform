/**
 * Parse FastAPI `detail` (string or validation array) for auth flows.
 * @param {unknown} detail
 * @returns {string}
 */
export function parseFastApiDetail(detail) {
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((entry) => {
        if (typeof entry === "string") return entry;
        const loc = Array.isArray(entry?.loc)
          ? entry.loc.filter((x) => x !== "body").join(" › ")
          : "";
        const msg = typeof entry?.msg === "string" ? entry.msg : "";
        if (loc && msg) return `${loc}: ${msg}`;
        return msg || "";
      })
      .filter(Boolean)
      .join(" — ");
  }
  return "";
}

/**
 * User-visible Arabic message for failed login/register responses.
 * @param {number} status
 * @param {{ detail?: unknown; message?: string }} [body]
 * @param {string} [fallback]
 */
export function formatAuthError(status, body, fallback = "تعذر إكمال الطلب.") {
  const fromDetail = parseFastApiDetail(body?.detail);
  if (fromDetail) {
    if (fromDetail === "طلب غير صالح") {
      return "البيانات المرسلة غير صالحة. تحقق من البريد الإلكتروني واسم المستخدم (حرفان على الأقل) وكلمة المرور.";
    }
    if (fromDetail === "Email already exists") {
      return "البريد الإلكتروني مسجّل مسبقاً. جرّب تسجيل الدخول أو استخدم بريداً آخر.";
    }
    if (fromDetail === "Username already exists") {
      return "اسم المستخدم مستخدم مسبقاً. جرّب بريداً إلكترونياً مختلفاً.";
    }
    if (fromDetail === "Username is required") {
      return "اسم المستخدم مطلوب.";
    }
    if (fromDetail === "بيانات الدخول غير صحيحة") {
      return fromDetail;
    }
    return fromDetail;
  }
  if (typeof body?.message === "string" && body.message.trim()) {
    return body.message.trim();
  }
  if (status === 401) return "بيانات الدخول غير صحيحة.";
  if (status === 422) {
    return "البيانات المرسلة غير صالحة. راجع الحقول وحاول مرة أخرى.";
  }
  if (status === 400) return fallback;
  if (status === 200) {
    return "استجابة غير متوقعة من الخادم (لا يوجد رمز دخول). تحقق من إعداد VITE_API_BASE_URL في نشر الواجهة.";
  }
  return `${fallback} (رمز ${status})`;
}

/**
 * @param {string} tag
 * @param {string} url
 * @param {Response} res
 * @param {object} data
 * @param {Record<string, unknown>} [extra]
 */
export function logAuthFailure(tag, url, res, data, extra = {}) {
  console.error(`[${tag}] auth request failed`, {
    url,
    status: res?.status,
    statusText: res?.statusText,
    detail: data?.detail ?? null,
    responseBody: data,
    ...extra,
  });
}

/**
 * Build OAuth2 login body (application/x-www-form-urlencoded).
 * Backend: POST /api/v1/auth/login — fields `username` (email or username) + `password`.
 * @param {string} loginId
 * @param {string} password
 */
export function buildLoginFormBody(loginId, password) {
  const body = new URLSearchParams();
  body.set("grant_type", "password");
  body.set("username", loginId.trim());
  body.set("password", password);
  return body;
}

/**
 * Derive username ≥2 chars (backend UserCreate.username min_length=2).
 * @param {string} email
 * @param {string} fullName
 */
export function buildRegisterUsername(email, fullName) {
  const safeEmail = String(email || "").trim().toLowerCase();
  const emailLocal = safeEmail.includes("@") ? safeEmail.split("@")[0] : safeEmail;
  const fromName = String(fullName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, 20);
  let base = (emailLocal || fromName || "user")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, 64);
  if (base.length < 2) {
    const stamp = String(Date.now()).slice(-6);
    base = `${base || "u"}${stamp}`.slice(0, 64);
  }
  return base;
}

/**
 * JSON body accepted by POST /api/v1/auth/users (UserCreate).
 * @param {{
 *   email: string;
 *   password: string;
 *   role: string;
 *   tenantId: number;
 *   fullName: string;
 *   branchId: number;
 *   branchName: string;
 * }} fields
 */
export function buildRegisterPayload({ email, password, role, tenantId, fullName, branchId, branchName }) {
  const safeEmail = email.trim().toLowerCase();
  return {
    email: safeEmail,
    username: buildRegisterUsername(safeEmail, fullName),
    password,
    role,
    tenant_id: tenantId,
    full_name: fullName.trim() || null,
    branch_id: branchId,
    branch_name: branchName,
  };
}
