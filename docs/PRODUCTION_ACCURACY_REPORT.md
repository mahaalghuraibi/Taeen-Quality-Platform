# SKA Production Accuracy Report — Honest Audit

**Generated:** 2026-05-22
**Scope:** All 6 required violation categories for kitchen safety CCTV monitoring.
**Purpose:** Honest assessment of model capability, data gaps, and a real plan for production-grade CCTV accuracy.

---

## 1. Models currently installed

Files in `ska-system/backend/ml/models/`:

| File | Size | Purpose | Origin | Honest assessment |
|---|---|---|---|---|
| `keremberk_ppe.pt` | 51.9 MB | Main PPE detector (mask + gloves + helmet + uniform classes) | Open-source pre-trained (Roboflow Universe community model) | **Construction-site oriented** — built for hard-hats, safety vests, full PPE. Adequate for hardhat/vest, weaker on kitchen-specific items (chef hats, hairnets, food-handling gloves). |
| `hansung_ppe.pt` | 6.2 MB | Auxiliary PPE model | Open-source small variant | Lower accuracy, used as fallback. |
| `yolov8n.pt` | 6.5 MB | COCO person detector | Ultralytics official | **Solid.** Detects people reliably down to ~16 px. CCTV-ready. |
| `mask_best.pt` | 6.2 MB | Mask vs no_mask classifier | Custom-trained (~5 epochs, Kaggle face-mask dataset) | **Undertrained — max conf ~0.28.** Works on near-frontal faces, fails on side-views, masks of dark colour, and CCTV-style oblique angles. |
| `glove_best.pt` | 6.2 MB | Gloves vs no_gloves classifier | Custom-trained (~5 epochs) | **Undertrained — max conf ~0.54.** Currently capped at `needs_review` in code (never confirms violation alone) to avoid false alerts. |
| `hairnet_best.pt` | 24.5 MB | Hairnet vs no_hairnet classifier | Custom-trained (~12 epochs) | **Best of the custom models** but still weak. Fires at 0.26–0.52 confidence range. Misses dark/navy/black headcovers and chef caps. |
| `hairnet_best_epoch12_backup.pt` | 24.5 MB | Backup of above | — | Identical backup. |

**Honest one-line summary:** The system relies on **two general-purpose models** (yolov8n for people, keremberk_ppe for PPE) plus **three custom models trained for 5–12 epochs only**. None of the custom models meet production accuracy targets (recommended ≥ 50 epochs on >2,000 labelled CCTV-style images per class).

---

## 2. Detection coverage — what works today

| # | Required violation | Current detector | Honest expected accuracy on CCTV |
|---|---|---|---|
| 1 | **no_mask** | `mask_best.pt` on face crop + main `keremberk_ppe.pt` mask class | **Low – Medium.** Works on near-frontal close-ups. Fails on side views, dark masks, partial face. |
| 2 | **no_gloves** | `glove_best.pt` on hand crop + region-aware visibility gating | **Low.** Currently capped at `needs_review` (cannot fire as confirmed violation alone). Will only flag when hands are clearly visible AND model fires positively above 0.55 — most CCTV frames won't pass. |
| 3 | **no_headcover** | `hairnet_best.pt` on head crop + heuristic + dark-torso fallback | **Medium.** OK for white hairnets and chef caps in good light. Misses dark/navy caps, helmets, kerchiefs. |
| 4 | **improper_uniform** | `keremberk_ppe.pt` torso classes + dark-torso heuristic | **Medium-Low.** Detects safety vests well (construction origin) but kitchen white uniforms are not in training data. |
| 5 | **wet_floor** | **NOT IMPLEMENTED** | **Zero.** No model and no heuristic — requires brand-new dataset + training. |
| 6 | **trash_on_floor / improper_waste_area** | Geometric rules + bin-class from `keremberk_ppe.pt` | **Low.** Detects bins, infers "near worker prep zone" by IoU geometry. Cannot tell clean bin from full bin. False-positive prone on clean kitchens with normal bins. |

---

## 3. Production logic that IS working correctly

The pipeline itself is solid even if individual models are weak:

✅ **Person detection first**, then per-region PPE inference (face/head/hand crops).
✅ **Multi-frame confirmation** — 2 consecutive frames before any DB alert.
✅ **Per-person, per-type cooldown** — 90 s window prevents alert flooding.
✅ **Gloves require visible hands** — `_MIN_GLOVE_CLEAR_W/H = 50 px` enforced; below that → `needs_review`.
✅ **"Positive detection required for compliant"** rule — silent model + low confidence → amber `needs_review`, never green.
✅ **Wet floor and trash treated as scene checks**, not per-person PPE.
✅ **Evidence snapshot** (`image_data_url`) saved with every DB alert.
✅ **Riyadh timezone (Asia/Riyadh)** — frontend formats with `ar-SA-u-ca-gregory` locale.
✅ **Per-type confidence thresholds** + `_NEEDS_REVIEW_FLOOR`.
✅ **YOLO/PPE jargon removed** from supervisor-facing UI; technical panel admin-only.
✅ **Webcam clearly labelled as TEST ONLY**; production flow is CCTV via the «الكاميرات» section.

---

## 4. What the dataset folder contains today

`ska-system/dataset/` has the **skeleton structure** but no labelled training data:

```
ska-system/dataset/
├── mask/raw/images/        →  0 images
├── no_mask/raw/images/     →  0 images
├── helmet/raw/images/      →  0 images
├── hairnet/raw/images/     →  0 images
├── gloves/raw/images/      →  0 images
├── no_gloves/raw/images/   →  0 images
├── improper_uniform/raw/images/ → 0 images
├── trash/raw/images/       →  0 images
├── wet_floor/raw/images/   →  0 images
└── yolo_export/            →  (empty train/val splits)
```

**There are zero training images and zero labels.** The folder is a placeholder for the upcoming collection campaign.

---

## 5. Real CCTV data needed — collection plan

For each weak category, here is the **minimum** to retrain to production quality (precision ≥ 0.85, recall ≥ 0.80):

| Class | Min images | What to capture | Why |
|---|---|---|---|
| `no_mask` | **1,000+** | Workers with bare faces at the angles/distances/lighting of real CCTV (high mount, oblique, 2–6 m away). Include side profiles, partial occlusion, hairnets above mask. | Current model is frontal-only. |
| `mask` (positive class) | **1,000+** | Same workers WITH masks — white, black, blue, surgical, KN95, chef-style. | Need balanced positive class. |
| `no_gloves` | **1,500+** | Bare hands during food prep (cutting, plating, handling). Multiple skin tones. | Hands are tiny in CCTV — needs lots of examples. |
| `gloves` (positive class) | **1,500+** | Hands wearing gloves — blue, white, black, latex, vinyl, varied lighting. | Glove colours vary by station. |
| `no_headcover` | **1,000+** | Bare heads / loose hair in kitchen. Side, back, and top-down views. | Top-down is the dominant CCTV angle. |
| `hairnet` / `chef_hat` | **1,500+** | Hairnets (white, black), chef caps, kerchiefs, surgical caps. Color diversity essential. | Current model trained mostly on white hairnets. |
| `improper_uniform` | **800+** | Workers in non-uniform attire (street clothes, t-shirts, no apron) in real kitchen. | Kitchen uniforms differ from safety vests. |
| `proper_uniform` | **800+** | Workers in chef whites, branded uniforms, aprons. | Positive class needed. |
| `wet_floor` | **600+** | Wet tiles, puddles, recently mopped areas. Reflections, water droplets, "Caution Wet" signs. | No existing model. Greenfield. |
| `trash_on_floor` | **600+** | Food scraps, plastic, paper on kitchen floors at multiple distances. | Needed to distinguish clean vs dirty floor. |

**Total target ≈ 10,500 labelled CCTV images.** Realistic timeline: 4–8 weeks of collection + 2 weeks of labelling (Roboflow or CVAT) + 1 week of training/evaluation.

---

## 6. Concrete production next steps (priority order)

1. **Deploy 1–3 real CCTV cameras** in the target kitchen at production angles. Record 7 days of normal operation (~50–100 GB raw video).
2. **Extract 1 frame every 2 s** from peak-activity windows → ~25,000 candidate images.
3. **Stratified sampling**: select 8,000–10,000 frames covering different shifts, stations, headcover colours, mask colours, glove colours.
4. **Label in Roboflow** using the existing `dataset.yaml` class IDs:
   - 0 = helmet (chef cap / hairnet / kerchief), 1 = mask, 2 = gloves, 3 = no_mask, 4 = no_gloves, 5 = no_helmet, 6 = improper_uniform, 7 = wet_floor, 8 = trash_on_floor.
5. **Train**:
   - Stage 1 — fine-tune `keremberk_ppe.pt` (transfer learning) on all 9 classes, 50 epochs, imgsz=640.
   - Stage 2 — separate compact specialists for `wet_floor` and `trash_on_floor` (scene-level).
6. **Evaluate honestly**:
   - Per-class P, R, mAP@0.5, mAP@0.5:0.95.
   - Confusion matrix.
   - 100 hand-picked CCTV stress-test frames as held-out test set.
   - Before/after comparison vs current models.
7. **Production gate**: ship to live monitoring only when each class hits P ≥ 0.85, R ≥ 0.80 on the stress-test set.
8. **Continuous improvement**: every confirmed false alarm or missed violation flagged by supervisors goes into a feedback loop (`monitoring_alert.status='under_review'` → labelled correction → next training batch).

---

## 7. Model limitations to communicate to operators

- The system **will under-detect**: dark masks, dark headcovers, partially visible workers, wet floor, full trash bins.
- The system **will over-flag**: clean bins near workers (geometric heuristic), oblique mask angles (`needs_review` not full violation), low-confidence everything.
- Operators should treat:
  - 🟢 **مطابق** = positive verification (high trust)
  - 🟡 **يحتاج مراجعة** = system uncertain — human eyes required
  - 🔴 **مخالفة** = confirmed violation (auto-saved + evidence image)
- Until retraining, **gloves cannot fire as a confirmed violation alone** — this is deliberate to avoid false alarms while the model is weak.

---

## 8. What this audit means in plain Arabic

النظام يعمل بشكل صحيح من حيث **البنية**: رصد الأشخاص أولاً، فحص كل عامل في المنطقة الصحيحة، تأكيد متعدد الإطارات، حفظ الدليل، توقيت الرياض. **لكن** النماذج التي تقرر "مخالفة أم لا" تم تدريبها بسرعة على بيانات عامة (وجوه Kaggle، يدين، شعر) وليس على لقطات كاميرات المراقبة الحقيقية. النتيجة:

- الكمامة: تعمل أحياناً، تفشل على الزوايا الجانبية والكمامات الداكنة.
- القفازات: ضعيف جداً، النظام عمداً لا يحوّله إلى مخالفة مؤكدة.
- غطاء الرأس: متوسط، يفشل على الألوان الداكنة.
- الزي: متوسط — مصمم للسترات الإنشائية أكثر من زي المطبخ الأبيض.
- الأرضية المبللة: **لا يوجد نموذج على الإطلاق**.
- النفايات: يعتمد على القواعد الهندسية فقط (تخمين موقع الحاوية).

الحل الوحيد للوصول لدقة إنتاجية حقيقية هو **جمع بيانات من كاميرات المراقبة الفعلية في المطبخ المستهدف** وإعادة التدريب على ≥ 10,000 صورة مُسماة. لا توجد حيلة برمجية تستبدل بيانات التدريب الحقيقية.

---

*End of report.*
