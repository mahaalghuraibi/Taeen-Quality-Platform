# YOLO weights (not in git)

Large `.pt` files are listed in `.gitignore`.

| File | Size | Purpose |
|------|------|---------|
| `keremberk_ppe.pt` | ~52 MB | Primary PPE model (local dev) |
| `hansung_ppe.pt` | ~6 MB | Fallback PPE model (**Render build**) |
| `yolov8n.pt` | ~6 MB | Person detector only (optional) |

**Local setup:**

```bash
cd backend
python ml/download_ppe_model.py              # both models
python ml/download_ppe_model.py --fallback-only  # Render / CI
```

**Production (Render):** `render.yaml` runs `--fallback-only` during build.  
Startup also auto-downloads `hansung_ppe.pt` if missing (`YOLO_AUTO_DOWNLOAD=true` by default in production).
