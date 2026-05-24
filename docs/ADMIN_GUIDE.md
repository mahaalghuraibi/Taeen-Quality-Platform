# دليل مدير النظام — منصة عين الجودة

> دليل تقني لمسؤولي النظام (System Administrator) لإدارة، نشر، وصيانة منصة عين الجودة (Ayn Al-Jawdah Quality Platform).
>
> **الإصدار:** 1.0 · **الجمهور:** مهندسو DevOps / مسؤولو المنصة · **اللغة:** العربية

---

## جدول المحتويات

1. [نظرة تقنية عامة](#1-نظرة-تقنية-عامة)
2. [هيكل المشروع](#2-هيكل-المشروع)
3. [الواجهة الأمامية (Frontend)](#3-الواجهة-الأمامية-frontend)
4. [الخادم الخلفي (Backend)](#4-الخادم-الخلفي-backend)
5. [قاعدة البيانات](#5-قاعدة-البيانات)
6. [المصادقة والصلاحيات](#6-المصادقة-والصلاحيات)
7. [متغيرات البيئة](#7-متغيرات-البيئة)
8. [إعداد الكاميرات](#8-إعداد-الكاميرات)
9. [ملفات نماذج الذكاء الاصطناعي](#9-ملفات-نماذج-الذكاء-الاصطناعي)
10. [نماذج YOLO للمراقبة](#10-نماذج-yolo-للمراقبة)
11. [خطوات النشر (Deployment)](#11-خطوات-النشر-deployment)
12. [النسخ الاحتياطي والاستعادة](#12-النسخ-الاحتياطي-والاستعادة)
13. [الأمان](#13-الأمان)
14. [استكشاف الأخطاء وإصلاحها](#14-استكشاف-الأخطاء-وإصلاحها)
15. [قائمة الصيانة الدورية](#15-قائمة-الصيانة-الدورية)
16. [مراجع إضافية](#16-مراجع-إضافية)

---

## 1. نظرة تقنية عامة

| الطبقة | التقنية | الوصف |
|--------|---------|-------|
| **Frontend** | React 18 + Vite 6 | SPA عربية RTL، توجيه عبر React Router |
| **Backend** | FastAPI + Uvicorn | REST API تحت `/api/v1` |
| **قاعدة البيانات** | SQLAlchemy 2 | SQLite (تطوير) · PostgreSQL (إنتاج) |
| **المصادقة** | JWT (HS256) | رمز وصول في `localStorage` |
| **ذكاء الأطباق** | Gemini Vision | `professional_dish_vision.py` |
| **ذكاء المراقبة** | YOLO + Gemini | `yolo_monitoring_service.py` + `monitoring_ai_service.py` |
| **النشر** | Render Blueprint | `render.yaml` — خدمتان (API + Static SPA) |

### عناوين الإنتاج الافتراضية (Render)

| الخدمة | الاسم في Render | الرابط |
|--------|-----------------|--------|
| API | `taeen-backend` | `https://taeen-quality-platform.onrender.com` |
| Frontend | `taeen-quality-frontend` | `https://taeen-quality-frontend.onrender.com` |

> يُفعَّل **Auto Deploy** تلقائيًا عند كل `git push` إلى فرع `main`.

---

## 2. هيكل المشروع

```text
ska-system/
├── frontend/                 # React + Vite SPA
│   ├── src/
│   │   ├── pages/            # Dashboard, Login, Register, Admin…
│   │   ├── components/       # UI مكوّنات (dish, monitoring, reports…)
│   │   ├── hooks/            # useDetectDish, useDishRecords…
│   │   ├── services/         # طبقة API للأطباق والمراقبة
│   │   ├── utils/            # مساعدات (تصدير، أخطاء، تواريخ)
│   │   └── config/           # apiBase.js
│   ├── public/               # _redirects (SPA fallback)
│   ├── Dockerfile            # multi-stage: build → serve
│   └── vite.config.js        # manualChunks + proxy
│
├── backend/
│   ├── app/
│   │   ├── api/routes/       # 20+ router
│   │   ├── models/           # SQLAlchemy ORM
│   │   ├── schemas/          # Pydantic v2
│   │   ├── services/         # منطق AI والأعمال
│   │   ├── core/             # config, limiter
│   │   ├── db/               # session, init_db
│   │   ├── middleware/       # security headers
│   │   └── security/         # stream_url redact/validate
│   ├── ml/
│   │   ├── models/           # أوزان YOLO (*.pt — gitignored)
│   │   └── custom_food/      # ResNet18 اختياري للأطباق
│   ├── media/dishes/         # صور الأطباق الدائمة
│   ├── scripts/              # create_admin, start_render, اختبارات PPE
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
│
├── docs/                     # الوثائق (هذا الملف + USER_GUIDE.md)
├── dataset/                  # بيانات تدريب PPE (محلية)
├── scripts/                  # سكربتات تدريب YOLO
├── render.yaml               # Blueprint Render
└── SECURITY_REPORT.md        # تقرير الأمان التفصيلي
```

---

## 3. الواجهة الأمامية (Frontend)

### التشغيل المحلي

```bash
cd frontend
npm install
cp .env.example .env    # إن وُجد
# VITE_API_BASE_URL=http://127.0.0.1:8000
npm run dev             # http://localhost:5173
```

### البناء للإنتاج

```bash
npm ci
npm run build           # مخرجات في dist/
```

### التوجيه (Routes)

| المسار | الوصف | الحماية |
|--------|-------|---------|
| `/` | الصفحة الرئيسية | عام |
| `/login`, `/signup` | دخول / تسجيل | عام |
| `/dashboard` | لوحة الموظف | `PrivateRoute` |
| `/analytics` | تحليلات المشرف | `PrivateRoute` |
| `/alerts` | التنبيهات | `PrivateRoute` |
| `/cameras` | الكاميرات | `PrivateRoute` |
| `/reports` | التقارير | `PrivateRoute` |
| `/dish-reviews` | مراجعة الأطباق | `PrivateRoute` |
| `/admin/users` | إدارة المستخدمين | `AdminRoute` |
| `/admin/requests` | طلبات الترقية | `AdminRoute` |
| `/mask-check` | اختبار كشف الكمامة | `PrivateRoute` |
| `/people-count-check` | اختبار عدّ الأشخاص | `PrivateRoute` |

### تحسينات الأداء (مفعّلة)

- **Code Splitting:** `React.lazy` + `Suspense` للصفحات الثقيلة.
- **manualChunks:** فصل `react`, `router`, `charts`, `xlsx`, `vendor`.
- **SPA Fallback:** `public/_redirects` + قواعد `rewrite` في `render.yaml`.
- **Mobile:** تعطيل الرسوم المتحركة الثقيلة تحت 640px في `index.css`.

### متغيرات الواجهة

| المتغير | الغرض |
|---------|-------|
| `VITE_API_BASE_URL` | عنوان API في الإنتاج (يُضمَّن وقت البناء) |

---

## 4. الخادم الخلفي (Backend)

### التشغيل المحلي

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# عدّل SECRET_KEY, GEMINI_API_KEY, DATABASE_URL
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### نقاط API الرئيسية

البادئة الموحّدة: **`/api/v1`**

| المجموعة | المسارات | الوصف |
|----------|----------|-------|
| **Auth** | `POST /auth/login`, `POST /auth/register` | JWT + تسجيل |
| **Dishes** | `GET/POST /dishes`, `GET /dishes/files/{name}` | سجلات الأطباق |
| **Media** | `GET /media/dishes/{filename}` | خدمة صور الأطباق |
| **Detection** | `POST /detect-dish` | تصنيف صورة طبق (AI) |
| **Monitoring** | `POST /monitoring/analyze-frame` | تحليل إطار PPE |
| **Cameras** | `GET/POST /cameras`, `/supervisor/cameras` | إدارة الكاميرات |
| **Alerts** | `GET /supervisor/alerts`, `PATCH …/status` | تنبيهات المراقبة |
| **Reports** | `GET /reports/quality-summary` | ملخّصات التقارير |
| **Supervisor** | `GET /supervisor/summary`, `/employees` | لوحة المشرف |
| **Admin** | `/users`, `/admin-settings`, `/admin-requests` | إدارة المنصة |
| **AI Status** | `GET /ai/status` | حالة نماذج AI |
| **Health** | `GET /health` | فحص صحة الخدمة |

### خدمات AI (لا تُحذف أو تُعطَّل دون مراجعة)

| الملف | الوظيفة |
|-------|---------|
| `professional_dish_vision.py` | خط أنابيب تصنيف الأطباق (Gemini → custom → Food-101 → Roboflow) |
| `vision_service.py` | Roboflow fallback للأطباق |
| `custom_food_classifier.py` | ResNet18 محلي (9 فئات) |
| `food101_mapping.py` | خريطة Food-101 → عربي |
| `yolo_monitoring_service.py` | كشف PPE + مخالفات الإطار |
| `monitoring_ai_service.py` | تنسيق Gemini للمراقبة |
| `scene_checks_service.py` | فحوصات المشهد (أرضية، نفايات) |
| `ppe_region_pipeline.py` | استنتاج مناطق الوجه/اليد |
| `mask_detection_service.py` | كشف الكمامة المستقل |
| `people_count_service.py` | عدّ الأشخاص |
| `yolo_model_resolver.py` | حل مسار أوزان YOLO + التحميل |
| `dish_image_storage.py` | تخزين دائم لصور الأطباق |
| `ai_violation_service.py` | كشف مخالفة مفردة |
| `violation_tracker.py` | تتبع المخالفات عبر الإطارات |

### أوامر التحقق

```bash
cd backend
pip check
python -m ruff check app
python -m compileall -q app
python -c "from app.main import app; print(len(app.routes), 'routes')"
```

---

## 5. قاعدة البيانات

### الجداول الرئيسية

| الجدول | النموذج | الوصف |
|--------|---------|-------|
| `tenants` | `Tenant` | المنشآت / العلامات التجارية |
| `users` | `User` | المستخدمون (admin / supervisor / staff) |
| `dish_records` | `DishRecord` | سجلات توثيق الأطباق |
| `cameras` | `Camera` | كاميرات المراقبة |
| `monitoring_alerts` | `MonitoringAlert` | تنبيهات المخالفات |
| `meal_types` | `MealType` | أنواع الوجبات |
| `admin_requests` | `AdminRequest` | طلبات ترقية الحساب |

### حقول مهمة — `dish_records`

| العمود | النوع | ملاحظة |
|--------|-------|--------|
| `image_url` | Text | مسار أو رابط الصورة |
| `predicted_label` | String | اقتراح AI |
| `confirmed_label` | String | الاسم المؤكَّد |
| `quantity` | Integer | الكمية |
| `source_entity` | String | المصدر/الوجهة |
| `status` | String | `approved` / `pending_review` / `rejected` |
| `ai_confidence` | Float | ثقة AI |
| `tenant_id` | FK | عزل المستأجر |

### حقول مهمة — `monitoring_alerts`

| العمود | النوع | ملاحظة |
|--------|-------|--------|
| `violation_type` | String | مفتاح المخالفة (`no_mask`, …) |
| `label_ar` | String | التسمية العربية |
| `confidence` | Integer | 0–100 |
| `status` | String | `open` / `resolved` |
| `image_data_url` | Text | لقطة الإطار (قد تكون base64) |

### التهيئة

```bash
# يُنشئ الجداول تلقائيًا عند أول تشغيل:
python -c "from app.db.session import init_db; init_db()"
```

> **إنتاج:** استخدم PostgreSQL عبر `DATABASE_URL`. SQLite غير مناسب للتزامن العالي.

```env
DATABASE_URL=postgresql://user:password@host:5432/ska_db
```

---

## 6. المصادقة والصلاحيات

### JWT

- **التوقيع:** `SECRET_KEY` + خوارزمية `HS256`
- **المدة الافتراضية:** 60 دقيقة (`ACCESS_TOKEN_EXPIRE_MINUTES`)
- **التخزين:** `localStorage` في الواجهة (`ACCESS_TOKEN_KEY`, `USER_ROLE_KEY`)

### مصفوفة الصلاحيات (API)

| المسار | admin | supervisor | staff |
|--------|:-----:|:----------:|:-----:|
| `POST /detect-dish` | ✅ | ✅ | ✅ |
| `POST /dishes` | ✅ | ✅ | ✅ |
| `GET /dishes` (الكل) | ✅ (tenant) | ✅ (branch) | ✅ (own) |
| `POST /monitoring/analyze-frame` | ✅ | ✅ | ❌ |
| `GET /supervisor/*` | ✅ | ✅ | ❌ |
| `GET/POST /users` | ✅ | ❌ | ❌ |
| `GET /reports/*` | ✅ | ✅ | ❌ |

### إنشاء / تحديث المدير

```bash
cd backend
# من متغيرات البيئة:
python scripts/create_admin.py

# أو بمعاملات صريحة:
python scripts/create_admin.py admin@company.com StrongP@ssw0rd
```

على Render يُنفَّذ تلقائيًا كـ **`preDeployCommand`** في `render.yaml`.

---

## 7. متغيرات البيئة

> المرجع الكامل: `backend/.env.example`

### إلزامية للإنتاج

| المتغير | الوصف | مثال |
|---------|-------|------|
| `ENVIRONMENT` | `production` | `production` |
| `SECRET_KEY` | مفتاح JWT (≥32 حرفًا عشوائيًا) | `openssl rand -hex 32` |
| `DATABASE_URL` | PostgreSQL | `postgresql://…` |
| `CORS_ALLOW_ORIGINS` | أصول الواجهة المسموحة | `https://taeen-quality-frontend.onrender.com` |
| `GEMINI_API_KEY` | مفتاح Gemini Vision | من Google AI Studio |
| `SEED_ADMIN_EMAIL` | بريد المدير الأول | `admin@company.com` |
| `SEED_ADMIN_PASSWORD` | كلمة مرور المدير | كلمة قوية |

### ذكاء الأطباق

| المتغير | الوصف |
|---------|-------|
| `GEMINI_API_KEY` | المفتاح المشترك (fallback) |
| `DISH_GEMINI_API_KEY` | مفتاح مخصّص للأطباق (اختياري) |
| `DISH_GEMINI_MODEL` | نموذج Gemini للأطباق (افتراضي: `gemini-2.0-flash`) |
| `OPENAI_API_KEY` | OpenAI Vision (اختياري — أولوية أعلى إن وُجد) |
| `SKA_CUSTOM_FOOD_MODEL_PATH` | مسار ResNet18 المخصّص |
| `ROBOFLOW_API_KEY` | Roboflow fallback |
| `DISH_MEDIA_DIR` | مجلد صور الأطباق الدائم |

### ذكاء المراقبة (YOLO + Gemini)

| المتغير | الوصف | افتراضي |
|---------|-------|---------|
| `YOLO_ENABLED` | تفعيل YOLO | `true` |
| `YOLO_MODEL_PATH` | مسار مخصّص لأوزان PPE | تلقائي |
| `YOLO_MAX_EDGE` | أقصى حافة للصورة | `640` |
| `YOLO_AUTO_DOWNLOAD` | تحميل `hansung_ppe.pt` عند الحاجة | `true` |
| `YOLO_USE_PERSON_DETECTOR` | كاشف أشخاص COCO إضافي | `false` |
| `PERSON_MODEL_PATH` | مسار yolov8n | تلقائي |
| `YOLO_WASTE_MODEL_PATH` | أوزان النفايات (اختياري) | — |
| `MONITORING_GEMINI_API_KEY` | مفتاح Gemini للمراقبة | fallback |
| `MONITORING_GEMINI_MODEL` | نموذج Gemini للمراقبة | `gemini-2.0-flash` |
| `MONITORING_AI_DEMO_MODE` | وضع تجريبي بدون API | `false` |
| `MONITORING_UPLOAD_MAX_BYTES` | حد حجم الإطار | `8388608` (8 MiB) |
| `PRODUCTION_AI_MODE` | وضع AI صارم | `false` |

### أمان ونشر

| المتغير | الوصف |
|---------|-------|
| `ALLOWED_HOSTS` | قائمة Host headers المسموحة |
| `ENABLE_HSTS` | `true` فقط خلف HTTPS كامل |
| `DEV_AUTH_BYPASS` | **يجب أن يكون `false` في الإنتاج** |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | مدة الرمز |

---

## 8. إعداد الكاميرات

### تخزين الكاميرا (Backend)

```python
# app/models/camera.py
name, location, stream_url, is_active, tenant_id, ai_enabled, last_analysis_at
```

### API

| العملية | الطريقة | المسار |
|---------|---------|--------|
| إنشاء | `POST` | `/api/v1/supervisor/cameras` |
| قائمة | `GET` | `/api/v1/supervisor/cameras` |
| تحديث | `PATCH` | `/api/v1/supervisor/cameras/{id}` |
| حذف | `DELETE` | `/api/v1/supervisor/cameras/{id}` |

### صيغة RTSP

```
rtsp://username:password@192.168.1.100:554/stream1
```

- **التحقق عند الكتابة:** `app/security/stream_url.py` — يرفض أحرف التحكم، المسارات `..`، والعناوين غير الصالحة.
- **العرض في JSON:** تُموَّه بيانات الاعتماد → `rtsp://***:***@host:port/path`

### إعداد الواجهة (Client-side)

- تُخزَّن إعدادات الكاميرات المحلية في `localStorage` عبر `restaurantCameraStorage.js`.
- تُعرض عناوين IP مموّهة في الواجهة (`maskIpv4Display`).
- **توصية إنتاج:** الاعتماد على API الخلفي (`/supervisor/cameras`) بدل التخزين المحلي فقط.

### تحليل الإطار

```http
POST /api/v1/monitoring/analyze-frame
Content-Type: multipart/form-data
Authorization: Bearer <token>

image: <file>
analysis_mode: live | manual
```

- حد الحجم: `MONITORING_UPLOAD_MAX_BYTES`
- Rate limit: 72 طلب/دقيقة لكل IP (SlowAPI)

---

## 9. ملفات نماذج الذكاء الاصطناعي

### خط أنابيب تصنيف الأطباق

```
صورة → OpenAI Vision (إن وُجد المفتاح)
     → Gemini Vision (DISH_GEMINI_API_KEY)
     → SKA Custom ResNet18 (إن وُجدت الأوزان)
     → Food-101 HuggingFace (FOOD101_HF_MODEL_ID)
     → Roboflow (ROBOFLOW_API_KEY)
```

الملف المرجعي: `app/services/professional_dish_vision.py`

### أوزان مخصّصة للأطباق (اختياري)

```text
backend/ml/custom_food/
├── train_custom_food.py      # تدريب ResNet18 (9 فئات)
├── dataset/                  # صور التدريب
└── README.md
```

```env
SKA_CUSTOM_FOOD_MODEL_PATH=/path/to/custom_food_best.pt
SKA_CUSTOM_FOOD_LABEL_MAP_PATH=/path/to/label_map.json
```

### مفاتيح Gemini

1. أنشئ مفتاحًا من: https://aistudio.google.com/apikey
2. عيّنه في Render Dashboard → Environment → `GEMINI_API_KEY`
3. (اختياري) مفاتيح منفصلة: `DISH_GEMINI_API_KEY`, `MONITORING_GEMINI_API_KEY`

---

## 10. نماذج YOLO للمراقبة

### الملفات المتوقعة

| الملف | الحجم التقريبي | الغرض |
|-------|----------------|-------|
| `hansung_ppe.pt` | ~6 MB | **النموذج الافتراضي على Render** (تحميل تلقائي) |
| `keremberk_ppe.pt` | ~52 MB | نموذج PPE أدق (تطوير محلي) |
| `yolov8n.pt` | ~6 MB | كاشف أشخاص COCO (اختياري) |
| `mask_best.pt` | — | كشف كمامة إقليمي (غير في git) |
| `glove_best.pt` | — | كشف قفازات إقليمي |
| `hairnet_best.pt` | — | كشف غطاء رأس |

> جميع ملفات `*.pt` **مستثناة من Git** (`.gitignore`). يجب رفعها يدويًا إلى القرص الدائم على Render أو تحميلها محليًا.

### ترتيب البحث عن الأوزان

```
1. YOLO_MODEL_PATH (env)
2. backend/ml/models/hansung_ppe.pt
3. backend/ml/models/keremberk_ppe.pt
4. أي *.pt آخر في ml/models/
5. تحميل hansung_ppe.pt من HuggingFace (YOLO_AUTO_DOWNLOAD=true)
```

الملف المرجعي: `app/services/yolo_model_resolver.py`

### التحميل المحلي

```bash
cd backend
python ml/download_ppe_model.py              # كلا النموذجين
python ml/download_ppe_model.py --fallback-only  # hansung فقط (Render)
```

### سلوك Render

- **لا يُحمَّل** أثناء البناء (تجنّب فشل الشبكة).
- **أول طلب** `analyze-frame` يحمّل `hansung_ppe.pt` تلقائيًا (~6 MB، مرة واحدة).
- انتظر 30-60 ثانية لأول تحليل بعد إعادة النشر (Cold Start + تحميل النموذج).

### اختبار دقة PPE

```bash
cd backend
python scripts/ppe_accuracy_test.py
```

---

## 11. خطوات النشر (Deployment)

### النشر على Render (موصى به)

#### المتطلبات المسبقة

1. مستودع GitHub متصل (`main` branch).
2. ملف `render.yaml` في جذر المستودع.
3. قاعدة بيانات PostgreSQL على Render (أو خارجية).

#### الخطوات

1. **إنشاء Blueprint:**
   - Render Dashboard → **New** → **Blueprint**
   - اختر المستودع `Taeen-Quality-Platform`
   - Render يقرأ `render.yaml` وينشئ خدمتين.

2. **إعداد متغيرات Backend** (`taeen-backend`):

   ```env
   ENVIRONMENT=production
   SECRET_KEY=<openssl rand -hex 32>
   DATABASE_URL=<من Render PostgreSQL>
   CORS_ALLOW_ORIGINS=https://taeen-quality-frontend.onrender.com
   GEMINI_API_KEY=<مفتاحك>
   SEED_ADMIN_EMAIL=admin@yourcompany.com
   SEED_ADMIN_PASSWORD=<كلمة قوية>
   DISH_MEDIA_DIR=/var/data/ska/media/dishes
   YOLO_AUTO_DOWNLOAD=true
   YOLO_ENABLED=true
   ```

3. **إعداد متغيرات Frontend** (`taeen-quality-frontend`):

   ```env
   VITE_API_BASE_URL=https://taeen-quality-platform.onrender.com
   NODE_VERSION=20
   ```

4. **قرص دائم (Persistent Disk) — موصى به:**
   - أضف قرصًا بـ 1 GB على خدمة Backend.
   - اربطه بـ `/var/data/ska`
   - عيّن `DISH_MEDIA_DIR=/var/data/ska/media/dishes`

5. **التحقق بعد النشر:**

   ```bash
   curl https://taeen-quality-platform.onrender.com/health
   curl https://taeen-quality-frontend.onrender.com/
   ```

### النشر بـ Docker (بديل)

```bash
# Backend
docker build -f backend/Dockerfile -t ska-backend .
docker run -p 8000:8000 --env-file backend/.env ska-backend

# Frontend
docker build -f frontend/Dockerfile \
  --build-arg VITE_API_BASE_URL=https://api.example.com \
  -t ska-frontend .
docker run -p 3000:3000 ska-frontend
```

### Auto Deploy

- كل `git push origin main` → Render يعيد بناء ونشر الخدمتين تلقائيًا.
- `autoDeploy: true` مُعرَّف في `render.yaml`.

---

## 12. النسخ الاحتياطي والاستعادة

### قاعدة البيانات (PostgreSQL)

```bash
# نسخ احتياطي يومي
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# استعادة
psql $DATABASE_URL < backup_20260524.sql
```

> على Render: فعّل **Automated Backups** من لوحة PostgreSQL (خطة مدفوعة) أو استخدم `pg_dump` مجدولًا عبر Cron Job.

### صور الأطباق

```bash
# نسخ مجلد الوسائط
tar -czf dishes_media_$(date +%Y%m%d).tar.gz /var/data/ska/media/dishes/

# استعادة
tar -xzf dishes_media_20260524.tar.gz -C /var/data/ska/media/
```

### أوزان YOLO

```bash
tar -czf yolo_models_$(date +%Y%m%d).tar.gz backend/ml/models/*.pt
```

### ما يجب نسخه دوريًا

| العنصر | التكرار | الأهمية |
|--------|---------|---------|
| قاعدة البيانات PostgreSQL | يومي | حرج |
| `media/dishes/` | يومي | حرج |
| `ml/models/*.pt` | أسبوعي | عالي |
| متغيرات البيئة (Render Dashboard) | عند التغيير | حرج |
| سجلات التطبيق (Render Logs) | أسبوعي | متوسط |

---

## 13. الأمان

> التفاصيل الكاملة: [`SECURITY_REPORT.md`](../SECURITY_REPORT.md) و [`SECURITY_DEPLOYMENT_NOTES.md`](SECURITY_DEPLOYMENT_NOTES.md)

### ضوابط مفعّلة

| الضابط | التفاصيل |
|--------|----------|
| JWT | توقيع + انتهاء صلاحية إلزامي |
| CORS | قائمة بيضاء في الإنتاج |
| Rate Limiting | login 25/min · analyze-frame 72/min · detect-dish 48/min |
| Security Headers | `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` |
| RTSP Redaction | إخفاء بيانات اعتماد الكاميرا في JSON |
| Upload Validation | حجم + نوع MIME + فحص Pillow |
| Production Mode | إخفاء OpenAPI UI + أخطاء عامة بالعربية |

### قائمة تحقق أمان الإنتاج

- [ ] `ENVIRONMENT=production`
- [ ] `SECRET_KEY` عشوائي ≥ 32 حرفًا
- [ ] `DEV_AUTH_BYPASS=false`
- [ ] `SEED_DEV_ADMIN=false`
- [ ] كلمات مرور seed قوية ومختلفة عن الافتراضيات
- [ ] `CORS_ALLOW_ORIGINS` محدّد بدقة
- [ ] HTTPS مفعّل على الواجهة والـ API
- [ ] `ENABLE_HSTS=true` (فقط بعد تأكيد HTTPS الكامل)
- [ ] لا تُرفع ملفات `.env` إلى Git
- [ ] مفاتيح API في Render Environment (وليس في الكود)
- [ ] نسخ احتياطي لقاعدة البيانات مفعّل

### ما لا يُعدّ آمناً 100%

- JWT في `localStorage` (عرضة لـ XSS — يُفضَّل HttpOnly cookies مستقبلًا).
- Rate limiting في الذاكرة (لا يعمل عبر عدة Workers — استخدم Redis).
- أسرار RTSP مخزّنة بنص صريح في DB (يُوصى بتشفير أثناء السكون).

---

## 14. استكشاف الأخطاء وإصلاحها

### Backend

| العرض | السبب المحتمل | الحل |
|-------|---------------|------|
| `500` عند التشغيل | `SECRET_KEY` ضعيف في production | عيّن مفتاحًا ≥ 32 حرفًا |
| `401` على كل الطلبات | Token منتهٍ أو `SECRET_KEY` تغيّر | أعد تسجيل الدخول |
| `CORS error` في المتصفح | `CORS_ALLOW_ORIGINS` ناقص | أضف رابط الواجهة |
| `analyze-frame` بطيء جدًا (أول مرة) | تحميل YOLO + Cold Start | انتظر 60 ثانية، الطلبات التالية أسرع |
| `analyze-frame` يفشل دائمًا | لا أوزان YOLO | تحقق من `YOLO_AUTO_DOWNLOAD=true` وسجلات Render |
| صور أطباق `404` | `DISH_MEDIA_DIR` غير موجود | أنشئ المجلد أو اربط Persistent Disk |
| `detect-dish` يفشل | `GEMINI_API_KEY` مفقود | عيّن المفتاح في Environment |

### Frontend

| العرض | السبب | الحل |
|-------|-------|------|
| صفحة بيضاء بعد `/dashboard` | خطأ JS أو API معطّل | افتح DevTools → Console |
| `404` عند تحديث الصفحة | SPA fallback مفقود | تأكد من `_redirects` و `rewrite` في render.yaml |
| API يتصل بـ localhost | `VITE_API_BASE_URL` خاطئ | أعد بناء Frontend بالرابط الصحيح |
| بطء على الجوال | Bundle كبير | تأكد من lazy loading (مفعّل) |

### Render-specific

| العرض | الحل |
|-------|------|
| خدمة «نائمة» (Sleep) | أول طلب يستغرق 30-60 ثانية — طبيعي على Free tier |
| OOM (Out of Memory) | خفّض `YOLO_MAX_EDGE` إلى 480 · عطّل `YOLO_USE_PERSON_DETECTOR` |
| Build فشل (Frontend) | تحقق من `npm ci` و Node 20 |
| Build فشل (Backend) | تحقق من `requirements.txt` و Python 3.11 |

### فحص حالة AI

```bash
curl -H "Authorization: Bearer <token>" \
  https://taeen-quality-platform.onrender.com/api/v1/ai/status
```

### السجلات

```bash
# Render Dashboard → Service → Logs
# أو محليًا:
uvicorn app.main:app --log-level debug
```

---

## 15. قائمة الصيانة الدورية

### يوميًا

- [ ] مراجعة سجلات Render للأخطاء `5xx`
- [ ] التحقق من `/health` endpoint
- [ ] مراجعة عدد التنبيهات المفتوحة غير المعالجة

### أسبوعيًا

- [ ] نسخ احتياطي لقاعدة البيانات (`pg_dump`)
- [ ] نسخ احتياطي لـ `media/dishes/`
- [ ] مراجعة استخدام القرص الدائم (صور + أوزان)
- [ ] `npm audit` + `pip check`

### شهريًا

- [ ] تدوير `SECRET_KEY` (يتطلب إعادة تسجيل دخول جميع المستخدمين)
- [ ] مراجعة صلاحيات المستخدمين (حذف حسابات غير نشطة)
- [ ] تحديث `requirements.txt` و `package.json`
- [ ] اختبار دقة PPE: `python scripts/ppe_accuracy_test.py`
- [ ] مراجعة حصة Gemini API والفواتير

### عند كل نشر (Release)

- [ ] `npm run build` — نجاح بدون أخطاء
- [ ] `python -m ruff check app` — نجاح
- [ ] `python -c "from app.main import app"` — نجاح
- [ ] لا ملفات `.env` أو صور خاصة في Git
- [ ] `git push origin main`
- [ ] انتظر اكتمال Render Deploy
- [ ] اختبر: login → dashboard → detect-dish → analyze-frame

---

## 16. مراجع إضافية

| المستند | المحتوى |
|---------|---------|
| [`USER_GUIDE.md`](USER_GUIDE.md) | دليل المستخدم (عربي) |
| [`SECURITY_REPORT.md`](../SECURITY_REPORT.md) | تقرير الأمان التفصيلي |
| [`SECURITY_DEPLOYMENT_NOTES.md`](SECURITY_DEPLOYMENT_NOTES.md) | ملاحظات نشر الأمان |
| [`PRODUCTION_ACCURACY_REPORT.md`](PRODUCTION_ACCURACY_REPORT.md) | تقرير دقة AI |
| [`PROJECT_HANDOVER.md`](PROJECT_HANDOVER.md) | وثيقة تسليم المشروع |
| [`backend/README.md`](../backend/README.md) | دليل Backend |
| [`frontend/README.md`](../frontend/README.md) | دليل Frontend |
| [`backend/.env.example`](../backend/.env.example) | قائمة متغيرات البيئة |
| [`backend/ml/models/README.md`](../backend/ml/models/README.md) | أوزان YOLO |
| [`render.yaml`](../render.yaml) | Blueprint النشر |

---

*منصة عين الجودة — Ayn Al-Jawdah Quality Platform · وثيقة إدارية — للاستخدام الداخلي والتسليم التجاري*
