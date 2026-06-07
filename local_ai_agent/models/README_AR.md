# مجلد نماذج YOLO للوكيل المحلي — عين الجودة

ضع ملفات أوزان YOLO (`.pt`) **داخل هذا المجلد**:

```
local_ai_agent/models/
```

> ملاحظة: ملفات `.pt` كبيرة الحجم ولا تُرفع إلى Git (مستثناة في `.gitignore`).
> تُنشر يدوياً على جهاز المطعم.

---

## الملفات المتوقّعة وأسماؤها

| الملف | الغرض | المخالفات | الحالة |
|---|---|---|---|
| `mask_best.pt` | الكمامة | `no_mask` | متوفّر |
| `glove_best.pt` | القفازات | `no_gloves` | متوفّر |
| `hairnet_best.pt` | غطاء الرأس | `no_headcover` | متوفّر |
| `uniform_yolo.pt` | الزي الرسمي | `improper_uniform` | **مطلوب (اختياري)** |
| `environment_yolo.pt` | البيئة/المكان | `wet_floor`, `trash_on_floor`, `unclean_area`, `blocked_path`, `unsafe_area` | **مطلوب (اختياري)** |

جميع النماذج عدا PPE اختيارية: إذا كان أي ملف مفقوداً يستمر الوكيل بالعمل دون تعطّل،
ويعرض تحذيراً واضحاً، ولا يكشف المخالفات الخاصة بذلك النموذج فقط.

---

## الفئات المتوقّعة لكل نموذج (model.names)

### نموذج الزي الرسمي — `uniform_yolo.pt`
- `no_uniform` → `improper_uniform`
- `improper_uniform` → `improper_uniform`
- `uniform_ok` → التزام (لا يُنشئ تنبيهاً)

### نموذج البيئة — `environment_yolo.pt`
- `wet_floor` → `wet_floor`
- `trash_on_floor` / `trash` / `litter` / `garbage` → `trash_on_floor`
- `unclean_area` / `dirty` / `stain` → `unclean_area`
- `blocked_path` / `blocked` / `obstacle` → `blocked_path`
- `unsafe_area` / `unsafe` / `hazard` → `unsafe_area`

### نماذج PPE (للمرجعية)
- `mask_best.pt`: `mask`, `no_mask`
- `glove_best.pt`: `gloves`, `no_gloves`
- `hairnet_best.pt`: `hairnet`, `no_hairnet` (تُربط `no_hairnet` بـ `no_headcover`)

---

## كيف تطبع أسماء فئات أي نموذج (model.names)

```bash
cd local_ai_agent
python3 - <<'EOF'
from ultralytics import YOLO
for f in ["mask_best.pt", "glove_best.pt", "hairnet_best.pt",
          "uniform_yolo.pt", "environment_yolo.pt"]:
    try:
        print(f, "→", YOLO(f"models/{f}").names)
    except Exception as exc:
        print(f, "→ غير متاح:", exc)
EOF
```

أو استخدم وضع الجاهزية الذي يطبع الأسماء ويكتب تقريراً:

```bash
python agent.py --readiness
```

---

## ماذا لو اختلفت أسماء الفئات في نموذجك؟

أسماء الفئات في أوزانك المدرَّبة قد تختلف عن المتوقّع أعلاه. في هذه الحالة:

1. اطبع الأسماء الفعلية عبر `model.names` (انظر الأمر أعلاه).
2. افتح `local_ai_agent/agent.py`.
3. أضف اسم الفئة الفعلي إلى الخريطة المناسبة:
   - `UNIFORM_VIOLATION_CLASSES` لنموذج الزي.
   - `ENV_VIOLATION_CLASSES` لنموذج البيئة.
   - `PPE_VIOLATION_CLASSES` لنماذج PPE.

مثال — إذا كان نموذج الزي يسمّي الفئة `bad_uniform`:

```python
UNIFORM_VIOLATION_CLASSES = {
    "no_uniform": "improper_uniform",
    "improper_uniform": "improper_uniform",
    "bad_uniform": "improper_uniform",   # أضف اسمك هنا
}
```

المطابقة غير حسّاسة لحالة الأحرف (يتم تحويل الأسماء إلى أحرف صغيرة قبل المقارنة).
أي فئة غير موجودة في الخريطة تُتجاهَل ولا تُنشئ تنبيهاً (مثل `uniform_ok`).
