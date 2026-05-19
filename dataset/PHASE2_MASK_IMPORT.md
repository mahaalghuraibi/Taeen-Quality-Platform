# Phase 2 — Kaggle Face Mask import

**Source:** `Desktop/data/` (Kaggle extract)

| Source folder   | Destination                      | Prefix        | Count |
|-----------------|----------------------------------|---------------|------:|
| `with_mask/`    | `dataset/mask/raw/images/`       | `mask_####`   |  3725 |
| `without_mask/` | `dataset/no_mask/raw/images/`    | `no_mask_####`|  3828 |
| **Total**       |                                  |               | **7553** |

Re-run import:

```bash
python scripts/import_mask_kaggle.py --source /path/to/data
```

**Next:** Roboflow upload → bbox labels → `labeled/` → `organize_dataset.py`
