# المتطلبات التقنية — منصة عين الجودة

> دليل مرجعي شامل لمتطلبات النظام التقنية والبنية المعمارية لمنصة **عين الجودة** (Ayn Al-Jawdah Quality Platform).
>
> **الإصدار:** 1.0 · **الجمهور:** مهندسو DevOps / مطوّرو النظام · **اللغة:** العربية مع مصطلحات تقنية إنجليزية

---

## جدول المحتويات

1. [نظرة معمارية عامة](#1-نظرة-معمارية-عامة)
2. [متطلبات الأجهزة (Hardware)](#2-متطلبات-الأجهزة-hardware)
3. [متطلبات البرامج (Software)](#3-متطلبات-البرامج-software)
4. [متطلبات الشبكة والبنية التحتية](#4-متطلبات-الشبكة-والبنية-التحتية)
5. [حزمة Frontend](#5-حزمة-frontend)
6. [حزمة Backend](#6-حزمة-backend)
7. [قاعدة البيانات](#7-قاعدة-البيانات)
8. [مكتبات Python (requirements.txt)](#8-مكتبات-python-requirementstxt)
9. [مكتبات JavaScript (package.json)](#9-مكتبات-javascript-packagejson)
10. [نماذج الذكاء الاصطناعي](#10-نماذج-الذكاء-الاصطناعي)
11. [نماذج YOLO للمراقبة](#11-نماذج-yolo-للمراقبة)
12. [متغيّرات البيئة الكاملة](#12-متغيّرات-البيئة-الكاملة)
13. [نقاط API](#13-نقاط-api)
14. [نموذج البيانات (ERD)](#14-نموذج-البيانات-erd)
15. [تكامل الكاميرات](#15-تكامل-الكاميرات)
16. [الحدود والقيود](#16-الحدود-والقيود)

---

## 1. نظرة معمارية عامة

```
┌─────────────────────────────────────────────────────────────────┐
│                    العميل (المتصفّح / الجوال)                    │
│            React 18 + Vite 6 SPA · Tailwind CSS · RTL          │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS / JWT
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Backend API (FastAPI / Uvicorn)                │
│  /api/v1 · JWT · CORS · SlowAPI Rate Limit · Security Headers   │
├─────────────────────────────────────────────────────────────────┤
│  AI Services:                                                   │
│   • Gemini Vision (Dish + Monitoring)                           │
│   • YOLO PPE Detection (Ultralytics)                            │
│   • OpenAI Vision (Optional)                                    │
│   • Roboflow Fallback                                           │
│   • Custom ResNet18 (Optional)                                  │
├─────────────────────────────────────────────────────────────────┤
│  Storage:                                                       │
│   • PostgreSQL (Primary DB)                                     │
│   • Persistent Disk (media/dishes/)                             │
│   • Persistent Disk (ml/models/*.pt)                            │
└─────────────────────────────────────────────────────────────────┘
                           ▲
                           │ RTSP
                           │
                  ┌────────┴────────┐
                  │  كاميرات IP/RTSP │
                  └─────────────────┘
```

### المكوّنات الأساسية

| المكوّن | التقنية | الإصدار |
|---------|---------|---------|
| **Frontend** | React + Vite | 18 + 6 |
| **Backend** | FastAPI | 0.100+ |
| **ASGI Server** | Uvicorn | 0.20+ |
| **ORM** | SQLAlchemy | 2.x |
| **Validation** | Pydantic | v2 |
| **Auth** | python-jose (JWT) | HS256 |
| **AI Vision** | Google Gemini | gemini-2.0-flash |
| **YOLO** | Ultralytics | 8.x |
| **Rate Limiting** | SlowAPI | latest |

---

## 2. متطلبات الأجهزة (Hardware)

### إنتاج (موصى به على Render أو خادم ذاتي)

| المكوّن | الحدّ الأدنى | الموصى به | للأحمال العالية |
|---------|--------------|-----------|------------------|
| **CPU** | 1 vCPU | 2 vCPU | 4+ vCPU |
| **RAM** | 1 GB | 2 GB | 4+ GB |
| **التخزين** | 5 GB SSD | 10 GB SSD | 20+ GB SSD |
| **Persistent Disk** | 1 GB | 2 GB | 5+ GB |
| **GPU** | غير مطلوب | غير مطلوب (CPU YOLO) | NVIDIA T4/L4 (اختياري للسرعة) |

### تطوير محلي

| المكوّن | الحدّ الأدنى |
|---------|--------------|
| **CPU** | 2 cores |
| **RAM** | 4 GB |
| **التخزين** | 10 GB |
| **OS** | macOS / Linux / Windows 10+ |

> **ملاحظة:** YOLO يعمل بكفاءة على CPU بفضل ضبط `YOLO_MAX_EDGE=640` و `OMP_NUM_THREADS=1`. لا حاجة لـ GPU في النشر العادي.

---

## 3. متطلبات البرامج (Software)

### الخادم (Backend Host)

| البرنامج | الإصدار |
|----------|---------|
| **Python** | 3.11.x (معتمد) — متوافق 3.10-3.12 |
| **pip** | 23+ |
| **Node.js** | 20.x (للبناء فقط، ليس وقت التشغيل) |
| **Git** | 2.30+ |

### مكتبات نظام (Linux/Debian)

```bash
apt-get install -y \
  libgl1 \
  libglib2.0-0 \
  libgomp1 \
  libpq-dev \
  gcc
```

> هذه مدرجة في `backend/Dockerfile` تلقائيًا.

### العميل (Client / Browser)

| المتصفّح | الحدّ الأدنى |
|----------|--------------|
| **Chrome** | 100+ |
| **Safari** | 15+ |
| **Firefox** | 100+ |
| **Edge** | 100+ |

### حدود المتصفّح

- يجب دعم **WebRTC** (للوصول إلى الكاميرا).
- يجب دعم **localStorage** (لحفظ JWT).
- يجب دعم **Fetch API + AbortController**.
- يجب دعم **CSS Grid + Flexbox**.

---

## 4. متطلبات الشبكة والبنية التحتية

### النطاق المُستهلَك

| العملية | الحجم التقريبي |
|---------|----------------|
| تحميل الصفحة الرئيسية | ~200 KB (Gzipped) |
| فتح Dashboard | ~400 KB (Lazy chunks) |
| رفع صورة طبق | 50 KB - 500 KB (مضغوطة) |
| إطار مراقبة | 100 KB - 1 MB |
| تنزيل تقرير Excel | 50 KB - 5 MB |

### المنافذ المطلوبة

| المنفذ | الخدمة | الاتجاه |
|--------|---------|---------|
| `443` | HTTPS API + Frontend | داخلي |
| `80` | HTTP redirect إلى HTTPS | داخلي |
| `5432` | PostgreSQL (إن كانت ذاتية) | داخلي فقط |
| `554` | RTSP للكاميرات | محلي للشبكة |

### النطاقات الخارجية المطلوبة (Outbound)

| النطاق | الغرض |
|---------|-------|
| `generativelanguage.googleapis.com` | Gemini Vision API |
| `api.openai.com` | OpenAI (اختياري) |
| `serverless.roboflow.com` | Roboflow (اختياري) |
| `huggingface.co` | تحميل أوزان YOLO تلقائيًا |
| `registry.npmjs.org` | npm packages (وقت البناء) |
| `pypi.org` | Python packages (وقت البناء) |

---

## 5. حزمة Frontend

### بنية المجلدات

```
frontend/
├── public/
│   ├── _redirects              # SPA fallback for static hosts
│   ├── favicon.svg
│   └── ...
├── src/
│   ├── pages/                  # 9 صفحات رئيسية
│   ├── components/             # مكوّنات UI مقسّمة بالموضوع
│   │   ├── ai/
│   │   ├── auth/
│   │   ├── camera/
│   │   ├── dish/
│   │   ├── monitoring/
│   │   ├── navigation/
│   │   ├── reports/
│   │   ├── shared/
│   │   ├── staff/
│   │   └── supervisor/
│   ├── hooks/                  # useDetectDish, useDishRecords, …
│   ├── services/               # API client layer
│   ├── utils/                  # helpers (errors, dates, exports)
│   ├── stores/                 # zustand stores (Toast)
│   ├── lib/                    # local storage (camera config)
│   ├── constants/              # routes, branding, theme
│   ├── config/                 # apiBase
│   ├── App.jsx                 # router
│   ├── main.jsx                # entry
│   └── index.css               # Tailwind + custom
├── index.html
├── package.json
├── vite.config.js              # manualChunks for code splitting
├── tailwind.config.js
└── Dockerfile                  # multi-stage build
```

### إعدادات Vite الإنتاجية

```js
build: {
  chunkSizeWarningLimit: 800,
  rollupOptions: {
    output: {
      manualChunks: {
        react: [/\/react\//],
        router: [/\/react-router/],
        charts: [/\/recharts\//],
        xlsx: [/\/xlsx\//],
        vendor: [/node_modules/],
      },
    },
  },
}
```

### تحسينات الأداء المفعّلة

- **Lazy loading** للصفحات الثقيلة (`Dashboard`, `AdminUsers`, …).
- **manualChunks** لفصل `react`, `router`, `charts`, `xlsx`, `vendor`.
- **`_redirects`** + `rewrite` rules لـ SPA fallback.
- **Mobile media queries** لتعطيل الرسوم المتحركة الثقيلة (<640px).
- **`AbortController`** لإلغاء طلبات API المعلّقة.

### حجم الحزمة (آخر بناء)

| الـ Chunk | الحجم | Gzipped |
|-----------|-------|---------|
| `react` | 194 KB | 60 KB |
| `charts` (Recharts) | 334 KB | 84 KB |
| `xlsx` | 283 KB | 95 KB |
| `Dashboard` | 288 KB | 71 KB |
| `router` | 89 KB | 30 KB |
| `vendor` | 102 KB | 35 KB |
| `index` | 70 KB | 17 KB |

---

## 6. حزمة Backend

### بنية المجلدات

```
backend/
├── app/
│   ├── api/
│   │   ├── deps/               # JWT, RBAC dependencies
│   │   ├── routes/             # 22 router file
│   │   └── router.py           # main API aggregator
│   ├── core/
│   │   ├── config.py           # Settings (env vars)
│   │   ├── limiter.py          # SlowAPI
│   │   └── timezone.py         # Asia/Riyadh helpers
│   ├── db/
│   │   ├── base.py             # Declarative base
│   │   └── session.py          # Engine, init_db, migrations
│   ├── models/                 # SQLAlchemy ORM (8 models)
│   ├── schemas/                # Pydantic v2 schemas
│   ├── services/               # 18 service file
│   ├── middleware/
│   │   └── security_headers.py
│   ├── security/
│   │   └── stream_url.py       # RTSP redact + validate
│   └── main.py                 # FastAPI app + lifespan
├── ml/
│   ├── models/                 # YOLO weights (gitignored)
│   ├── custom_food/            # ResNet18 training
│   └── download_ppe_model.py
├── media/
│   └── dishes/                 # permanent dish photos
├── scripts/
│   ├── create_admin.py
│   ├── start_render.sh
│   ├── start.sh
│   └── ppe_accuracy_test.py
├── requirements.txt
├── Dockerfile
└── .env.example
```

### Routers مسجَّلة (22)

```
auth · users_me · me · profile · meal_types · admin_requests
dishes · dish_media · detect_dish · monitoring · cameras · reports
supervisor_dashboard · supervisor_reviews · supervisor_cameras
users · admin_settings · mask_detection · people_count
ai_violations · ai_status
```

### إعدادات Production (Render)

```bash
# scripts/start_render.sh
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-10000}" \
  --workers 1 \
  --log-level info \
  --timeout-keep-alive 5 \
  --backlog 64 \
  --limit-concurrency 20
```

> **ملاحظة:** worker واحد للـ Free tier (تجنّب OOM). للـ paid plans، ارفع إلى 2-4 workers مع Redis للـ rate limiting المشترك.

---

## 7. قاعدة البيانات

### المحرّكات المدعومة

| المحرّك | الاستخدام |
|---------|-----------|
| **SQLite** | تطوير محلي فقط — `test.db` |
| **PostgreSQL 14+** | إنتاج (موصى به) |

### الجداول الـ7

| الجدول | الغرض | المفاتيح |
|--------|-------|----------|
| `tenants` | المنشآت | `id` (PK) |
| `users` | المستخدمون | `id`, `email` (unique), `username` (unique) |
| `dish_records` | سجلات الأطباق | `id`, `tenant_id`, `branch_id`, `user_id` |
| `cameras` | الكاميرات | `id`, `tenant_id` |
| `monitoring_alerts` | تنبيهات المراقبة | `id`, `tenant_id`, `branch_id`, `camera_id` |
| `meal_types` | أنواع الوجبات | `id` |
| `admin_requests` | طلبات الترقية | `id`, `user_id` |

### الفهارس (Indexes)

- `users.email`, `users.username` — unique
- `dish_records.user_id`, `tenant_id`, `branch_id`, `status`, `employee_id`
- `monitoring_alerts.tenant_id`, `branch_id`, `camera_id`, `violation_type`, `status`
- `cameras.tenant_id`

### Migrations

- **التشغيل الأول:** `init_db()` ينشئ الجداول تلقائيًا (`Base.metadata.create_all`).
- **ALTER TABLE خاص بـ SQLite:** يُنفَّذ تلقائيًا في `_ensure_*` functions داخل `db/session.py`.
- **PostgreSQL:** يُوصى بـ Alembic للمستقبل (غير مفعّل حاليًا).

### تقدير الحجم

| الفترة | عدد السجلات (مطعم متوسط) | حجم DB |
|--------|--------------------------|---------|
| شهر | ~5,000 | 50-100 MB |
| سنة | ~60,000 | 500 MB - 1 GB |
| سنتان | ~120,000 | 1-2 GB |

---

## 8. مكتبات Python (requirements.txt)

### الأساسية

```
fastapi
uvicorn[standard]
sqlalchemy
pydantic
pydantic-settings
python-jose[cryptography]
passlib[bcrypt]
python-multipart
slowapi
python-dotenv
psycopg2-binary       # PostgreSQL driver
```

### الذكاء الاصطناعي

```
ultralytics           # YOLO
torch                 # PyTorch (CPU)
torchvision
google-generativeai   # Gemini
openai                # Optional
transformers          # HuggingFace (Food-101)
Pillow                # Image processing
opencv-python-headless
numpy
```

### أدوات وتنسيق

```
ruff                  # Linting
httpx                 # HTTP client
requests
```

> القائمة الكاملة في `backend/requirements.txt`.

---

## 9. مكتبات JavaScript (package.json)

### Frontend Runtime

```json
{
  "dependencies": {
    "react": "^18",
    "react-dom": "^18",
    "react-router-dom": "^6",
    "zustand": "^4",
    "recharts": "^2",
    "xlsx": "^0.18",
    "tailwindcss": "^3"
  },
  "devDependencies": {
    "vite": "^6",
    "@vitejs/plugin-react": "^4",
    "eslint": "^8",
    "eslint-plugin-react-hooks": "^4",
    "eslint-plugin-unused-imports": "^3"
  }
}
```

> القائمة الكاملة في `frontend/package.json`.

---

## 10. نماذج الذكاء الاصطناعي

### خط أنابيب تصنيف الأطباق

```
الصورة المرفوعة
   │
   ▼
1. OpenAI Vision (إن وُجد OPENAI_API_KEY)
   │ فشل / غير مفعّل
   ▼
2. Gemini Vision (DISH_GEMINI_API_KEY) ← الأساسي
   │ فشل / غير مفعّل
   ▼
3. SKA Custom ResNet18 (إن وُجد SKA_CUSTOM_FOOD_MODEL_PATH)
   │ فشل / غير مفعّل
   ▼
4. Food-101 (HuggingFace nateraw/vit-base-food101)
   │ فشل
   ▼
5. Roboflow (ROBOFLOW_API_KEY) ← Fallback أخير
```

**الملف المرجعي:** `backend/app/services/professional_dish_vision.py`

### مفاتيح Gemini

| المتغيّر | الأولوية | الاستخدام |
|----------|----------|-----------|
| `GEMINI_API_KEY` | منخفضة (Legacy fallback) | للأطباق + المراقبة |
| `DISH_GEMINI_API_KEY` | عالية | الأطباق فقط |
| `MONITORING_GEMINI_API_KEY` | عالية | المراقبة فقط |

### النماذج الافتراضية

```env
GEMINI_VISION_MODEL=gemini-2.0-flash
DISH_GEMINI_MODEL=gemini-2.0-flash
MONITORING_GEMINI_MODEL=gemini-2.0-flash
OPENAI_VISION_MODEL=gpt-4o-mini
FOOD101_HF_MODEL_ID=nateraw/vit-base-food101
```

---

## 11. نماذج YOLO للمراقبة

### الأوزان المتوقَّعة

| الملف | الحجم | الغرض | المصدر |
|-------|-------|-------|--------|
| `hansung_ppe.pt` | ~6 MB | **النموذج الأساسي على Render** | HuggingFace (تحميل تلقائي) |
| `keremberk_ppe.pt` | ~52 MB | PPE أدق (تطوير محلي) | يُحمَّل يدويًا |
| `yolov8n.pt` | ~6 MB | كاشف أشخاص COCO | Ultralytics auto-download |
| `mask_best.pt` | متغيّر | كشف كمامة إقليمي | تدريب محلي |
| `glove_best.pt` | متغيّر | كشف قفازات إقليمي | تدريب محلي |
| `hairnet_best.pt` | متغيّر | كشف غطاء رأس | تدريب محلي |

> جميع ملفات `.pt` **مستثناة من Git** (`.gitignore`).

### ترتيب البحث عن الأوزان

```
1. YOLO_MODEL_PATH (env)
2. backend/ml/models/hansung_ppe.pt
3. backend/ml/models/keremberk_ppe.pt
4. أي *.pt آخر في ml/models/
5. تحميل تلقائي من HuggingFace (YOLO_AUTO_DOWNLOAD=true)
```

**الملف المرجعي:** `backend/app/services/yolo_model_resolver.py`

### رابط HuggingFace للتحميل التلقائي

```
https://huggingface.co/Hansung-Cho/yolov8-ppe-detection/resolve/main/best.pt
```

### التحميل اليدوي

```bash
cd backend
python ml/download_ppe_model.py              # كل النماذج
python ml/download_ppe_model.py --fallback-only  # hansung فقط
```

### إعدادات Runtime

| المتغيّر | الافتراضي | التأثير |
|----------|-----------|---------|
| `YOLO_ENABLED` | `true` | تفعيل/تعطيل YOLO كاملًا |
| `YOLO_MAX_EDGE` | `640` | أقصى حافة للصورة (يقلّل RAM) |
| `YOLO_CONF_THRESHOLD` | `0.35` | عتبة ثقة الكشف |
| `YOLO_USE_PERSON_DETECTOR` | `false` | YOLO ثانٍ لـ COCO persons (يضاعف RAM) |
| `YOLO_AUTO_DOWNLOAD` | `true` (prod) | تحميل أوزان عند الحاجة |

---

## 12. متغيّرات البيئة الكاملة

### عامّة

| المتغيّر | الإلزام | الافتراضي | الوصف |
|----------|---------|-----------|-------|
| `ENVIRONMENT` | ✅ (prod) | `development` | `production` لتفعيل الوضع الصارم |
| `PROJECT_NAME` | ❌ | `Quality Platform API` | اسم المشروع للسجلات |
| `PYTHON_VERSION` | ❌ | `3.11.9` | على Render فقط |
| `NODE_VERSION` | ❌ | `20` | للـ Frontend build |

### المصادقة

| المتغيّر | الإلزام | الوصف |
|----------|---------|-------|
| `SECRET_KEY` | ✅ (prod) | JWT signing key (≥32 حرف) |
| `ALGORITHM` | ❌ | HS256 (افتراضي) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | ❌ | 60 |
| `DEV_AUTH_BYPASS` | ❌ | `false` (يجب في prod) |
| `SEED_ADMIN_EMAIL` | ✅ (نشر أول) | بريد المدير الأول |
| `SEED_ADMIN_PASSWORD` | ✅ (نشر أول) | كلمة مرور المدير الأول |

### قاعدة البيانات

| المتغيّر | الإلزام | الوصف |
|----------|---------|-------|
| `DATABASE_URL` | ✅ (prod) | `postgresql://user:pass@host:5432/db` |

### CORS / Hosts

| المتغيّر | الإلزام | الوصف |
|----------|---------|-------|
| `CORS_ALLOW_ORIGINS` | ✅ (prod) | قائمة بفواصل بنطاقات الواجهة |
| `ALLOWED_HOSTS` | ❌ | TrustedHostMiddleware list |
| `ENABLE_HSTS` | ❌ | `true` فقط مع HTTPS كامل |
| `HSTS_MAX_AGE` | ❌ | `63072000` (سنتان) |

### الذكاء الاصطناعي

| المتغيّر | الإلزام | الوصف |
|----------|---------|-------|
| `GEMINI_API_KEY` | ✅ (لـ AI) | المفتاح المشترك (fallback) |
| `DISH_GEMINI_API_KEY` | ❌ | مفتاح مخصّص للأطباق |
| `MONITORING_GEMINI_API_KEY` | ❌ | مفتاح مخصّص للمراقبة |
| `GEMINI_VISION_MODEL` | ❌ | `gemini-2.0-flash` |
| `DISH_GEMINI_MODEL` | ❌ | تجاوز للأطباق |
| `MONITORING_GEMINI_MODEL` | ❌ | تجاوز للمراقبة |
| `OPENAI_API_KEY` | ❌ | OpenAI Vision (أولوية أعلى) |
| `OPENAI_VISION_MODEL` | ❌ | `gpt-4o-mini` |
| `ROBOFLOW_API_KEY` | ❌ | Roboflow fallback |
| `ROBOFLOW_MODEL_ID` | ❌ | `food-types-po0yz/2` |
| `MONITORING_AI_DEMO_MODE` | ❌ | `true` للوضع التجريبي |
| `PRODUCTION_AI_MODE` | ❌ | تشديد التحقّق |

### YOLO

| المتغيّر | الإلزام | الوصف |
|----------|---------|-------|
| `YOLO_ENABLED` | ❌ | تفعيل/تعطيل |
| `YOLO_MODEL_PATH` | ❌ | مسار مخصّص للأوزان |
| `YOLO_MAX_EDGE` | ❌ | 640 (320-1280) |
| `YOLO_CONF_THRESHOLD` | ❌ | 0.35 |
| `YOLO_USE_PERSON_DETECTOR` | ❌ | كاشف ثانٍ |
| `YOLO_AUTO_DOWNLOAD` | ❌ | `true` على Render |
| `PERSON_MODEL_PATH` | ❌ | مسار yolov8n |
| `YOLO_WASTE_MODEL_PATH` | ❌ | أوزان النفايات |

### تخزين الصور

| المتغيّر | الإلزام | الوصف |
|----------|---------|-------|
| `DISH_MEDIA_DIR` | ❌ | مجلد الصور الدائم |

### حدود الرفع

| المتغيّر | الإلزام | الوصف |
|----------|---------|-------|
| `MONITORING_UPLOAD_MAX_BYTES` | ❌ | `8388608` (8 MiB) |

### Frontend

| المتغيّر | الإلزام | الوصف |
|----------|---------|-------|
| `VITE_API_BASE_URL` | ✅ (build) | عنوان API يُضمَّن وقت البناء |

> القائمة الكاملة مع التعليقات في **`backend/.env.example`**.

---

## 13. نقاط API

### البادئة الموحّدة: `/api/v1`

| الفئة | المسار | الطريقة | الدور المطلوب |
|-------|--------|---------|----------------|
| **Health** | `/health` | GET | عام |
| **Auth** | `/auth/login` | POST | عام |
| | `/auth/register` | POST | عام |
| **Profile** | `/me` | GET | أي مستخدم |
| | `/users/me` | GET/PATCH | أي مستخدم |
| | `/users/me/password` | PATCH | أي مستخدم |
| **Dishes** | `/dishes` | GET/POST | أي مستخدم (مفلتر) |
| | `/dishes/{id}` | GET/PATCH/DELETE | حسب الملكية |
| | `/dishes/files/{name}` | GET | أي مستخدم |
| | `/detect-dish` | POST | أي مستخدم |
| **Media** | `/media/dishes/{filename}` | GET | أي مستخدم |
| **Monitoring** | `/monitoring/analyze-frame` | POST | supervisor / admin |
| **Cameras** | `/cameras` | GET/POST | admin |
| | `/supervisor/cameras` | GET/POST/PATCH/DELETE | supervisor / admin |
| **Alerts** | `/supervisor/alerts` | GET | supervisor / admin |
| | `/supervisor/alerts/{id}/status` | PATCH | supervisor / admin |
| **Reports** | `/reports/quality-summary` | GET | supervisor / admin |
| **Supervisor** | `/supervisor/summary` | GET | supervisor / admin |
| | `/supervisor/employees` | GET | supervisor / admin |
| **Admin** | `/users` | GET/POST/PATCH/DELETE | admin |
| | `/admin-requests` | GET/POST/PATCH | admin (للمراجعة) |
| | `/admin-settings` | GET/PATCH | admin |
| **AI** | `/ai/status` | GET | admin / supervisor |
| | `/violations/detect` | POST | admin / supervisor |
| | `/mask-check` | POST | admin / supervisor |
| | `/people-count-check` | POST | admin / supervisor |

### Rate Limits (SlowAPI)

| المسار | الحد |
|--------|------|
| `POST /auth/login` | 25/min |
| `POST /auth/register` | 40/hour |
| `POST /detect-dish`, `POST /dishes/detect` | 48/min |
| `POST /monitoring/analyze-frame` | 72/min |
| `GET /reports/quality-summary` | 120/min |

---

## 14. نموذج البيانات (ERD)

```
                ┌─────────────┐
                │   tenants   │
                └──────┬──────┘
                       │ 1:N
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   ┌────────┐    ┌──────────┐   ┌──────────┐
   │ users  │    │ cameras  │   │dish_records│
   └───┬────┘    └────┬─────┘   └────┬─────┘
       │              │              │
       │ 1:N          │ 1:N          │ N:1
       ▼              ▼              │
   ┌─────────────────────┐           │
   │  monitoring_alerts  │           │
   │  (resolved_by_id)   │◄──────────┘
   └─────────────────────┘
       
       ┌────────────────┐
       │ admin_requests │
       │  (user_id)     │
       └────────────────┘
       
       ┌────────────────┐
       │  meal_types    │
       └────────────────┘
```

### حقول مهمة

**`users`:**
```python
id, email (unique), username (unique), password (bcrypt),
is_admin, role (admin/supervisor/staff),
tenant_id, branch_id, branch_name,
supervisor_id, supervisor_name,
full_name, avatar_url, organization_name
```

**`dish_records`:**
```python
id, image_url, predicted_label, confirmed_label,
quantity, source_entity, recorded_at,
needs_review, status (approved/pending_review/rejected),
reviewed_by_id, reviewed_by_name, reviewed_at,
ai_suggestions (JSON text), ai_confidence,
employee_id, employee_name, employee_email,
branch_id, branch_name,
user_id, tenant_id
```

**`monitoring_alerts`:**
```python
id, tenant_id, branch_id, branch_name,
camera_id, camera_name, location,
violation_type, label_ar, confidence (0-100),
reason_ar, image_data_url,
status (open/resolved),
created_at, resolved_at,
resolved_by_id, resolved_by_name
```

---

## 15. تكامل الكاميرات

### الصيغة المدعومة

```
rtsp://username:password@ip-address:port/stream-path
```

### أمثلة موصى بها

```
rtsp://admin:Pass123@192.168.1.100:554/stream1
rtsp://viewer:secret@cam.restaurant.com:554/h264_stream
```

### حماية بيانات الاعتماد

- **في DB:** يُحفظ الرابط الكامل (يُوصى بتشفير في الإنتاج).
- **في API responses:** يُموَّه إلى `rtsp://***:***@host:port/path`.
- **في الواجهة:** قناع IP إضافي عبر `maskIpv4Display`.

### التحقّق على الكتابة

`backend/app/security/stream_url.py`:

- يرفض أحرف التحكّم (`\n`, `\r`, …)
- يرفض المسارات الخلفية (`..`)
- يفرض حدًّا على طول URL
- يتحقّق من شكل RTSP الأساسي

### تحليل الإطار

```http
POST /api/v1/monitoring/analyze-frame
Content-Type: multipart/form-data
Authorization: Bearer <jwt>

image: <binary, max 8 MiB>
analysis_mode: live | manual
```

---

## 16. الحدود والقيود

### حدود تقنية حالية

| المورد | الحد |
|--------|------|
| حجم صورة طبق | 12 MB |
| حجم إطار مراقبة | 8 MB |
| طول `stream_url` | 500 حرف |
| طول `password` | 8-128 حرف |
| `JWT lifetime` | 60 دقيقة (افتراضي) |
| `Workers` | 1 (Render Free) — قابل للتوسعة |
| `Concurrency` | 20 طلب متزامن |

### قيود محتملة

| القيد | الحل المقترح |
|-------|---------------|
| Render Free Tier ينام بعد 15 دقيقة خمول | الترقية للخطة المدفوعة أو استخدام wake-up cron |
| Rate limiting في الذاكرة (لا يصمد عبر workers) | Redis + SlowAPI storage_uri |
| JWT في `localStorage` (عرضة لـ XSS) | الانتقال لـ HttpOnly cookies + refresh tokens |
| لا توجد ميزة استرجاع كلمة مرور ذاتية | إضافة email-based password reset |
| لا يوجد Alembic للـ migrations | إضافته للمشاريع الكبيرة |
| رفع كاميرات HLS غير مدعوم حاليًا | امتداد مستقبلي |

### نطاقات للتوسّع المستقبلي

- إشعارات Push / Email للتنبيهات الحرجة.
- جدولة تقارير شهرية تلقائية.
- WebSocket للتحديثات الحيّة.
- تطبيق جوال أصلي (iOS/Android).
- تكامل مع أنظمة POS للمطاعم.

---

## مراجع

| الملف | المحتوى |
|-------|---------|
| `backend/.env.example` | قائمة كاملة بمتغيّرات البيئة |
| `backend/requirements.txt` | كل مكتبات Python |
| `frontend/package.json` | كل مكتبات JavaScript |
| `render.yaml` | إعدادات نشر Render |
| `backend/Dockerfile` | بناء حاوية Backend |
| `frontend/Dockerfile` | بناء حاوية Frontend |
| `backend/ml/models/README.md` | تفاصيل أوزان YOLO |
| [`DEPLOYMENT_GUIDE_AR.md`](DEPLOYMENT_GUIDE_AR.md) | دليل النشر |
| [`SECURITY_GUIDE_AR.md`](SECURITY_GUIDE_AR.md) | دليل الأمان |

---

*منصة عين الجودة — Ayn Al-Jawdah Quality Platform · مرجع تقني للنظام · آخر تحديث: 2026-05-24*
