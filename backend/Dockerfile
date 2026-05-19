# Backend Dockerfile — CPU-only, Railway/Render-safe.
# YOLO weights are NOT baked in; they download at runtime on first analyze-frame.
FROM python:3.11-slim

WORKDIR /app

# System deps: OpenCV headless (Pillow/YOLO), psycopg2, libgomp (PyTorch CPU threading)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps before copying source (layer cache hit on unchanged requirements)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY . .

# Ensure ml/models directory exists for YOLO weight resolver
RUN mkdir -p ml/models && chmod +x scripts/start.sh

# ── Runtime env — all can be overridden by Railway/Render environment vars ──
# Disable GPU — Railway/Render free tier is CPU-only
ENV CUDA_VISIBLE_DEVICES=""
# Single-threaded CPU math libs — prevents torch OOM from spawning excess threads
ENV OMP_NUM_THREADS=1
ENV MKL_NUM_THREADS=1
ENV OPENBLAS_NUM_THREADS=1
ENV VECLIB_MAXIMUM_THREADS=1
ENV NUMEXPR_NUM_THREADS=1
# Help glibc return freed heap to the OS promptly
ENV MALLOC_TRIM_THRESHOLD_=65536
# Suppress ultralytics telemetry
ENV YOLO_VERBOSE=false

# Railway injects PORT automatically; local Docker default is 8000
EXPOSE 8000

# Liveness probe — Railway uses HTTP health checks
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT:-8000}/health')" || exit 1

CMD ["bash", "scripts/start.sh"]
