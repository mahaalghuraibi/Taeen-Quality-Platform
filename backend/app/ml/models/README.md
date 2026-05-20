# Mask Detection Model

Place your trained YOLO weights here:

```
backend/app/ml/models/mask_best.pt
```

## How to add the model

1. Copy `mask_best.pt` (output of your YOLOv8 training run) into this directory.
2. Restart the backend — the model is loaded lazily on the first request to `POST /api/v1/analyze-mask`.

## Class order (must match training)

| Index | Class    | Meaning                     |
|-------|----------|-----------------------------|
| 0     | mask     | Worker wearing a face mask  |
| 1     | no_mask  | Worker without a mask (violation) |

The model file is gitignored. Do not commit `.pt` files to git.
