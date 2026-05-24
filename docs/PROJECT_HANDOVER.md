# PROJECT_HANDOVER.md — SKA (Smart Kitchen Analytics)

> Complete technical handover document for incoming engineers.  
> Last updated: 2026-05-05

---

## 1. Project Overview

**SKA (Smart Kitchen Analytics)** is a SaaS-ready, multi-tenant restaurant kitchen management system. It allows:

- **Staff** to photograph dishes, have them identified by AI (Gemini Vision), and save records with quantity/source metadata
- **Supervisors** to review staff records for their branch, view dashboards, and manage branch cameras
- **Admins** to manage all users, tenants, review all records, configure the system, and view cross-branch analytics

The system is built for Arabic-speaking restaurant chains in Saudi Arabia. All UI text is in Arabic (RTL), datetimes are displayed in Riyadh timezone (Asia/Riyadh), and the dish list is a curated set of 33 Arabic + international dish names.

---

## 2. Business Logic

### Core Flow (Staff)
1. Staff opens the Dashboard → "توثيق الأطباق" (Document Dishes) section
2. Clicks camera button → browser camera opens
3. Captures photo of the dish
4. Frontend sends image to `POST /api/v1/detect-dish` (multipart/form-data)
5. Backend calls Gemini Vision → returns `dish_name`, `confidence`, `suggestions[3]`
6. Frontend shows AI result; staff can confirm or pick a different suggestion
7. Staff enters quantity and source entity, clicks "حفظ الطبق"
8. Frontend sends `POST /api/v1/dishes` → saved as `status="approved"`, `needs_review=False`
9. Record appears immediately in "سجل الأطباق" (Records section)

### Approval Model
- **Staff confirmed save** → `status="approved"`, `needs_review=False` — no supervisor review needed
- Staff confirmation itself is the approval action (saves time in kitchen flow)
- Previous behavior was `status="pending_review"` requiring supervisor approval — changed by design

### Role Access Matrix
| Endpoint group         | admin | supervisor | staff |
|------------------------|-------|------------|-------|
| List dishes            | All   | Branch     | Own   |
| Create dish            | Yes   | Yes        | Yes   |
| Detect dish (AI)       | Yes   | Yes        | Yes   |
| Supervisor dashboard   | Yes   | Yes        | No    |
| Admin users / settings | Yes   | No         | No    |
| Reports                | Yes   | Yes        | No    |

### Multi-Tenant
- Every `User` and `DishRecord` has a `tenant_id`
- All queries are filtered by `current_user.tenant_id` — tenants are strictly isolated
- Admin sees all records in their tenant; supervisor sees only their `branch_id`; staff sees only their `user_id`

---

## 3. Folder Structure

```
ska-system/
├── backend/                  # FastAPI application
│   ├── .env                  # Environment variables (NOT committed in prod)
│   ├── .env.example          # Template
│   ├── requirements.txt      # Python dependencies
│   ├── test.db               # SQLite dev database
│   ├── media/
│   │   └── dish_images/      # Uploaded dish photos (UUID filenames)
│   └── app/
│       ├── main.py           # FastAPI app creation, CORS, lifespan
│       ├── api/
│       │   ├── deps.py       # Auth dependencies (get_current_user)
│       │   ├── rbac.py       # Role-based access control
│       │   ├── router.py     # All routers mounted at /api/v1
│       │   └── routes/       # One file per feature
│       │       ├── auth.py
│       │       ├── dishes.py
│       │       ├── detect_dish.py
│       │       ├── users.py
│       │       ├── users_me.py
│       │       ├── me.py
│       │       ├── supervisor_dashboard.py
│       │       ├── supervisor_reviews.py
│       │       ├── supervisor_cameras.py
│       │       ├── monitoring.py
│       │       ├── cameras.py
│       │       ├── reports.py
│       │       ├── admin_requests.py
│       │       ├── admin_settings.py
│       │       └── meal_types.py
│       ├── core/
│       │   └── config.py     # Settings class reading from .env
│       ├── db/
│       │   ├── base.py       # SQLAlchemy declarative Base
│       │   └── session.py    # engine, SessionLocal, get_db, init_db
│       ├── models/           # SQLAlchemy ORM models
│       │   ├── dish_record.py
│       │   ├── user.py
│       │   ├── tenant.py
│       │   ├── camera.py
│       │   ├── meal_type.py
│       │   ├── admin_request.py
│       │   └── monitoring_alert.py
│       ├── schemas/          # Pydantic v2 schemas
│       │   ├── dish_record.py
│       │   ├── auth.py
│       │   ├── user.py
│       │   └── ...
│       └── services/
│           ├── professional_dish_vision.py  # Gemini Vision classifier (MAIN AI)
│           ├── dish_detection_service.py    # Thin wrapper around professional_dish_vision
│           ├── dish_image_storage.py        # base64 data URL → UUID file on disk
│           ├── auth_service.py              # JWT encode/decode
│           ├── monitoring_ai_service.py     # Camera monitoring (separate from dish AI)
│           ├── vision_service.py            # Legacy Roboflow wrapper (not used for dishes)
│           └── custom_food_classifier.py    # ResNet18 placeholder (not used)
│
├── frontend/                 # React SPA
│   ├── package.json
│   ├── vite.config.js        # Vite + proxy /api → :8000
│   ├── tailwind.config.js
│   └── src/
│       ├── main.jsx          # React entry, ReactDOM.render
│       ├── App.jsx           # React Router routes
│       ├── constants.js      # localStorage keys, API URLs
│       ├── index.css         # Tailwind directives
│       ├── pages/
│       │   ├── Dashboard.jsx # MAIN FILE — all staff/supervisor/admin UI (~3625 lines)
│       │   ├── Login.jsx
│       │   ├── Register.jsx
│       │   ├── Landing.jsx
│       │   ├── AdminUsers.jsx
│       │   ├── AdminRequest.jsx
│       │   └── AdminRequests.jsx
│       ├── components/
│       │   ├── PrivateRoute.jsx
│       │   ├── AdminRoute.jsx
│       └── utils/
│           ├── datetime.js          # formatSaudiDateTime, formatSaudiDateLine, etc.
│           ├── dishRecordsDisplay.js # computeDishStats, filterAndSortDishRecords
│           ├── avatarInitials.js     # staffAvatarInitials, staffWelcomeDisplayName
│           └── apiError.js          # dishSaveErrorMessage
│
    ├── Dockerfile
    └── classifiers/.gitkeep  # etc.
```

---

## 4. Frontend Architecture

### Technology
- **React 19** + **React Router DOM 7** + **Vite 6.4.2** + **Tailwind CSS 3**
- No state management library (Redux/Zustand) — all state is `useState`/`useCallback` in Dashboard.jsx
- No component library — pure Tailwind utility classes
- No TypeScript

### Dashboard.jsx (3625 lines) — The Core File
This single file contains the **entire UI** for all three roles. It is organized into:

```
Dashboard.jsx
├── Imports + utility functions (lines 1–120)
├── Icon components (SVG) (lines 120–200)
├── Role-routing logic (shows Staff/Supervisor/Admin UI)
├── STAFF SECTION (~1800 lines)
│   ├── handleDetectDish()      — camera capture → POST /detect-dish
│   ├── handleSaveDish()        — POST /dishes
│   ├── Search/filter section   — STAFF_SECTION_IDS.search
│   ├── Capture modal           — camera-only (no file picker)
│   ├── Records list            — dish card grid
│   └── Navigation bar
├── SUPERVISOR SECTION (~700 lines)
│   ├── Dashboard stats
│   ├── Branch record list
│   └── Review actions
└── ADMIN SECTION (~600 lines)
    ├── User management
    ├── All-branch stats
    └── System settings
```

### Key Constants
- `ACCESS_TOKEN_KEY = "access_token"` — localStorage key for JWT
- `USER_ROLE_KEY = "user_role"` — localStorage key for role
- `STAFF_SECTION_IDS` — IDs for anchor navigation between staff UI panels
- `UNKNOWN_DISH_TEXT = "طبق غير محدد"` — sentinel value for unrecognized dishes

### Navigation Order (Staff)
```
توثيق الأطباق → البحث والتصفية → سجل الأطباق → تسجيل الخروج
```

### Vite Proxy
All `/api/*` requests go through Vite dev server proxy to `http://127.0.0.1:8000`.
No CORS issue in dev because browser sees same origin. In production, set up nginx/reverse proxy the same way.

---

## 5. Backend Architecture

### Technology
- **Python 3.14** (in .venv)
- **FastAPI 0.136.0** + **Uvicorn** (ASGI server)
- **SQLAlchemy 2.0** ORM
- **Pydantic v2** (models, validators)
- **python-jose** (JWT)
- **passlib[bcrypt]** (password hashing)
- **google-genai** (Gemini Vision SDK)
- **Pillow** (image decode/re-encode before Gemini)
- **SQLite** (dev) / **PostgreSQL** (prod — not tested yet)

### App Startup
`main.py` lifespan hook:
1. Logs Roboflow key status
2. Logs GEMINI_API_KEY and MONITORING_AI_DEMO_MODE
3. Calls `init_db()` — `Base.metadata.create_all()` + seeding

### Auth Flow
1. `POST /api/v1/auth/login` → verifies bcrypt password → returns `access_token` (JWT)
2. JWT payload: `{"sub": email, "role": role}`
3. Every protected endpoint has `Depends(get_current_user)` → decodes JWT → queries DB by email
4. Expired token → `decode_access_token()` catches `JWTError` → returns `None` → raises HTTP 401

### Route Prefix
All routes: `/api/v1/...`

---

## 6. AI System Flow

### Primary Path
```
Camera capture (browser)
    → Blob JPEG → FormData
    → POST /api/v1/detect-dish (multipart)
    → detect_dish.py router
    → classify_dish_image(image_bytes)          # in professional_dish_vision.py
    → _classify_gemini(image_bytes)
    → Gemini Vision API (gemini-flash-lite-latest)
    → JSON response parsed → dish_name + suggestions
    → _rank_suggestions_by_similarity()         # filter out cross-category suggestions
    → _enhance_with_history()                   # learn from past confirmed labels (DB)
    → refresh_review_metadata()                 # recompute needs_review
    → DetectDishResponse (HTTP 200 always)
    → Frontend post-processing (_CAT/_FILL filter in handleDetectDish)
    → Display: dish name + 3 suggestions + confidence bar
```

### PRODUCTION_AI_MODE
When `PRODUCTION_AI_MODE=true` in `.env`:
- Images < 8000 bytes are rejected with `"الصورة صغيرة جداً"` and `vision_model="none"`
- This prevents test scripts with tiny fake images from consuming Gemini API credits

### Confidence Thresholds
- `>= 0.85` → clear, unambiguous — returned as-is
- `0.65–0.84` → likely but ambiguous — returned, `needs_review` may be false
- `< 0.65` → `dish_name = "غير متأكد"` + 3 alternatives from closest visual category
- `REVIEW_CONFIDENCE_THRESHOLD = 0.75` — below this, `needs_review=True` from AI

### Frontend Post-Processing (Category Filter)
After receiving AI response, `handleDetectDish` applies a client-side category coherence filter:
- `_CAT` map: dish → category (burger, pizza, pasta, grilled, rice, etc.)
- `_FILL` map: category → default alternatives
- If detected dish has a known category, filter suggestions to same-category dishes only
- Does NOT modify Gemini prompt or API call — purely client-side refinement

### AI Fallback
Any failure in `classify_dish_image()` returns a `_finalize_result(...)` dict with:
- `dish_name = "غير متأكد"` / `vision_model = "none"` / `needs_review = True`
- Never raises an exception — always returns HTTP 200 from the endpoint
- The `_uncertain()` function in `detect_dish.py` is a final safety net for unhandled exceptions

---

## 7. Database Structure

**Database**: SQLite (dev) at `backend/test.db` | PostgreSQL (prod — not configured)

### Table: `dish_records`
| Column          | Type         | Notes                                           |
|-----------------|--------------|-------------------------------------------------|
| id              | Integer PK   |                                                 |
| image_url       | Text         | UUID-named file path in `media/dish_images/`    |
| predicted_label | String(255)  | AI output dish name                             |
| confirmed_label | String(255)  | Staff's final confirmed name                    |
| quantity        | Integer      | Default 1                                       |
| source_entity   | String(100)  | Kitchen station / source identifier             |
| recorded_at     | DateTime     | UTC naive, from Riyadh wall-clock instant       |
| needs_review    | Boolean      | False on staff save (auto-approved)             |
| status          | String(32)   | "approved" on staff save                        |
| reviewed_by_id  | FK(users.id) | Supervisor who reviewed (nullable)              |
| reviewed_at     | DateTime     | Nullable                                        |
| rejected_reason | Text         | Nullable                                        |
| supervisor_notes| Text         | Nullable                                        |
| ai_suggestions  | Text         | JSON string of suggestions array                |
| ai_confidence   | Float        | Nullable                                        |
| employee_id     | Integer      | FK to users.id (denormalized for reports)       |
| employee_name   | String(255)  | Denormalized from user at save time             |
| employee_email  | String(255)  | Denormalized from user at save time             |
| branch_id       | Integer      | Denormalized from user at save time             |
| branch_name     | String(255)  | Denormalized from user at save time             |
| user_id         | FK(users.id) | The staff member who created the record         |
| tenant_id       | FK(tenants.id) | Multi-tenant isolation key                    |

### Table: `users`
| Column            | Type        | Notes                          |
|-------------------|-------------|--------------------------------|
| id                | Integer PK  |                                |
| email             | String(255) | Unique                         |
| username          | String(64)  | Unique                         |
| password          | String(255) | bcrypt hash                    |
| is_admin          | Boolean     |                                |
| role              | String(50)  | admin / supervisor / staff     |
| tenant_id         | FK          |                                |
| full_name         | String(255) | Nullable                       |
| avatar_url        | Text        | Nullable, base64 or URL        |
| organization_name | String(255) | Nullable                       |
| branch_id         | Integer     | Nullable                       |
| branch_name       | String(255) | Nullable                       |
| supervisor_id     | FK(users.id)| Nullable, assigned supervisor  |
| supervisor_name   | String(255) | Denormalized                   |

### Table: `tenants`
Minimal: `id`, `name`. All users and records belong to a tenant.

### Other Tables
- `cameras` — IP cameras per branch
- `meal_types` — configurable meal type list
- `admin_requests` — staff-to-admin request/notification system
- `monitoring_alerts` — AI camera monitoring alerts (separate from dish detection)

---

## 8. Authentication & Security

### JWT
- Library: `python-jose[cryptography]`
- Algorithm: HS256
- Secret: `SECRET_KEY` in `.env` (change in production!)
- Expiry: `ACCESS_TOKEN_EXPIRE_MINUTES=1440` (24 hours) — changed from 60 min due to shift-length use case
- Payload: `{"sub": email, "role": role, "exp": ...}`
- Token stored in `localStorage["access_token"]`

### Password
- Hashed with `passlib[bcrypt]`
- `auth_service.py` handles `create_access_token()` and `decode_access_token()`

### RBAC
- `require_roles(*allowed)` in `rbac.py` — returns FastAPI dependency
- Admin bypasses all role checks
- Staff sees only own records (filtered by `user_id`)
- Supervisor sees only branch records (filtered by `branch_id`)

### CORS
Backend allows: `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:5178`, `http://127.0.0.1:5178`

---

## 9. Image Storage

**Service**: `backend/app/services/dish_image_storage.py`

- When staff saves a dish, the `image_url` in the payload can be:
  - A base64 data URL (`data:image/jpeg;base64,...`) → materialized to disk as a UUID file
  - Already a file URL → kept as-is
- Files saved to: `backend/media/dish_images/{uuid}.jpg`
- Served by: `GET /api/v1/dishes/files/{filename}` (public, no auth — filenames are UUIDs)
- Delete: `try_delete_stored_dish_file()` called on dish delete

---

## 10. Environment Variables

File: `backend/.env`

```env
# Core
PROJECT_NAME=SKA Backend
DATABASE_URL=sqlite:///./test.db
SECRET_KEY=replace_with_strong_secret
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440         # 24h — changed from 60 for kitchen shift use

# Dev seeding
SEED_DEV_ADMIN=true
SEED_ADMIN_EMAIL=admin@test.com
SEED_ADMIN_PASSWORD=123456

# Gemini Vision (primary AI)
GEMINI_API_KEY=AIzaSy...                 # Your Gemini API key
GEMINI_VISION_MODEL=gemini-flash-lite-latest
PRODUCTION_AI_MODE=true                  # true = reject images < 8000 bytes
MONITORING_AI_DEMO_MODE=false

# Roboflow (unused for dishes — kept for reference)
ROBOFLOW_API_KEY=...
ROBOFLOW_MODEL_ID=food-types-po0yz/2
```

---

## 11. API Routes Reference

### Auth
| Method | Path                      | Auth | Description                 |
|--------|---------------------------|------|-----------------------------|
| POST   | /api/v1/auth/login        | No   | Login, returns access_token |
| POST   | /api/v1/auth/register     | No   | Register new user           |

### Dishes
| Method | Path                         | Roles               | Description                |
|--------|------------------------------|---------------------|----------------------------|
| GET    | /api/v1/dishes               | admin/sup/staff     | List (filtered by role)    |
| POST   | /api/v1/dishes               | admin/sup/staff     | Create dish record         |
| PATCH  | /api/v1/dishes/{id}          | admin/sup/staff     | Update dish record         |
| DELETE | /api/v1/dishes/{id}          | admin/sup/staff     | Delete dish record         |
| GET    | /api/v1/dishes/files/{name}  | public              | Serve dish image file      |

### Dish Detection
| Method | Path                    | Roles           | Description              |
|--------|-------------------------|-----------------|--------------------------|
| POST   | /api/v1/detect-dish     | admin/sup/staff | AI dish recognition      |

### Users
| Method | Path                  | Roles       | Description              |
|--------|-----------------------|-------------|--------------------------|
| GET    | /api/v1/users/me      | all auth    | Get current user profile |
| GET    | /api/v1/users         | admin       | List all users           |
| POST   | /api/v1/users         | admin       | Create user              |
| PATCH  | /api/v1/users/{id}    | admin       | Update user              |
| DELETE | /api/v1/users/{id}    | admin       | Delete user              |

### Supervisor
| Method | Path                              | Roles        | Description                |
|--------|-----------------------------------|--------------|----------------------------|
| GET    | /api/v1/supervisor/dashboard      | admin/sup    | Branch dashboard stats     |
| GET    | /api/v1/supervisor/reviews        | admin/sup    | Records pending review     |
| PATCH  | /api/v1/supervisor/reviews/{id}   | admin/sup    | Approve/reject record      |
| GET    | /api/v1/supervisor/cameras        | admin/sup    | Branch camera list         |

### Other
- `GET /api/v1/reports/...` — analytics reports (admin/supervisor)
- `GET/POST /api/v1/monitoring/...` — camera monitoring alerts
- `GET/POST /api/v1/cameras/...` — camera management
- `GET/POST /api/v1/meal-types/...` — configurable meal types
- `GET/POST /api/v1/admin/requests/...` — admin request queue
- `GET/PATCH /api/v1/admin/settings/...` — system settings

---

## 12. Development Commands

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Start dev server
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Or background (used in session)
nohup uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 > /tmp/backend.log 2>&1 &
```

### Frontend
```bash
cd frontend
npm install
npm run dev           # starts Vite at localhost:5173
npm run build         # production build → dist/
```

### Quick Dev Login
- Admin: `admin@test.com` / `123456`
- Seeded on first startup if `SEED_DEV_ADMIN=true`

---

## 13. Docker

**Status: Production Dockerfiles ready.** `backend/Dockerfile` builds the FastAPI image (Python 3.11-slim + ML deps + `start.sh`). `frontend/Dockerfile` is a multi-stage Vite build served by `serve`. Use `render.yaml` for managed deploys; assemble a `docker-compose.yml` per environment when needed.

---

## 14. Bug History & Fixes

### Bug 1: JWT Token Expiry → AI Detection Failure
**Symptom**: UI showed "التعرف التلقائي غير متاح" and "تعذر التعرف على الطبق، يرجى الاختيار يدويًا" after every camera capture.

**Investigation path**:
1. Initially suspected PRODUCTION_AI_MODE rejecting real photos
2. Then suspected proxy failure (curl returned HTTP 000 — turned out to be missing test file, not proxy issue)
3. Finally: redirected backend logs to `/tmp/backend.log` → saw `POST /api/v1/detect-dish HTTP/1.1" 401` three times

**Root cause**: `ACCESS_TOKEN_EXPIRE_MINUTES=60` — token expires mid-shift. Frontend `handleDetectDish` received HTTP 401 → hit `!res.ok` branch → set error notice → returned early without setting `detectResult` → `detectResult` null → fallback block shown.

**Fix**:
- `backend/.env`: Changed `ACCESS_TOKEN_EXPIRE_MINUTES=60` → `1440` (24 hours)
- `Dashboard.jsx`: Added specific 401 branch with Arabic session-expired message
- User must log out + log in after fix for fresh token

**Files**: `backend/.env`, `frontend/src/pages/Dashboard.jsx`

---

### Bug 2: curl HTTP 000 — False Proxy Alarm
**Symptom**: `curl -F "image=@/tmp/camera_capture.jpg" http://localhost:5173/api/v1/detect-dish` → HTTP 000

**Root cause**: `/tmp/camera_capture.jpg` did not exist. curl exit code 26 means "Failed to open/read local data from file". This was NOT a proxy failure.

**Lesson**: HTTP 000 from curl = local file/network error, not server response. Always verify test artifacts exist.

---

### Bug 3: Saved Dish Records Showing "يحتاج مراجعة"
**Symptom**: After staff confirmed and saved a dish, the record card showed "يحتاج مراجعة" badge.

**Root cause**: `create_dish()` in `dishes.py` computed `needs_review` from AI confidence:
- Low confidence (< 0.75) → `needs_review=True`, `status="pending_review"`
- Staff could not override this even after manually confirming the correct dish name

**Fix**: Changed `create_dish()` to unconditionally set `needs_review=False`, `status="approved"`.  
Rationale: Staff confirmation of the dish name IS the approval action. Supervisor review is optional, not required.

**File**: `backend/app/api/routes/dishes.py` (lines 88–90)

---

### Bug 4: Oversized Record Cards
**Symptom**: Date/time displayed in `text-2xl sm:text-3xl` — visually dominant, noisy layout.

**Fix**: Changed to compact `text-xs` single line combining date + time. Thumbnail reduced from `h-28 w-28 sm:h-32 sm:w-32` to `h-20 w-20`.

**File**: `frontend/src/pages/Dashboard.jsx`

---

### Bug 5: Staff Navigation Order Wrong
**Symptom**: Nav items were in wrong order for UX flow.

**Fix**: Changed to: `توثيق الأطباق → البحث والتصفية → سجل الأطباق → تسجيل الخروج`

**File**: `frontend/src/pages/Dashboard.jsx` (~line 839)

---

### Bug 6: AI Suggestions Cross-Category Contamination
**Symptom**: Gemini sometimes returned suggestions from completely different food categories (burger + rice, pizza + kabsa).

**Fix**: Added client-side `_CAT`/`_FILL` post-processing filter after AI response in `handleDetectDish`. Maps each dish to a category, filters suggestions to same-category only.

**Note**: The backend already has `_enforce_category_coherence()` and `_rank_suggestions_by_similarity()` for this. The frontend filter is an additional safety layer.

**File**: `frontend/src/pages/Dashboard.jsx` (in `handleDetectDish`)

---

## 15. Key Code Snippets

### detect_dish.py — Endpoint
```python
@router.post("/detect-dish", response_model=DetectDishResponse,
             dependencies=[Depends(require_roles("admin", "supervisor", "staff"))])
async def detect_dish(image: UploadFile = File(...), ...):
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, ...)
    image_bytes = await image.read()
    result = classify_dish_image(image_bytes=image_bytes)
    result = _enhance_with_history(result, db, tenant_id)  # learn from past corrections
    result = refresh_review_metadata(result)
    return DetectDishResponse(**result)
```

### dishes.py — Auto-Approve on Staff Save
```python
# Staff confirmed the dish name on save — auto-approve, no review needed.
values["needs_review"] = False
values["status"] = "approved"
```

### professional_dish_vision.py — PRODUCTION_AI_MODE Check
```python
if production_mode and len(image_bytes) < _PRODUCTION_MIN_IMAGE_BYTES:  # 8000 bytes
    return _finalize_result(
        visual_reason="الصورة صغيرة جداً — يرجى رفع صورة حقيقية من كاميرا أو هاتف.",
        vision_model="none", top_dish_override="غير متأكد", ...
    )
```

### Dashboard.jsx — 401 Handling
```javascript
if (res.status === 401) {
  setDishNotice({ type: "error", text: "انتهت الجلسة — سجّل الدخول مجددًا ثم أعد المحاولة." });
} else {
  setDishNotice({ type: "error", text: "تعذر التعرف على الطبق، يرجى الاختيار يدويًا" });
}
```

---

## 16. Tech Stack Summary

| Layer          | Technology                  | Version  |
|----------------|-----------------------------|----------|
| Frontend       | React                       | 19.0.0   |
| Routing        | React Router DOM            | 7.6.0    |
| Build Tool     | Vite                        | 6.4.2    |
| CSS            | Tailwind CSS                | 3.4.17   |
| Backend        | FastAPI                     | 0.136.0  |
| ASGI Server    | Uvicorn                     | latest   |
| ORM            | SQLAlchemy                  | 2.0      |
| Validation     | Pydantic                    | v2       |
| Auth           | python-jose                 | latest   |
| Passwords      | passlib[bcrypt]             | latest   |
| AI Vision      | google-genai (Gemini)       | latest   |
| Image Process  | Pillow                      | latest   |
| Database (dev) | SQLite                      | 3.x      |
| Python         | 3.14                        |          |
| Language       | Arabic (RTL) / Saudi Arabia |          |

---

## 17. Technical Debt & Known Issues

1. **Dashboard.jsx is 3625 lines** — everything is in one file. Should be split into role-specific sub-components. This makes the file hard to navigate and slows down HMR.

2. **No token refresh mechanism** — tokens expire after 24h and user must re-login. This was a pragmatic fix; a proper refresh token flow should be implemented for production.

3. **No tests** — zero test coverage on both frontend and backend. No pytest, no Vitest/Jest.

4. **SQLite in dev** — fine for local dev, but schema migrations are handled by `create_all()` on startup (no Alembic). Adding columns requires dropping and recreating the SQLite file.

5. **Compose not pinned** — `backend/Dockerfile` and `frontend/Dockerfile` are production-ready, but no `docker-compose.yml` is checked in; production uses `render.yaml` (Render Blueprint).

6. **PRODUCTION_AI_MODE in .env** — currently `true`. In prod, ensure this stays `true` to prevent fake-image abuse of Gemini API.

7. **GEMINI_API_KEY in .env** — key is in plaintext. Should use secrets manager in production.

8. **Camera monitoring (monitoring_ai_service.py)** — separate from dish detection AI. Uses a different Roboflow model URL. Currently `MONITORING_AI_DEMO_MODE=false` but the monitoring feature UI completeness is unclear.

9. **Branch/Tenant seeding** — the current seeding (in `session.py` `init_db()`) creates hardcoded admin users. The tenant seeding logic creates a default tenant. Multi-tenant onboarding UI does not exist yet.

10. **`ai_suggestions` stored as JSON text** — not a proper relational structure. Queries against AI suggestions are not possible without parsing.

---

## 18. Security Notes

- `SECRET_KEY` in `.env` is `"replace_with_strong_secret"` — **MUST change before production**
- Admin credentials `admin@test.com` / `123456` are in `.env` — **change for production** and set `SEED_DEV_ADMIN=false`
- `dish_image_storage.py` uses `safe_dish_filename()` to validate filenames — prevents path traversal
- All dish file endpoints serve UUID-named files — effectively unguessable URLs (no auth needed)
- Input validation is handled by Pydantic v2 schemas — all API inputs are type-checked
- SQL injection: SQLAlchemy ORM prevents it — no raw queries

---

## 19. Deployment Readiness

**Current state: Development only.**

To deploy to production:
1. Set `DATABASE_URL` to PostgreSQL connection string
2. Run Alembic migrations (or create schema manually — no migrations exist yet)
3. Set a strong `SECRET_KEY`
4. Change admin seed password, set `SEED_DEV_ADMIN=false`
5. Configure nginx reverse proxy: `location /api { proxy_pass http://backend:8000; }`
6. Serve frontend: `npm run build` → serve `dist/` as static files
7. Set up HTTPS (Let's Encrypt / Cloudflare)
8. Set `ALLOWED_ORIGINS` in `main.py` to your production domain
9. Set `DISH_MEDIA_DIR` to a persistent volume path

---

## 20. SaaS / Multi-Tenant Architecture

- Multi-tenancy is implemented via `tenant_id` on all records
- All API queries filter by `current_user.tenant_id`
- No tenant management UI exists yet (admin can see users, but tenant creation is via seeding)
- For true SaaS: need a superadmin role above `admin` that can create tenants
- Branch isolation: supervisor sees only `branch_id == current_user.branch_id`

---

## 21. File Locations Quick Reference

| What you need to change              | File                                              |
|--------------------------------------|---------------------------------------------------|
| AI prompt / dish list                | `backend/app/services/professional_dish_vision.py` |
| Detection endpoint                   | `backend/app/api/routes/detect_dish.py`           |
| Dish save/create logic               | `backend/app/api/routes/dishes.py`                |
| Auth / token logic                   | `backend/app/services/auth_service.py`            |
| Auth dependency (get_current_user)   | `backend/app/api/deps.py`                         |
| RBAC / role enforcement              | `backend/app/api/rbac.py`                         |
| All settings / env vars              | `backend/app/core/config.py`                      |
| Image file storage                   | `backend/app/services/dish_image_storage.py`      |
| Database models                      | `backend/app/models/`                             |
| All API routes                       | `backend/app/api/router.py`                       |
| Staff/Supervisor/Admin UI            | `frontend/src/pages/Dashboard.jsx`                |
| Login page                           | `frontend/src/pages/Login.jsx`                    |
| Route guards                         | `frontend/src/components/PrivateRoute.jsx`        |
| API URL constants                    | `frontend/src/constants.js`                       |
| Date formatting (Riyadh TZ)          | `frontend/src/utils/datetime.js`                  |
| Dish filter/sort/stats               | `frontend/src/utils/dishRecordsDisplay.js`        |
| Vite proxy config                    | `frontend/vite.config.js`                         |
