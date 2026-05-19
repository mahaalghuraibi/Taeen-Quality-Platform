# Frontend Dockerfile — multi-stage: Vite build → lightweight static server.
# Set VITE_API_BASE_URL build arg to your Railway backend URL before deploying.

# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

# Bake API URL at build time (Railway passes this as a build variable)
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY . .
RUN npm run build

# ── Stage 2: Serve ──────────────────────────────────────────────────────────
FROM node:20-alpine

RUN npm install -g serve@14

COPY --from=builder /app/dist /app/dist

# Railway injects PORT; default 3000 for local Docker
EXPOSE 3000

# serve -s: SPA mode — unknown paths return index.html (required for React Router)
CMD sh -c "serve -s /app/dist -l ${PORT:-3000}"
