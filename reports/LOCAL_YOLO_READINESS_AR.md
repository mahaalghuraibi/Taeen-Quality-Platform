# تقرير جاهزية الوكيل المحلي YOLO — عين الجودة

> آخر تحديث: 2026-06-07 06:44:01 · إصدار الوكيل: 1.0.0

## الحالة العامة

| المنظومة | الحالة |
|---|---|
| كشف معدات الحماية (PPE: كمامة/قفازات/غطاء رأس) | جاهزة ✅ |
| كشف الزي الرسمي (Uniform) | غير جاهزة ❌ |
| كشف البيئة/المكان (Environment) | غير جاهزة ❌ |

- **كشف الزي الرسمي: غير جاهز** — ضع ملف uniform_yolo.pt لتفعيل كشف الزي الرسمي
- **كشف البيئة: غير جاهز** — ضع ملف environment_yolo.pt لتفعيل مخالفات المكان
  - Environment detection model missing — place environment_yolo.pt to enable wet floor/trash/unclean detection.

## نماذج PPE

| الملف | موجود | الفئات (model.names) | المخالفات المدعومة |
|---|---|---|---|
| `mask_best.pt` | نعم | mask, no_mask | عدم ارتداء الكمامة |
| `glove_best.pt` | نعم | no_gloves, gloves | عدم ارتداء القفازات |
| `hairnet_best.pt` | نعم | hairnet, no_hairnet | عدم ارتداء غطاء الرأس / قبعة الشيف |

## نموذج الزي الرسمي

- `uniform_yolo.pt` **غير موجود**.
- ضع ملف uniform_yolo.pt لتفعيل كشف الزي الرسمي

## نموذج البيئة

- `environment_yolo.pt` **غير موجود**.
- ضع ملف environment_yolo.pt لتفعيل مخالفات المكان
- Environment detection model missing — place environment_yolo.pt to enable wet floor/trash/unclean detection.

## النماذج الناقصة

- `models/uniform_yolo.pt`
- `models/environment_yolo.pt`

## الملفات المطلوبة لإكمال الجاهزية

ضع الملفات التالية داخل `local_ai_agent/models/`:

| الملف | الغرض | الحالة |
|---|---|---|
| `mask_best.pt` | كشف PPE | متوفّر |
| `glove_best.pt` | كشف PPE | متوفّر |
| `hairnet_best.pt` | كشف PPE | متوفّر |
| `uniform_yolo.pt` | كشف الزي الرسمي (improper_uniform) | مطلوب (اختياري حالياً) |
| `environment_yolo.pt` | كشف البيئة (أرضية مبللة/نفايات/اتساخ/ممر مسدود/منطقة خطرة) | مطلوب (اختياري حالياً) |

## المخالفات المدعومة حالياً

- عدم ارتداء الكمامة (`no_mask`)
- عدم ارتداء القفازات (`no_gloves`)
- عدم ارتداء غطاء الرأس / قبعة الشيف (`no_headcover`)

## المخالفات غير المدعومة بعد

- عدم ارتداء الزي الرسمي (`improper_uniform`)
- أرضية مبللة (`wet_floor`)
- نفايات على الأرض (`trash_on_floor`)
- منطقة غير نظيفة (`unclean_area`)
- ممر مسدود (`blocked_path`)
- منطقة غير آمنة (`unsafe_area`)
