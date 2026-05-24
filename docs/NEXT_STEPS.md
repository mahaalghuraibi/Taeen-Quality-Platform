# NEXT_STEPS.md — SKA System
> Recommended development priorities as of 2026-05-05

---

## Priority 1: Production Readiness (Critical)

### 1.1 Replace SQLite with PostgreSQL
- Add `psycopg2-binary` to `requirements.txt`
- Set `DATABASE_URL=postgresql://user:pass@host/dbname` in `.env`
- Set up Alembic for schema migrations
- Run `alembic init alembic` and create first migration from current models
- **Why critical**: SQLite cannot handle concurrent writes; multiple staff saving simultaneously will cause locking errors

### 1.2 Implement Token Refresh
- Add `POST /api/v1/auth/refresh` endpoint
- Store refresh token in `httpOnly` cookie (not localStorage)
- Frontend: intercept 401 responses → try refresh → retry original request
- **Why important**: Current 24h token is a pragmatic fix; token rotation is more secure

### 1.3 Secure Secrets
- Move `SECRET_KEY`, `GEMINI_API_KEY`, and admin seed credentials out of `.env` into environment secrets (AWS Secrets Manager, Vault, or at minimum server env vars)
- Set `SEED_DEV_ADMIN=false` in production
- Change admin seed email/password from `admin@test.com` / `123456`

### 1.4 Set Up nginx + HTTPS
- Reverse proxy: `/api/` → `http://backend:8000`, `/` → frontend static files
- Issue TLS cert (Let's Encrypt or Cloudflare)
- Update CORS `allow_origins` in `main.py` to production domain only

---

## Priority 2: Code Quality (High)

### 2.1 Split Dashboard.jsx into Components
Dashboard.jsx is 3625 lines — this is the biggest maintenance risk. Split into:
```
src/pages/
  StaffDashboard.jsx         (~800 lines)
  SupervisorDashboard.jsx    (~500 lines)
  AdminDashboard.jsx         (~400 lines)
src/components/
  DishCapture/
    CaptureModal.jsx
    DetectResult.jsx
    DishSaveForm.jsx
  DishRecords/
    RecordCard.jsx
    RecordsList.jsx
    RecordsFilter.jsx
  shared/
    NavBar.jsx
    StatsStrip.jsx
```

### 2.2 Add Database Migrations (Alembic)
```bash
cd backend
pip install alembic
alembic init alembic
# Edit alembic/env.py to use app.db.base.Base and settings.DATABASE_URL
alembic revision --autogenerate -m "initial_schema"
alembic upgrade head
```

### 2.3 Add Tests
**Backend** (pytest):
```bash
pip install pytest httpx pytest-asyncio
# Tests to write:
# - test auth login / token expiry
# - test dish create (status=approved, needs_review=False)
# - test detect-dish with a real small image (< 8000 bytes rejection)
# - test role filtering (staff sees only own records)
```

**Frontend** (Vitest + Testing Library):
```bash
npm install -D vitest @testing-library/react @testing-library/user-event jsdom
# Tests to write:
# - DishCapture modal opens to camera directly
# - handleDetectDish: 401 shows session-expired message
# - filterAndSortDishRecords returns correct results
```

---

## Priority 3: Feature Completion (Medium)

### 3.1 Supervisor Feature Validation
- Log in as supervisor and fully test:
  - Dashboard stats for branch
  - Record review (approve / reject with reason)
  - Camera management
- Confirm branch isolation: supervisor cannot see other branch records

### 3.2 Admin Reports
- `GET /api/v1/reports/...` routes exist — verify they return correct data
- Hook up frontend Admin section report charts
- Add date range filtering to reports

### 3.3 Monitoring Feature
- `monitoring_ai_service.py` exists — test with a real camera IP
- `MONITORING_AI_DEMO_MODE` in `.env` — document what demo mode does
- Confirm the monitoring alert UI in Dashboard.jsx works end-to-end

### 3.4 Multi-Tenant Onboarding
- No UI exists for creating new tenants
- Add a "superadmin" role (above admin) that can:
  - Create new tenants
  - Assign tenant admins
  - View cross-tenant analytics
- Or add a tenant creation form to the Admin section

---

## Priority 4: UX Improvements (Low–Medium)

### 4.1 Offline Support
- Staff in kitchens may have intermittent connectivity
- Cache last-loaded dish records in localStorage
- Queue failed saves and retry when online

### 4.2 Image Quality Check
- Before sending to `/detect-dish`, check image dimensions (not just byte size)
- Warn staff if image is blurry or too dark
- Client-side: use canvas to check average brightness

### 4.3 Staff Dish History Autocomplete
- When staff types a dish name, autocomplete from their `confirmed_label` history
- Backend already has `_enhance_with_history()` logic — extend it

### 4.4 Arabic Number Formatting
- All numbers in the UI should use Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩) or Latin depending on preference
- Currently mixed — standardize

### 4.5 Print / Export Records
- Add "تصدير PDF" or "تصدير Excel" button for record lists
- Backend reports endpoint may already support CSV export — check

---

## Priority 5: Infrastructure (Before Scale)

### 5.1 Docker Compose
Create `docker-compose.yml`:
```yaml
services:
  backend:
    build: ./backend
    env_file: ./backend/.env
    volumes:
      - dish-media:/app/media/dish_images
    ports:
      - "8000:8000"

  frontend:
    build: ./frontend
    ports:
      - "80:80"

  db:
    image: postgres:16
    environment:
      POSTGRES_DB: ska
      POSTGRES_USER: ska
      POSTGRES_PASSWORD: changeme
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  dish-media:
  pgdata:
```

### 5.2 CI/CD
- Add GitHub Actions workflow: lint → test → build
- Backend: `ruff` for linting, `pytest` for tests
- Frontend: `eslint`, `vitest`

### 5.3 Persistent Dish Image Storage
- Currently saved to `backend/media/dish_images/` on the local filesystem
- In production, use S3 / R2 / DigitalOcean Spaces
- Update `dish_image_storage.py` to upload to object storage instead of local disk

---

## Quick Wins (Do First)

These are small, safe changes with immediate impact:

1. **Add `SEED_DEV_ADMIN=false` note in .env.example** with comment "NEVER true in prod"
2. **Change dev admin password** to something non-obvious in `.env.example`
3. **Add `git stash` warning** — the `test.db` SQLite file should be in `.gitignore`
4. **Log rotation** — backend logs go to stdout; add log level config in `.env`
5. **Add loading spinner** to detect-dish button while waiting for Gemini response (currently just disables the button)
6. **Error boundary in React** — uncaught errors currently crash the whole Dashboard

---

## DO NOT CHANGE (Stable / Working)

- `professional_dish_vision.py` — the Gemini prompt, `ALLOWED_DISHES`, `DISH_SIMILAR`, `DISH_KEYWORDS` — all carefully tuned
- `dish_image_storage.py` — UUID file generation and path traversal protection
- Vite proxy config (`/api` → `:8000`) — this handles CORS in dev
- `detect_dish.py` — the `_uncertain()` fallback and try/except wrapper ensure the endpoint never returns 5xx
- `formatSaudiDateTime()` — Riyadh timezone display is working correctly
- `PRODUCTION_AI_MODE=true` — keeps the Gemini API protected from fake images
- `ACCESS_TOKEN_EXPIRE_MINUTES=1440` — do not lower this without implementing token refresh
