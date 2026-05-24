# دليل الأمان — منصة عين الجودة

> دليل أمني شامل لمنصة **عين الجودة** (Ayn Al-Jawdah Quality Platform): الضوابط المُطبَّقة، التوصيات، إجراءات الاستجابة للحوادث، وقوائم التحقّق.
>
> **الإصدار:** 1.0 · **الجمهور:** مهندسو الأمان / DevSecOps · **التصنيف:** للاستخدام الداخلي

---

## جدول المحتويات

1. [نموذج التهديد](#1-نموذج-التهديد)
2. [المصادقة والتفويض](#2-المصادقة-والتفويض)
3. [حماية API](#3-حماية-api)
4. [حماية البيانات أثناء النقل](#4-حماية-البيانات-أثناء-النقل)
5. [حماية البيانات أثناء السكون](#5-حماية-البيانات-أثناء-السكون)
6. [حماية رفع الملفات](#6-حماية-رفع-الملفات)
7. [حماية بيانات الكاميرا (RTSP)](#7-حماية-بيانات-الكاميرا-rtsp)
8. [إدارة الأسرار](#8-إدارة-الأسرار)
9. [التسجيل والتدقيق](#9-التسجيل-والتدقيق)
10. [Rate Limiting](#10-rate-limiting)
11. [أمان قاعدة البيانات](#11-أمان-قاعدة-البيانات)
12. [الاستجابة للحوادث](#12-الاستجابة-للحوادث)
13. [قوائم التحقّق الأمني](#13-قوائم-التحقّق-الأمني)
14. [مخاطر متبقّية](#14-مخاطر-متبقّية)
15. [توصيات للتحسين المستقبلي](#15-توصيات-للتحسين-المستقبلي)

---

## 1. نموذج التهديد

### الأصول المحميّة

| الأصل | المستوى | الأثر عند التسرّب |
|-------|---------|-------------------|
| بيانات اعتماد المستخدمين (passwords) | حرج | اختراق حسابات + تسرّب بيانات |
| رموز JWT النشطة | عالي | انتحال شخصية مؤقّت |
| `SECRET_KEY` (JWT signing) | حرج | تزوير رموز لكل المستخدمين |
| بيانات اعتماد كاميرات RTSP | عالي | الوصول للبث المباشر للمطبخ |
| مفاتيح API (Gemini, OpenAI) | متوسط-عالي | استنزاف الحصة + تكلفة مالية |
| `DATABASE_URL` | حرج | تسرّب جميع بيانات المنشأة |
| صور الأطباق والمخالفات | متوسط | كشف هوية موظفين / عمليات داخلية |

### وسطاء التهديد المحتملون

| الوسيط | الدافع |
|--------|--------|
| موظف خبيث (Insider) | سرقة بيانات / تخريب |
| مهاجم خارجي عبر الإنترنت | اختراق + فدية |
| منافس تجاري | تجسس صناعي |
| باحث أمن (Bug Bounty) | إيجابي — يساعد على التحسين |

### السطوح المعرّضة

- **API الإنتاج** على Render (نطاق عام).
- **Frontend الإنتاج** (نطاق عام).
- **PostgreSQL** (داخلي على Render).
- **Persistent Disk** (داخلي).
- **GitHub repository** (خاص أو عام حسب الإعداد).
- **Gemini/OpenAI API keys** (خارجية).

---

## 2. المصادقة والتفويض

### JWT Authentication

#### الإعدادات الحالية

| العنصر | القيمة | المرجع |
|--------|--------|--------|
| الخوارزمية | HS256 | `settings.ALGORITHM` |
| مدة الرمز | 60 دقيقة (افتراضي) | `ACCESS_TOKEN_EXPIRE_MINUTES` |
| المفتاح | `SECRET_KEY` env | يجب ≥32 حرف في الإنتاج |
| التحقّق | التوقيع + الانتهاء | `app/services/auth_service.py` |
| التخزين (العميل) | `localStorage` | `frontend/src/constants.js` |

#### القواعد المُطبَّقة

✅ التحقّق من التوقيع (`verify_signature=True`)
✅ التحقّق من انتهاء الصلاحية (`verify_exp=True`)
✅ إلزام وجود `exp` claim (`require_exp=True`)
✅ ربط `sub` بالبريد الإلكتروني للمستخدم
✅ رفض الرموز المُعدَّلة → 401

#### التحقّق من قوة `SECRET_KEY`

```python
# app/core/config.py → validate_settings_for_startup()
if settings.is_production:
    if len(settings.SECRET_KEY) < 32:
        raise ValueError("SECRET_KEY must be ≥32 chars in production")
    if settings.SECRET_KEY in {"change-me", "secret", "..."}:
        raise ValueError("Default SECRET_KEY rejected")
```

### كلمات المرور

- **التشفير:** bcrypt مع salt تلقائي (`passlib`).
- **الحدّ الأدنى للطول:** 8 أحرف (مفروض من Frontend).
- **عدم التخزين بنص صريح:** التزام بـ `password` كـ hash فقط.

### التفويض القائم على الأدوار (RBAC)

`app/api/deps/rbac.py`:

```python
def require_roles(*allowed_roles: str):
    def _check(current_user = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(403, "Forbidden")
        return current_user
    return _check
```

#### الاستخدام على المسارات الحسّاسة

```python
@router.get("/users", dependencies=[Depends(require_roles("admin"))])
def list_users(...):
    ...
```

### عزل البيانات (Tenant Isolation)

كل query مقيّد بـ `tenant_id` للمستخدم الحالي:

```python
db.query(DishRecord).filter(
    DishRecord.tenant_id == current_user.tenant_id
)
```

> **حرج:** أي endpoint جديد يجب أن يطبّق هذا المرشّح. مراجعة الكود الإلزامية.

---

## 3. حماية API

### CORS

```python
# app/main.py → _cors_allow_origins()
if settings.is_production:
    configured = parse(CORS_ALLOW_ORIGINS)
    merged = configured + _PROD_FRONTEND_ALLOWLIST
    return merged
```

- **في الإنتاج:** قائمة بيضاء صارمة.
- **fallback:** `https://taeen-quality-frontend.onrender.com` (دائمًا).
- **تحذير في السجل** إذا `CORS_ALLOW_ORIGINS` غير معيّن.

### TrustedHostMiddleware

```python
if settings.ALLOWED_HOSTS:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=settings.ALLOWED_HOSTS.split(","),
    )
```

> اختياري — يفعَّل خلف reverse proxy لمنع Host header injection.

### Security Headers

`app/middleware/security_headers.py`:

| الـ Header | القيمة |
|-----------|--------|
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `no-referrer-when-downgrade` |
| `Permissions-Policy` | يحدّ من APIs خطيرة |
| `Strict-Transport-Security` | (اختياري عبر `ENABLE_HSTS=true`) |

### إخفاء OpenAPI في الإنتاج

```python
if settings.is_production:
    docs_url = redoc_url = openapi_url = None
```

→ `/docs`, `/redoc`, `/openapi.json` كلها 404 في الإنتاج.

### معالج الأخطاء

```python
@app.exception_handler(SQLAlchemyError)
@app.exception_handler(RequestValidationError)
@app.exception_handler(Exception)
async def safe_handler(...):
    if settings.is_production:
        return JSONResponse({"detail": "حدث خطأ غير متوقّع"}, 500)
    return ... # full traceback in dev
```

→ **لا يُكشف stack trace** للمستخدم في الإنتاج.

---

## 4. حماية البيانات أثناء النقل

### TLS / HTTPS

- **Render:** TLS تلقائي عبر Let's Encrypt (يُجدَّد تلقائيًا).
- **Self-hosted:** يجب إعداد TLS عبر nginx/Caddy + Let's Encrypt.
- **HSTS:** فعِّل `ENABLE_HSTS=true` فقط بعد التأكّد من HTTPS كامل (يصعب التراجع).

### إعدادات TLS الموصى بها (nginx)

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:...;
ssl_prefer_server_ciphers on;
ssl_session_cache shared:SSL:10m;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
```

### Cookies (مستقبلًا — عند الانتقال من localStorage)

```python
response.set_cookie(
    key="access_token",
    value=token,
    httponly=True,        # لا JS access
    secure=True,          # HTTPS only
    samesite="strict",    # CSRF protection
    max_age=3600,
)
```

---

## 5. حماية البيانات أثناء السكون

### قاعدة البيانات

- **PostgreSQL على Render:** التشفير on disk تلقائي (AES-256 على مستوى البنية التحتية).
- **Self-hosted:** فعِّل PostgreSQL TDE أو full-disk encryption.

### كلمات المرور

- ✅ مُشفَّرة بـ bcrypt (cost factor افتراضي).
- ✅ غير قابلة للقراءة من الـ DB مباشرة.

### مفاتيح API

- ❌ مخزّنة كنص صريح في `Settings` env.
- **توصية:** الانتقال إلى Vault أو AWS Secrets Manager للمشاريع الحرجة.

### بيانات اعتماد RTSP

- ⚠️ مخزّنة كنص صريح في `cameras.stream_url`.
- ✅ مموَّهة في API responses.
- **توصية حرجة:** تشفير at rest عبر field-level encryption أو استبدال بـ reference إلى secret manager.

### صور الأطباق والمخالفات

- ❌ غير مشفّرة على القرص الدائم.
- **توصية:** خادم ملفات منفصل + تشفير القرص (LUKS/encrypted volume).

---

## 6. حماية رفع الملفات

### حدود الحجم

| Endpoint | الحدّ الأقصى |
|----------|--------------|
| `POST /detect-dish` | 12 MB |
| `POST /dishes/detect` | 12 MB |
| `POST /monitoring/analyze-frame` | 8 MB (`MONITORING_UPLOAD_MAX_BYTES`) |

### التحقّق من النوع

```python
# app/services/dish_image_storage.py
if not content_type.startswith("image/"):
    raise HTTPException(400, "نوع غير مدعوم")
```

### التحقّق من المحتوى الفعلي

```python
from PIL import Image
img = Image.open(io.BytesIO(file_bytes))
img.verify()   # يطلق exception إذا ليس صورة فعلية
```

→ يمنع رفع ملفات ضارّة بامتداد صورة (Polyglot attacks).

### Magic bytes

- يتمّ التحقّق من توافق `Content-Type` مع المحتوى الفعلي (header bytes).

### اسم الملف الآمن

```python
SAFE_FILENAME_RE = re.compile(r"^[a-zA-Z0-9._-]+$")
```

→ يمنع directory traversal (`../`) وحقن المسار.

### تخزين بـ UUID

```python
filename = f"{uuid.uuid4().hex}.{ext}"
```

→ لا اسم أصلي مكشوف، لا تخمين.

---

## 7. حماية بيانات الكاميرا (RTSP)

### التحقّق من الكتابة

`app/security/stream_url.py → validate_camera_stream_url()`:

```python
def validate_camera_stream_url(url: str) -> str:
    if any(c in url for c in "\n\r\t\0"):
        raise ValueError("Control chars not allowed")
    if ".." in url:
        raise ValueError("Path traversal blocked")
    if len(url) > 500:
        raise ValueError("URL too long")
    if not url.startswith("rtsp://"):
        raise ValueError("Only RTSP supported")
    # تحقّق من شكل المضيف والمنفذ
    ...
```

### الإخفاء في الردود

```python
# app/schemas/camera.py
@field_serializer("stream_url")
def serialize_stream_url(self, v: str | None):
    return redact_rtsp_credentials(v)
    # rtsp://admin:Pass@10.0.0.1:554/s1
    # → rtsp://***:***@10.0.0.1:554/s1
```

→ المُشرف الفرعي يستطيع رؤية وجود الكاميرا والمضيف، لكن **ليس** بيانات الاعتماد.

### القراءة (للتشغيل الفعلي)

- يحدث في الخادم فقط.
- لا تُكشف بيانات الاعتماد للعميل أبدًا.

---

## 8. إدارة الأسرار

### الممارسات الحالية

✅ ملف `.env` مُستثنى من Git (`.gitignore`).
✅ `.env.example` placeholder فقط، بدون قيم حقيقية.
✅ متغيّرات البيئة تُعيَّن في Render Dashboard (مشفّرة on disk).
✅ لا أسرار في الكود المصدري (تحقّق ESLint + Grep).

### أوامر التحقّق

```bash
# لا يجب أن يطابق أي شيء حقيقي:
grep -rE "AIza[A-Za-z0-9_-]{35}|sk-[A-Za-z0-9]{40,}" \
  --include="*.py" --include="*.js" --include="*.jsx" \
  ska-system/

# لا يجب أن تكون .env mtnsoupcked:
git ls-files | grep -E "\.env$|\.env\."
```

### تدوير الأسرار

| السر | معدّل التدوير الموصى |
|------|-----------------------|
| `SECRET_KEY` | كل 6 أشهر (يخرج كل المستخدمين) |
| `GEMINI_API_KEY` | عند الشك في تسرّب |
| `DATABASE_URL` (password) | كل 12 شهرًا |
| `SEED_ADMIN_PASSWORD` | بعد أول دخول |
| كلمات مرور المشرفين | كل 90 يومًا |

### بعد تدوير `SECRET_KEY`

```bash
# 1. غيّره في Render Environment
# 2. أعد نشر Backend
# 3. كل JWT النشطة تصبح غير صالحة → كل المستخدمون يسجّلون دخولًا جديدًا
```

---

## 9. التسجيل والتدقيق

### السجلات المُكتَنَزة

#### عند الدخول الناجح

```python
logger.info(f"login_success user_id={user.id} role={user.role}")
```

→ لا email/password/JWT.

#### عند الفشل

```python
logger.warning("login_failed")
```

→ **لا** email للحدّ من account enumeration.

#### العمليات الحسّاسة (في DB)

| العملية | الحقل | الجدول |
|---------|-------|--------|
| مراجعة طبق | `reviewed_by_id`, `reviewed_at` | `dish_records` |
| إغلاق مخالفة | `resolved_by_id`, `resolved_at` | `monitoring_alerts` |
| إنشاء/تحديث مستخدم | `created_at` | `users` |

### السجلات على Render

- ادخل خدمة → **Logs** → ابحث بـ regex.
- الاحتفاظ: 7 أيام (Free) → 30 يومًا (Standard).

### السجلات الموصى بإضافتها مستقبلًا

- محاولات دخول متكرّرة من نفس IP (brute-force).
- تغييرات الأدوار (audit trail).
- حذف بيانات (lazy delete vs hard delete).

---

## 10. Rate Limiting

### SlowAPI Configuration

`app/core/limiter.py`:

```python
limiter = Limiter(key_func=get_remote_address)
```

### الحدود المُطبَّقة

| Endpoint | الحدّ |
|----------|------|
| `POST /auth/login` | 25/min per IP |
| `POST /auth/register` | 40/hour per IP |
| `POST /detect-dish` | 48/min per IP |
| `POST /dishes/detect` | 48/min per IP |
| `POST /monitoring/analyze-frame` | 72/min per IP |
| `GET /reports/quality-summary` | 120/min per IP |

### رد 429

```json
{
  "detail": "تم تجاوز عدد المحاولات المسموح، حاول لاحقًا"
}
```

→ بالعربية، بدون الكشف عن تفاصيل limiter.

### القيد الحالي

- **In-memory:** لا يصمد عبر workers متعدّدة.
- **التوصية:** Redis storage للـ multi-worker:
  ```python
  Limiter(
      key_func=get_remote_address,
      storage_uri="redis://redis:6379",
  )
  ```

---

## 11. أمان قاعدة البيانات

### حقن SQL (SQL Injection)

✅ كل الـ queries تستخدم SQLAlchemy ORM (parameterized).
✅ في `db/session.py` حيث يُستخدم `text()`، الإدخالات مربوطة (`:param`).
✅ لا concatenation للـ user input في SQL strings.

### الصلاحيات

```sql
-- مستخدم DB التطبيق يحتاج:
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ska_user;
-- لا يحتاج DROP, CREATE, GRANT.
```

### النسخ الاحتياطي

- يُمكّن الاستعادة في حالة الخطأ البشري أو الهجوم.
- راجع [`DEPLOYMENT_GUIDE_AR.md`](DEPLOYMENT_GUIDE_AR.md) → القسم 9.

### التشفير

- **At rest:** Render PostgreSQL مشفّر تلقائيًا (AES-256).
- **In transit:** Render يفرض TLS بين الخدمات.

---

## 12. الاستجابة للحوادث

### مستويات الحوادث

| المستوى | الوصف | وقت الاستجابة |
|---------|-------|---------------|
| **حرج** | اختراق فعلي / تسرّب بيانات | فوري |
| **عالي** | محاولات اختراق متكرّرة | خلال ساعة |
| **متوسط** | شذوذ في السلوك | خلال 24 ساعة |
| **منخفض** | تنبيه أمني عام | خلال أسبوع |

### إجراءات الطوارئ

#### اشتباه باختراق حساب مدير

1. **فورًا:** غيّر كلمة المرور.
2. **فورًا:** غيّر `SECRET_KEY` (يخرج كل الجلسات).
3. **خلال ساعة:** راجع سجلات Render للنشاط المشبوه.
4. **خلال 24 ساعة:** راجع تغييرات قاعدة البيانات (تعديلات على المستخدمين).
5. أبلغ الإدارة العليا.

#### اشتباه بتسرّب `SECRET_KEY`

1. **فورًا:** ولِّد مفتاحًا جديدًا: `openssl rand -hex 32`.
2. **فورًا:** عيّنه في Render Environment.
3. **خلال 5 دقائق:** أعد نشر Backend.
4. كل المستخدمين يفقدون جلساتهم — أبلغهم بإعادة الدخول.

#### اشتباه بتسرّب `GEMINI_API_KEY`

1. **فورًا:** ادخل Google AI Studio → احذف المفتاح.
2. **فورًا:** أنشئ مفتاحًا جديدًا.
3. **خلال 5 دقائق:** عيّنه في Render Environment + أعد النشر.
4. راجع Google Cloud Billing للنشاط الشاذّ.

#### اشتباه بتسرّب `DATABASE_URL`

1. **فورًا:** غيّر كلمة مرور DB من Render Dashboard.
2. **فورًا:** عيّن `DATABASE_URL` الجديد.
3. **خلال 24 ساعة:** افحص logs لـ DB لأي عمليات شاذّة.
4. **خلال 48 ساعة:** صدر تقرير تأثير + قرّر الإفصاح.

#### هجوم DDoS / brute-force

1. ارفع SlowAPI rate limits مؤقّتًا.
2. فعِّل Cloudflare أمام Render.
3. احظر IPs المشبوهة عبر firewall.

#### تسرّب بيانات اعتماد كاميرا

1. **فورًا:** غيّر كلمة مرور الكاميرا من واجهتها.
2. حدّث الرابط في المنصة.
3. راجع من يملك صلاحية مشاهدة الكاميرات.

### التواصل بعد الحادث

- إعلام **الإدارة التنفيذية** فورًا.
- إعلام **المستخدمين المتأثّرين** بشفافية.
- إعداد **تقرير ما بعد الحادث** (Post-mortem).
- تحديث **الإجراءات** لمنع التكرار.

---

## 13. قوائم التحقّق الأمني

### قبل أول نشر إنتاجي

- [ ] `ENVIRONMENT=production`
- [ ] `SECRET_KEY` ≥ 32 حرفًا عشوائيًا (`openssl rand -hex 32`)
- [ ] `DEV_AUTH_BYPASS=false`
- [ ] `SEED_DEV_ADMIN=false` (بعد إنشاء المدير)
- [ ] `SEED_ADMIN_PASSWORD` قويّ (≥ 16 حرف، رموز + أرقام + حروف)
- [ ] `CORS_ALLOW_ORIGINS` محدّد بدقة (لا wildcards)
- [ ] HTTPS مفعّل على Frontend و Backend
- [ ] PostgreSQL وليس SQLite
- [ ] Persistent Disk مرتبط
- [ ] متغيّرات البيئة في Render Dashboard (لا في الكود)
- [ ] `.env` غير tracked في Git
- [ ] لا صور خاصة في Git
- [ ] لا أسرار في الكود (`grep` تأكيد)

### مراجعة شهرية

- [ ] فحص محاولات الدخول الفاشلة (Render logs)
- [ ] مراجعة المستخدمين النشطين (لا حسابات نائمة بصلاحيات عالية)
- [ ] التأكّد من النسخ الاحتياطي يعمل
- [ ] مراجعة `pip list --outdated` و `npm outdated`
- [ ] فحص دليل Persistent Disk (لا ملفات مشبوهة)

### مراجعة ربع سنوية

- [ ] تدوير كلمات مرور المشرفين والمدير
- [ ] مراجعة شاملة لقواعد CORS و firewall
- [ ] اختبار الاستعادة من نسخة احتياطية
- [ ] فحص dependencies للثغرات المعروفة:
  ```bash
  pip-audit
  npm audit
  ```

### مراجعة سنوية

- [ ] تدوير `SECRET_KEY`
- [ ] تدوير `GEMINI_API_KEY` و `OPENAI_API_KEY`
- [ ] اختبار اختراق (Penetration testing) من جهة مستقلة
- [ ] مراجعة سياسات الأمان الداخلية
- [ ] تدريب الموظفين على إدارة كلمات المرور

---

## 14. مخاطر متبقّية

### معروفة ومُقبولة (مع توصيات للتحسين)

| المخاطرة | التأثير | التوصية |
|----------|---------|---------|
| JWT في `localStorage` | عرضة لـ XSS | الانتقال لـ HttpOnly cookies + refresh tokens |
| Rate limiting in-memory | لا يصمد عبر workers | Redis storage |
| RTSP credentials بنص صريح في DB | تسرّب على مستوى DB | field-level encryption |
| لا token refresh آلي | جلسة قصيرة (60 دقيقة) | إضافة `/auth/refresh` |
| لا 2FA | اختراق كلمة مرور = اختراق كامل | إضافة TOTP / SMS |
| لا CAPTCHA على login | brute-force ممكن (محدود بـ rate limit) | hCaptcha / reCAPTCHA |
| Logs لا تشفّر بـ TLS داخليًا | اعتراض داخلي على Render | استخدم provider يدعم encrypted logging |

### غير معالجة بعد

- ❌ لا audit log مفصّل للعمليات الإدارية.
- ❌ لا تنبيهات أمنية تلقائية (محاولات دخول متعدّدة، تغيير صلاحيات).
- ❌ لا غسيل تلقائي لبيانات المستخدمين المحذوفين (GDPR).
- ❌ لا web application firewall (WAF) أمام API.

---

## 15. توصيات للتحسين المستقبلي

### قصير المدى (≤ 3 أشهر)

1. **Refresh tokens** + HttpOnly cookies → استبدال `localStorage`.
2. **CAPTCHA** على `/auth/login` و `/auth/register`.
3. **استرجاع كلمة مرور** عبر email بـ token قصير العمر.
4. **Audit log** كامل للعمليات الإدارية → جدول `audit_logs`.
5. **Redis** للـ rate limiting و cache.

### متوسط المدى (3-12 شهرًا)

6. **2FA** عبر TOTP (Google Authenticator).
7. **WAF** عبر Cloudflare أمام Render.
8. **Field-level encryption** لـ `cameras.stream_url`.
9. **Alembic** للـ migrations الرسمية.
10. **Centralized logging** (Datadog / Grafana Loki).

### طويل المدى (12+ شهرًا)

11. **Penetration testing** سنوي من جهة مستقلة.
12. **Bug bounty program** للباحثين الأمنيين.
13. **SOC 2 / ISO 27001** للعملاء المؤسسيين.
14. **End-to-end encryption** لبيانات الفيديو الحسّاسة.
15. **Zero Trust architecture** للوصول الإداري.

---

## مراجع

| الموضوع | المرجع |
|---------|--------|
| تقرير الأمان التفصيلي | [`../SECURITY_REPORT.md`](../SECURITY_REPORT.md) |
| ملاحظات نشر الأمان | [`SECURITY_DEPLOYMENT_NOTES.md`](SECURITY_DEPLOYMENT_NOTES.md) |
| دليل النشر | [`DEPLOYMENT_GUIDE_AR.md`](DEPLOYMENT_GUIDE_AR.md) |
| المتطلبات التقنية | [`TECHNICAL_REQUIREMENTS_AR.md`](TECHNICAL_REQUIREMENTS_AR.md) |
| OWASP Top 10 | https://owasp.org/Top10/ |
| FastAPI Security | https://fastapi.tiangolo.com/tutorial/security/ |
| Render Security | https://render.com/docs/security |

---

## ملاحظة ختامية

> **هذا المستند يصف الضوابط الأمنية الحالية ولا يضمن الأمان المطلق (100%).**
> الأمان عملية مستمرّة تتطلّب:
> - مراقبة دائمة
> - تحديثات منتظمة
> - تدريب المستخدمين
> - اختبارات دورية
> - استجابة سريعة للتهديدات الجديدة
>
> أي تساؤل أمني → تواصل مع فريق DevSecOps فورًا.

---

*منصة عين الجودة — Ayn Al-Jawdah Quality Platform · دليل الأمان · للاستخدام الداخلي · آخر تحديث: 2026-05-24*
