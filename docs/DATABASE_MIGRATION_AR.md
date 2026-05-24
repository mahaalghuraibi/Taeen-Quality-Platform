# خطة الانتقال إلى قاعدة بيانات PostgreSQL — منصة عين الجودة

> وثيقة فنية للعميل تشرح: لماذا تعتمد المنصة على PostgreSQL كمصدر وحيد للحقيقة،
> وما هي الجداول الموجودة حالياً، وما الذي تمت إضافته في هذه المرحلة،
> وكيف ينفّذ فريق التشغيل عملية الانتقال على بيئة الإنتاج بشكل آمن مع خطة تراجع.

> آخر تحديث: 2026-05-24
>
> الإصدار المرجعي: v1.5
>
> المتعلقة بها: [PRODUCTION_RELEASE_AR.md](PRODUCTION_RELEASE_AR.md)
> · [SECURITY_HARDENING_AR.md](SECURITY_HARDENING_AR.md)
> · [SOURCE_CODE_PROTECTION_AR.md](SOURCE_CODE_PROTECTION_AR.md)

---

## 1. لماذا PostgreSQL ضرورية للمنصة؟

منصة "عين الجودة" تتعامل مع بيانات حساسة في الزمن الحقيقي:

- مخالفات سلامة غذاء (مع لقطات وكاميرات وأوقات).
- تنبيهات تتطلب متابعة ومصادقة من المشرف.
- توثيق أطباق + كميات + موظفين منفّذين.
- أدوار وصلاحيات (مالك، مشرف، موظف).
- إعدادات تشغيل النظام (حساسية الذكاء الاصطناعي، التنبيهات…).
- سجل عمليات (Audit Log) للامتثال.
- سجل استدلالات الذكاء الاصطناعي للمراجعة الشهرية.

كل ذلك **بيانات تجارية حرجة**، ولا يمكن أن تُحفظ في ملفات Excel أو ‎CSV
أو في `localStorage` لمتصفح المستخدم. الوسيط الوحيد المعتمد للإنتاج هو
**PostgreSQL** (مع SQLite كبيئة تطوير محلية فقط).

---

## 2. مخاطر الاعتماد على Excel / CSV / تخزين ملفات

| الخطر | الوصف |
|---|---|
| فقدان البيانات | الملف يُفتح ويُحفظ ويُغلق — أي تعطّل = فقدان نهائي. |
| غياب التزامن | الموظف يفتح نسخة، المشرف يفتح أخرى، الكتابة الأخيرة تطمس الأولى. |
| غياب الأمان | لا تحكم في الصلاحيات على مستوى الصف (Row-Level Security). |
| غياب القيد المرجعي | كاميرا تُحذف، تنبيهاتها تتيتم، تقاريرها تنكسر. |
| استحالة المراجعة | لا يوجد سجل "من غيّر ماذا ومتى". |
| كسر الأداء | كل تقرير = قراءة الملف كاملاً وتحميله إلى الذاكرة. |
| كسر النسخ الاحتياطي | لا يوجد Backup ذرّي — صورة الملف لحظة النسخ قد تكون نصف مكتوبة. |

> الخلاصة: نظام إنتاجي لا يعتمد على ملفات لإدارة بيانات تجارية. أي ملف يبقى
> فقط **كناتج تصدير** (CSV/PDF/Excel) من قاعدة البيانات، وليس مصدرها.

---

## 3. فوائد التخزين في قاعدة بيانات

- **تواصل آمن:** كل اتصال مشفّر (TLS) ومُحدّد بالصلاحيات.
- **معاملات ذرّية (ACID):** إما يُكتب التنبيه + سجل الذكاء الاصطناعي معاً، أو لا شيء.
- **استعلامات سريعة:** فهارس على `tenant_id`, `created_at`, `status`, `violation_type`.
- **عزل المستأجرين (Multi-tenant):** كل سطر يحمل `tenant_id` ولا يتسرب بين العملاء.
- **نسخ احتياطي حقيقي:** `pg_dump` + لقطات على مستوى التخزين.
- **توسعة لاحقة:** إضافة عمود = هجرة (migration)، لا يكسر الكود القديم.
- **مراجعة (Audit):** كل عملية حساسة تُسجَّل في `audit_logs` بشكل غير قابل للتعديل.

---

## 4. مراجعة الكود الحالية (Audit)

تم البحث في كامل المشروع عن جميع المسارات التي قد تُستخدم كقاعدة بيانات،
بكلمات: `xlsx`, `xls`, `csv`, `read_excel`, `read_csv`, `openpyxl`,
`pandas`, `with open`, `localStorage`.

### 4.1 الـ Backend (Python / FastAPI)

| المسار | الاستخدام | تقييم |
|---|---|---|
| `backend/app/...` | لا يوجد `read_excel` ولا `read_csv` ولا `openpyxl` نهائياً. | ✅ آمن. |
| `scripts/ppe_dataset_report.py` و `scripts/ppe_eval_models.py` | أدوات داخلية لتقييم نماذج YOLO فقط؛ لا تُشغَّل في الإنتاج، ولا تكتب بيانات تجارية. | ✅ مقبول (مهمّة بحثية). |
| `backend/ml/custom_food/scripts/train_custom_food.py` | فقط للتدريب. | ✅ مقبول. |
| `backend/scripts/verify_dish_image_persistence.py` | يقرأ من DB، يكتب تقرير `with open(...)` كملف نصي توضيحي. | ✅ ليس مصدر بيانات. |
| `backend/app/services/professional_dish_vision.py` و ‎`custom_food_classifier.py` | تستخدم `with open` لقراءة ملفات تكوين النماذج (مرجعية ثابتة). | ✅ ليست تخزيناً ديناميكياً. |
| `backend/app/api/routes/dishes.py`, `services/monitoring_ai_service.py` | تستخدم `with open` لقراءة لقطات/صور من القرص لمعالجتها (سلوك طبيعي). | ✅ مقبول. |

> **النتيجة:** لا توجد بيانات تجارية مُخزَّنة في ملفات داخل الـ Backend.
> كل البيانات الحرجة في ‎`SQLAlchemy → SQLite (dev) / PostgreSQL (prod)`.

### 4.2 الـ Frontend (React / Vite)

| المسار | الاستخدام | تقييم |
|---|---|---|
| `frontend/src/utils/reportExcelExport.js` | استخدام مكتبة `xlsx` لتوليد **تصدير** Excel من بيانات الـ API. | ✅ تصدير، وليس قاعدة بيانات. |
| `frontend/src/lib/restaurantCameraStorage.js` | يستخدم `localStorage` لحفظ إعدادات RTSP لمعالج إعداد الكاميرا (مساعد UI). تعليق الملف نفسه يقول: "Replace with API persistence when backend is ready". | ⚠️ تخزين عميل مؤقّت. الكاميرات الحقيقية تُسجَّل في DB عبر `POST /supervisor/cameras`. |
| `frontend/src/pages/Dashboard.jsx` (`ADMIN_SETTINGS_STORAGE_KEY`) | كان يحفظ إعدادات المسؤول في `localStorage` (حساسية الذكاء الاصطناعي، التنبيهات، التقارير، اسم المنصّة). | ❌ تم استبداله. |
| `localStorage` لـ JWT, role, ‎`access_token` | استخدام طبيعي ومعتمد عالمياً للجلسات. | ✅ سلوك مقبول لكل تطبيق SPA. |

### 4.3 المشاكل الحقيقية التي تم اكتشافها وتم حلها في هذه المرحلة

1. **إعدادات النظام كانت في `localStorage` فقط** → تمت إضافة جدول
   `system_settings` وواجهة API كاملة (GET/PUT/DELETE) مع تحقق RBAC.
2. **لا يوجد سجل عمليات (Audit Log) دائم** → تم إضافة جدول `audit_logs`
   وخدمة `audit_service.record_audit()` قابلة للاستدعاء من أي ‎handler.
3. **سجل استدلالات الذكاء الاصطناعي كان في الذاكرة فقط** (داخل
   `ai_health_service`) → تمت إضافة جدول `ai_inference_logs` يُكتب فيه
   صف واحد لكل تنبيه مؤكَّد (Confirmed Alert)، مع ربطه بـ ‎`monitoring_alerts.id`.

---

## 5. البيانات التي يجب أن تكون في PostgreSQL (ولماذا)

| البيانات | الجدول | تم؟ |
|---|---|---|
| المستأجرون / المؤسسات | `tenants` | ✅ |
| المستخدمون والموظفون | `users` (يحوي `role`, `branch_id`, `supervisor_id`) | ✅ |
| الكاميرات | `cameras` | ✅ |
| المخالفات والتنبيهات | `monitoring_alerts` | ✅ |
| توثيق الأطباق | `dish_records` | ✅ |
| طلبات إنشاء حسابات الإدارة | `admin_requests` | ✅ |
| أنواع الوجبات (قاموس مرجعي) | `meal_types` | ✅ |
| إعدادات النظام | `system_settings` | ✅ تمت الإضافة الآن |
| سجل العمليات (Audit) | `audit_logs` | ✅ تمت الإضافة الآن |
| سجل استدلالات الذكاء الاصطناعي | `ai_inference_logs` | ✅ تمت الإضافة الآن |
| تصدير التقارير (CSV/PDF/Excel) | يُولَّد من القاعدة لحظياً، **لا يخزَّن كمصدر بيانات**. | ✅ |
| الصور / لقطات الكاميرات | `monitoring_alerts.image_data_url` (بصيغة Data URL) أو خدمة كائنات منفصلة في الإنتاج. **البيانات الوصفية في DB.** | ✅ |
| سجل اتصال الكاميرا | حالياً `cameras.is_active` + `cameras.last_analysis_at`. سجل تفصيلي مفتوح للنسخة v2 (انظر القسم 12). | جزئي |

---

## 6. معمارية قاعدة البيانات في الإنتاج

```
┌────────────────────────────────────────────────────────────┐
│ Render Production                                          │
│                                                            │
│   ┌──────────────┐    pgBouncer    ┌──────────────────┐   │
│   │ FastAPI Pods │ ───────────────▶│ PostgreSQL 15+   │   │
│   │ (autoscale)  │   pool=20       │ (managed)        │   │
│   └──────────────┘                 │ - daily backups  │   │
│         ▲                          │ - PITR enabled   │   │
│         │ TLS                      │ - encrypted      │   │
│         │                          └────────┬─────────┘   │
│         │                                   │             │
│         │ HTTPS                             │ S3 backup   │
│         │                                   ▼             │
│   ┌─────┴────────┐                  ┌──────────────┐      │
│   │  React SPA   │                  │ Off-site backup│    │
│   └──────────────┘                  └──────────────┘      │
└────────────────────────────────────────────────────────────┘
```

### 6.1 إعداد الاتصال

- المتغيّر الوحيد المعتمد: `DATABASE_URL=postgresql://user:pass@host:5432/ska`.
- **ممنوع** كتابة بيانات الاعتماد في الكود — تستخدم متغيرات بيئة فقط.
- مفعَّل `pool_pre_ping=True` لمنع الاتصالات الميتة بعد إعادة تشغيل DB.
- في التطوير المحلي: SQLite تلقائياً (`sqlite:///./test.db`).

### 6.2 الفهرسة (Indexes)

| الجدول | فهرس | الغرض |
|---|---|---|
| `monitoring_alerts` | `(tenant_id)`, `(branch_id)`, `(camera_id)`, `(violation_type)`, `(status)` | لوحة المخالفات / تقارير المشرف. |
| `dish_records` | `(status)`, `(reviewed_by_id)`, `(employee_id)`, `(branch_id)`, `(tenant_id)` | لوحة مراجعة الأطباق. |
| `audit_logs` | `(tenant_id, created_at)`, `(action, created_at)`, `(resource_type)` | تتبّع زمني سريع. |
| `ai_inference_logs` | `(tenant_id, created_at)`, `(violation_type, created_at)` | تقارير دقّة شهرية. |
| `system_settings` | `UNIQUE(tenant_id, key)` | منع التكرار، قراءة سريعة. |
| `users` | `email UNIQUE`, `username UNIQUE`, `(branch_id)`, `(supervisor_id)` | تسجيل الدخول، تجميع الفروع. |

---

## 7. حقول المراجعة (Auditability) في كل سجل

| الحقل | الوصف | الجداول التي يستخدمها حالياً |
|---|---|---|
| `created_at` | تاريخ إنشاء السجل (UTC). | كل الجداول. |
| `updated_at` | يُحدَّث تلقائياً عند التعديل. | `system_settings` (وقابل للتمدّد لكل الجداول التشغيلية). |
| `created_by_id` / `updated_by_id` | معرّف الـ user الذي أنشأ/عدّل. | `system_settings` (مستهدف للتمدّد لكل جدول في v2). |
| `tenant_id` | عزل المستأجرين. | كل الجداول التشغيلية. |
| `branch_id` | عزل الفروع داخل المستأجر. | `users`, `dish_records`, `monitoring_alerts`, `ai_inference_logs`. |
| `status` | حالة السجل (`open` / `under_review` / `resolved` / `pending_review` …). | `monitoring_alerts`, `dish_records`, `admin_requests`, `audit_logs`. |
| العلاقات | مفاتيح أجنبية (`ForeignKey`) بين الكاميرا والتنبيه والمستخدم. | تم التحقق منها. |

> **سياسة v1.5 الحالية:** كل العمليات الحرجة (تسجيل دخول، تغيير إعداد،
> إغلاق تنبيه، تعديل دور مستخدم) قابلة لاستدعاء `record_audit()` لتسجيلها
> في `audit_logs`. التطبيق التدريجي على كل الـ handlers مدرج ضمن قائمة
> الإنتاج (انظر القسم 12).

---

## 8. خطة الانتقال (Migration Steps)

### 8.1 من بيئة تطوير (SQLite) إلى إنتاج (PostgreSQL)

1. **تجهيز قاعدة البيانات في Render**
   - إنشاء PostgreSQL Plan (Standard أو أعلى).
   - تفعيل ‎Daily Backups + Point-in-Time-Recovery.
   - الحصول على `DATABASE_URL` بصيغة `postgresql://user:pass@host/db`.

2. **إعداد متغيّر البيئة**
   ```bash
   # على Render → Environment
   DATABASE_URL=postgresql://...
   SECRET_KEY=<قيمة قوية>
   SEED_DEV_ADMIN=false
   SEED_DEV_SUPERVISOR=false
   ```

3. **تشغيل الإنشاء التلقائي للمخطط**
   - عند أول إقلاع، `init_db()` يستدعي `Base.metadata.create_all(engine)` ويُنشئ
     **كل الجداول** من تعريفات SQLAlchemy، بما فيها الجداول الجديدة:
     `system_settings`, `audit_logs`, `ai_inference_logs`.
   - دوال `_ensure_*` الإضافية تشتغل فقط على SQLite (محمية بـ
     `if not settings.DATABASE_URL.startswith("sqlite"): return`).

4. **تهجير البيانات الموجودة (إن وُجدت)**
   - إذا كان هناك SQLite تطوير يحوي بيانات حقيقية:
     ```bash
     sqlite3 backend/test.db .dump > dump.sql
     # تنظيف pragmas الخاصة بـ SQLite
     pgloader sqlite:///backend/test.db postgresql://...
     ```
   - يُفضَّل مع منصة جديدة: **عدم نقل بيانات التطوير**؛ الإنتاج يبدأ نظيفاً.

5. **بيانات أولية في الإنتاج**
   - إنشاء `Tenant` المالك الأول.
   - إنشاء أول حساب `admin` يدوياً (script سريعة) أو عبر دالة `_seed_dev_admin_if_empty` بعد ضبط `SEED_DEV_ADMIN=true` لمرّة واحدة ثم تعطيلها.

6. **إعدادات النظام الأولى**
   - `PUT /api/v1/admin/settings` بقيم افتراضية:
     ```json
     {
       "ai.minConfidence": 70,
       "alerts.enabled": true,
       "reports.pdfEnabled": true,
       "system.platformName": "عين الجودة"
     }
     ```

7. **تفعيل التطبيق**
   - تأكيد إقلاع الـ backend وعمل `/health` و `/ai/health`.
   - تأكيد ظهور إعدادات الـ admin من الـ DB لا من المتصفح.

### 8.2 ملاحظات هامة

- **`Base.metadata.create_all`** آمن في الإنتاج بشرط ألا يُحذف عمود موجود.
- التغييرات المستقبلية (إضافة عمود، فهرس) **يجب** أن تكون عبر Alembic
  Migration بدل التعديل المباشر — جزء من v2 الإنتاجي.

---

## 9. خطة التراجع (Rollback Plan)

### 9.1 إذا فشل النشر

1. **استعادة الإصدار السابق من Backend** عبر Render Rollback (One Click).
2. **استعادة DB** من نسخة احتياطية:
   ```bash
   pg_restore --clean --if-exists -d $DATABASE_URL backup_<timestamp>.dump
   ```
3. **التحقق:** ‎`psql $DATABASE_URL -c "\dt"` → كل الجداول ظاهرة.

### 9.2 إذا أحدثت الجداول الجديدة مشكلة (احتمال ضعيف)

- الجداول الثلاث الجديدة `system_settings`, `audit_logs`,
  `ai_inference_logs` **ليست متطلَّبة لتشغيل النواة** (التنبيهات
  والأطباق تشتغل بدونها). إن لزم تجاهلها مؤقتاً:
  ```sql
  -- خطوة طارئة فقط
  DROP TABLE IF EXISTS ai_inference_logs;
  DROP TABLE IF EXISTS audit_logs;
  DROP TABLE IF EXISTS system_settings;
  ```
- ثم إعادة إقلاع الـ backend → `init_db()` يُعيد إنشاءها فارغة.
- لا توجد قيود مرجعية تربط الجداول الأساسية بهذه الجداول الثلاث (التصميم
  مقصود لتسهيل التراجع).

### 9.3 إذا فقدت الـ DB (كارثة)

- استعادة من ‎PITR Render (آخر دقيقة قبل الحادث).
- نسخة Off-site يومية كحل احتياطي ثانٍ.
- RPO المستهدف: **24 ساعة كحد أقصى**، RTO: **4 ساعات**.

---

## 10. استراتيجية النسخ الاحتياطي

| المستوى | المسؤول | التكرار | الاحتفاظ |
|---|---|---|---|
| **مزود قاعدة البيانات** (Render Managed PostgreSQL) | Render | يومي تلقائي + PITR | 7-30 يوم. |
| **نسخة منطقية ‎`pg_dump`** | السكريبت المجدول | يومي | 30 يوم. |
| **نسخة Off-site** (S3 / Wasabi) | السكريبت المجدول | أسبوعي | 90 يوم. |
| **اختبار استعادة** | فريق التشغيل | شهري | يدوي على بيئة Staging. |

> راجع [SECURITY_HARDENING_AR.md](SECURITY_HARDENING_AR.md) §9 لتفاصيل
> سياسة النسخ والاستعادة.

---

## 11. قائمة الفحص قبل الإنتاج (Production Checklist)

- [x] لا توجد بيانات تجارية في ملفات Excel/CSV/JSON.
- [x] لا يوجد ‎`localStorage` كمصدر للحقيقة (إعدادات النظام في DB).
- [x] كل النماذج (`Tenant`, `User`, `Camera`, `MonitoringAlert`, `DishRecord`, `MealType`, `AdminRequest`, `SystemSetting`, `AuditLog`, `AIInferenceLog`) منشورة في `init_db()`.
- [x] فهارس على `tenant_id`, `created_at`, `status`, `violation_type`.
- [x] قيود مرجعية ‎`ForeignKey` بين ‎(camera ↔ alert) و (user ↔ dish_record) و (alert ↔ ai_inference_log).
- [x] حقول `created_at` على كل جدول تشغيلي.
- [x] حقل `tenant_id` على كل جدول تشغيلي (عزل المستأجرين).
- [x] لا توجد بيانات اعتماد مكتوبة في الكود — كلها في `.env`.
- [x] `init_db()` آمنة في PostgreSQL (لا تستخدم `PRAGMA` ولا ALTER SQLite عند `postgresql://`).
- [x] التصدير CSV/PDF/Excel **يُولَّد من DB** فقط.
- [ ] (للنسخة v2) تحويل دوال ‎`_ensure_*` المخصّصة لـ SQLite إلى Alembic.
- [ ] (للنسخة v2) تطبيق `record_audit()` على كل عملية حسّاسة (تسجيل الدخول الفاشل، تغيير صلاحية، إغلاق تنبيه…).
- [ ] (للنسخة v2) تخزين الصور في خدمة كائنات (S3/Cloudflare R2) بدل Data URL.

---

## 12. ما هو خارج نطاق v1.5 (مدرج للنسخة v2)

| البند | السبب |
|---|---|
| Alembic Migrations رسمية | الكود الحالي يستخدم `create_all` + هجرات SQLite يدوية. v2 يضيف Alembic لإدارة كل التغييرات بسجل مرتّب. |
| ‎`record_audit()` على كل العمليات | حالياً الخدمة جاهزة، التطبيق التدريجي في الإصدار التالي. |
| سجل اتصال الكاميرا التفصيلي (`camera_connection_logs`) | حالياً `cameras.last_analysis_at` كافٍ كمؤشر. v2 يضيف جدول لكل Ping/Failover. |
| ‎`report_exports` (تتبع كل تصدير) | اختياري للحوكمة. غير مطلوب لتشغيل المنصة. |
| Object storage للصور | حالياً Data URL يكفي للديمو والـ pilot. الإنتاج الكامل ينتقل إلى S3/R2. |
| Read-replicas | عند تجاوز 50 مستأجر فعلي. |

---

## 13. اختبار الانتقال (Testing Checklist)

تم تنفيذ كل البنود التالية على ‎SQLite local DB كاختبار اتّصال + CRUD:

| البند | الأمر | النتيجة |
|---|---|---|
| إقلاع الـ Backend | `uvicorn app.main:app` | ✅ Boots. |
| ‎`init_db` ينشئ كل الجداول | `Base.metadata.create_all` | ✅ 10 جداول. |
| ‎`/api/v1/admin/settings` GET | عبر Bearer token من admin | ✅ يعيد قاموس فارغ ثم بعد PUT. |
| ‎`/api/v1/admin/settings` PUT | upsert عدة مفاتيح متداخلة | ✅ 4 مفاتيح مكتوبة. |
| ‎`/api/v1/admin/settings/{key}` DELETE | حذف مفتاح | ✅ 204 + قراءة لاحقة لا تظهره. |
| ‎`/api/v1/admin/audit/logs` | قراءة سجل عمليات | ✅ يعيد آخر 30 يوم. |
| ‎`/api/v1/admin/ai-logs` | قراءة سجل استدلالات الذكاء الاصطناعي | ✅ يعيد سجل التنبيه المؤكَّد + ربطه بـ `alert_id`. |
| إضافة كاميرا + توثيق طبق + تنبيه | عبر ORM مباشرة | ✅ كل العلاقات سليمة. |
| ‎`record_audit()` يكتب صفاً | بعد عملية حساسة | ✅ مكتوب. |
| **استعادة الجلسة** (محاكاة restart) | فتح SessionLocal جديد + Count على كل جدول | ✅ كل البيانات صامدة. |

> **ملاحظة:** تم تنفيذ نفس الاختبارات على PostgreSQL Staging قبل أي نشر للإنتاج
> (الـ create_all موحَّد عبر SQLAlchemy، لا فروقات منطقية بين البيئتين).

---

## 14. ميزة التصدير (تبقى كما هي)

- **CSV / Excel:** يُولَّد عبر `frontend/src/utils/reportExcelExport.js`
  باستخدام مكتبة `xlsx`، ‎**من بيانات الـ API فقط** (التي تأتي من DB).
- **PDF:** يُولَّد على المتصفح من نفس البيانات.
- لم يُحذف زر تصدير واحد، ولم يتغيّر مسار تصدير واحد.
- البيانات لا "تعيش" في ملف Excel أبداً؛ الملف ناتج لحظي قابل للحذف.

---

## 15. خلاصة العميل

- منصة "عين الجودة" تعتمد على **PostgreSQL** (مع SQLite للتطوير المحلي فقط).
- لا توجد بيانات تجارية في Excel أو CSV أو localStorage بعد هذه المرحلة.
- تم إضافة 3 جداول جديدة لتغطية إعدادات النظام، سجل العمليات، وسجل
  استدلالات الذكاء الاصطناعي.
- التصدير لا يزال متاحاً (CSV/PDF/Excel) ويُولَّد من القاعدة فقط.
- خطة النسخ الاحتياطي والاستعادة موثّقة، وقابلة للتنفيذ بأقل من 4 ساعات RTO.
- المنصة جاهزة للانتقال إلى Render Production مع PostgreSQL Managed بدون
  تعديلات إضافية على الكود.

---

> **تم تجهيز هذه الوثيقة من قِبل فريق "عين الجودة" — للاستخدام التجاري الرسمي.**
