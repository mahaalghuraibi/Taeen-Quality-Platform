# Frontend — منصة عين الجودة · Ayn Al-Jawdah Quality Platform

React single-page application for **kitchen quality monitoring**, **dish workflows**, **supervisor analytics**, and **RTL Arabic** UX.

---

## Overview | نظرة عامة

The UI is a **Vite + React** app with **React Router** (history API). Authenticated areas wrap **`PrivateRoute`**; admin-only pages use **`AdminRoute`** — **always paired with backend RBAC** on every sensitive API call.

---

## Stack | التقنية

| Item | Choice |
|------|--------|
| Framework | React 19 |
| Bundler | Vite 6 |
| Routing | React Router 7 |
| Styling | Tailwind CSS |
| Charts | Recharts |
| State | Zustand (toasts), React hooks |
| Animations | AOS (landing/marketing) |

---

## Main pages & routes | الصفحات

| Path | Audience | Purpose |
|------|----------|---------|
| `/` | Public | Landing |
| `/login`, `/signup` | Public | Authentication |
| `/dashboard`, `/dashboard/search`, `/dashboard/records` | Staff | Dish capture, records, filters |
| `/analytics`, `/alerts`, `/cameras`, `/reports`, … | Supervisor / Admin | Dashboards, alerts, cameras, reports |
| `/admin/users`, `/admin/requests` | Admin | User & access-request management |
| `/admin-request` | Public | Request admin access |

Legacy redirects: `/supervisor` → `/analytics`, `/monitoring` → `/cameras`.

---

## Features | الميزات

- 📊 **Dashboards** — Role-aware sections in `Dashboard.jsx` (staff vs supervisor vs admin).  
- 📈 **Reports & analytics** — Charts and export helpers (`reportExportHelpers.js`).  
- 🔔 **Alerts** — Monitoring alert lists and resolution flows.  
- 🍽 **Dish reviews** — Supervisor dish-review section and staff record cards.  
- 📹 **Camera monitoring** — Zone cards, capture, optional restaurant RTSP drafts (local masking).  
- 🌐 **RTL Arabic UI** — `index.html` uses `dir="rtl"` `lang="ar"`.

---

## Prerequisites

- **Node.js** 18+  
- **npm** 9+

---

## Installation

```bash
cd frontend
npm install
```

---

## Environment variables | المتغيرات

The SPA talks to the API via **relative paths** (e.g. `/api/v1/...`). No API keys belong in the frontend bundle.

| Concern | Notes |
|---------|--------|
| **API base (production)** | **Preferred:** set **`VITE_API_BASE_URL`** on Render at **build** time (no trailing slash), e.g. `https://taeen-quality-platform.onrender.com`. See `frontend/.env.example`. |
| **Emergency override** | In the browser console: `localStorage.setItem('ska_api_base','https://taeen-quality-platform.onrender.com'); location.reload()` — then redeploy with proper `VITE_API_BASE_URL` when you can rebuild. |
| **API origin** | Dev: Vite `server.proxy` targets `http://127.0.0.1:8000`. Production static host: without `VITE_API_BASE_URL`, same-origin `/api` calls fail unless a built-in fallback matches your host. |
| **Secrets** | Never commit `.env` with production secrets; use CI/host env only if you introduce `VITE_*` vars later. |

---

## npm scripts

| Script | Command |
|--------|---------|
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Preview build | `npm run preview` |
| Lint | `npm run lint` |

---

## Build instructions

```bash
npm run build
```

Output: **`dist/`** — deploy as static files with **fallback to `index.html`** for client routes.

---

## Troubleshooting | حل المشكلات

| Issue | What to try |
|-------|-------------|
| **API 401 / CORS** | Ensure backend `CORS_ALLOW_ORIGINS` includes your frontend origin in production. |
| **Blank routes after refresh** | Configure host (`try_files` / equivalent) so unknown paths serve `index.html`. |
| **Port in use** | Change Vite port or stop the old process (`lsof -ti:5173`). |
| **Stale deps** | Remove `node_modules` + lockfile and `npm install` again (last resort). |

---

## Security notes (frontend)

- JWT is stored in **`localStorage`** — mitigate XSS in production (CSP, dependency audits).  
- **`dangerouslySetInnerHTML`** is not used in app sources reviewed for delivery.  
- Production builds use **`build.sourcemap: false`** in `vite.config.js` (fewer internals exposed).

See repo root **`SECURITY_REPORT.md`** — **high-security baseline completed for demo and controlled production deployment**; **not** a claim of 100% security.

---

## Future frontend enhancements | تطوير لاحق

- Lazy-loaded routes for smaller initial bundle  
- Session refresh / shorter-lived tokens  
- Offline-friendly dish draft queue  
- WCAG-focused contrast & keyboard passes  

---

*React · Vite · RTL Arabic*
