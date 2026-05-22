# Manual Image Collection Instructions

These folders hold real kitchen images YOU must collect from your actual cameras.
Public datasets cannot replace this step — they do not match your kitchen's lighting,
camera angles, or worker appearance.

**Priority order:** headcover_dark → mask_kitchen → gloves_kitchen → everything else

---

## 1. headcover_dark  (CRITICAL — 150–300 images)

**Why this folder exists:** Every public headcover dataset contains mostly white or
light-colored hairnets. Navy, dark blue, and black chef hats are completely absent
from all public datasets. The current hairnet model has 0% recall on dark headcovers.

**What to collect:**
- Navy blue chef hat (short back-of-head style) — the most common in your kitchen
- Dark blue skull cap
- Black bandana worn under/without hair
- Black hairnet (mesh)
- Any dark headcover your workers currently wear

**Angles needed (collect each angle for each headcover type):**
- Front-facing, camera at face level
- 45° left/right side angle (most common CCTV angle)
- From behind — worker facing the prep station
- From above (downward camera, high ceiling mount)
- Partially visible — only top of head visible from bottom of frame

**Lighting variations:**
- Normal kitchen fluorescent (most important)
- Bright overhead — slightly overexposed
- Shadow areas near cabinets
- Steam/condensation (if your camera suffers from this)

**Target:** At least 50 images per headcover type, minimum 150 total.

**Filename format:** `dark_headcover_0001.jpg`, `dark_headcover_0002.jpg`, ...

---

## 2. headcover_light  (100–200 images)

**What to collect:**
- White chef hat (toque)
- White hairnet / snood
- White/beige food-service cap
- No headcover — bare hair clearly visible (100 images — label these as no_headcover)

---

## 3. mask_kitchen  (150–250 images)

**What to collect:**
- Workers wearing blue surgical mask (most common in your kitchen)
- Workers wearing black mask
- Workers wearing white cloth mask
- Worker from the side while masked
- Worker looking down at prep station

**Labeling:** Bounding box tightly around the face area (chin to forehead).

---

## 4. no_mask_kitchen  (150–250 images)

**What to collect:**
- Worker with clearly bare face, no mask
- Same worker as above for direct comparison
- Different skin tones
- Side profile with no mask
- Face partially in shadow

---

## 5. gloves_kitchen  (150–250 images)

**What to collect:**
- Blue nitrile gloves — both hands near food/utensils
- Black latex gloves
- White cotton gloves
- Hands moving (motion blur OK)
- Single hand visible, other off-frame
- From above prep station angle

---

## 6. no_gloves_kitchen  (150–250 images)

**What to collect:**
- Bare hands clearly visible near food surface
- Different skin tones
- Male and female workers
- Hands holding utensils (knife, ladle, tray)
- From CCTV angle (looking slightly down)

---

## How to capture images

### From live CCTV/webcam (recommended)
```bash
# Extract one frame every 30 seconds from your RTSP feed
ffmpeg -i "rtsp://admin:password@your-camera-ip/stream" \
       -vf fps=1/30 \
       -q:v 2 \
       dataset/manual_collection/headcover_dark/images/frame_%04d.jpg

# From a recorded video file
ffmpeg -i /path/to/kitchen_recording.mp4 \
       -vf fps=1/10 \
       -q:v 2 \
       dataset/manual_collection/headcover_dark/images/frame_%04d.jpg
```

### From your phone/camera
- Place your phone in the same position as your ceiling camera
- Record 5-minute videos of workers at prep stations
- Extract frames with ffmpeg as above

---

## How to label

1. Upload each folder to **Roboflow** (free tier: 1,000 images)
   - roboflow.com → New Project → Object Detection
   - One project per PPE type (mask, headcover, gloves)

2. Draw bounding boxes:
   - **Mask/no_mask**: box around the face (chin to forehead)
   - **Headcover/no_headcover**: box around the head (top of head to chin)
   - **Gloves/no_gloves**: box tightly around the hands only (not arms)

3. Export as **YOLOv8 format**

4. Place exported files into the matching `dataset/ppe_sources/` subfolder

5. Run the pipeline:
   ```bash
   python scripts/ppe_normalize_labels.py
   python scripts/ppe_validate_labels.py --fix
   python scripts/ppe_build_split.py
   python scripts/ppe_train_all.py
   python scripts/ppe_eval_models.py
   ```

---

## Minimum targets before retraining

| Folder | Min Images | Notes |
|--------|-----------|-------|
| headcover_dark | **150** | No public dataset covers this — highest priority |
| headcover_light | 100 | Supplement Roboflow data |
| mask_kitchen | 150 | Supplement Roboflow data |
| no_mask_kitchen | 150 | Must match above count |
| gloves_kitchen | 150 | Blue nitrile most important |
| no_gloves_kitchen | 150 | Must match above count |
| **Total** | **≥ 850** | Spread across all classes |

---

## Current gap summary

| Model | Public datasets | Missing | Status |
|-------|----------------|---------|--------|
| Mask | ~1,653 from Roboflow | Kitchen-specific angles | WEAK |
| Headcover | ~1,100 from Roboflow | **Dark headcovers (0 images in any public set)** | BROKEN for dark |
| Gloves | ~1,320 from Roboflow | Kitchen-specific angles, black/green gloves | WEAK |
| **Uniform** | None matching kitchen | Chef whites at CCTV angles | NO MODEL — uses heuristic |
| **Wet floor** | None matching kitchen | Mopped tile, food spill, oil puddle | NO MODEL — uses heuristic |
| **Trash on floor** | None matching kitchen | Food scrap / wrapper / plastic on tiles | NO MODEL — uses heuristic |

Dark headcover, kitchen uniform, wet floor, and trash images do not exist in any public dataset. You must collect them yourself.

---

## 7. uniform  (200–400 images)

**Why this folder exists:** The main YOLO model recognizes safety vests (construction)
not kitchen whites. We need real chef-uniform images from your CCTV.

**What to collect:**
- Chef in full white uniform (jacket + apron) — front, side, back views
- Branded uniform with logo / colored trim
- Apron only (worker without full jacket)
- Worker bending over prep station (back-of-uniform visible)
- Multiple workers in same frame, all in uniform

**Labeling:** Bounding box around upper body (shoulders to waist).

**Class:** `uniform` (0)

**Filename:** `uniform_0001.jpg`, …

---

## 8. no_uniform  (200–400 images)

**What to collect:**
- Worker in t-shirt / casual shirt during shift
- Worker without apron over civilian clothes
- Visitor/non-staff person in the kitchen
- Worker who removed jacket but still in kitchen
- Dark/colorful non-uniform attire (black t-shirt is the hardest case)

**Class:** `no_uniform` (1)

---

## 9. wet_floor  (150–300 images)

**Why this folder exists:** No public dataset covers restaurant wet-floor detection.

**What to collect:**
- Floor right after mopping (visible water/sheen)
- Oil spill (varies by lighting — needs many examples)
- Water puddle near sink
- Soup or sauce spill on tile
- "Caution Wet Floor" sign visible (optional positive marker)
- Different floor tile colors and finishes (matte, glossy, dark, light)
- Lighting variations: bright overhead, shadow zones, reflective glare

**Labeling:** Bounding box around the wet area only (not the whole floor).

**Class:** `wet_floor` (0)

**Important:** Capture also reflections that are NOT wet floor (polished counter,
metal worktop) so the model learns to ignore them. Put those in `dry_floor/`.

---

## 10. dry_floor  (150–300 images — negative class)

**What to collect:**
- Same floor areas as `wet_floor/` but dry
- Polished stainless counter reflections
- Shiny tile in dry condition
- Floor with shadows (looks dark but dry)
- Same lighting variations as wet examples

**Class:** `dry_floor` (1) — used as the negative class.

---

## 11. trash_on_floor  (150–300 images)

**What to collect:**
- Food scrap (vegetable peel, meat trim, bone) on the floor
- Plastic wrapper, paper, napkin on floor
- Spilled rice / lentils / loose grains
- Broken egg or sauce splatter near prep
- Small object groups (multiple scraps in one frame)

**Labeling:** Tight bounding boxes around each piece.

**Class:** `trash_on_floor` (0)

---

## 12. clean_floor  (150–300 images — negative class)

**What to collect:**
- Same floor areas, immediately after cleaning
- Normal kitchen floor with workers moving around
- Floor in different lighting conditions, no trash
- Bin in correct position (the bin itself is NOT trash)
- Worker shoes / aprons visible (avoid model confusing those with trash)

**Class:** `clean_floor` (1)

---

## Recommended sequence

1. **Week 1:** Collect dark headcover + kitchen uniform (most painful current gaps).
2. **Week 2:** Collect wet floor + dry floor pairs (negative class same shift to control lighting).
3. **Week 3:** Collect trash on floor + clean floor pairs.
4. **Week 4:** Run `ppe_normalize_labels.py` → `ppe_build_split.py` → `ppe_train_all.py`
   producing `uniform_best.pt`, `wet_floor_best.pt`, `trash_best.pt` into
   `backend/ml/models/`. The backend will pick them up automatically next restart.

Until those weights are dropped in, the backend uses heuristic checks
(deterministic OpenCV) that surface results as **يحتاج مراجعة (needs_review)**,
never confirmed violations. This is intentional — heuristics are accurate
enough to flag suspicious frames but not accurate enough for auto-blame.
