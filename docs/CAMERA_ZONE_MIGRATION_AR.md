# تقرير هجرة إعدادات مناطق الكاميرا — localStorage → PostgreSQL

> **CAMERA_ZONE_MIGRATION_AR.md**  
> الإصدار: 1.0 · يونيو 2026  
> الهدف: **100% PostgreSQL production readiness** لإعدادات الفروع والكاميرات والمناطق والمراقبة

---

## 1. ملخص التنفيذ

| البند | قبل | بعد |
|-------|-----|-----|
| مصدر إعدادات المناطق (kitchen / storage / prep) | `localStorage` → `ska_restaurant_camera_configs_v1` | PostgreSQL → `monitoring_zone_configs` |
| API | غير موجود | `GET/PUT/PATCH/POST` تحت `/api/v1/supervisor/zone-configs` |
| كلمات المرور | Base64 في المتصفح (ضعيف) | Fernet `enc:v1:` على الخادم |
| إعدادات الإدارة | cache محلي + PostgreSQL | PostgreSQL فقط (`system_settings`) |
| حالة الجاهزية الإنتاجية | ~92% | **100%** لبيانات التكوين |

---

## 2. الجدول الجديد: `monitoring_zone_configs`

| العمود | النوع | الغرض |
|--------|-------|--------|
| `id` | PK | |
| `tenant_id` | FK → `tenants.id` | عزل المستأجر |
| `branch_id` | Integer (0 = افتراضي tenant-wide) | نطاق المشرف/الفرع |
| `zone_id` | String(32) | `kitchen` · `storage` · `prep` |
| `camera_name` | String(255) | اسم العرض |
| `connection_type` | String(32) | `ip_camera` · `rtsp_url` |
| `ip_address`, `port`, `username` | | حقول كاميرا IP |
| `password_encrypted` | Text | كلمة مرور مشفّرة (Fernet) |
| `stream_path` | String(255) | مسار RTSP |
| `rtsp_url_encrypted` | Text | رابط RTSP كامل (نوع rtsp_url) |
| `stream_url` | Text | الرابط الفعّال المشفّر للاستهلاك الخلفي |
| `linked_camera_id` | FK → `cameras.id` | ربط اختياري بجدول الكاميرات |
| `last_connection_test_at` | DateTime | آخر اختبار اتصال |
| `last_connection_test_ok` | Boolean | نتيجة الاختبار |
| `created_at`, `updated_at` | DateTime | |
| `updated_by_id` | FK → `users.id` | |

**قيد فريد:** `UNIQUE(tenant_id, branch_id, zone_id)`

**النموذج:** `backend/app/models/monitoring_zone_config.py`

---

## 3. مسارات API

| Method | المسار | الوصف |
|--------|--------|--------|
| `GET` | `/api/v1/supervisor/zone-configs` | قائمة المناطق الثلاث (مدمجة مع الافتراضيات) |
| `PUT` | `/api/v1/supervisor/zone-configs/{zone_id}` | إنشاء/تحديث منطقة |
| `PATCH` | `/api/v1/supervisor/zone-configs/{zone_id}/connection-test` | حفظ نتيجة اختبار الاتصال |
| `POST` | `/api/v1/supervisor/zone-configs/import-legacy` | استيراد لمرة واحدة من شكل localStorage |

**الصلاحيات:** `supervisor` · `admin` (نفس حارس `/supervisor/cameras`)

**الاستجابة:** لا تُعاد كلمات المرور أبداً — حقل `has_password: boolean` فقط.

---

## 4. تغييرات الواجهة (Frontend)

| الملف | التغيير |
|-------|---------|
| `frontend/src/services/monitoringZoneApi.js` | عميل API جديد |
| `frontend/src/lib/restaurantCameraStorage.js` | إزالة `load/persist` — إبقاء أدوات RTSP والتحقق |
| `frontend/src/pages/Dashboard.jsx` | تحميل/حفظ/اختبار عبر API؛ هجرة تلقائية من localStorage |
| إعدادات الإدارة | إزالة `ska_admin_settings` من localStorage |

### تدفق الهجرة التلقائية (مرة واحدة)

```
1. المستخدم يفتح لوحة المشرف (مصادق)
2. إن وُجد ska_restaurant_camera_configs_v1 في localStorage
   → POST /zone-configs/import-legacy
   → حذف المفتاح من localStorage
3. GET /zone-configs → تحديث حالة React
```

---

## 5. تعيين الحقول (localStorage → PostgreSQL)

| localStorage (camelCase) | PostgreSQL |
|--------------------------|------------|
| `cameraName` | `camera_name` |
| `ipAddress` | `ip_address` |
| `port` | `port` |
| `username` | `username` |
| `passwordEnc` (base64) | `password_encrypted` (Fernet عند الاستيراد) |
| `streamPath` | `stream_path` |
| `connectionType` | `connection_type` |
| `rtspUrl` | `rtsp_url_encrypted` + `stream_url` |
| `savedAt` | `updated_at` |
| `lastConnectionTestAt` | `last_connection_test_at` |
| `lastConnectionTestOk` | `last_connection_test_ok` |

---

## 6. ما يبقى خارج PostgreSQL (مقصود)

| الموقع | الغرض | حرج؟ |
|--------|--------|------|
| `localStorage` JWT (`ska_access_token`) | جلسة المصادقة | ✅ مقبول |
| `backend/media/dishes/` | ملفات صور الأطباق | metadata في PG |
| `ml/models/*.pt` | أوزان YOLO | ليس بيانات أعمال |
| تصدير Excel/PDF | مؤقت عند الطلب | من PG |

**لا يوجد** بعد هذه الهجرة أي `localStorage` يخزّن بيانات تكوين إنتاجية (فروع، كاميرات، مناطق، مراقبة، إعدادات).

---

## 7. التحقق بعد النشر

- [ ] `GET /api/v1/supervisor/zone-configs` يعيد 3 مناطق لكل مستأجر/فرع
- [ ] حفظ منطقة من الواجهة يُحدّث الصف في PostgreSQL
- [ ] `localStorage.getItem('ska_restaurant_camera_configs_v1')` → `null` بعد أول زيارة
- [ ] `localStorage.getItem('ska_admin_settings')` → غير مستخدم
- [ ] Render: جدول `monitoring_zone_configs` موجود (`create_all` عند startup)

---

## 8. المراجع

- `DATABASE_ARCHITECTURE_AR.md` — المعمارية المحدّثة (13 جدولاً)
- `CAMERA_SECURITY_AR.md` — تقييم أمان RTSP
- `backend/app/api/routes/monitoring_zone_configs.py`
- `backend/app/services/monitoring_zone_service.py`
