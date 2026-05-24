# دليل حماية السورس كود ومكافحة القرصنة — منصة عين الجودة

> **SOURCE_CODE_PROTECTION_AR.md**
> آخر تحديث: مايو 2026
> **التصنيف:** للاستخدام الداخلي والعميل — مستوى مؤسسي (Enterprise)
> **المنصة:** عين الجودة — SaaS تجاري للمراقبة بالذكاء الاصطناعي

---

## معلومات المستند

| البند | القيمة |
|-------|--------|
| **اسم المنصة** | عين الجودة (Ayn Al-Jawdah) |
| **نموذج العمل** | **SaaS** — Software as a Service (اشتراك شهري/سنوي) |
| **المكدس التقني** | **React + Vite** (Frontend) · **FastAPI** (Backend) · **PostgreSQL** · **Docker** · **Render** · **YOLO** |
| **الملكية الفكرية** | كود المصدر، نماذج AI، واجهات، توثيق — ملك للمزوّد |
| **الجمهور** | الإدارة التنفيذية، العميل، Legal، DevOps، CISO |

---

## جدول المحتويات

1. [مقدمة حماية السورس كود](#1-مقدمة-حماية-السورس-كود)
2. [حماية الـ Frontend](#2-حماية-ال-frontend)
3. [حماية الـ Backend](#3-حماية-ال-backend)
4. [حماية ملفات الذكاء الاصطناعي](#4-حماية-ملفات-الذكاء-الاصطناعي)
5. [حماية قاعدة البيانات](#5-حماية-قاعدة-البيانات)
6. [حماية السيرفر والإنتاج](#6-حماية-السيرفر-والإنتاج)
7. [منع نسخ النظام](#7-منع-نسخ-النظام)
8. [حماية ملفات التسليم](#8-حماية-ملفات-التسليم)
9. [GitHub security](#9-github-security)
10. [تقييم الحماية الحالي](#10-تقييم-الحماية-الحالي)
11. [توصيات مستقبلية](#11-توصيات-مستقبلية)
12. [خلاصة العميل](#12-خلاصة-العميل)

---

## 1. مقدمة حماية السورس كود

### 1.1 أهمية حماية الملكية الفكرية (Intellectual Property)

منصة **عين الجودة** تمثّل استثماراً تقنياً كبيراً يشمل:

| الأصل | الوصف | القيمة التجارية |
|-------|--------|-----------------|
| **كود المصدر** | FastAPI backend + React frontend — آلاف الأسطر | أساس المنتج |
| **نماذج YOLO** | `.pt` weights مدرّبة/مُكيَّفة للمطابخ | ميزة تنافسية |
| **خط أنابيب AI** | Region pipeline، violation tracker، smart priority | IP فريد |
| **الواجهات العربية** | RTL، UX مخصّص للمطابخ السعودية | علامة تجارية |
| **التوثيق** | 15+ دليل عربي احترافي | قيمة تسليم |
| **قاعدة المعرفة** | Dataset guides، accuracy reports، roadmaps | أصل استراتيجي |

**بدون حماية IP:** أي منافس يمكنه نسخ المنصة، إعادة بيعها، أو استخراج نماذج AI — مما يُفقد المزوّد ميزته التنافسية والعائد على الاستثمار.

### 1.2 مخاطر نسخ النظام أو إعادة بيعه

| السيناريو | الآلية | الأثر |
|-----------|--------|-------|
| **Clone كامل** | سرقة repo + deploy على سيرفر آخر | منافس مباشر بنفس المنتج |
| **Reverse engineering Frontend** | فك minified JS → فهم API calls | تقليد الواجهة |
| **Model extraction** | الوصول لملفات `.pt` | سرقة نماذج AI |
| **API abuse** | استخدام API بدون ترخيص | استنزاف موارد + بيانات |
| **White-label غير مرخّص** | إعادة بيع تحت علامة أخرى | فقدان حصة سوق |
| **Insider leak** | موظف ينسخ الكود | تسريب قبل الإطلاق |

### 1.3 أهمية العقود والترخيص

| الوثيقة | الغرض |
|---------|--------|
| **EULA** (End User License Agreement) | يحدّد ما يجوز للعميل فعله بالبرنامج |
| **SaaS Agreement** | مدة الاشتراك، SLA، حدود الاستخدام |
| **NDA** | منع تسريب الكود أو البيانات |
| **IP Assignment** | تأكيد ملكية المزوّد للكود |
| **Non-compete** (حيث يسمح القانون) | منع العميل من بناء منافس |

**قاعدة ذهبية:** *الحماية التقنية + العقد القانوني = حماية شاملة.* لا يكفي أحدهما وحده.

```
┌─────────────────────────────────────────────────────────────┐
│              طبقات حماية الملكية الفكرية                     │
├─────────────────────────────────────────────────────────────┤
│  Legal Layer     │ EULA · NDA · SaaS Agreement · IP Rights   │
│  Technical Layer │ Obfuscation · Server-side AI · JWT · RBAC │
│  Operational     │ Private Git · Access control · Audit logs │
│  Contractual     │ Domain lock · License keys · Multi-tenant │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. حماية الـ Frontend

### 2.1 Vite Production Build

| البند | التطبيق |
|-------|---------|
| **Build tool** | Vite (`npm run build`) |
| **Output** | `frontend/dist/` — static files |
| **Deploy** | Render Static Site أو CDN |
| **Source** | **لا يُرفع** `src/` للإنتاج — فقط `dist/` |

```bash
# ✅ إنتاج — build مُحسَّن
cd frontend && npm run build
# الناتج: dist/index.html + hashed JS/CSS bundles
```

### 2.2 Minification (تصغير الكود)

| الأداة | الوظيفة | الحالة |
|--------|---------|--------|
| **Vite (esbuild)** | Minify JS/CSS تلقائياً في production | ✅ مُفعَّل |
| **Tree shaking** | إزالة dead code | ✅ تلقائي |
| **Code splitting** | Lazy routes — chunks منفصلة | ✅ React lazy |

**النتيجة:** كود المصدر الأصلي (React JSX) **غير موجود** في الإنتاج — فقط bundles مُصغَّرة.

### 2.3 Obfuscation Recommendations (توصيات التشويش)

| المستوى | الأداة | الفائدة | التكلفة |
|---------|--------|---------|---------|
| **Basic** | Vite minify (حالي) | أسماء متغيرات قصيرة | مجاني |
| **Medium** | `javascript-obfuscator` | Control flow flattening | منخفض |
| **Advanced** | Webpack obfuscator + domain lock | أسماء مشفّرة + runtime checks | متوسط |

**توصية v2.0:**
```javascript
// vite.config.js — optional obfuscation plugin
import obfuscator from 'rollup-plugin-obfuscator';
// apply only in production build
```

**⚠️ واقعية:** Obfuscation **لا يجعل** الكود «غير قابل للفك» — يزيد صعوبة reverse engineering فقط. **الحماية الحقيقية = server-side logic.**

### 2.4 Disable Source Maps in Production

| البند | الإعداد | السبب |
|-------|---------|-------|
| `sourcemap` | **`false`** في production | Source maps تكشف الكود الأصلي |
| Vite default | `build.sourcemap: false` | ✅ تحقق من `vite.config.js` |

```javascript
// vite.config.js — ✅ صحيح
export default defineConfig({
  build: {
    sourcemap: false,  // NEVER true in production
  },
});
```

**فحص:** بعد `npm run build`، تأكد أن `dist/assets/*.js` **لا** يوجد لها ملفات `.map` مرافقة.

### 2.5 Protect Environment Variables

| المتغير | Frontend | Backend |
|---------|----------|---------|
| `VITE_API_URL` | ✅ public (API base URL فقط) | — |
| `GEMINI_API_KEY` | **❌ NEVER** | ✅ Backend env only |
| `SECRET_KEY` | **❌ NEVER** | ✅ Backend env only |
| `DATABASE_URL` | **❌ NEVER** | ✅ Backend env only |

**قاعدة Vite:** فقط متغيرات تبدأ بـ `VITE_` تظهر في Frontend bundle. **لا تضع أسراراً في `VITE_*`.**

```env
# frontend/.env.production — ✅ آمن
VITE_API_URL=https://api.ayn-aljawdah.com

# ❌ ممنوع في frontend
VITE_GEMINI_KEY=AIzaSy...
```

### 2.6 Prevent Exposing Internal APIs

| البند | التطبيق |
|-------|---------|
| **API base URL** | نقطة دخول واحدة — `VITE_API_URL` |
| **Internal routes** | `/docs`, `/redoc` — **معطّلة** في production |
| **Debug endpoints** | غير موجودة في production build |
| **Swagger UI** | `DEBUG=false` → FastAPI docs disabled |

```python
# backend/app/main.py
app = FastAPI(docs_url=None if not settings.DEBUG else "/docs")
```

**Frontend:** لا hardcode لمسارات API داخلية — كل الطلبات عبر `apiUrl()` helper.

---

## 3. حماية الـ Backend

### 3.1 Server-Side Logic Isolation

```
┌──────────────── Client ────────────────┐
│  React SPA (public, minified)          │
│  • UI rendering only                   │
│  • Sends: images, form data, JWT       │
│  • Receives: JSON responses            │
│  ❌ NO business logic                  │
│  ❌ NO AI inference                    │
└──────────────────┬─────────────────────┘
                   │ HTTPS + JWT
┌──────────────────▼─────────────────────┐
│  FastAPI Backend (private, protected)  │
│  ✅ All business logic                 │
│  ✅ YOLO inference                     │
│  ✅ RBAC enforcement                   │
│  ✅ Database access                    │
│  ✅ Model files on disk                │
└────────────────────────────────────────┘
```

**مبدأ:** *Thin client, thick server.* العميل «غبي» — السيرفر «ذكي».

### 3.2 Never Expose AI Logic to Client

| ما يبقى على السيرفر | ما يُرسل للعميل |
|--------------------|-------------------|
| YOLO model loading | JSON detections فقط |
| Region pipeline (face/hand/head crops) | `violations[]` array |
| Confidence thresholds | `confidence` integer (0–100) |
| violation_tracker logic | `priority`, `status` |
| Model file paths | **❌ NEVER** |
| Raw inference tensors | **❌ NEVER** |

### 3.3 Protect API Endpoints

| الحماية | التطبيق |
|---------|---------|
| **Authentication** | JWT Bearer on all `/api/v1/*` (except `/auth/login`) |
| **Authorization** | `require_roles()` decorator |
| **Rate limiting** | SlowAPI — login 10/min, monitoring 72/min |
| **Input validation** | Pydantic schemas |
| **Tenant isolation** | `tenant_id` filter on every query |

### 3.4 JWT Validation

```
Every Request:
  Authorization: Bearer <token>
    → decode JWT (HS256 + SECRET_KEY)
    → verify signature + expiry
    → extract user_id, role, tenant_id
    → RBAC check for endpoint
    → proceed OR 401/403
```

### 3.5 Role Permissions

| Endpoint pattern | Admin | Supervisor | Staff |
|-----------------|-------|------------|-------|
| `/api/v1/users/*` | ✅ | ❌ | ❌ |
| `/api/v1/monitoring/*` | ✅ | ✅ | ❌ |
| `/api/v1/ai/*` | ✅ | ✅ | ❌ |
| `/api/v1/dishes/*` | ✅ | ✅ | ✅ (own) |
| `/api/v1/admin/*` | ✅ | ❌ | ❌ |

### 3.6 Secure Deployment Architecture

```
Internet
   │
   ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   CDN /      │     │   Render     │     │  PostgreSQL  │
│  Cloudflare  │────►│   Backend    │────►│  (Private)   │
│  (Frontend)  │     │   (FastAPI)  │     │              │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────▼───────┐
                     │ YOLO Models  │
                     │ (disk only)  │
                     └──────────────┘
```

**لا يوجد مسار:** Client → Database، Client → Models، Client → RTSP.

---

## 4. حماية ملفات الذكاء الاصطناعي

### 4.1 منع تحميل ملفات YOLO

| البند | الحالة |
|-------|--------|
| HTTP endpoint لتحميل `.pt` | **❌ غير موجود** |
| Static file mount للـ models | **❌ غير موجود** |
| `/ml/models/*` route | **❌ غير موجود** |
| Git tracking للـ `.pt` | **❌ `.gitignore`** |

### 4.2 عدم كشف مسارات النماذج

| Endpoint | ما يُرجع | ما **لا** يُرجع |
|----------|---------|----------------|
| `GET /api/v1/ai/status` | `configured: true/false` | ❌ full filesystem path |
| `GET /api/v1/ai/health` | latency, FPS, model names | ❌ model file contents |

**في production logs:** model paths تُسجَّل على مستوى INFO — **لا** في API responses.

### 4.3 تشغيل Inference داخل السيرفر فقط

```
Client                    Backend
  │                         │
  │ POST /monitoring/       │
  │   analyze-frame         │
  │ (image bytes)           │
  │ ───────────────────────►│
  │                         │ _load_yolo() → CPU inference
  │                         │ violation_tracker.register()
  │ JSON: {violations,      │
  │        checks,          │
  │        summary}         │
  │ ◄───────────────────────│
  │                         │
  │ ❌ No model sent         │
  │ ❌ No weights sent       │
  │ ❌ No inference code     │
```

### 4.4 منع Direct Access لملفات `.pt`

| الطبقة | الحماية |
|--------|---------|
| **Git** | `*.pt`, `*.onnx` in `.gitignore` |
| **Docker** | Models in container filesystem — no volume mount to public |
| **Render** | No static file serving from model directory |
| **Nginx/Proxy** | No route to `/ml/` or `/models/` |
| **File permissions** | `chmod 600` on model files (container user only) |

**Deploy strategy:**
- Models baked into Docker image at build time (private registry), OR
- Downloaded at startup from private S3/GCS bucket (signed URL, short TTL).

---

## 5. حماية قاعدة البيانات

### 5.1 No Direct Database Exposure

| القاعدة | التفاصيل |
|---------|----------|
| **Frontend → DB** | **❌ NEVER** — all access via Backend API |
| **Public DB port** | **❌ NEVER** — Render PostgreSQL is private |
| **DB credentials in client** | **❌ NEVER** |
| **SQL from client** | **❌ NEVER** — ORM only |

### 5.2 Internal DB Networking

```
Backend (Render) ──private network──► PostgreSQL (Render)
                                         │
                                    No public IP
                                    SSL required
                                    App user only (not superuser)
```

### 5.3 Backup Encryption

| البند | التطبيق |
|-------|---------|
| Render auto-backup | Encrypted at rest (Render managed) |
| Manual `pg_dump` | Encrypt before upload: `gpg --encrypt backup.sql` |
| Storage | S3 with SSE (Server-Side Encryption) |
| Access | DevOps only — MFA on cloud account |

### 5.4 Restricted DB Credentials

| User | Permissions | Used by |
|------|-------------|---------|
| `app_user` | SELECT, INSERT, UPDATE, DELETE on app tables | Backend only |
| `readonly_user` | SELECT only | Reporting (future) |
| `postgres` (superuser) | **NOT used by app** | Emergency only |

---

## 6. حماية السيرفر والإنتاج

### 6.1 Docker Isolation

```dockerfile
# ✅ Production Dockerfile practices
FROM python:3.11-slim
RUN useradd -m -s /bin/bash appuser
USER appuser                    # Non-root
COPY --chown=appuser:appuser . .
# No .env in image
# No secrets in layers
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

| البند | الحماية |
|-------|---------|
| Non-root user | ✅ `appuser` |
| Read-only filesystem | ⚠️ Recommended (except `/tmp`, `/media`) |
| No shell access | ✅ Production container |
| Image scanning | ⚠️ Trivy in CI (future) |

### 6.2 Render Deployment Protection

| البند | التطبيق |
|-------|---------|
| **Private repo deploy** | GitHub private → Render auto-deploy |
| **Environment vars** | Encrypted in Render dashboard |
| **Branch protection** | Deploy from `main` only |
| **MFA on Render account** | ✅ Required |
| **No SSH to production** | Render managed — no shell access |

### 6.3 HTTPS Enforcement

| البند | الحالة |
|-------|--------|
| TLS 1.2+ | ✅ Render automatic |
| HTTP → HTTPS redirect | ✅ Automatic |
| HSTS | ⚠️ Recommended (via Cloudflare) |
| Certificate | Auto-managed by Render |

### 6.4 Reverse Proxy Recommendations

```
Client → Cloudflare (WAF + CDN) → Render Backend
Client → Cloudflare (CDN) → Render Static (Frontend)
```

| Proxy | الفائدة |
|-------|---------|
| **Cloudflare** | DDoS, WAF, bot protection, SSL, caching |
| **Nginx** (if self-hosted) | Rate limit, SSL termination, header injection |

### 6.5 WAF Recommendations

| WAF Rule | يحمي من |
|----------|---------|
| OWASP Core Rules | SQLi, XSS, path traversal |
| Bot Fight Mode | Scraping, credential stuffing |
| Rate limiting (edge) | DDoS L7 |
| Geo-blocking (optional) | Traffic from unexpected countries |
| Custom: block `/docs`, `/redoc` | API documentation exposure |

**توصية:** Cloudflare Pro/Business قبل الإطلاق العام.

---

## 7. منع نسخ النظام

### 7.1 License Agreement (اتفاقية الترخيص)

| البند | النص المقترح |
|-------|-------------|
| **Grant** | «يُمنح العميل ترخيص استخدام غير حصري، غير قابل للتحويل، محدود المدة.» |
| **Restrictions** | «يُحظر: نسخ، تعديل، reverse engineer، redistribute، sublicense.» |
| **Ownership** | «جميع حقوق IP تبقى للمزوّد.» |
| **Termination** | «عند انتهاء الاشتراك: يُلغى الوصول فوراً.» |
| **Audit rights** | «يحق للمزوّد التحقق من الامتثال.» |

### 7.2 Domain Locking Recommendations

| الآلية | التطبيق |
|--------|---------|
| **CORS** | `CORS_ORIGINS` = production domain(s) only |
| **Frontend env** | `VITE_API_URL` hardcoded to production API |
| **License check (future)** | Backend validates `LICENSE_DOMAIN` env on startup |
| **Watermark** | Tenant name in UI footer (optional) |

```env
# Backend production
LICENSED_DOMAINS=app.ayn-aljawdah.com,client1.ayn-aljawdah.com
```

### 7.3 API Key Restrictions

| المفتاح | Scope | Rotation |
|---------|-------|----------|
| `GEMINI_API_KEY` | Backend only — dish detection | 90 days |
| `SECRET_KEY` | JWT signing | On compromise only |
| Per-tenant API key (future) | External integrations | Per client |

### 7.4 Branch / Account Separation (Multi-Tenant)

```
Tenant A (Restaurant Chain 1)
  ├── Branch Riyadh
  │     ├── Cameras 1-3
  │     └── Users (supervisor, staff)
  └── Branch Jeddah
        ├── Cameras 4-6
        └── Users

Tenant B (Restaurant Chain 2)  ← COMPLETELY ISOLATED
  └── ...
```

| العزل | التطبيق |
|-------|---------|
| `tenant_id` on every table | ✅ SQLAlchemy filter |
| Cross-tenant access | **❌ IMPOSSIBLE** via API |
| Shared infrastructure | ✅ Same Backend/DB — logical isolation |

### 7.5 Private Repositories Only

| Repo | Visibility | Access |
|------|-----------|--------|
| `SKA` / `Taeen-Quality-Platform` | **Private** | Dev team only |
| `.env`, secrets | **Never in repo** | Render env |
| Model weights | **Never in repo** | Docker image / private storage |

---

## 8. حماية ملفات التسليم

### 8.1 EXE Protection Notes

| السيناريو | التوصية |
|-----------|---------|
| **Desktop app (future)** | PyInstaller / Electron — code bundled, not source |
| **Code signing** | Sign EXE with EV certificate — prevents tampering warnings |
| **Anti-debug** | VMProtect / Themida (optional, for high-value desktop apps) |
| **Current platform** | **SaaS web-only** — no EXE delivery |

### 8.2 Binary Packaging Recommendations

| Component | Packaging | Protection |
|-----------|-----------|------------|
| Backend | Docker image | Private registry, signed |
| Frontend | Static build (`dist/`) | CDN, no source |
| ML models | Inside Docker image | Not separately delivered |
| Database | Managed PostgreSQL | Not delivered to client |

### 8.3 Electron Packaging Notes (If Future Desktop App)

| البند | التوصية |
|-------|---------|
| **Main process** | Keep sensitive logic here (not renderer) |
| **Context isolation** | `contextIsolation: true`, `nodeIntegration: false` |
| **ASAR encryption** | `electron-asar-encryption` (optional) |
| **Auto-update** | Signed updates from private server |
| **License check** | Online validation on startup |

### 8.4 Optional License Verification System

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │     │  License    │     │  Backend    │
│   App       │────►│  Server     │────►│  (validates │
│             │     │  (future)   │     │   license)  │
└─────────────┘     └─────────────┘     └─────────────┘
```

| Feature | Description |
|---------|-------------|
| **Online check** | Backend calls license server on startup + daily |
| **Offline grace** | 7-day cache if license server unreachable |
| **Revocation** | Instant disable via license server |
| **Hardware binding** | Optional: tie to server MAC / instance ID |

**الوضع الحالي:** SaaS model — license = active subscription + valid JWT. No separate license server needed yet.

---

## 9. GitHub Security

### 9.1 Private Repo Recommendations

| البند | التطبيق |
|-------|---------|
| Repository visibility | **Private** |
| Forking | Disabled |
| Clone access | Team members only (invite-based) |
| Deploy keys | Read-only, scoped to Render |

### 9.2 Secret Scanning

| الأداة | الغرض |
|--------|-------|
| **GitHub Secret Scanning** | Auto-detect committed secrets |
| **git-secrets / detect-secrets** | Pre-commit hook |
| **`.gitignore`** | `.env`, `*.pt`, `*.db`, `media/` |

```bash
# Recommended pre-commit
pip install detect-secrets
detect-secrets scan > .secrets.baseline
# Add to CI: fail if new secrets detected
```

### 9.3 Branch Protection

| Rule | `main` branch |
|------|---------------|
| Require PR review | ✅ 1+ approver |
| Require status checks | ✅ CI pass |
| No force push | ✅ |
| No deletion | ✅ |
| Signed commits | ⚠️ Recommended |

### 9.4 Access Control

| Role | Permissions |
|------|-------------|
| **Admin** | Full repo access |
| **Developer** | Write (via PR only) |
| **CI/CD (Render)** | Read-only deploy key |
| **Client** | **❌ NO repo access** — SaaS only |

---

## 10. تقييم الحماية الحالي

### 10.1 ما هو محمي بالفعل ✅

| المجال | الحماية المُطبَّقة |
|--------|-------------------|
| **Frontend** | Vite production build (minified), no source maps in prod, env vars scoped |
| **Backend** | Server-side only logic, JWT + RBAC, rate limiting, Pydantic validation |
| **AI Models** | Backend-only inference, `.pt` gitignored, no download endpoint |
| **Database** | Private PostgreSQL, ORM only, tenant isolation, no public access |
| **Secrets** | `.env` gitignored, Render encrypted env, no hardcoded keys |
| **API** | HTTPS, CORS restricted, auth on all routes, Swagger disabled in prod |
| **Multi-tenant** | `tenant_id` isolation — prevents cross-client data access |
| **Git** | Private repo, `.gitignore` for secrets/models/media |
| **Docker** | Non-root user, no secrets in image |
| **Legal** | SaaS model — client gets usage rights, not source code |

### 10.2 ما يحتاج تعزيز مؤسسي ⚠️

| المجال | الوضع | الأولوية |
|--------|-------|----------|
| **JS Obfuscation** | Minify only (no obfuscator) | متوسطة |
| **License server** | Subscription-based only | منخفضة (SaaS model) |
| **Domain locking** | CORS only — no runtime check | متوسطة |
| **Model encryption at rest** | Plaintext on disk | متوسطة |
| **WAF / Cloudflare** | Not deployed | **عالية** |
| **Secret scanning CI** | Not in pipeline | **عالية** |
| **Code signing** | N/A (web SaaS) | — |
| **Audit logging** | App logs only — no dedicated audit table | متوسطة |
| **Penetration test** | Not performed | **عالية** (pre-launch) |
| **Hardware-bound licensing** | N/A (SaaS) | — |

### 10.3 مستوى الجاهزية الواقعي

```
┌─────────────────────────────────────────────────────────────────┐
│           Source Code Protection Maturity                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Basic        ████████████████████░░░░░░░░░░░░░░  (good)        │
│  Commercial   ██████████████████████████░░░░░░░░  (current ★)   │
│  Enterprise   ████████████████████████████████░░  (target)      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

| المستوى | التقييم |
|---------|---------|
| **Basic** | ✅ متجاوز |
| **Commercial SaaS** | ✅ **الوضع الحالي** — مناسب للبيع التجاري |
| **Enterprise anti-piracy** | ⚠️ يحتاج WAF + obfuscation + pen test + audit logs |

**الخلاصة الصادقة:**

> المنصة **محمية على مستوى SaaS تجاري احترافي**: الكود الحساس على السيرفر، AI لا يُعرَّض للعميل، secrets خارج Git، multi-tenant isolation، JWT + RBAC.
>
> **لكن** لا يوجد نظام «غير قابل للاختراق 100%» — obfuscation أقوى، WAF، وpen test ستُرفع الحماية لمستوى Enterprise.

---

## 11. توصيات مستقبلية

| # | التوصية | الأولوية | الجدول | التكلفة |
|---|---------|----------|--------|---------|
| 1 | **Cloudflare** (CDN + WAF + DDoS) | 🔴 عالية | v2.0 | ~$20–200/شهر |
| 2 | **JS Obfuscation** (production build) | 🟡 متوسطة | v2.0 | مجاني |
| 3 | **Secret scanning CI** (detect-secrets) | 🔴 عالية | v2.0 | مجاني |
| 4 | **MFA** for admin accounts | 🔴 عالية | v2.0 | مجاني |
| 5 | **Audit logging table** (who did what when) | 🟡 متوسطة | v2.0 | تطوير |
| 6 | **Model encryption at rest** (Fernet) | 🟡 متوسطة | v2.0 | تطوير |
| 7 | **Domain/license runtime check** | 🟡 متوسطة | v2.1 | تطوير |
| 8 | **Penetration test** (third party) | 🔴 عالية | pre-launch | $3K–10K |
| 9 | **SIEM** (Elastic/Datadog) | 🟢 منخفضة | v3.0 | $100+/شهر |
| 10 | **Hardware-bound licensing** | 🟢 منخفضة | v3.0 (on-prem) | تطوير |
| 11 | **Bug bounty program** | 🟢 منخفضة | v3.0 | متغير |
| 12 | **ISO 27001 / SOC 2** | 🟢 منخفضة | v3.0 Enterprise | $50K+ |

---

## 12. خلاصة العميل

### للإدارة التنفيذية

منصة **عين الجودة** مبنية وفق **أفضل ممارسات حماية السورس كود** لمنصات SaaS التجارية:

| ✅ محمي | التفاصيل |
|---------|----------|
| **الكود الحساس** | على السيرفر فقط — لا يصل للعميل |
| **الذكاء الاصطناعي** | YOLO inference داخل Backend — لا تحميل نماذج |
| **البيانات** | PostgreSQL معزول — لا وصول مباشر |
| **الأسرار** | خارج Git — مشفّرة في Render |
| **الوصول** | JWT + RBAC — كل مستخدم يرى ما يخصه فقط |
| **Multi-tenant** | عزل كامل بين العملاء |
| **Frontend** | Build مُصغَّر — لا source maps — لا API keys |

### ما يجب أن يعرفه العميل

1. **المنصة محمية على مستوى تجاري احترافي** — مناسبة للبيع والتشغيل كـ SaaS.
2. **لا يوجد نظام «مستحيل الاختراق 100%»** — أي برنامج يمكن reverse-engineerه theoretically. الهدف هو **رفع التكلفة** على المهاجم حتى يصبح غير مجدٍ اقتصادياً.
3. **الحماية القانونية + التقنية معاً** — EULA + NDA + SaaS Agreement + server-side architecture = حماية شاملة.
4. **Enterprise hardening** (WAF, obfuscation, pen test) متاحة كترقية — موصى بها قبل التوسع لـ 10+ عملاء.
5. **العميل يحصل على «حق استخدام»** — لا يحصل على السورس كود أو نماذج AI.

### رسالة Confidence

> **عين الجودة** ليست «مشروعاً مفتوحاً» يمكن نسخه بسهولة. البنية المعمارية (SaaS, server-side AI, JWT, multi-tenant, private repo) تضمن أن **القيمة التقنية تبقى مع المزوّد** — والعميل يستفيد من الخدمة دون مخاطر IP.

---

## 13. مراجع

| المستند | الغرض |
|---------|--------|
| `SECURITY_HARDENING_AR.md` | تعزيز الأمن السيبراني الشامل |
| `SECURITY_GUIDE_AR.md` | دليل الأمان التفصيلي |
| `DEPLOYMENT_GUIDE_AR.md` | نشر Render + Docker |
| `TECHNICAL_REQUIREMENTS_AR.md` | متطلبات تقنية |
| `COST_BREAKDOWN_AR.md` | تكلفة Enterprise security |

---

*هذا المستند جاهز للإرسال للعميل والفريق القانوني. يُحدَّث مع كل إصدار.*

*نهاية دليل حماية السورس كود.*
