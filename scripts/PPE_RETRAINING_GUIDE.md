# PPE Model Retraining Guide

**Focus:** Mask and headcover models only. Gloves are on hold (optional check, no DB alerts).

**Current model status:**

| Model | mAP50 | Status |
|-------|-------|--------|
| `mask_best.pt` | ~0% | BROKEN — 5 epochs, dataset gone |
| `hairnet_best.pt` | 0.975 | Deployed (35-epoch run) — weak on dark headcovers |
| `glove_best.pt` | 0.54 max conf | OPTIONAL — not creating DB alerts |

---

## Quick start (recommended path)

```bash
cd /path/to/ska-system

# Step 1: Set your Roboflow API key
export ROBOFLOW_API_KEY="your_key_here"

# Step 2: Download datasets
python scripts/download_ppe_data.py

# Step 3: Train both models (YOLOv8m, 100 epochs)
python scripts/retrain_mask_headcover.py --skip-download

# Step 4: Evaluate results
python scripts/ppe_eval_models.py
```

---

## Step 1 — Get a Roboflow API key (free)

1. Go to [roboflow.com](https://roboflow.com) → sign up (free account)
2. Go to Settings → API Keys → copy key
3. Set it:
   ```bash
   export ROBOFLOW_API_KEY=rf_xxxxxx
   ```

---

## Step 2 — Download datasets (mask + headcover only)

```bash
# Mask + headcover:
python scripts/download_ppe_data.py

# Or one at a time:
python scripts/download_ppe_data.py --model mask
python scripts/download_ppe_data.py --model headcover
```

### Datasets downloaded (all CC BY 4.0):

| Target | Source | Images | Notes |
|--------|--------|--------|-------|
| mask | Roboflow "face-mask-detection-s6u8e" (militech) | ~853 | Pre-labeled YOLO |
| mask | Roboflow "mask-wearing" (joseph-nelson) | ~800 | Pre-labeled YOLO |
| gloves | Roboflow "gloves-ppe" | ~720 | Pre-labeled YOLO |
| gloves | Roboflow "medical-gloves" | ~600 | Pre-labeled YOLO |
| headcover | Roboflow "hairnet-fb3td" (maha-alghuraibi) | ~600 | Already used for current model |
| headcover | Roboflow "head-protection" | ~500 | Chef hats + hard hats |

### Optional: Kaggle face mask dataset (7553 more images)

The Kaggle dataset (Prajna Bhandary) has NO bounding boxes — just raw images classified
by folder. You need to auto-label it with face detection.

```bash
# Install kaggle CLI
pip install kaggle
# Copy ~/.kaggle/kaggle.json (from kaggle.com → account → API)

# Download
python scripts/ppe_download_datasets.py --target mask --include-kaggle

# Auto-label faces using OpenCV DNN face detector
python scripts/ppe_autolabel_faces.py

# OR: if you have the Kaggle "andrewmvd/face-mask-detection" dataset
# (which HAS bboxes in Pascal VOC XML format):
python scripts/ppe_convert_voc.py \
    --source dataset/ppe_sources/kaggle_mask_andrewmvd \
    --dest   dataset/ppe_sources/kaggle_mask_andrewmvd_yolo
```

---

## Step 3 — Normalize class names

Different datasets use different class names. This script remaps all of them to the canonical names expected by the backend:

```bash
python scripts/ppe_normalize_labels.py
```

Canonical class maps:
```
Mask model:      0=mask,      1=no_mask
Headcover model: 0=headcover, 1=no_headcover
Gloves model:    0=no_gloves, 1=gloves
```

---

## Step 4 — Validate labels

```bash
# Check all downloaded datasets for label errors
python scripts/ppe_validate_labels.py

# Show individual problematic files
python scripts/ppe_validate_labels.py --verbose

# Auto-remove corrupt images and unmatched label files
python scripts/ppe_validate_labels.py --fix
```

**Common issues found:**
- Bounding box coordinates outside [0, 1]
- Label file exists but image missing (or vice versa)
- Empty label files
- Corrupt JPEG/PNG files

---

## Step 5 — Add YOUR real kitchen images (critical)

The public datasets alone are not enough. You MUST add images from your actual kitchen:

### What to collect per model:

**Mask (100 images minimum per category):**
- Workers wearing blue surgical mask — front angle, 45°, top-down
- Workers wearing white/black cloth mask
- Workers with bare face (no mask) — same angles
- Capture in your kitchen's actual lighting conditions

**Gloves (100 images minimum per category):**
- Blue nitrile kitchen gloves — hands near food/utensils
- Black latex gloves
- White cotton gloves
- Bare hands during food prep
- From above (prep station camera angle)
- Side angle (wall-mounted camera)

**Headcover (150 images minimum — this is the weakest model):**
- **Navy/dark blue chef hat or skull cap** (most critical — missing from all public datasets)
- White chef hat (toque)
- White hairnet
- Bare head/hair visible

### How to capture:
```bash
# Use FFmpeg to extract frames from your CCTV feed every 30 seconds
ffmpeg -i rtsp://your-camera-url -vf fps=1/30 frame_%04d.jpg

# Or from a recorded video
ffmpeg -i recording.mp4 -vf fps=1/30 dataset/ppe_sources/my_kitchen/frame_%04d.jpg
```

### How to label:
1. Upload images to [Roboflow](https://roboflow.com) (free tier: 1000 images)
2. Create a project per model (mask, headcover, gloves)
3. Draw bounding boxes around faces/heads/hands
4. Export as YOLOv8 format
5. Place exported files in `dataset/ppe_sources/my_kitchen_<model>/`

---

## Step 6 — Merge and split datasets

```bash
# Merge all sources, split 70% train / 20% valid / 10% test
python scripts/ppe_build_split.py

# Check the result
python scripts/ppe_build_split.py --dry-run
```

Expected output:
```
dataset/ppe_mask/      data.yaml + images/train|valid|test + labels/train|valid|test
dataset/ppe_headcover/ data.yaml + ...
dataset/ppe_gloves/    data.yaml + ...
```

---

## Step 7 — Train all three models

```bash
# Auto-detects Mac GPU (MPS), CUDA GPU, or CPU
python scripts/ppe_train_all.py

# Train only one model
python scripts/ppe_train_all.py --model mask

# Custom settings
python scripts/ppe_train_all.py --epochs 150 --batch 16

# CPU-only (slower but always works)
python scripts/ppe_train_all.py --device cpu
```

Expected training time:
- Mac M-series (MPS): ~45 min per model at 100 epochs
- CPU only: ~4–6 hours per model
- NVIDIA GPU: ~15–20 min per model

Weights are automatically deployed to:
```
backend/ml/models/mask_best.pt
backend/ml/models/hairnet_best.pt   (headcover model)
backend/ml/models/glove_best.pt
```

---

## Step 8 — Evaluate accuracy

```bash
python scripts/ppe_eval_models.py
```

Report written to: `PPE_EVAL_REPORT.md`

### Targets before deploying to production:

| Model | Minimum mAP50 | Minimum Precision | Minimum Recall | Frame Pass Rate |
|-------|---------------|-------------------|----------------|-----------------|
| mask | 0.85 | 0.85 | 0.80 | ≥ 80% |
| headcover | 0.85 | 0.85 | 0.80 | ≥ 80% |
| gloves | 0.80 | 0.80 | 0.75 | ≥ 80% |

**If targets are not met:** Add more real kitchen images (Step 5), increase epochs to 150, run again.

---

## Complete command sequence

```bash
cd /path/to/ska-system
export ROBOFLOW_API_KEY=rf_xxxxxx

pip install roboflow ultralytics opencv-python-headless kaggle

# 1. Download
python scripts/ppe_download_datasets.py --target all --include-kaggle

# 2. Auto-label Kaggle classification images (adds face bboxes)
python scripts/ppe_autolabel_faces.py

# 3. Convert Kaggle VOC format to YOLO (andrewmvd dataset)
python scripts/ppe_convert_voc.py

# 4. Normalize class names
python scripts/ppe_normalize_labels.py

# 5. Validate and fix label errors
python scripts/ppe_validate_labels.py --fix

# 6. Merge + split
python scripts/ppe_build_split.py

# 7. Train
python scripts/ppe_train_all.py

# 8. Evaluate
python scripts/ppe_eval_models.py
```

---

## If accuracy is still low after retraining

The most common reason is **dataset domain mismatch** — the public datasets don't look like your kitchen. Solutions:

1. **Collect 200+ real images per class** from your actual kitchen webcam.
2. **Use YOLOv8s instead of YOLOv8n** — edit `ppe_train_all.py` and change `YOLO("yolov8n.pt")` to `YOLO("yolov8s.pt")`. ~10x better but ~4x more RAM.
3. **Increase epochs to 150** with `--epochs 150`.
4. **Hard negatives**: add images that the model gets wrong (false positives) back into training as negative examples.

---

## License compliance

All datasets used:

| Dataset | License | Commercial use? |
|---------|---------|-----------------|
| Roboflow "face-mask-detection-s6u8e" | CC BY 4.0 | Yes (with attribution) |
| Roboflow "mask-wearing" | CC BY 4.0 | Yes |
| Roboflow "gloves-ppe" | CC BY 4.0 | Yes |
| Roboflow "medical-gloves" | CC BY 4.0 | Yes |
| Roboflow "hairnet-fb3td" | CC BY 4.0 | Yes |
| Roboflow "head-protection" | CC BY 4.0 | Yes |
| Kaggle "face-mask-detection" (andrewmvd) | CC BY 4.0 | Yes |
| Your own kitchen images | Private | Yes |

Attribution required for CC BY 4.0 datasets. Add to your product documentation:
> PPE detection models trained in part on datasets from Roboflow Universe (CC BY 4.0).
