# دليل تعزيز الأمن السيبراني — منصة عين الجودة

> **SECURITY_HARDENING_AR.md**
> آخر تحديث: مايو 2026
> **التصنيف:** للاستخدام الداخلي والعميل — مستوى مؤسسي (Enterprise)
> **المنصة:** عين الجودة — SaaS لمراقبة جودة وسلامة المطابخ بالذكاء الاصطناعي

---

## معلومات المستند

| البند | القيمة |
|-------|--------|
| **اسم المنصة** | عين الجودة (Ayn Al-Jawdah) |
| **نوع الخدمة** | SaaS — مراقبة CCTV + AI + توثيق أطباق |
| **المكدس التقني** | **FastAPI** (Backend) · **React + Vite** (Frontend) · **PostgreSQL** · **Docker** · **Render** |
| **المصادقة** | JWT (HS256) + RBAC |
| **الذكاء الاصطناعي** | YOLO (Ultralytics) — استدلال Backend-only |
| **الجمهور** | CIO، CISO، IT، DevOps، العميل المؤسسي |

> **ملاحظة تقنية:** Backend مبني على **FastAPI** (Python) وليس Django. جميع التوصيات في هذا المستند مُطبَّقة على المكدس الفعلي للمنصة.

---

## جدول المحتويات

1. [مقدمة الأمن السيبراني](#1-مقدمة-الأمن-السيberاني)
2. [حماية الحسابات](#2-حماية-الحسابات)
3. [حماية الـ API](#3-حماية-ال-api)
4. [حماية قاعدة البيانات](#4-حماية-قاعدة-البيانات)
5. [حماية الكاميرات والبث](#5-حماية-الكاميرات-والبث)
6. [حماية ملفات الذكاء الاصطناعي](#6-حماية-ملفات-الذكاء-الاصطناعي)
7. [حماية ملفات المشروع](#7-حماية-ملفات-المشروع)
8. [حماية السيرفر](#8-حماية-السيرفر)
9. [النسخ الاحتياطي والاستعادة](#9-النسخ-الاحتياطي-والاستعادة)
10. [المراقبة واكتشاف الاختراق](#10-المراقبة-واكتشاف-الاختراق)
11. [قائمة فحص الأمان قبل التسليم](#11-قائمة-فحص-الأمان-قبل-التسليم)
12. [تقييم الأمان الحالي للمنصة](#12-تقييم-الأمان-الحالي-للمنصة)
13. [توصيات مستقبلية](#13-توصيات-مستقبلية)

---

## 1. مقدمة الأمن السيبراني

### 1.1 أهمية حماية بيانات المطاعم

منصة **عين الجودة** تُعالج بيانات حساسة تشمل:

- **صور وفيديو** من داخل المطابخ (عمليات، موظفون، معدات).
- **سجلات مخالفات** قد تُستخدم في قرارات إدارية أو قانونية.
- **بيانات توثيق الأطباق** (إنتاج، كميات، فروع).
- **بيانات المستخدمين** (أسماء، أدوار، فروع، صلاحيات).

اختراق هذه البيانات قد يؤدي إلى:

| المخاطرة | الأثر |
|----------|-------|
| تسريب فيديو المطبخ | خرق خصوصية الموظفين — مسؤولية قانونية |
| تزوير سجلات مخالفات | قرارات إدارية خاطئة — نزاعات عمالية |
| سرقة بيانات العملاء (Multi-tenant) | فقدان ثقة + غرامات تنظيمية |
| تعطيل المراقبة | مخاطر سلامة غذائية غير مُكتشفة |

### 1.2 حماية بيانات الموظفين والكاميرات

| الأصل | نوع البيانات | مستوى الحساسية |
|-------|--------------|----------------|
| بث الكاميرات (RTSP) | فيديو حيّ | **حرج** |
| صور المخالفات | JPEG/WebP + metadata | **عالي** |
| حسابات المستخدمين | email, password hash, role | **حرج** |
| بيانات RTSP | username/password كاميرات | **حرج** |
| نماذج YOLO | `.pt` weights | **متوسط** (IP) |

**مبدأ أساسي:** *الحد الأدنى من الصلاحيات (Least Privilege)* — كل مستخدم يرى فقط ما يحتاجه لدوره.

### 1.3 منع الوصول غير المصرح

```
                    ┌─────────────────────────────────────┐
                    │         Internet (HTTPS)            │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │   WAF / Cloudflare (مستقبلي)        │
                    └──────────────┬──────────────────────┘
                                   │
          ┌────────────────────────▼────────────────────────┐
          │              Render — Frontend (React)           │
          │         Static SPA · HTTPS · CORS restricted     │
          └────────────────────────┬────────────────────────┘
                                   │ JWT Bearer
          ┌────────────────────────▼────────────────────────┐
          │           Render — Backend (FastAPI)             │
          │    Rate Limit · RBAC · Input Validation · JWT   │
          └───────┬────────────────────────────┬────────────┘
                  │                            │
     ┌────────────▼──────────┐    ┌────────────▼────────────┐
     │  PostgreSQL (Private)  │    │  YOLO Inference (CPU)   │
     │  Encrypted at rest     │    │  Models NOT public      │
     └────────────────────────┘    └─────────────────────────┘
                  │
     ┌────────────▼──────────┐
     │  RTSP Cameras (LAN)   │  ← لا تعرض للإنternet
     │  VPN for multi-branch │
     └───────────────────────┘
```

---

## 2. حماية الحسابات

### 2.1 Password Hashing (تجزئة كلمات المرور)

| البند | التطبيق الحالي | التوصية الإنتاجية |
|-------|----------------|-------------------|
| **الخوارزمية** | bcrypt (passlib) | ✅ bcrypt — work factor ≥ 12 |
| **Salt** | تلقائي (bcrypt) | ✅ مُدمج |
| **Plaintext** | **لا يُخزَّن أبداً** | ✅ |
| **سياسة كلمة المرور** | 6+ أحرف (حد أدنى) | **8+ أحرف، حرف كبير + رقم** (مستقبلي) |

**الملف المرجعي:** `backend/app/services/auth_service.py`

```python
# ✅ صحيح — bcrypt hashing
pwd_context.hash(plain_password)

# ❌ ممنوع — plaintext أو MD5/SHA1
user.password = plain_password  # NEVER
```

### 2.2 JWT Authentication

| العنصر | القيمة | ملاحظة |
|--------|--------|--------|
| **الخوارزمية** | HS256 | HMAC-SHA256 |
| **المفتاح** | `SECRET_KEY` (env) | ≥ 32 حرف عشوائي في الإنتاج |
| **مدة الصلاحية** | `ACCESS_TOKEN_EXPIRE_MINUTES` | 60–1440 دقيقة (حسب سياسة العميل) |
| **Payload** | `sub` (user id), `exp`, `role`, `tenant_id` | لا تضع بيانات حساسة في JWT |
| **التخزين (Client)** | `localStorage` | ⚠️ عرضة لـ XSS — انظر 3.7 |

**قواعد JWT:**

✅ التحقق من التوقيع (`verify_signature=True`)
✅ التحقق من انتهاء الصلاحية (`verify_exp=True`)
✅ رفض الرموز المنتهية بـ 401 (لا silent fail)
❌ لا تُخزَّن JWT في URL query parameters
❌ لا تُرسل JWT في logs

### 2.3 Session Expiration (انتهاء الجلسة)

| السيناريو | السلوك |
|-----------|--------|
| Token منتهٍ | `401 Unauthorized` + رسالة «انتهت الجلسة» |
| Frontend | إعادة توجيه تلقائية لصفحة Login |
| Token refresh | **غير مُطبَّق حالياً** — مستخدم يُعيد تسجيل الدخول |
| Idle timeout | **Frontend-side** — يُوصى بـ 30–60 دقيقة (مستقبلي) |

### 2.4 Role-Based Access Control (RBAC)

| الدور | الصلاحيات | القيود |
|-------|-----------|--------|
| **Admin** | كل الفروع، إدارة مستخدمين، إعدادات، تقارير | — |
| **Supervisor** | فرعه فقط، مراقبة، تنبيهات، مراجعات | `branch_id` إلزامي |
| **Staff (Employee)** | توثيق أطباق، سجله الشخصي | لا مراقبة، لا إدارة |

**التطبيق:**

- **Backend:** `require_roles("admin", "supervisor")` decorator على كل route حساس.
- **Frontend:** `PrivateRoute`, `AdminRoute` — إخفاء UI غير المصرح.
- **Database:** `tenant_id` + `branch_id` filter على كل query.

**الملفات المرجعية:**
- `backend/app/api/rbac.py`
- `backend/app/api/deps.py`
- `frontend/src/components/PrivateRoute.jsx`

### 2.5 جدول صلاحيات تفصيلي

| المورد | Admin | Supervisor | Staff |
|--------|-------|------------|-------|
| إدارة مستخدمين | ✅ | ❌ | ❌ |
| إضافة كاميرات | ✅ | ✅ (فرعه) | ❌ |
| المراقبة المباشرة | ✅ | ✅ | ❌ |
| تنبيهات المخالفات | ✅ | ✅ | ❌ |
| توثيق أطباق | ✅ | ✅ | ✅ |
| تقارير | ✅ | ✅ (فرعه) | ❌ (سجله) |
| `/api/v1/ai/health` | ✅ | ✅ | ❌ |
| إعدادات النظام | ✅ | ❌ | ❌ |

---

## 3. حماية الـ API

### 3.1 HTTPS Only

| البند | الحالة |
|-------|--------|
| TLS 1.2+ على Render | ✅ تلقائي |
| HTTP → HTTPS redirect | ✅ Render default |
| HSTS header | ⚠️ يُوصى بتفعيله صراحة |
| Certificate pinning (mobile) | ❌ غير مُطبَّق (لا تطبيق جوّال بعد) |

**Render:** جميع الخدمات تُقدَّم عبر HTTPS افتراضياً. لا تُفعِّل HTTP plain.

### 3.2 CORS Protection

| الإعداد | القيمة |
|---------|--------|
| `CORS_ORIGINS` | قائمة نطاقات Frontend المصرح بها فقط |
| `allow_credentials` | `True` (لـ JWT cookies إن وُجدت) |
| `allow_methods` | `GET, POST, PUT, PATCH, DELETE` |
| Wildcard `*` | **❌ ممنوع في الإنتاج** |

**الملف:** `backend/app/main.py` — `CORSMiddleware`

```env
# ✅ إنتاج
CORS_ORIGINS=https://app.ayn-aljawdah.com,https://admin.ayn-aljawdah.com

# ❌ ممنوع
CORS_ORIGINS=*
```

### 3.3 Rate Limiting

| Endpoint | الحد | الغرض |
|----------|------|-------|
| `POST /auth/login` | 10/minute | منع Brute Force |
| `POST /monitoring/analyze-frame` | 72/minute | منع استنزاف YOLO CPU |
| Global (SlowAPI) | configurable | حماية عامة |

**الملف:** `backend/app/core/limiter.py` + `@limiter.limit()` decorators

**توصية إنتاجية:** إضافة rate limit على `/auth/register` و `/users` (5/min).

### 3.4 Token Validation

```
Request → Authorization: Bearer <JWT>
    │
    ├─ Missing token → 401
    ├─ Invalid signature → 401
    ├─ Expired → 401
    ├─ Valid → extract user → RBAC check → proceed
    └─ Wrong role → 403 Forbidden
```

**الملف:** `backend/app/api/deps.py` → `get_current_user()`

### 3.5 Input Validation

| الطبقة | الأداة | الغرض |
|--------|--------|-------|
| Request body | **Pydantic v2** schemas | Type + range + format validation |
| Query params | FastAPI + Pydantic | Sanitization |
| File uploads | Size limit + MIME check | `MONITORING_UPLOAD_MAX_BYTES` |
| SQL params | SQLAlchemy ORM | Parameterized queries |

**قاعدة:** لا تثق أبداً بمدخلات المستخدم — validate على Backend حتى لو Frontend يتحقق.

### 3.6 SQL Injection Prevention

| البند | التطبيق |
|-------|---------|
| ORM | **SQLAlchemy** — parameterized queries |
| Raw SQL | **ممنوع** إلا في migrations |
| User input in queries | `.filter(Model.field == value)` — never string concat |

```python
# ✅ آمن
db.query(User).filter(User.email == email).first()

# ❌ خطير — SQL Injection
db.execute(f"SELECT * FROM users WHERE email = '{email}'")
```

### 3.7 XSS Protection (Cross-Site Scripting)

| الطبقة | الحماية |
|--------|---------|
| **React** | Auto-escaping JSX — `{userInput}` آمن افتراضياً |
| **dangerouslySetInnerHTML** | **ممنوع** إلا مع DOMPurify |
| **API responses** | JSON — لا HTML rendering |
| **Content-Security-Policy** | ⚠️ يُوصى بإضافته في Frontend headers |

**مخاطرة JWT في localStorage:** إذا وُجد XSS، المهاجم يسرق Token. **الحل المستقبلي:** httpOnly Secure cookies + CSRF token.

### 3.8 CSRF Protection

| البند | الحالة |
|-------|--------|
| JWT Bearer (Header) | ✅ CSRF-resistant (لا cookies تلقائية) |
| Cookie-based auth | ❌ غير مُستخدم حالياً |
| SameSite cookies | N/A |
| CSRF token | ⚠️ مطلوب فقط إذا انتقلنا لـ cookie auth |

**الوضع الحالي:** API stateless + JWT في Header → **CSRF risk منخفض**. إذا أُضيف cookie auth → CSRF token إلزامي.

### 3.9 Security Headers (Middleware)

| Header | القيمة المُوصى بها | الحالة |
|--------|-------------------|--------|
| `X-Content-Type-Options` | `nosniff` | ✅ |
| `X-Frame-Options` | `DENY` | ✅ |
| `X-XSS-Protection` | `1; mode=block` | ✅ |
| `Strict-Transport-Security` | `max-age=31536000` | ⚠️ يُوصى |
| `Content-Security-Policy` | restrictive | ⚠️ مستقبلي |

**الملف:** `backend/app/middleware/security_headers.py`

---

## 4. حماية قاعدة البيانات

### 4.1 PostgreSQL Security

| البند | التطبيق |
|-------|---------|
| **Engine** | PostgreSQL (Render managed) |
| **Connection** | SSL/TLS (`sslmode=require`) |
| **Network** | Private — لا public IP |
| **User** | Dedicated app user — **ليس** superuser |
| **Permissions** | SELECT/INSERT/UPDATE/DELETE على جداول التطبيق فقط |

### 4.2 Environment Variables

```env
# ✅ صحيح — في Render Environment (encrypted)
DATABASE_URL=postgresql://app_user:STRONG_PASS@host:5432/ayn_db?sslmode=require
SECRET_KEY=<random-32+-chars>
GEMINI_API_KEY=<key>

# ❌ ممنوع — في الكود
DATABASE_URL = "postgresql://admin:123456@localhost/db"
```

### 4.3 No Hardcoded Secrets

| الملف | القاعدة |
|-------|---------|
| `backend/app/core/config.py` | يقرأ من `os.environ` / `.env` |
| `backend/.env.example` | placeholders فقط — **لا قيم حقيقية** |
| Source code | **صفر** secrets hardcoded |

**فحص دوري:**
```bash
# ابحث عن secrets محتملة في الكود
grep -rn "password\s*=" backend/app/ --include="*.py" | grep -v "hash\|context\|Field"
grep -rn "api_key\s*=" backend/app/ --include="*.py" | grep -v "settings\|getenv"
```

### 4.4 Encrypted Credentials

| السر | التخزين | التشفير |
|------|---------|---------|
| `DATABASE_URL` | Render env (encrypted at rest) | ✅ Render managed |
| `SECRET_KEY` | Render env | ✅ |
| RTSP camera passwords | PostgreSQL `cameras` table | ⚠️ plaintext في DB — **يُوصى بتشفير at-rest** |
| Gemini API key | Render env | ✅ |
| User passwords | PostgreSQL `users.password_hash` | ✅ bcrypt |

**توصية:** تشفير `cameras.rtsp_password` بـ Fernet/AES قبل التخزين (مستقبلي).

### 4.5 Backup Strategy

| النوع | التكرار | الاحتفاظ | الأداة |
|-------|---------|----------|--------|
| **Automated (Render)** | يومي | 7 أيام | Render PostgreSQL backup |
| **Manual dump** | أسبوعي | 30 يوم | `pg_dump` → S3/encrypted storage |
| **Point-in-time** | — | 7 أيام | Render Pro plan |

```bash
# نسخة احتياطية يدوية
pg_dump "$DATABASE_URL" | gzip > backup_$(date +%Y%m%d).sql.gz
# رفع إلى تخزين مشفّر (S3, GCS) — لا local disk فقط
```

### 4.6 Database Access Restrictions

| القاعدة | التفاصيل |
|---------|----------|
| **No public access** | PostgreSQL على Render = private network فقط |
| **App user only** | Backend يتصل بـ user محدود الصلاحيات |
| **No direct client access** | Frontend **لا يتصل** بـ DB مباشرة — API only |
| **Admin DB access** | عبر Render Dashboard فقط — MFA على حساب Render |
| **IP allowlist** | Render internal — لا حاجة IP allowlist خارجي |

---

## 5. حماية الكاميرات والبث

### 5.1 Secure RTSP Usage

| البند | التوصية |
|-------|---------|
| **البروتوكول** | RTSP over **TCP** (ليس UDP) |
| **Credentials في URL** | `rtsp://user:pass@IP:554/path` — Backend only |
| **Exposure** | Backend يقرأ RTSP — **لا يُمرَّر URL للFrontend** |
| **Logging** | **لا تُسجَّل** RTSP URLs مع passwords في logs |

### 5.2 IP Whitelist

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Camera    │ ◄────── │   Backend   │         │  Internet   │
│ 192.168.1.x │  RTSP   │  (Render)   │ ◄────── │  Users      │
│             │  ONLY   │             │  HTTPS  │             │
└─────────────┘         └─────────────┘         └─────────────┘
     ▲                        │
     │                        │
     └── LAN only ────────────┘
         (via VPN if remote)
```

| القاعدة | التفاصيل |
|---------|----------|
| Cameras → Backend | Backend IP/ VPN endpoint فقط |
| Cameras → Internet | **❌ ممنوع** — لا port forwarding |
| Users → Cameras | **❌ ممنوع** — كل شيء عبر Backend API |

### 5.3 Internal Network Recommendation

- الكاميرات على **VLAN منفصل** (VLAN 20 = Cameras).
- Backend (أو edge agent) على VLAN 10 = Servers.
- Firewall rule: VLAN 10 → VLAN 20 port 554 **only**.
- **لا** routing من VLAN 20 → Internet.

### 5.4 Avoid Public Camera Exposure

| ❌ خطر | ✅ آمن |
|--------|--------|
| Port forward 554 على Router | Backend داخل LAN يقرأ RTSP |
| كاميرات على DMZ | كاميرات على LAN معزول |
| RTSP URL في Frontend JS | RTSP credentials في Backend env/DB فقط |
| Default password (admin/admin) | كلمة مرور قوية فريدة لكل كاميرا |

### 5.5 Secure Camera Credentials

| البند | التوصية |
|-------|---------|
| **Password policy** | 12+ chars, unique per camera |
| **Storage** | PostgreSQL (encrypted column — مستقبلي) |
| **Rotation** | كل 90 يوم |
| **Access** | Admin + Supervisor (فرعه) فقط |
| **Audit** | log كل تعديل على camera credentials |

### 5.6 VPN Recommendation (Multi-Branch)

```
┌──────── Branch A ────────┐     ┌──── Branch B ────────┐
│ Cameras → Local Backend  │     │ Cameras → Local Edge │
│         (or Edge Agent)  │     │         Agent        │
└────────────┬─────────────┘     └──────────┬───────────┘
             │         Site-to-Site VPN      │
             └──────────────┬────────────────┘
                            │
                   ┌────────▼────────┐
                   │  Central Cloud  │
                   │  Render Backend │
                   │  PostgreSQL     │
                   └─────────────────┘
```

**خيارات VPN:**
- **WireGuard** — خفيف، سريع، open source.
- **Tailscale** — zero-config mesh VPN.
- **OpenVPN** — enterprise-grade.

**بدون VPN:** Backend على Render **لا يستطيع** الوصول لكاميرات LAN مباشرة — يحتاج **Edge Agent** محلي يُرسل إطارات مشفّرة.

---

## 6. حماية ملفات الذكاء الاصطناعي

### 6.1 Prevent Unauthorized Model Download

| البند | التطبيق |
|-------|---------|
| Model files (`.pt`) | **NOT** in Git (`.gitignore`) |
| Public URL | **❌ لا** endpoint لتحميل `.pt` |
| API access | `/ai/status` يُبلِّغ **existence** فقط — لا يرسل الملف |
| File system | Models on Backend disk only — no static mount |

### 6.2 Protect YOLO Model Files

```
backend/ml/models/
├── keremberk_ppe.pt      ← NOT in Git, NOT publicly served
├── yolov8n.pt            ← NOT in Git
├── glove_best.pt         ← NOT in Git
├── hairnet_best.pt       ← NOT in Git
└── mask_best.pt          ← NOT in Git
```

| الحماية | التفاصيل |
|---------|----------|
| `.gitignore` | `*.pt`, `*.onnx` excluded |
| Deploy | Models baked into Docker image OR downloaded at startup from private storage |
| Access | Backend process only — no HTTP static route |
| Integrity | Checksum verification on load (مستقبلي) |

### 6.3 Backend-Only Inference

```
Client (React)                    Backend (FastAPI)
     │                                  │
     │  POST /monitoring/analyze-frame  │
     │  (image bytes only)              │
     │ ────────────────────────────────►│
     │                                  │ YOLO inference (CPU)
     │                                  │ violation_tracker
     │  JSON response (detections)      │
     │ ◄────────────────────────────────│
     │                                  │
     │  ❌ NO model files sent          │
     │  ❌ NO raw inference on client    │
```

**قاعدة:** الذكاء الاصطناعي **server-side only**. Frontend يرسل صورة/إطار ويستقبل JSON.

### 6.4 Disable Direct Public Model Access

| Endpoint | يسمح بتحميل model؟ |
|----------|-------------------|
| `GET /api/v1/ai/status` | ❌ metadata only |
| `GET /api/v1/ai/health` | ❌ metrics only |
| `GET /static/*.pt` | ❌ **does not exist** |
| `GET /ml/models/*` | ❌ **blocked** |

**Render/Docker:** لا تُعرِّف volume mount للـ models كـ public static.

---

## 7. حماية ملفات المشروع

### 7.1 `.env` Excluded from GitHub

```gitignore
# من .gitignore الفعلي للمشروع
.env
.env.*
!.env.example
!**/.env.example
backend/.env
```

| الملف | في Git؟ | السبب |
|-------|---------|-------|
| `.env` | ❌ | secrets |
| `.env.example` | ✅ | placeholders للمطورين |
| `.env.production` | ❌ | production secrets |

### 7.2 Sensitive Files Excluded

```gitignore
# أسرار وبيانات حساسة
*.db                    # SQLite local databases
*.sqlite3
backend/media/          # uploaded images
*.pt / *.onnx           # ML model weights
screenshots/*.png       # may contain real kitchen footage
```

### 7.3 Production Secrets Handling

| السر | أين يُخزَّن | من يصل |
|------|------------|--------|
| `SECRET_KEY` | Render Environment | Backend only |
| `DATABASE_URL` | Render Environment | Backend only |
| `GEMINI_API_KEY` | Render Environment | Backend only |
| RTSP passwords | PostgreSQL | Backend only |
| Render API token | Render Dashboard (MFA) | DevOps only |

**قاعدة:** Production secrets **never** in Git, Slack, email, or screenshots.

### 7.4 Git Ignore Policy

| الفئة | أمثلة | السياسة |
|-------|-------|---------|
| Secrets | `.env`, API keys | ❌ Never commit |
| Models | `*.pt`, `*.onnx` | ❌ Never commit — regenerate via scripts |
| Databases | `*.db`, `test.db` | ❌ Never commit |
| Media | `backend/media/` | ❌ Never commit |
| Dependencies | `node_modules/`, `.venv/` | ❌ Never commit |
| Cache | `__pycache__/`, `.ruff_cache/` | ❌ Never commit |
| Examples | `.env.example` | ✅ Commit (no real values) |

**Pre-commit hook (مستقبلي):**
```bash
# detect secrets before commit
pip install detect-secrets
detect-secrets scan --baseline .secrets.baseline
```

---

## 8. حماية السيرفر

### 8.1 Render Production Hardening

| البند | التطبيق |
|-------|---------|
| **Plan** | Starter/Standard (not free tier for production) |
| **Auto-deploy** | GitHub branch `main` only |
| **Environment** | Separate staging + production services |
| **Health check** | `/health` or `/api/v1/ai/health` |
| **Zero-downtime deploy** | Render rolling deploy |
| **MFA on Render account** | ✅ **إلزامي** |

### 8.2 Docker Security

```dockerfile
# ✅ Best practices (backend/Dockerfile)
FROM python:3.11-slim          # Minimal base image
RUN useradd -m appuser           # Non-root user
USER appuser                     # Don't run as root
COPY --chown=appuser:appuser .   # Correct ownership
# No secrets in Dockerfile
# No .env copied into image
```

| البند | التوصية |
|-------|---------|
| Base image | Official slim images — pin version |
| Root user | **❌ Never** run as root in production |
| Secrets in image | **❌ Never** — use env vars at runtime |
| Image scanning | Trivy / Snyk (CI pipeline — مستقبلي) |
| Multi-stage build | ✅ Reduce attack surface |

### 8.3 Firewall Recommendations

| الطبقة | القاعدة |
|--------|---------|
| **Render** | Managed — only 443/80 inbound |
| **PostgreSQL** | Private network — no public port |
| **Camera VLAN** | Block inbound from Internet |
| **Office/VPN** | Allow HTTPS to Render only |

### 8.4 Resource Isolation

| المورد | العزل |
|--------|-------|
| **Multi-tenant** | `tenant_id` on every DB query |
| **Branch isolation** | Supervisor sees `branch_id` only |
| **YOLO inference** | Single-thread lock — one frame at a time |
| **File uploads** | Size limit + tenant-scoped storage paths |
| **Process** | Docker container = single Backend instance |

### 8.5 Logging and Monitoring

| المصدر | ماذا يُسجَّل | أين |
|--------|-------------|-----|
| FastAPI access logs | HTTP method, path, status, latency | Render logs |
| Auth events | login success/fail, 401/403 | Backend logger |
| AI inference | latency, dropped frames, model state | `/api/v1/ai/health` |
| Errors | stack traces (no secrets) | Render logs |
| Audit | alert creation, user changes | PostgreSQL + logs |

**⚠️ لا تُسجَّل:** passwords, JWT tokens, RTSP URLs with credentials, API keys.

---

## 9. النسخ الاحتياطي والاستعادة

### 9.1 Daily Backups

| الأصل | الأداة | التكرار | الاحتفاظ |
|-------|--------|---------|----------|
| PostgreSQL | Render auto-backup | **يومي** | 7 أيام |
| Environment vars | Render config export | يومي (manual) | 30 يوم |
| ML models | Private S3/GCS bucket | عند التحديث | all versions |

### 9.2 Weekly Backups

| الأصل | الأداة | التكرار | الاحتفاظ |
|-------|--------|---------|----------|
| PostgreSQL full dump | `pg_dump` → encrypted S3 | **أسبوعي** | 90 يوم |
| Media files (evidence) | S3 sync | أسبوعي | 365 يوم |
| Docker images | Container registry tag | عند كل release | 10 versions |

### 9.3 Disaster Recovery Plan

```
┌─────────────────────────────────────────────────────────┐
│                  Disaster Recovery Flow                  │
└─────────────────────────────────────────────────────────┘

  Incident Detected
        │
        ▼
  ┌─────────────┐    RTO: 4 hours    ┌─────────────┐
  │  Assess     │ ─────────────────► │  Communicate│
  │  Severity   │                    │  Stakeholders│
  └──────┬──────┘                    └─────────────┘
         │
         ▼
  ┌─────────────┐    RPO: 24 hours   ┌─────────────┐
  │  Restore DB │ ─────────────────► │  Redeploy   │
  │  from backup│                    │  Backend +  │
  └──────┬──────┘                    │  Frontend   │
         │                           └──────┬──────┘
         ▼                                  │
  ┌─────────────┐                           ▼
  │  Verify     │                    ┌─────────────┐
  │  Integrity  │                    │  Post-mortem│
  └─────────────┘                    │  + Improve  │
                                     └─────────────┘
```

| Metric | Target |
|--------|--------|
| **RTO** (Recovery Time Objective) | ≤ 4 ساعات |
| **RPO** (Recovery Point Objective) | ≤ 24 ساعة (آخر backup يومي) |

### 9.4 Backup Retention Policy

| النوع | Production | Staging | Development |
|-------|-----------|---------|-------------|
| DB daily auto | 7 أيام | 3 أيام | 1 يوم |
| DB weekly manual | 90 يوم | 30 يوم | — |
| Media/evidence | 365 يوم | 30 يوم | — |
| Logs | 90 يوم | 30 يوم | 7 أيام |
| ML model versions | All | Latest 3 | Latest 1 |

---

## 10. المراقبة واكتشاف الاختراق

### 10.1 Failed Login Tracking

| البند | التطبيق | مستقبلي |
|-------|---------|---------|
| Log failed attempts | ✅ Backend logger | — |
| Rate limit on `/auth/login` | ✅ 10/minute | — |
| Account lockout after N fails | ❌ | ✅ 5 fails → 15 min lock |
| Alert admin on brute force | ❌ | ✅ Email/webhook |
| IP-based blocking | ❌ | ✅ WAF / Cloudflare |

### 10.2 Suspicious Activity Alerts

| النشاط | الإجراء |
|--------|---------|
| 10+ failed logins in 5 min | Alert admin + rate block |
| Access from new IP/country | Log + optional MFA challenge |
| Bulk data export | Alert + audit log |
| Unauthorized role escalation attempt | 403 + alert |
| AI model file access attempt | 404 + alert |

### 10.3 Access Logs

| المصدر | البيانات | الاحتفاظ |
|--------|----------|----------|
| Render HTTP logs | IP, path, status, latency | 90 يوم |
| Backend auth logs | user_id, action, timestamp | 90 يوم |
| PostgreSQL audit | CRUD on sensitive tables | 365 يوم (مستقبلي) |
| `/ai/health` metrics | FPS, latency, drops | Process-local (مستقبلي: Prometheus) |

### 10.4 Monitoring Dashboard

| Metric | Endpoint / Tool | Who sees |
|--------|----------------|----------|
| AI health | `GET /api/v1/ai/health` | Admin, Supervisor |
| Model status | `GET /api/v1/ai/status` | Admin, Supervisor |
| Service uptime | Render Dashboard | DevOps |
| Error rate | Render logs / Sentry (مستقبلي) | DevOps |
| DB connections | Render PostgreSQL metrics | DevOps |

---

## 11. قائمة فحص الأمان قبل التسليم

### 11.1 Authentication & Authorization

- [ ] `SECRET_KEY` ≥ 32 random characters in production env
- [ ] `ACCESS_TOKEN_EXPIRE_MINUTES` set appropriately (≤ 1440)
- [ ] bcrypt password hashing verified
- [ ] RBAC enforced on all sensitive endpoints
- [ ] Supervisor restricted to own `branch_id`
- [ ] Staff cannot access monitoring endpoints
- [ ] No default/test credentials in production DB

### 11.2 API Security

- [ ] HTTPS only (no HTTP)
- [ ] CORS restricted to production frontend domain(s)
- [ ] Rate limiting active on login + monitoring endpoints
- [ ] JWT validation on all protected routes
- [ ] Pydantic input validation on all request bodies
- [ ] Security headers middleware active
- [ ] No sensitive data in API error messages
- [ ] File upload size limits enforced

### 11.3 Database

- [ ] PostgreSQL with SSL (`sslmode=require`)
- [ ] No public database access
- [ ] App DB user with minimal privileges
- [ ] `DATABASE_URL` in env only — not in code
- [ ] Daily automated backups enabled
- [ ] Weekly manual backup tested (restore verified)
- [ ] Multi-tenant isolation verified (`tenant_id` on all queries)

### 11.4 Camera & Streaming

- [ ] RTSP credentials NOT exposed to frontend
- [ ] Cameras NOT port-forwarded to Internet
- [ ] Camera passwords changed from defaults
- [ ] RTSP over TCP configured
- [ ] VPN or Edge Agent for remote branches
- [ ] Camera VLAN isolated from guest Wi-Fi

### 11.5 AI / ML Security

- [ ] `.pt` model files NOT in Git
- [ ] No public endpoint to download models
- [ ] Inference server-side only
- [ ] Model files not in static/public directory
- [ ] `/ai/health` accessible to authorized roles only

### 11.6 Secrets & Configuration

- [ ] `.env` in `.gitignore` — verified not in Git history
- [ ] `.env.example` has placeholders only
- [ ] All production secrets in Render Environment
- [ ] No API keys in frontend code
- [ ] No secrets in Docker image layers
- [ ] Git history scanned for leaked secrets

### 11.7 Server & Infrastructure

- [ ] Docker runs as non-root user
- [ ] Render MFA enabled on team accounts
- [ ] Separate staging and production environments
- [ ] Health check endpoint configured
- [ ] Logging active — no secrets in logs
- [ ] Auto-deploy from protected branch only

### 11.8 Backup & Recovery

- [ ] Daily DB backup confirmed active
- [ ] Restore procedure documented and tested
- [ ] RTO/RPO defined and communicated
- [ ] Media backup strategy in place
- [ ] Disaster recovery plan documented

### 11.9 Monitoring

- [ ] Failed login attempts logged
- [ ] `/ai/health` endpoint functional
- [ ] Render service alerts configured
- [ ] Error tracking setup (Sentry — مستقبلي)

---

## 12. تقييم الأمان الحالي للمنصة

### 12.1 نقاط القوة المُطبَّقة ✅

| المجال | ما هو موجود |
|--------|---------------|
| **Authentication** | JWT (HS256) + bcrypt password hashing |
| **Authorization** | RBAC (Admin / Supervisor / Staff) + tenant isolation |
| **API** | HTTPS (Render), CORS config, Rate limiting (SlowAPI), Pydantic validation |
| **Database** | SQLAlchemy ORM (SQL injection safe), PostgreSQL on Render (private) |
| **Headers** | Security headers middleware (X-Frame-Options, nosniff, etc.) |
| **Secrets** | `.env` gitignored, env-based config, `.env.example` with placeholders |
| **AI** | Backend-only inference, models gitignored, no public model download |
| **File uploads** | Size limits, MIME validation |
| **Multi-tenant** | `tenant_id` filtering on all queries |
| **Monitoring** | `/ai/health` endpoint, auth logging, Render logs |

### 12.2 نقاط تحتاج تحسين ⚠️

| المجال | الوضع الحالي | المخاطرة | الأولوية |
|--------|-------------|----------|----------|
| **MFA** | غير موجود | متوسط | عالية |
| **JWT storage** | localStorage | XSS → token theft | عالية |
| **RTSP passwords in DB** | Plaintext | DB breach → camera access | عالية |
| **Account lockout** | غير موجود | Brute force | متوسطة |
| **CSP header** | غير مُفعَّل | XSS | متوسطة |
| **HSTS** | غير صريح | SSL strip | متوسطة |
| **WAF** | غير موجود | DDoS, bot attacks | متوسطة |
| **SIEM / SOC** | غير موجود | Delayed breach detection | متوسطة |
| **Automated security tests** | غير موجود | Regressions | متوسطة |
| **Secret scanning (CI)** | غير موجود | Leaked secrets | متوسطة |
| **Camera credential encryption** | Plaintext in DB | Insider threat | متوسطة |
| **Audit log table** | Partial (app logs only) | Compliance gap | منخفضة |
| **Penetration test** | لم يُجرَ | Unknown vulnerabilities | عالية (pre-launch) |

### 12.3 التصنيف الحالي

```
┌─────────────────────────────────────────────────────────────────┐
│                    Security Maturity Level                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Development ████████░░░░░░░░░░░░░░░░░░░░░░░░░░  (basic)       │
│  Staging     ████████████████████░░░░░░░░░░░░░░  (good)        │
│  Production  ██████████████████████████░░░░░░░░░  (near-ready)  │
│                                                                  │
│  ◄────────────────────────────────────────────────────────────► │
│  Current position: ────────────★                                 │
│                    (Staging → Production-ready)                  │
└─────────────────────────────────────────────────────────────────┘
```

| المستوى | التقييم |
|---------|---------|
| **Development** | ✅ متجاوز — الأساسيات موجودة |
| **Staging** | ✅ **الوضع الحالي** — جاهز للاختبار الميداني |
| **Production-ready** | ⚠️ **قريب** — يحتاج: MFA, pen test, RTSP encryption, WAF, account lockout |

**الخلاصة الصادقة:**

> المنصة **ليست** «Development-only» — البنية الأمنية الأساسية (JWT, RBAC, bcrypt, HTTPS, CORS, rate limiting, ORM, gitignore, backend-only AI) **مُطبَّقة فعلياً**.
>
> لكنها **ليست بعد** «Production-ready» بالمعنى المؤسسي الكامل — ينقص: MFA، WAF، تشفير credentials الكاميرات، pen test، SIEM، وaccount lockout.
>
> **التقدير:** جاهزة لـ **Staging / Pilot** مع عميل واحد. قبل التوسع لعدة عملاء → إغلاق الفجوات عالية الأولوية (4–6 أسابيع).

---

## 13. توصيات مستقبلية

### 13.1 Multi-Factor Authentication (MFA)

| البند | التفاصيل |
|-------|----------|
| **الأولوية** | 🔴 عالية |
| **التطبيق** | TOTP (Google Authenticator) أو SMS OTP |
| **النطاق** | Admin + Supervisor (إلزامي)؛ Staff (اختياري) |
| **التكلفة** | منخفضة — مكتبات open source (pyotp) |
| **الجدول** | v2.0 — 4–6 أسابيع |

### 13.2 SIEM (Security Information & Event Management)

| البند | التفاصيل |
|-------|----------|
| **الأولوية** | 🟡 متوسطة |
| **الخيارات** | Elastic SIEM, Datadog Security, Wazuh (open source) |
| **البيانات** | Auth logs, API access, failed logins, AI health anomalies |
| **الفائدة** | Correlation, alerting, compliance reporting |
| **الجدول** | v3.0 — Enterprise |

### 13.3 SOC Monitoring (Security Operations Center)

| البند | التفاصيل |
|-------|----------|
| **الأولوية** | 🟡 متوسطة (Enterprise clients) |
| **النموذج** | 24/7 monitoring via managed SOC provider |
| **البديل** | Automated alerting (PagerDuty + SIEM rules) |
| **الجدول** | v3.0 — عند 10+ عملاء |

### 13.4 Cloudflare

| البند | التفاصيل |
|-------|----------|
| **الأولوية** | 🔴 عالية (قبل Production) |
| **الخدمات** | CDN, DDoS protection, SSL, DNS |
| **WAF** | Managed rules + custom rules |
| **Bot protection** | Challenge suspicious traffic |
| **التكلفة** | Pro plan ~$20/month — Business ~$200/month |
| **الجدول** | v2.0 — قبل الإطلاق العام |

### 13.5 WAF (Web Application Firewall)

| البند | التفاصيل |
|-------|----------|
| **الأولوية** | 🔴 عالية |
| **الخيارات** | Cloudflare WAF, AWS WAF, Render + Cloudflare proxy |
| **الحماية** | SQLi, XSS, CSRF, bot, DDoS L7 |
| **الجدول** | v2.0 — مع Cloudflare |

### 13.6 Enterprise IAM

| البند | التفاصيل |
|-------|----------|
| **الأولوية** | 🟢 منخفضة (Enterprise) |
| **الخيارات** | Microsoft Entra ID, Google Workspace SSO, Okta |
| **البروتوكول** | SAML 2.0 / OIDC |
| **الفائدة** | Single Sign-On, centralized user lifecycle |
| **الجدول** | v3.0 — Enterprise package |

### 13.7 خارطة التحسين الأمني

```
الآن (v1.5)          v2.0 (6 أسابيع)         v3.0 (Enterprise)
─────────────         ─────────────────         ─────────────────
JWT + RBAC            + MFA                     + SSO / IAM
bcrypt                + Cloudflare + WAF        + SIEM
HTTPS                 + RTSP encryption         + SOC 24/7
Rate limiting         + Account lockout         + Pen test سنوي
CORS                  + CSP headers             + FedRAMP-ready
Backend-only AI       + Secret scanning (CI)    + Edge encryption
.gitignore            + Pen test                + Compliance (ISO 27001)
/ai/health            + Audit log table         + Bug bounty program
```

---

## 14. مراجع

| المستند | الغرض |
|---------|--------|
| `SECURITY_GUIDE_AR.md` | دليل الأمان التفصيلي (Threat model, controls) |
| `SECURITY_DEPLOYMENT_NOTES.md` | ملاحظات نشر أمنية |
| `SECURITY_REPORT.md` | تقرير تدقيق أمني |
| `DEPLOYMENT_GUIDE_AR.md` | نشر Render + Docker |
| `CAMERA_SETUP_GUIDE_AR.md` | أمان الكاميرات و RTSP |
| `TECHNICAL_REQUIREMENTS_AR.md` | متطلبات تقنية شاملة |

---

## 15. خلاصة للعميل

| السؤال | الجواب |
|--------|--------|
| **هل المنصة آمنة؟** | نعم — الأساسيات مُطبَّقة (JWT, RBAC, bcrypt, HTTPS, ORM, AI server-side). |
| **هل هي Production-ready؟** | قريبة — جاهزة لـ Pilot. قبل التوسع: MFA + WAF + pen test. |
| **ما أكبر المخاطر؟** | كاميرات credentials plaintext + JWT in localStorage + no MFA. |
| **كم يستغرق الوصول لـ Production-ready؟** | 4–6 أسابيع (MFA, Cloudflare, RTSP encryption, pen test). |
| **هل AI models محمية؟** | نعم — backend-only, not in Git, no public download. |

---

*هذا المستند جاهز للإرسال للعميل والفريق التقني. يُحدَّث مع كل إصدار أمني.*

*نهاية دليل تعزيز الأمن السيberاني.*
