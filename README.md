# منصة عين الجودة | Ayn Al-Jawdah Quality Platform 👁️

**AI-powered platform for smart kitchen quality monitoring.**

عين الجودة هي منصة ويب طورتها لمساعدة فرق المطابخ على متابعة الجودة والسلامة، وتوثيق الأطباق، وتحليل الصور والفيديو باستخدام تقنيات الذكاء الاصطناعي والرؤية الحاسوبية.

The platform combines kitchen monitoring, dish documentation, AI-assisted recognition, alerts, and analytics in one Arabic RTL interface.

---

## About the project | عن المشروع

The idea behind Ayn Al-Jawdah is to make kitchen quality monitoring easier through one platform that combines daily operations with AI-assisted analysis.

The system supports three main roles:

- **Staff** — document dishes and manage daily records.
- **Supervisor** — review dishes, monitor results, and follow analytics.
- **Admin** — manage users and platform settings.

The platform also includes AI-based image and video analysis to support dish recognition and detect selected kitchen safety and hygiene violations.

---

## Main features | الميزات الرئيسية

- 👥 Staff, Supervisor, and Admin roles
- 🍽️ Dish capture and documentation
- 🤖 AI-assisted dish recognition
- 🎥 Video analysis and violation detection
- 🔔 Monitoring alerts
- 📊 Analytics and dashboards
- 🔎 Search and filtering
- ✅ Dish review and approval workflow
- 🔐 JWT authentication and protected routes
- 🌐 Responsive Arabic RTL interface

---

## Tech stack | التقنيات المستخدمة

| Area | Technologies |
|------|--------------|
| **Frontend** | React.js, Vite, Tailwind CSS, React Router, Zustand, Recharts |
| **Backend** | Python, FastAPI, SQLAlchemy, Pydantic |
| **Database** | PostgreSQL / Supabase, SQLite for local development |
| **AI & Computer Vision** | YOLO, Gemini Vision, OpenCV, PyTorch |
| **Authentication** | JWT |
| **Deployment** | Render, Docker |

---

## How it works | كيف تعمل المنصة

```text
React + Vite Frontend
        │
        │ REST API
        ▼
FastAPI Backend
        │
        ├── Authentication & Roles
        ├── Dish Management
        ├── Monitoring & Alerts
        └── Analytics
        │
        ▼
PostgreSQL / Supabase
        │
        ▼
AI Services
YOLO · Gemini Vision · OpenCV
```

---

## Screenshots | لقطات الشاشة

### 1. Platform Homepage | الواجهة الرئيسية

The main landing page of Ayn Al-Jawdah with an Arabic RTL interface designed for smart kitchen quality monitoring.

![Ayn Al-Jawdah Homepage](./screenshots/IMG_7769.jpeg)

---

### 2. AI-Powered Dish Recognition | التعرف الذكي على الأطباق

The platform can analyze captured dish images, suggest the detected dish, and display a confidence score.

![AI-Powered Dish Recognition](./screenshots/IMG_7771.jpeg)

---

### 3. Video Analysis & Violation Detection | تحليل الفيديو ورصد المخالفات

Video analysis is used to identify selected kitchen safety and hygiene violations and display detected events with confidence scores.

![Video Analysis and Violation Detection](./screenshots/IMG_7767.jpeg)

> **Note:** The screenshots above are captured directly from the working application. AI results depend on the configured models and input data.

---

## My work on the project | دوري في المشروع

I worked on developing and connecting the main parts of the platform, including:

- Building the frontend interface using React.
- Developing backend APIs with FastAPI.
- Connecting the application to the database.
- Implementing authentication and role-based access.
- Integrating AI services for image and video analysis.
- Working with YOLO and Gemini for computer vision features.
- Building dashboards, monitoring flows, and alerts.
- Testing and improving the overall user experience.

---

## Installation | تشغيل المشروع

### Requirements

- Node.js 18+
- npm 9+
- Python 3.11+
- Git

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

For Windows:

```bash
.venv\Scripts\activate
```

The local API runs on:

```text
http://127.0.0.1:8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend runs locally on:

```text
http://localhost:5173
```

---

## Deployment | النشر

The project includes configuration for deployment using Render and Docker.

### Render

Backend start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port=$PORT
```

The repository also includes:

```text
render.yaml
backend/Dockerfile
frontend/Dockerfile
```

Environment variables and API keys should be configured securely in the deployment environment and should not be committed to the repository.

---

## Security | الأمان

The project includes basic security practices such as:

- JWT authentication
- Role-based access control
- Protected API routes
- Environment variables for sensitive configuration
- CORS configuration
- Server-side authorization checks

More details are available in:

[`SECURITY_REPORT.md`](SECURITY_REPORT.md)

and

[`docs/SECURITY_DEPLOYMENT_NOTES.md`](docs/SECURITY_DEPLOYMENT_NOTES.md)

---

## Future improvements | تطوير لاحق

Some improvements I plan to explore in future versions:

- Email or push notifications for important alerts
- More detailed analytics and reports
- Additional AI detection scenarios
- Improved camera monitoring
- Better performance and security
- Expanded AI model evaluation and testing

---

## Project structure

```text
ska-system/
├── frontend/           # React frontend
├── backend/            # FastAPI backend
├── dataset/            # AI training data structure
├── docs/               # Project documentation
├── scripts/            # Training and utility scripts
├── screenshots/        # Real application screenshots
├── render.yaml         # Render configuration
├── SECURITY_REPORT.md
└── README.md
```

---

## Documentation | الوثائق

Additional project documentation is available in the `docs/` folder.

### Arabic documentation

- [`CLIENT_GUIDE_AR.md`](docs/CLIENT_GUIDE_AR.md) — دليل استخدام المنصة
- [`ADMIN_GUIDE_AR.md`](docs/ADMIN_GUIDE_AR.md) — دليل مدير النظام
- [`TECHNICAL_REQUIREMENTS_AR.md`](docs/TECHNICAL_REQUIREMENTS_AR.md) — المتطلبات التقنية
- [`DEPLOYMENT_GUIDE_AR.md`](docs/DEPLOYMENT_GUIDE_AR.md) — دليل النشر
- [`SECURITY_GUIDE_AR.md`](docs/SECURITY_GUIDE_AR.md) — دليل الأمان

### Technical documentation

- [`frontend/README.md`](frontend/README.md)
- [`backend/README.md`](backend/README.md)
- [`docs/PROJECT_HANDOVER.md`](docs/PROJECT_HANDOVER.md)
- [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md)
- [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md)
- [`docs/PRODUCTION_ACCURACY_REPORT.md`](docs/PRODUCTION_ACCURACY_REPORT.md)

---

## External services

Some AI features depend on external services such as Gemini and other configured APIs. API keys are not included in the repository and must be provided separately through environment variables.

---

**Ayn Al-Jawdah Quality Platform | منصة عين الجودة 👁️**
