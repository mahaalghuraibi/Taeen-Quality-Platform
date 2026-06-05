# تقرير دقة الذكاء الاصطناعي — الوكيل المحلي YOLO

> تاريخ التوليد: 2026-06-05 20:08:50 +03
> الحالة: **مجموعة البيانات غير جاهزة (DATASET NOT READY)**

## ملاحظة مهمة

هذا النظام يقيس الدقة بشكل قابل للقياس **ولا يدّعي دقة 100%**. أنظمة الرؤية الحاسوبية الواقعية دائماً بها نسبة خطأ.

## لماذا التقرير غير مكتمل؟

مجلدات بيانات التحقق فارغة — لم تُضَف أي صور اختبار بعد. لا يمكن قياس الدقة بدون صور حقيقية من كاميرات المطعم.

**الحد الأدنى الموصى به:** 20 صورة لكل فئة.

## المجلدات المفقودة أو الفارغة

| المجلد | عدد الصور |
|--------|-----------|
| `datasets/validation/ppe/no_mask` | 0 |
| `datasets/validation/ppe/mask_ok` | 0 |
| `datasets/validation/ppe/no_gloves` | 0 |
| `datasets/validation/ppe/gloves_ok` | 0 |
| `datasets/validation/ppe/no_headcover` | 0 |
| `datasets/validation/ppe/headcover_ok` | 0 |
| `datasets/validation/ppe/improper_uniform` | 0 |
| `datasets/validation/ppe/uniform_ok` | 0 |
| `datasets/validation/environment/wet_floor` | 0 |
| `datasets/validation/environment/dry_floor` | 0 |
| `datasets/validation/environment/trash_on_floor` | 0 |
| `datasets/validation/environment/clean_floor` | 0 |
| `datasets/validation/environment/unclean_area` | 0 |
| `datasets/validation/environment/clean_area` | 0 |
| `datasets/validation/environment/blocked_path` | 0 |
| `datasets/validation/environment/clear_path` | 0 |
| `datasets/validation/environment/unsafe_area` | 0 |
| `datasets/validation/environment/safe_area` | 0 |

## جرد كامل لمجموعة البيانات

| المجلد | عدد الصور | الحالة |
|--------|-----------|--------|
| `ppe/no_mask` | 0 | ❌ فارغ |
| `ppe/mask_ok` | 0 | ❌ فارغ |
| `ppe/no_gloves` | 0 | ❌ فارغ |
| `ppe/gloves_ok` | 0 | ❌ فارغ |
| `ppe/no_headcover` | 0 | ❌ فارغ |
| `ppe/headcover_ok` | 0 | ❌ فارغ |
| `ppe/improper_uniform` | 0 | ❌ فارغ |
| `ppe/uniform_ok` | 0 | ❌ فارغ |
| `environment/wet_floor` | 0 | ❌ فارغ |
| `environment/dry_floor` | 0 | ❌ فارغ |
| `environment/trash_on_floor` | 0 | ❌ فارغ |
| `environment/clean_floor` | 0 | ❌ فارغ |
| `environment/unclean_area` | 0 | ❌ فارغ |
| `environment/clean_area` | 0 | ❌ فارغ |
| `environment/blocked_path` | 0 | ❌ فارغ |
| `environment/clear_path` | 0 | ❌ فارغ |
| `environment/unsafe_area` | 0 | ❌ فارغ |
| `environment/safe_area` | 0 | ❌ فارغ |

## الخطوات التالية

1. أضف صور اختبار حقيقية من كاميرات المطعم إلى المجلدات أعلاه.
2. راجع `docs/AI_VALIDATION_GUIDE_AR.md` لمعرفة كيفية جمع الصور.
3. أعد تشغيل: `python scripts/evaluate_local_yolo_accuracy.py`
