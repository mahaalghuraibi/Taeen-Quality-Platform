# منصة عين الجودة · Ayn Al-Jawdah Quality Platform

**AI-powered smart kitchen monitoring and quality analytics platform.**

Unified web app for **staff**, **supervisors**, and **admins**: dish documentation, AI-assisted recognition, reviews, monitoring alerts, and analytics — with **RTL Arabic** UI and **JWT** authentication.

---

## 📌 GitHub About (لمحة للملف الشخصي)

| Field | Suggested value |
|--------|-----------------|
| **Description** | AI-powered smart kitchen monitoring and analytics platform built with FastAPI, React, and AI-based violation detection. |
| **Topics** | `fastapi` `react` `ai` `computer-vision` `analytics` `dashboard` `kitchen` `monitoring` `jwt` `postgresql` `vite` `arabic` `rtl` |

---

## Project overview | نظرة عامة

The platform helps kitchens document dishes, run quality checks, and monitor hygiene/PPE-style violations using computer vision where configured. Roles isolate data (staff vs branch supervisor vs admin) while sharing one codebase.

**English:** Operational dashboards, reporting stubs, camera-aware monitoring flows, and dish review pipelines live behind the same FastAPI API and React SPA.

---

## Main features | الميزات الرئيسية

| Area | Highlights |
|------|------------|
| **Roles** | Staff · Supervisor · Admin |
| **Dishes** | Capture, AI suggest, save records, search/filter |
| **Reviews** | Supervisor/admin approve, reject, or edit pending dishes |
| **Monitoring** | Frame/video analysis hooks, alerts, camera registry |
| **Analytics** | Supervisor dashboards and charts (Recharts) |
| **Reports** | Export/report helpers in UI; API reporting endpoints |
| **Auth** | JWT access tokens, protected routes (UI + server enforcement) |
| **UX** | RTL Arabic, responsive layout |

---

## Tech stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, Vite 6, React Router 7, Tailwind CSS, Zustand, Recharts |
| **Backend** | FastAPI, Starlette, SQLAlchemy 2, Pydantic v2, Uvicorn |
| **Auth** | JWT (HS256), OAuth2 password flow for login |
| **Database** | SQLite by default for local dev; **PostgreSQL** recommended for production |
| **AI / CV** | Optional **YOLO** weights, **Gemini** vision APIs, OpenCV-style flows via services (see `backend/app/services/`) |

---

## Architecture overview

High-level data flow:

```
┌─────────────────────┐
│  React + Vite SPA   │  RTL Arabic UI, JWT in requests
└──────────┬──────────┘
           │ HTTPS / REST
           ▼
┌─────────────────────┐
│   FastAPI Backend   │  RBAC, rate limits, security headers
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ PostgreSQL (prod)   │  SQLite OK for local demo
│ or SQLite (dev)     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ AI services         │  YOLO · Gemini vision · monitoring pipeline
└─────────────────────┘
```

---

## Screenshots | لقطات الشاشة

Add real screenshots under [`screenshots/`](screenshots/README.md) for portfolio polish.  
See **`screenshots/README.md`** for the checklist (dashboard, analytics, reports, alerts, cameras, dish review, login/home).

---

## Installation | التثبيت

### Prerequisites

- **Node.js** 18+ · **npm** 9+
- **Python** 3.11+
- **Git**

### Backend setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # ثم عبّئ القيم محلياً
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API base (local): `http://127.0.0.1:8000` · OpenAPI UI: `/docs` when **not** in `ENVIRONMENT=production`.

### Render deployment | نشر Render

Root directory on Render: **`backend/`**.

**Start command:**

```bash
uvicorn app.main:app --host 0.0.0.0 --port=$PORT
```

**Pre-deploy command** (creates or updates admin from **`SEED_ADMIN_EMAIL`** / **`SEED_ADMIN_PASSWORD`**):

```bash
python scripts/create_admin.py
```

Blueprint example: [`render.yaml`](render.yaml) (`preDeployCommand` + `startCommand` as above). Customize the service name, `envVars`, and attach your PostgreSQL database in the Render dashboard.

### Frontend setup

```bash
cd frontend
npm install
npm run dev
```

App (local): `http://localhost:5173` — Vite proxies `/api` to the backend when configured in `vite.config.js`.

### Docker setup | دوكر

The repo includes a **`docker-compose.yml`** stub and minimal **`Dockerfile`** placeholders under `frontend/`, `backend/`, and `ai-service/`.  
Extend them for production (multi-stage builds, env injection, PostgreSQL service, TLS termination behind nginx/Caddy).

---

## Security summary | الأمان

📄 **Authoritative technical baseline:** [`SECURITY_REPORT.md`](SECURITY_REPORT.md)

**High-security baseline completed for demo and controlled production deployment.**  
This does **not** mean 100% security — use HTTPS, hardened hosting, secrets management, backups, and periodic testing.

Additional deployment-oriented notes: [`docs/SECURITY_DEPLOYMENT_NOTES.md`](docs/SECURITY_DEPLOYMENT_NOTES.md).

---

## Future enhancements | تطوير لاحق

- Push / email notifications for critical alerts  
- Richer analytics and scheduled reports  
- Stronger multi-tenant isolation and audit logs  
- Encrypted storage for camera credentials at rest  
- Redis-backed rate limiting for multi-worker APIs  

---

## Project structure

```text
ska-system/
├── frontend/           # React + Vite SPA
├── backend/            # FastAPI app (app/)
├── ai-service/         # Optional / extended AI workspace
├── docs/               # Extra deployment & security notes
├── screenshots/        # Portfolio images (see screenshots/README.md)
├── SECURITY_REPORT.md
├── PROJECT_HANDOVER.md
├── CURRENT_STATUS.md
├── NEXT_STEPS.md
└── README.md           # هذا الملف
```

---

## Documentation map | خريطة الوثائق

| Document | Purpose |
|----------|---------|
| [`frontend/README.md`](frontend/README.md) | Frontend setup, scripts, troubleshooting |
| [`backend/README.md`](backend/README.md) | API modules, env vars, production notes |
| [`SECURITY_REPORT.md`](SECURITY_REPORT.md) | Security baseline & checklist |
| [`PROJECT_HANDOVER.md`](PROJECT_HANDOVER.md) | Handover context |
| [`CURRENT_STATUS.md`](CURRENT_STATUS.md) | Current status |
| [`NEXT_STEPS.md`](NEXT_STEPS.md) | Suggested next steps |

---

## License & credits

Use and attribution per your organization’s policy. External APIs (Gemini, Roboflow, etc.) require their own keys and terms.

---

*منصة عين الجودة — Ayn Al-Jawdah Quality Platform*
