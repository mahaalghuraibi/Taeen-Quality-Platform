# دليل النشر — منصة عين الجودة

> دليل تفصيلي لنشر منصة **عين الجودة** (Ayn Al-Jawdah Quality Platform) في بيئة الإنتاج، مع خطوات التحديث والاستعادة.
>
> **الإصدار:** 1.0 · **الجمهور:** مهندسو DevOps · **منصّة الإنتاج المعتمدة:** Render

---

## جدول المحتويات

1. [خيارات النشر](#1-خيارات-النشر)
2. [النشر على Render (موصى به)](#2-النشر-على-render-موصى-به)
3. [النشر بـ Docker](#3-النشر-بـ-docker)
4. [إعداد قاعدة البيانات](#4-إعداد-قاعدة-البيانات)
5. [إعداد الذكاء الاصطناعي](#5-إعداد-الذكاء-الاصطناعي)
6. [إعداد Persistent Disk للصور والأوزان](#6-إعداد-persistent-disk-للصور-والأوزان)
7. [تحديث الإنتاج](#7-تحديث-الإنتاج)
8. [الإرجاع لإصدار سابق (Rollback)](#8-الإرجاع-لإصدار-سابق-rollback)
9. [النسخ الاحتياطي والاستعادة](#9-النسخ-الاحتياطي-والاستعادة)
10. [الترقية لخادم مخصّص (Self-Hosted)](#10-الترقية-لخادم-مخصّص-self-hosted)
11. [قائمة تحقّق ما قبل النشر](#11-قائمة-تحقّق-ما-قبل-النشر)
12. [استكشاف أخطاء النشر](#12-استكشاف-أخطاء-النشر)

---

## 1. خيارات النشر

| الخيار | الجمهور | المميّزات | العيوب |
|--------|---------|-----------|---------|
| **Render Blueprint** | مشاريع تجارية صغيرة-متوسطة | نشر تلقائي · مجاني للبداية · بسيط | تنام الخدمة المجانية بعد 15 دقيقة |
| **Docker على VPS** | مشاريع متوسطة-كبيرة | تحكّم كامل · أرخص للحجم العالي | يتطلّب صيانة DevOps |
| **Kubernetes** | مؤسسات كبيرة | قابلية توسّع · موثوقية عالية | تعقيد عالٍ · تكلفة |
| **AWS/GCP/Azure** | متعدّد المناطق | بنية تحتية ناضجة | تكلفة + تعقيد |

> هذا الدليل يركّز على **Render** (الخيار الأساسي للمشروع) و **Docker** (للنشر المحلي/الذاتي).

---

## 2. النشر على Render (موصى به)

### المتطلبات المسبقة

- ✅ حساب Render مع خطة (Free / Starter / Standard).
- ✅ مستودع GitHub بصلاحية ربط لـ Render.
- ✅ ملف `render.yaml` في جذر المستودع (موجود مسبقًا).
- ✅ مفتاح Gemini API من https://aistudio.google.com/apikey.

### خطوة 1: ربط المستودع

1. ادخل https://dashboard.render.com.
2. اضغط **New** → **Blueprint**.
3. اختر مستودع **`Taeen-Quality-Platform`** (أو الاسم الحالي).
4. Render يقرأ `render.yaml` تلقائيًا ويعرض خدمتين:
   - `taeen-backend` (Python web service)
   - `taeen-quality-frontend` (Static site)
5. اضغط **Apply** لإنشاء الخدمات.

### خطوة 2: إنشاء قاعدة البيانات

1. في Render Dashboard → **New** → **PostgreSQL**.
2. الإعدادات:
   - **Name:** `ska-postgres`
   - **Database:** `ska_db`
   - **User:** `ska_user`
   - **Region:** نفس منطقة الـ web service
   - **Plan:** Starter ($7/شهر) أو أعلى
3. بعد الإنشاء انسخ **Internal Database URL** (يبدأ بـ `postgresql://…`).

### خطوة 3: إعداد متغيّرات البيئة (Backend)

ادخل خدمة `taeen-backend` → **Environment** → أضف:

```env
ENVIRONMENT=production
SECRET_KEY=<openssl rand -hex 32>
DATABASE_URL=<من PostgreSQL>
CORS_ALLOW_ORIGINS=https://taeen-quality-frontend.onrender.com
GEMINI_API_KEY=<من Google AI Studio>
SEED_ADMIN_EMAIL=admin@yourcompany.com
SEED_ADMIN_PASSWORD=<كلمة قوية>
DISH_MEDIA_DIR=/var/data/ska/media/dishes
YOLO_AUTO_DOWNLOAD=true
YOLO_ENABLED=true
YOLO_MAX_EDGE=640
PRODUCTION_AI_MODE=false
ACCESS_TOKEN_EXPIRE_MINUTES=60
```

### متغيّرات اختيارية (للذكاء الاصطناعي المتقدّم)

```env
DISH_GEMINI_API_KEY=<مفتاح مخصّص للأطباق>
MONITORING_GEMINI_API_KEY=<مفتاح مخصّص للمراقبة>
OPENAI_API_KEY=<اختياري>
ROBOFLOW_API_KEY=<اختياري>
ALLOWED_HOSTS=taeen-quality-platform.onrender.com
ENABLE_HSTS=true
```

### خطوة 4: إعداد متغيّرات Frontend

ادخل `taeen-quality-frontend` → **Environment**:

```env
VITE_API_BASE_URL=https://taeen-quality-platform.onrender.com
NODE_VERSION=20
```

> يُضمَّن `VITE_API_BASE_URL` وقت البناء — أي تغيير يتطلّب إعادة بناء.

### خطوة 5: إضافة Persistent Disk

ادخل `taeen-backend` → **Disks** → **Add Disk**:

- **Name:** `ska-data`
- **Mount Path:** `/var/data/ska`
- **Size:** 1 GB (للبداية، يمكن التوسعة لاحقًا)

### خطوة 6: إنشاء المدير الأول

`render.yaml` يحتوي على:

```yaml
preDeployCommand: python scripts/create_admin.py
```

سيُنفَّذ تلقائيًا قبل كل نشر، ويستخدم `SEED_ADMIN_EMAIL` و `SEED_ADMIN_PASSWORD` لإنشاء/تحديث المدير.

### خطوة 7: التحقّق بعد النشر

```bash
# Backend health
curl https://taeen-quality-platform.onrender.com/health
# يجب: {"status":"ok"}

# Frontend
curl -I https://taeen-quality-frontend.onrender.com/
# يجب: HTTP/2 200

# AI Status (يحتاج JWT)
TOKEN=$(curl -s -X POST https://taeen-quality-platform.onrender.com/api/v1/auth/login \
  -d "username=admin@yourcompany.com&password=<كلمة المرور>" \
  -H "Content-Type: application/x-www-form-urlencoded" | jq -r '.access_token')

curl -H "Authorization: Bearer $TOKEN" \
  https://taeen-quality-platform.onrender.com/api/v1/ai/status
```

### النشر التلقائي

`render.yaml` يحتوي:

```yaml
autoDeploy: true
```

بمجرّد `git push origin main` → Render يبني وينشر الخدمتين تلقائيًا (~3-5 دقائق).

---

## 3. النشر بـ Docker

### Backend

```bash
# بناء
docker build -f backend/Dockerfile -t ska-backend:latest .

# تشغيل
docker run -d --name ska-backend \
  -p 8000:8000 \
  --env-file backend/.env \
  -v ska-media:/app/media \
  -v ska-models:/app/ml/models \
  ska-backend:latest
```

### Frontend

```bash
# بناء (مع تضمين عنوان API)
docker build -f frontend/Dockerfile \
  --build-arg VITE_API_BASE_URL=https://api.example.com \
  -t ska-frontend:latest .

# تشغيل
docker run -d --name ska-frontend \
  -p 3000:3000 \
  ska-frontend:latest
```

### Docker Compose (مثال للنشر الذاتي)

أنشئ `docker-compose.prod.yml`:

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: ska_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ska_db
    volumes:
      - pg-data:/var/lib/postgresql/data
    restart: always

  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    environment:
      DATABASE_URL: postgresql://ska_user:${DB_PASSWORD}@postgres:5432/ska_db
      ENVIRONMENT: production
      SECRET_KEY: ${SECRET_KEY}
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      CORS_ALLOW_ORIGINS: ${FRONTEND_URL}
      SEED_ADMIN_EMAIL: ${ADMIN_EMAIL}
      SEED_ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      DISH_MEDIA_DIR: /app/media/dishes
    volumes:
      - ska-media:/app/media
      - ska-models:/app/ml/models
    depends_on:
      - postgres
    restart: always
    ports:
      - "8000:8000"

  frontend:
    build:
      context: .
      dockerfile: frontend/Dockerfile
      args:
        VITE_API_BASE_URL: ${API_URL}
    restart: always
    ports:
      - "3000:3000"

volumes:
  pg-data:
  ska-media:
  ska-models:
```

تشغيل:

```bash
docker-compose -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.prod.yml exec backend python scripts/create_admin.py
```

> يُوصى بإضافة Nginx/Caddy أمام الخدمتين لإنهاء TLS.

---

## 4. إعداد قاعدة البيانات

### PostgreSQL على Render

```sql
-- يتمّ تلقائيًا — Render ينشئ DB والمستخدم.
-- التحقّق من الاتصال:
psql $DATABASE_URL -c "SELECT version();"
```

### PostgreSQL على VPS

```bash
# تثبيت
sudo apt install postgresql postgresql-contrib

# إنشاء مستخدم وقاعدة
sudo -u postgres psql <<EOF
CREATE DATABASE ska_db;
CREATE USER ska_user WITH ENCRYPTED PASSWORD 'STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE ska_db TO ska_user;
ALTER DATABASE ska_db OWNER TO ska_user;
EOF
```

ثم:

```env
DATABASE_URL=postgresql://ska_user:STRONG_PASSWORD@127.0.0.1:5432/ska_db
```

### تهيئة الجداول (تلقائي)

عند أول تشغيل لـ Backend:

```python
# app/main.py → lifespan
init_db()  # يستدعي Base.metadata.create_all
```

ينشئ جميع الجداول السبعة تلقائيًا. لا حاجة لـ migrations يدوية للنشر الأول.

### الترقية اللاحقة (إن أُضيفت أعمدة)

`db/session.py` يحتوي على دوال `_ensure_*_columns` لإضافة أعمدة جديدة بأمان (SQLite + بعض PostgreSQL). للحالات المعقّدة استخدم Alembic.

---

## 5. إعداد الذكاء الاصطناعي

### Gemini Vision (الأساسي)

1. أنشئ مفتاحًا: https://aistudio.google.com/apikey
2. أضفه لـ Render Environment:
   ```env
   GEMINI_API_KEY=AIzaSy...
   ```
3. (اختياري) مفاتيح منفصلة:
   ```env
   DISH_GEMINI_API_KEY=AIzaSy...
   MONITORING_GEMINI_API_KEY=AIzaSy...
   ```

### YOLO PPE (تحميل تلقائي)

`render.yaml` يحتوي:

```yaml
- key: YOLO_AUTO_DOWNLOAD
  value: "true"
```

عند أول طلب `analyze-frame` يتمّ تنزيل `hansung_ppe.pt` (~6 MB) تلقائيًا من HuggingFace إلى `backend/ml/models/`.

### YOLO يدوي (للأداء الأفضل)

ارفع الأوزان للقرص الدائم:

```bash
# على Render Shell:
cd /var/data/ska
mkdir -p ml/models
# ارفع الملف يدويًا أو:
curl -L -o ml/models/keremberk_ppe.pt \
  https://huggingface.co/<repo>/resolve/main/keremberk_ppe.pt
```

ثم:

```env
YOLO_MODEL_PATH=/var/data/ska/ml/models/keremberk_ppe.pt
```

### OpenAI Vision (اختياري — أولوية عليا)

```env
OPENAI_API_KEY=sk-...
OPENAI_VISION_MODEL=gpt-4o-mini
```

> لا تضفه إن كنت تستخدم Gemini فقط — يضيف تكلفة بدون فائدة كبيرة.

### Custom ResNet18 (اختياري)

ارفع الأوزان وعيِّن:

```env
SKA_CUSTOM_FOOD_MODEL_PATH=/var/data/ska/ml/models/custom_food.pt
SKA_CUSTOM_FOOD_LABEL_MAP_PATH=/var/data/ska/ml/models/label_map.json
```

تفاصيل التدريب: `backend/ml/custom_food/README.md`.

---

## 6. إعداد Persistent Disk للصور والأوزان

### لماذا؟

- **بدون قرص دائم:** كل صور الأطباق وأوزان YOLO تُمسح عند كل إعادة نشر.
- **مع قرص دائم:** البيانات تبقى عبر إعادات النشر والتشغيل.

### على Render

1. خدمة Backend → **Disks** → **Add Disk**.
2. الإعدادات:
   - **Name:** `ska-data`
   - **Mount Path:** `/var/data/ska`
   - **Size:** 1 GB (مبدئيًا)

3. عيِّن متغيّرات البيئة:
   ```env
   DISH_MEDIA_DIR=/var/data/ska/media/dishes
   ```

4. أنشئ المجلدات (مرة واحدة عبر Render Shell):
   ```bash
   mkdir -p /var/data/ska/media/dishes
   mkdir -p /var/data/ska/ml/models
   chmod 755 /var/data/ska/media /var/data/ska/ml
   ```

### على Docker Compose

```yaml
volumes:
  - ska-media:/app/media
  - ska-models:/app/ml/models
```

### تقدير الحجم المطلوب

| الفترة | الصور | الأوزان | الإجمالي |
|--------|-------|---------|----------|
| 6 أشهر | 200-500 MB | 60 MB | ~600 MB |
| سنة | 500 MB - 1 GB | 60 MB | ~1 GB |
| سنتان | 1-2 GB | 60 MB | ~2 GB |

> **توصية:** ابدأ بـ 1 GB، راقب الاستخدام، وسِّع كلّ 6 أشهر.

---

## 7. تحديث الإنتاج

### الطريقة العادية (Auto-Deploy)

```bash
# 1. اعمل التغييرات محليًا
git checkout main
git pull origin main

# 2. اختبر محليًا
cd frontend && npm run build
cd ../backend && python -m ruff check app

# 3. ارفع
git add .
git commit -m "feat: <description>"
git push origin main

# 4. Render يبدأ النشر تلقائيًا
# راقب Logs في Dashboard
```

### وقت النشر المتوقّع

| الخدمة | الزمن |
|--------|-------|
| Backend | 3-5 دقائق |
| Frontend | 1-2 دقيقة |
| Cold start (أول طلب) | 30-60 ثانية |

### النشر اليدوي (Manual Deploy)

من Render Dashboard → الخدمة → **Manual Deploy** → **Deploy latest commit**.

### اختبار Smoke Tests بعد النشر

```bash
# 1. Health
curl https://taeen-quality-platform.onrender.com/health

# 2. Login
curl -X POST https://taeen-quality-platform.onrender.com/api/v1/auth/login \
  -d "username=admin@example.com&password=xxx"

# 3. Frontend
curl -I https://taeen-quality-frontend.onrender.com/
```

### Pull Request Previews

`render.yaml` يحتوي:

```yaml
pullRequestPreviewsEnabled: true
```

كل PR يحصل على **رابط معاينة** (Frontend) قبل دمج التغييرات.

---

## 8. الإرجاع لإصدار سابق (Rollback)

### عبر Render Dashboard

1. ادخل الخدمة → **Deploys**.
2. اعثر على الإصدار السابق الناجح.
3. اضغط **⋯** → **Rollback to this deploy**.
4. الخدمة تعود لذلك الإصدار خلال دقائق.

### عبر Git (للحالات الحرجة)

```bash
# اعثر على آخر commit مستقر
git log --oneline -10

# ارجع إليه
git revert <bad-commit>
git push origin main

# Render يبني الإصدار الجديد تلقائيًا
```

> **تحذير:** `git reset --hard` على main يكسر تاريخ الفرع. استخدم `revert` دائمًا.

---

## 9. النسخ الاحتياطي والاستعادة

### قاعدة البيانات

#### نسخ احتياطي يدوي

```bash
# من أي جهاز فيه psql:
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M).sql

# أو compressed:
pg_dump $DATABASE_URL | gzip > backup_$(date +%Y%m%d).sql.gz
```

#### نسخ احتياطي مجدوَل (Render Cron Job)

أنشئ خدمة جديدة من النوع **Cron Job**:

```yaml
- type: cron
  name: ska-db-backup
  runtime: python
  schedule: "0 3 * * *"   # 3 صباحًا يوميًا
  buildCommand: pip install -r requirements.txt
  startCommand: python scripts/backup_db.py
  envVars:
    - key: DATABASE_URL
      fromDatabase:
        name: ska-postgres
        property: connectionString
```

> Render Free tier لا يدعم Cron Jobs — يلزم Starter ($7/شهر).

#### النسخ الاحتياطي التلقائي على Render

PostgreSQL على Render يحتوي:
- **Daily backups** (آخر 7 أيام، Starter+)
- **Point-in-time recovery** (Standard+)

#### استعادة

```bash
# من ملف SQL:
psql $DATABASE_URL < backup_20260524.sql

# من gzip:
gunzip -c backup_20260524.sql.gz | psql $DATABASE_URL
```

### صور الأطباق

```bash
# نسخ من Render Shell:
cd /var/data/ska
tar -czf /tmp/dishes_backup_$(date +%Y%m%d).tar.gz media/dishes/

# نزّل الملف لجهازك:
# Render → Shell → اضغط Download
```

### أوزان YOLO

```bash
tar -czf yolo_models_$(date +%Y%m%d).tar.gz \
  /var/data/ska/ml/models/*.pt
```

### قائمة ما يجب نسخه

| العنصر | التكرار الموصى | الأهمية |
|--------|------------------|---------|
| PostgreSQL | يومي | حرج |
| `media/dishes/` | يومي | حرج |
| `ml/models/*.pt` | أسبوعي | عالي |
| متغيّرات البيئة | عند التغيير | حرج |
| سجلات Render | أسبوعي | متوسط |

---

## 10. الترقية لخادم مخصّص (Self-Hosted)

عندما تحتاج للترقية من Render إلى VPS أو خادم مخصّص:

### خطوات الترحيل

1. **تجهيز الخادم:**
   ```bash
   # Ubuntu 22.04 LTS موصى به
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y python3.11 python3.11-venv nodejs npm postgresql nginx certbot
   ```

2. **استنساخ المشروع:**
   ```bash
   cd /opt
   sudo git clone https://github.com/<owner>/ska-system.git
   cd ska-system
   ```

3. **تشغيل Backend:**
   ```bash
   cd backend
   python3.11 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env
   # عدِّل .env
   ```

4. **systemd service** (`/etc/systemd/system/ska-backend.service`):
   ```ini
   [Unit]
   Description=SKA Backend API
   After=network.target postgresql.service

   [Service]
   User=ska
   WorkingDirectory=/opt/ska-system/backend
   EnvironmentFile=/opt/ska-system/backend/.env
   ExecStart=/opt/ska-system/backend/.venv/bin/uvicorn app.main:app \
     --host 127.0.0.1 --port 8000 --workers 2
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```

5. **بناء Frontend:**
   ```bash
   cd /opt/ska-system/frontend
   VITE_API_BASE_URL=https://api.example.com npm ci
   VITE_API_BASE_URL=https://api.example.com npm run build
   sudo cp -r dist/* /var/www/ska/
   ```

6. **Nginx config** (`/etc/nginx/sites-available/ska`):
   ```nginx
   server {
       listen 443 ssl http2;
       server_name app.example.com;

       ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

       root /var/www/ska;
       index index.html;

       location / {
           try_files $uri /index.html;
       }
   }

   server {
       listen 443 ssl http2;
       server_name api.example.com;

       ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

       client_max_body_size 16M;

       location / {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-Proto https;
       }
   }
   ```

7. **TLS عبر Let's Encrypt:**
   ```bash
   sudo certbot --nginx -d app.example.com -d api.example.com
   ```

8. **ترحيل البيانات:**
   ```bash
   # على Render: pg_dump
   pg_dump $RENDER_DATABASE_URL > render_backup.sql

   # على الخادم الجديد:
   psql $LOCAL_DATABASE_URL < render_backup.sql

   # نسخ الصور:
   scp -r ./dishes_backup/ user@server:/var/lib/ska/media/dishes/
   ```

---

## 11. قائمة تحقّق ما قبل النشر

### الكود

- [ ] جميع الـ tests تمرّ
- [ ] `npm run build` ينجح بدون أخطاء
- [ ] `python -m ruff check app` ينجح
- [ ] `python -c "from app.main import app"` ينجح
- [ ] لا warnings ESLint جديدة
- [ ] الـ commits لها رسائل واضحة

### الأمان

- [ ] لا ملفات `.env` في Git
- [ ] لا مفاتيح API في الكود
- [ ] لا صور خاصة/اختبارية في Git
- [ ] `SECRET_KEY` قويّ (≥32 حرف)
- [ ] `DEV_AUTH_BYPASS=false`
- [ ] `ENVIRONMENT=production`

### الإعدادات

- [ ] `CORS_ALLOW_ORIGINS` يحتوي على نطاق Frontend الإنتاجي
- [ ] `DATABASE_URL` يشير إلى PostgreSQL إنتاجي
- [ ] `GEMINI_API_KEY` صحيح ومفعّل
- [ ] `DISH_MEDIA_DIR` يشير لـ Persistent Disk
- [ ] `VITE_API_BASE_URL` يطابق نطاق Backend

### البنية التحتية

- [ ] Persistent Disk مرتبط (`/var/data/ska`)
- [ ] PostgreSQL يعمل
- [ ] النسخ الاحتياطي مفعّل
- [ ] HTTPS مفعّل (Render تلقائي)

### بعد النشر

- [ ] `/health` يعود 200
- [ ] Login يعمل
- [ ] إنشاء طبق + رفع صورة
- [ ] استعراض التنبيهات
- [ ] تصدير تقرير

---

## 12. استكشاف أخطاء النشر

### Build فشل (Backend)

| الخطأ | الحل |
|-------|------|
| `pip install` فشل | تحقّق من `requirements.txt` و Python version |
| `libgl1 not found` | غير ممكن — Render يثبّتها تلقائيًا |
| Memory error | خفّض `YOLO_MAX_EDGE` أو ارفع الخطة |

### Build فشل (Frontend)

| الخطأ | الحل |
|-------|------|
| `npm ci` فشل | تحقّق من `package-lock.json` و Node 20 |
| `Cannot find module` | أعد `npm install` محليًا واختبر `npm run build` |
| OOM during build | الترقية لخطة مع RAM أعلى |

### Runtime errors

| الخطأ | الحل |
|-------|------|
| `500` على كل الطلبات | Logs → غالبًا `SECRET_KEY` ضعيف أو DB غير متصل |
| `CORS error` في المتصفّح | `CORS_ALLOW_ORIGINS` ناقص نطاق Frontend |
| `404` عند تحديث `/dashboard` | SPA fallback مفقود — تحقّق من `_redirects` |
| صور 404 | `DISH_MEDIA_DIR` خاطئ أو القرص غير مرتبط |
| YOLO فشل تحميل | تحقّق من `YOLO_AUTO_DOWNLOAD=true` والشبكة |

### Performance

| المشكلة | الحل |
|---------|------|
| طلبات بطيئة (5+ ثوان) | Cold start — طبيعي على Free tier |
| تحليل إطار يأخذ 30+ ثانية | تحميل أوزان أول مرة — تالي أسرع |
| OOM متكرّر | خفّض `YOLO_MAX_EDGE` إلى 480 · عطّل person detector |
| DB بطيء | فهارس مفقودة — راجع `monitoring_alerts.created_at` |

### Database errors

| الخطأ | الحل |
|-------|------|
| `connection refused` | `DATABASE_URL` خاطئ |
| `relation does not exist` | لم تُنشأ الجداول — تأكّد من `init_db` تشغيل |
| `unique constraint violation` على email | المستخدم موجود — استخدم endpoint للتحديث |

---

## مراجع

| الموضوع | المرجع |
|---------|--------|
| المتطلبات التقنية | [`TECHNICAL_REQUIREMENTS_AR.md`](TECHNICAL_REQUIREMENTS_AR.md) |
| الأمان | [`SECURITY_GUIDE_AR.md`](SECURITY_GUIDE_AR.md) |
| Render Blueprint Spec | https://render.com/docs/blueprint-spec |
| `render.yaml` المشروع | [`../render.yaml`](../render.yaml) |
| متغيّرات البيئة | [`../backend/.env.example`](../backend/.env.example) |

---

*منصة عين الجودة — Ayn Al-Jawdah Quality Platform · دليل النشر · آخر تحديث: 2026-05-24*
