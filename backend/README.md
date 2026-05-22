# Backend — منصة عين الجودة · Ayn Al-Jawdah Quality Platform

FastAPI service exposing REST APIs for **authentication**, **users**, **dishes**, **monitoring**, **cameras**, **reports**, and **supervisor** workflows.

---

## Overview | نظرة عامة

The backend is organized under **`app/`**: routers in **`app/api/routes/`**, SQLAlchemy models in **`app/models/`**, Pydantic schemas in **`app/schemas/`**, and domain logic in **`app/services/`**.  
JWT validates every protected handler via **`get_current_user`** and **`require_roles`**.

---

## Stack | التقنية

| Layer | Technology |
|-------|------------|
| Framework | FastAPI |
| ASGI | Uvicorn |
| ORM | SQLAlchemy 2 |
| Validation | Pydantic v2 |
| Auth | JWT (python-jose), bcrypt passwords |
| Rate limiting | SlowAPI (selected routes) |

---

## Main API modules | الوحدات

API prefix: **`/api/v1`**.

| Module | Router prefix / tags | Role highlights |
|--------|----------------------|-----------------|
| **Auth** | `/auth` | Login (OAuth2 form), public registration |
| **Users** | `/users` | Admin CRUD & role updates |
| **Users / Me** | `/users/me`, `/me` | Current profile & password |
| **Dishes** | `/dishes` | Records CRUD, file URLs, scoped by tenant/branch/user |
| **Dish detection** | `/detect-dish`, `/dishes/detect` | Upload image → AI classification pipeline |
| **Monitoring** | `/monitoring` | Analyze frame (supervisor/admin), alerts persistence |
| **Cameras** | `/cameras`, `/supervisor/cameras` | Camera registry & supervisor CRUD |
| **Alerts** | `/supervisor/alerts` | List/filter/resolve monitoring alerts |
| **Reports** | `/reports` | Summary stubs / reporting endpoints |
| **Supervisor** | `/supervisor/*` | Dashboard aggregates, employees context |
| **Admin** | `/admin-requests`, `/admin-settings` | Requests & settings (RBAC) |

There is no separate **`/dashboard`** router — dashboard data is composed from the endpoints above.

---

## Environment variables | المتغيرات

Copy **`.env.example`** → **`.env`** and fill values locally. Never commit real secrets.

| Variable | Purpose |
|----------|---------|
| `ENVIRONMENT` | `development` \| `production` — docs visibility, error shaping |
| `SECRET_KEY` | JWT signing (**required strong key in production**) |
| `DATABASE_URL` | SQLAlchemy URL (PostgreSQL recommended for prod) |
| `CORS_ALLOW_ORIGINS` | Comma-separated browser origins (required for prod browsers) |
| `ALLOWED_HOSTS` | Optional TrustedHost list |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT lifetime |
| `GEMINI_*`, `DISH_GEMINI_*`, `MONITORING_*` | Vision API configuration |
| `YOLO_MODEL_PATH`, etc. | Monitoring weights paths |
| `MONITORING_UPLOAD_MAX_BYTES` | Frame upload cap |

Full list and comments: **`.env.example`**.

---

## Setup steps | الإعداد

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env — DATABASE_URL, SECRET_KEY, AI keys as needed
```

Optional: download YOLO weights per `ml/` README scripts — large **`*.pt`** files stay gitignored.

---

## Run backend | التشغيل

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Production-style example (adjust workers & SSL termination):

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

### Render deployment | نشر Render

Use Render’s **`PORT`** env var (injected by the platform). **Start command:**

```bash
uvicorn app.main:app --host 0.0.0.0 --port=$PORT
```

**Pre-deploy command** (ensure admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`):

```bash
python scripts/create_admin.py
```

See repo root **`render.yaml`** for a Blueprint template.

---

## Security features | الأمان

Summarized here; details in repo **`SECURITY_REPORT.md`**.

- Production: strong **`SECRET_KEY`**, OpenAPI UIs off, generic Arabic errors for clients  
- JWT: signature + expiry enforced  
- CORS: strict allow-list in production  
- Optional **TrustedHostMiddleware**, **security headers**, optional **HSTS**  
- Rate limits on auth and sensitive upload/analysis routes  
- Dish images: validated decode + magic-byte checks where implemented  
- Camera **`stream_url`**: validated on write; credentials redacted in JSON responses for RTSP  

**High-security baseline completed for demo and controlled production deployment.**  
This is **not** a guarantee of 100% security.

---

## Production notes | ملاحظات الإنتاج

- Use **PostgreSQL** and managed backups  
- Terminate **HTTPS** at reverse proxy; set **`ENABLE_HSTS`** only when appropriate  
- Set **`CORS_ALLOW_ORIGINS`** explicitly  
- Use shared Redis (or proxy limits) for rate limiting across multiple workers  
- Rotate secrets and restrict filesystem permissions on **`media/`**

---

## Validation commands | أوامر التحقق

```bash
pip check
python -m ruff check app
python -m compileall -q app
```

---

## Project layout (backend)

```text
backend/
├── app/
│   ├── api/           # routes, deps, rbac
│   ├── core/          # settings, limiter
│   ├── db/            # session, init
│   ├── models/
│   ├── schemas/
│   ├── services/      # AI, monitoring, dish, auth
│   ├── middleware/
│   └── security/
├── ml/                # models, training scripts (weights gitignored)
├── scripts/
├── requirements.txt
├── .env.example
└── Dockerfile         # stub — extend for deployment
```

---

*FastAPI · SQLAlchemy · JWT*
