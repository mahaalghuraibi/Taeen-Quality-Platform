# CURRENT_STATUS.md — SKA System
> Last updated: 2026-05-05

---

## System State: RUNNING (Local Dev)

| Service   | Status  | Address                  | PID   | Log                 |
|-----------|---------|--------------------------|-------|---------------------|
| Backend   | Running | http://127.0.0.1:8000    | 20989 | /tmp/backend.log    |
| Frontend  | Running | http://localhost:5173    | —     | /tmp/vite-dev.log   |

---

## What Is Working

### Staff Flow (Core Feature)
- [x] Login → Dashboard loads correctly
- [x] Camera opens on "توثيق الأطباق" capture button (camera-only mode, no file picker)
- [x] Camera capture → photo sent to `/api/v1/detect-dish`
- [x] Gemini Vision identifies dish → dish name + 3 category-coherent suggestions displayed
- [x] Confidence bar shown (green / yellow / red based on threshold)
- [x] Staff can confirm AI suggestion or pick alternative from dropdown
- [x] Staff enters quantity + source entity and saves
- [x] Saved record: `status="approved"`, `needs_review=False` (no review queue)
- [x] Record appears immediately in "سجل الأطباق" section
- [x] Record card shows dish thumbnail, dish name, date+time (compact), quantity, status badge

### Search & Filter
- [x] Text search by dish name
- [x] Status filter pills (الكل / تم الاعتماد / يحتاج مراجعة / مرفوض)
- [x] Quick preset pills (اليوم / هذا الأسبوع / هذا الشهر)
- [x] Date range picker
- [x] Compact 5-stat strip (total / approved / review / rejected / today)
- [x] Secondary filters (dish type, branch, employee, etc.)

### Navigation
- [x] Staff nav order: `توثيق الأطباق → البحث والتصفية → سجل الأطباق → تسجيل الخروج`
- [x] Anchor links scroll to correct sections

### Auth
- [x] JWT login works
- [x] Token expiry: 24 hours (`ACCESS_TOKEN_EXPIRE_MINUTES=1440`)
- [x] Session-expired message shown on 401 (instead of generic error)
- [x] Role-based route guards in frontend (PrivateRoute, AdminRoute)

### Backend
- [x] All CRUD endpoints for dishes functional
- [x] Role filtering (admin → all, supervisor → branch, staff → own)
- [x] Gemini Vision API connected and working (key in `.env`)
- [x] Image storage: base64 data URLs converted to UUID files on disk
- [x] Image serving: `GET /api/v1/dishes/files/{uuid}` works
- [x] Multi-tenant isolation via `tenant_id`

---

## Recently Changed (This Session)

### 1. Token Expiry Extended
- **File**: `backend/.env`
- **Change**: `ACCESS_TOKEN_EXPIRE_MINUTES=60` → `1440`
- **Why**: 60 minutes was too short for kitchen staff working 4–8 hour shifts; tokens expired mid-shift causing all AI detection to silently fail with 401

### 2. Dish Save → Auto-Approved
- **File**: `backend/app/api/routes/dishes.py`
- **Change**: `create_dish()` now sets `needs_review=False`, `status="approved"` unconditionally
- **Why**: Staff confirmation is the approval action; previous logic kept records in `pending_review` even after staff manually confirmed the dish

### 3. Staff Navigation Order
- **File**: `frontend/src/pages/Dashboard.jsx`
- **Change**: Reordered nav items to `توثيق الأطباق → البحث والتصفية → سجل الأطباق → تسجيل الخروج`
- **Why**: Logical UX flow matching kitchen workflow

### 4. Compact Record Cards
- **File**: `frontend/src/pages/Dashboard.jsx`
- **Change**: Reduced card size; date+time on one `text-xs` line; thumbnail `h-20 w-20`
- **Why**: Oversized `text-2xl sm:text-3xl` time display was visually noisy

### 5. Camera-Only Modal
- **File**: `frontend/src/pages/Dashboard.jsx`
- **Change**: Removed file-picker choice screen; modal opens directly to camera; "رجوع" → "إغلاق" (closes modal)
- **Why**: Kitchen staff only need camera capture; file picker was unnecessary complexity

### 6. Frontend AI Category Filter
- **File**: `frontend/src/pages/Dashboard.jsx` (in `handleDetectDish`)
- **Change**: Added `_CAT`/`_FILL` post-processing after AI response
- **Why**: Extra safety layer to ensure suggestions stay in the same food category

### 7. Search/Filter UI Redesign
- **File**: `frontend/src/pages/Dashboard.jsx`
- **Change**: New order: search input → status pills → quick presets → date range → stats strip → secondary filters
- **Why**: Previous layout put secondary controls first; new layout prioritizes most-used controls

---

## Last Known Good State

### Backend API Test (most recent)
```
POST /api/v1/auth/login        → 200 OK (admin@test.com / 123456)
POST /api/v1/dishes            → 201 Created (id=20, status=approved, needs_review=false)
GET  /api/v1/dishes            → 200 OK (returns all records)
POST /api/v1/detect-dish       → 200 OK (برجر confidence=0.85)
GET  /api/v1/dishes/files/{uuid} → 200 OK (image served)
```

### Gemini Detection (last logged)
```
detect-dish pipeline: vision_model=gemini dish=برجر confidence=0.85
suggestions=[برجر(0.85), تشيز برجر(0.75), ساندويتش(0.65)]
needs_review=False
```

---

## Not Working / Incomplete

### Docker
- No `docker-compose.yml` exists for the full stack
- **Cannot deploy with Docker currently**

### Database Migrations
- No Alembic configured
- Schema changes require deleting `test.db` and restarting backend
- PostgreSQL not tested

### Camera Monitoring
- `monitoring_ai_service.py` and `monitoring.py` routes exist
- `MONITORING_AI_DEMO_MODE=false` in `.env`
- Unclear if the monitoring UI in Dashboard.jsx is fully complete
- This is a separate feature from dish detection

### Supervisor UI
- Supervisor dashboard, reviews, and cameras routes exist on backend
- Frontend supervisor section exists in Dashboard.jsx
- Full testing of supervisor flow not confirmed in this session

### Admin UI
- Admin user management exists
- Admin reports partially implemented
- Full admin feature set not tested in this session

### No Tests
- Zero automated tests on frontend or backend
- All verification done manually via backend logs and browser

---

## Active API Keys (in .env)

- **Gemini**: `AIzaSyDwPSM4GE6sNOxByrzg56-T4biaPs51S90` — active, working
- **Roboflow**: Present but NOT used for dish detection (legacy reference only)

---

## Database Contents (last known)
- Test records exist with IDs up to at least 20
- Dish images saved in `backend/media/dish_images/`
- Images: `3c60dbe1...jpg`, `f16a0d54...jpg`, `95a9f305...jpg`, `7ecfcfbb...jpg`, `ae3052c3...jpg`, `c7692a43...jpg`, `1f863ae2...jpg`, `3180b5a8...webp`
