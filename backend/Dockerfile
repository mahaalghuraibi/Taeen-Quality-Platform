# Backend Dockerfile — CPU-only, Render-safe.
# YOLO weights are NOT baked in; they download at runtime on first analyze-frame.
FROM python:3.11-slim

WORKDIR /app

# System deps for Pillow + psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps before copying source (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY . .

# Ensure ml/models dir exists so resolver doesn't fail on startup
RUN mkdir -p ml/models

# Disable GPU for Ultralytics/torch on CPU-only container
ENV CUDA_VISIBLE_DEVICES=""
ENV OMP_NUM_THREADS=1
ENV MALLOC_TRIM_THRESHOLD_=65536

EXPOSE 10000

CMD ["bash", "scripts/start_render.sh"]
