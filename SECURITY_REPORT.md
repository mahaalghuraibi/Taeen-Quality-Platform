# Security report — منصة عين الجودة

**High-security baseline completed.**  
This review and hardening apply to the FastAPI backend and React frontend in `ska-system/`. **This does not mean 100% security**; production should also use HTTPS, secure reverse-proxy and server configuration, database backups, monitoring, incident response, and periodic security testing.

---

## Security baseline completed

- Production mode (`ENVIRONMENT=production`) is supported with stricter JWT secret validation, disabled OpenAPI UIs, sanitized error bodies, and no `DEV_AUTH_BYPASS`.
- JWT verification enforces signature and expiration; invalid or expired tokens are rejected.
- Role-based dependencies (`require_roles`) protect admin/supervisor/staff surfaces on the API; admin remains superuser for allowed routes.
- CORS is empty-by-default in production until `CORS_ALLOW_ORIGINS` is set.
- Rate limiting covers auth, dish detection uploads, monitoring frame analysis, and report summary placeholder.
- Camera `stream_url` responses redact RTSP credentials; writes are validated for control characters, length, and basic RTSP shape.
- Login audit logs avoid recording client identifiers on failure (reduces account enumeration in logs); success logs `user_id` and `role` only (no JWT, no password).
- Dish detection verbose logs moved to `DEBUG` to limit operational leakage at default `INFO`.

---

## Production settings

| Control | Implementation |
|--------|------------------|
| `ENVIRONMENT=production` | `Settings.is_production`; OpenAPI `/docs`, `/redoc`, `/openapi.json` disabled |
| Strong `SECRET_KEY` | `validate_settings_for_startup()` requires length ≥ 32 and rejects common placeholders |
| Dev bypass | `effective_dev_auth_bypass` is always `False` in production |
| Stack traces | Generic Arabic `detail` for 422/500/unhandled in production; full trace only in development handler |

---

## Authentication and role protection

- **JWT**: `jwt.decode` with `verify_signature`, `verify_exp`, `require_exp` (`app/services/auth_service.py`).
- **User resolution**: Token `sub` matched to DB user email; tampered tokens do not map to a user → 401.
- **Private routes**: `get_current_user` + `require_roles` on sensitive routers; `/users` admin CRUD uses `dependencies=[Depends(require_roles("admin"))]`.
- **Supervisor/staff**: Dish listing and updates scoped by `tenant_id`, `branch_id`, and `user_id` where applicable (`dishes.py`, monitoring alerts).
- **Frontend**: `PrivateRoute` / `AdminRoute` are UX gates only; enforcement remains on the API.

---

## API protection

| Item | Status |
|------|--------|
| CORS | Production: explicit allow-list required; dev: localhost Vite defaults |
| Trusted hosts | `TrustedHostMiddleware` when `ALLOWED_HOSTS` is set |
| Security headers | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy`, `Permissions-Policy`, optional HSTS via `ENABLE_HSTS` |
| Rate limiting | SlowAPI: login `25/min`, register `40/hour`, `POST /detect-dish` and `POST /dishes/detect` `48/min`, `POST /monitoring/analyze-frame` `72/min`, `GET /reports/quality-summary` `120/min` |
| 429 responses | Custom handler returns safe Arabic message (no internal limiter details) |

---

## Upload protection

- **Monitoring**: `MONITORING_UPLOAD_MAX_BYTES` enforced on analyze-frame (`monitoring.py`).
- **Dish detection** (`/api/v1/detect-dish`, `/api/v1/dishes/detect`): max **12,000,000** bytes; `content-type` must be `image/*`.
- **Dish image persistence** (`dish_image_storage.py`): base64 decode validation, Pillow content verification, MIME vs content alignment, safe filename regex, size cap (unchanged logic).

---

## Camera credential protection

- **API responses**: `CameraOut` and `SupervisorCameraOut` serialize `stream_url` with credentials redacted (`rtsp://***:***@host:port/path`).
- **Writes**: `validate_camera_stream_url()` rejects newlines, oversize URLs, `..` in URL paths, and invalid RTSP host/port.
- **Storage**: Full URL remains in DB for operational use; **production should encrypt credentials at rest** (KMS/vault/app-level encryption) — documented in `.env.example`.
- **Frontend**: Local restaurant camera config already masks RTSP for display (`restaurantCameraStorage.js`, `RestaurantCameraCard.jsx`).

---

## Secrets and logs review

- **Frontend**: No API keys in bundle (grep / build); JWT only in `localStorage` (documented risk: XSS).
- **Logs**: Login no longer logs email/username on failed attempts; no database URL in auth logs (removed historically). Startup logs only boolean “key set” flags, not secret values.
- **`.env.example`**: Placeholders only for secrets; comments describe camera credential handling.
- **Code defaults**: `config.py` still contains **development-oriented** default seed emails/passwords for local SQLite seeding — **do not use these values in production**; override via env and real credential policy.

---

## Database safety

- Application queries use SQLAlchemy ORM / bound parameters.
- `app/db/session.py` uses `text()` for migrations and PRAGMA with **fixed** SQL strings; dynamic parts use bound params (`:uname`, `:uid`) or fixed table names from an internal list — **no user input in SQL strings**.

---

## Remaining production recommendations

1. **HTTPS everywhere** — terminate TLS at load balancer or reverse proxy; set `ENABLE_HSTS=true` only when all traffic is HTTPS.
2. **Shared rate-limit store** — SlowAPI in-memory limits are per process; use Redis + `storage_uri` for multi-worker deployments.
3. **JWT storage** — Prefer HttpOnly `SameSite` cookies + refresh flow over long-lived tokens in `localStorage` if threat model requires.
4. **Dependency scanning** — Run `pip-audit` / GitHub Dependabot and `npm audit` in CI on a schedule.
5. **Camera secrets** — Encrypt `Camera.stream_url` at rest or store references to a secret manager.
6. **Observability** — Centralized logging without PII/secrets; alerts on auth anomalies.
7. **Penetration testing** — Periodic third-party or internal pentest for IDOR and business-logic issues.

---

## Validation commands (executed)

**Frontend**

- `npm run build` — **passed**
- `npm audit` — **0 vulnerabilities**

**Backend**

- `pip check` — **No broken requirements found**
- `python -m ruff check app` — **All checks passed**
- `python -m compileall -q app` — **passed**

---

## Changed files (this hardening pass)

- `backend/app/main.py` — Custom 429 JSON handler
- `backend/app/middleware/security_headers.py` — `X-XSS-Protection`
- `backend/app/security/__init__.py` — **new**
- `backend/app/security/stream_url.py` — **new** (redact + validate)
- `backend/app/schemas/camera.py` — Redacting serializer for `stream_url`
- `backend/app/schemas/supervisor_camera.py` — Redacting serializer for `stream_url`
- `backend/app/api/routes/auth.py` — Safer login logging
- `backend/app/api/routes/cameras.py` — Stream URL validation on create
- `backend/app/api/routes/supervisor_cameras.py` — Stream URL validation on create/update
- `backend/app/api/routes/monitoring.py` — Rate limit on analyze-frame
- `backend/app/api/routes/detect_dish.py` — Rate limit, size cap, debug-level pipeline logs
- `backend/app/api/routes/dishes.py` — Rate limit + size cap on `/detect`
- `backend/app/api/routes/reports.py` — Rate limit on quality-summary
- `backend/.env.example` — Camera credential note
- `SECURITY_REPORT.md` — **this file**

---

## Security fixes added (summary)

- Arabic-safe **429** responses for rate limiting.
- **RTSP credential redaction** in camera JSON responses; **validation** on persisted stream URLs.
- **Per-IP rate limits** on monitoring analysis, both dish-detect upload paths, and reports stub.
- **Upload size caps** on dish detect routes aligned with media pipeline scale.
- **Reduced sensitive login logging** (failure path).
- **X-XSS-Protection** response header for legacy browser behavior.

---

**Final status:** **High-security baseline completed for demo and controlled production deployment.** This does not mean 100% security; production should also use HTTPS, secure server configuration, database backups, monitoring, and periodic security testing.
