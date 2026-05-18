"""
Kitchen safety monitoring: production path uses YOLO PPE (see yolo_monitoring_service).
Gemini helpers remain for optional / legacy flows; dish recognition is separate.
"""

from __future__ import annotations

import io
import json
import logging
import re
from base64 import standard_b64encode
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

CHECK_DEFS: list[tuple[str, str]] = [
    ("mask", "الكمامة"),
    ("glove", "القفازات"),
    ("helmet", "غطاء الرأس / قبعة الشيف"),
    ("uniform", "الزي الرسمي"),
    ("trash_floor", "النفايات على الأرض"),
    ("waste_area", "موقع النفايات والحاويات"),
    ("people_count", "عدد الأشخاص"),
]

STATUS_AR = {
    "safe": "سليم",
    "violation": "مخالفة",
    "needs_review": "يحتاج مراجعة",
    "uncertain": "غير مؤكد",
}

VIOLATION_TYPE_LABELS: dict[str, str] = {
    "no_mask": "عدم ارتداء الكمامة",
    "no_gloves": "عدم ارتداء القفازات",
    "no_headcover": "عدم ارتداء غطاء الرأس / قبعة الشيف",
    "improper_uniform": "عدم ارتداء الزي الرسمي",
    "trash_on_floor": "نفايات على الأرض",
    "improper_waste_area": "موقع النفايات غير ملائم",
    # Legacy DB / payloads (normalize at UI when aggregating)
    "no_glove": "عدم ارتداء القفازات",
    "no_helmet": "عدم ارتداء غطاء الرأس / قبعة الشيف",
    "no_head_cover": "عدم ارتداء غطاء الرأس / قبعة الشيف",
}

# Prompt in English for reliable JSON output; Arabic used only in label/reason fields.
GEMINI_PROMPT_MONITORING = """You are a kitchen food-safety compliance inspector for restaurant kitchens (YOLO may also run separately).
Only assess these items — do NOT assess goggles, shoes, or floor/trash hygiene here.

STATUS DEFINITIONS:
- "safe"         : the requirement is clearly met.
- "violation"    : you can observe that the requirement is NOT being followed.
- "needs_review" : partially visible or ambiguous — something looks wrong but you cannot be certain.
- "uncertain"    : the item is completely outside the frame or totally unobservable.

CONFIDENCE SCALE (integer 0-100):
- 85-100 : very clear, unambiguous observation.
- 65-84  : reasonably visible, some minor ambiguity.
- 40-64  : partial or obscured view.
- 0-39   : very unclear or not in frame.

VIOLATION DETECTION RULES — report "violation" when:
- mask       : a person's face is clearly visible and they are NOT wearing a mask or face covering.
- glove      : hands are visible and clearly bare during food contact or food preparation.
- helmet     : hair/head is clearly visible without head cover, chef hat, hairnet, or equivalent kitchen headwear.
- uniform    : person clearly lacks proper kitchen uniform / apron / safety vest when expected.

Use "uncertain" only when the item is completely outside the frame. If you can see any part of a person, assess mask, glove, helmet, uniform as best you can.

Return JSON ONLY — no markdown fences, no text outside the JSON object:
{
  "people_count": <integer, number of people visible>,
  "checks": [
    {
      "key": "mask",
      "label_ar": "الكمامة",
      "status": "safe" | "violation" | "needs_review" | "uncertain",
      "status_ar": "سليم" | "مخالفة" | "يحتاج مراجعة" | "غير مؤكد",
      "confidence": <integer 0-100>,
      "reason_ar": "<one Arabic sentence describing exactly what you observe>"
    }
  ]
}

Include exactly one entry per key in this order: mask, glove, helmet, uniform, people_count.
"""

_NOT_VISIBLE_HINT = re.compile(
    r"not\s+visible|cannot\s+see|unclear|not\s+shown|not\s+clear|"
    r"غير\s+ظاهر|غير\s+واضح|لا\s+يظهر|لا\s+تظهر|غير\s+مرئي|لا\s+يمكن",
    re.IGNORECASE,
)

# Minimum confidence (0-100) for a Gemini "violation" to be recorded.
# Using the original AI status before display-bucketing so 65-84% violations
# are not silently dropped by the ≥85 display threshold.
_VIOLATION_CONF_THRESHOLD = 65


def _parse_json_object(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    t = text.strip()
    # Strip markdown code fences if present
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", t, re.IGNORECASE)
    if fence:
        t = fence.group(1).strip()
    try:
        obj = json.loads(t)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass
    # Try extracting the first {...} block
    start = t.find("{")
    end = t.rfind("}")
    if start >= 0 and end > start:
        try:
            obj = json.loads(t[start : end + 1])
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def _to_int_confidence(value: object) -> int:
    try:
        n = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    if n <= 1.0:
        n = n * 100.0
    return int(max(0.0, min(100.0, round(n))))


def _bucket_display_status(raw: str, conf: int) -> str:
    """Map raw AI status + confidence to a display status bucket.

    ≥85 : violation or safe preserved; 60–84 : needs_review; <60 : uncertain.
    """
    raw_l = (raw or "").strip().lower()
    if conf < 60:
        return "uncertain"
    if conf < 85:
        return "needs_review"
    if raw_l == "violation":
        return "violation"
    if raw_l == "safe":
        return "safe"
    return "uncertain"


def _thumbnail_jpeg_data_url(image_bytes: bytes, max_side: int = 720, quality: int = 72) -> str | None:
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        raw = buf.getvalue()
        b64 = standard_b64encode(raw).decode("ascii")
        return f"data:image/jpeg;base64,{b64}"
    except Exception:
        return None


def monitoring_image_snapshot(image_bytes: bytes) -> str | None:
    url = _thumbnail_jpeg_data_url(image_bytes)
    if not url:
        return None
    cap = max(10_000, settings.MONITORING_IMAGE_DATA_URL_MAX_CHARS)
    if len(url) > cap:
        return url[:cap]
    return url


def _merge_checks(parsed_checks: list[Any] | None) -> dict[str, dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    if isinstance(parsed_checks, list):
        for item in parsed_checks:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key", "")).strip()
            if key:
                by_key[key] = item
    return by_key


def _row_for_key(checks_in: list[dict[str, Any]], key: str) -> dict[str, Any]:
    for c in checks_in:
        if isinstance(c, dict) and str(c.get("key", "")).strip() == key:
            return c
    return {}


def _apply_visibility_post_rules(checks_out: list[dict[str, Any]]) -> None:
    """Downgrade impossible 'safe' calls when the reason admits poor visibility."""
    keys = {"glove", "helmet", "uniform"}
    for row in checks_out:
        if row.get("key") not in keys:
            continue
        if row.get("status") != "safe":
            continue
        reason = str(row.get("reason_ar") or "")
        if _NOT_VISIBLE_HINT.search(reason):
            row["status"] = "uncertain"
            row["status_ar"] = STATUS_AR["uncertain"]
            row["confidence"] = min(int(row.get("confidence") or 0), 55)


def _display_status(provider: str, raw_status: str, conf: int) -> str:
    """YOLO keeps raw violation/safe for clearer cards; Gemini keeps confidence buckets."""
    if provider == "yolo":
        rs = (raw_status or "").strip().lower()
        if rs in ("safe", "violation", "uncertain", "needs_review"):
            return rs
        return "uncertain"
    return _bucket_display_status(raw_status, conf)


def _finalize_payload(
    *,
    provider: str,
    camera_name: str | None,
    location: str | None,
    checks_in: list[dict[str, Any]],
    people_count_top: int | None = None,
    violation_conf_threshold: int = _VIOLATION_CONF_THRESHOLD,
    violations_override: list[dict[str, Any]] | None = None,
    violation_thresholds: dict[str, int] | None = None,
    default_violation_threshold: int | None = None,
    frame_report: dict[str, Any] | None = None,
    skip_display_bucket_for_yolo: bool = False,
) -> dict[str, Any]:
    checks_out: list[dict[str, Any]] = []
    # Track the original AI status (before display bucketing) so violation
    # detection is not blocked by the stricter ≥85 display threshold.
    original_status_by_key: dict[str, tuple[str, int]] = {}
    needs_review_any = False
    confidences: list[int] = []

    for key, default_label_ar in CHECK_DEFS:
        src = _row_for_key(checks_in, key)
        raw_status = str(src.get("status", "uncertain")).strip().lower()
        conf = _to_int_confidence(src.get("confidence", 0))
        label_ar = str(src.get("label_ar", "")).strip() or default_label_ar
        reason = str(src.get("reason_ar", "")).strip() or "—"
        disp = (
            _display_status(provider, raw_status, conf)
            if skip_display_bucket_for_yolo or provider == "yolo"
            else _bucket_display_status(raw_status, conf)
        )
        if disp == "needs_review":
            needs_review_any = True
        confidences.append(conf)
        original_status_by_key[key] = (raw_status, conf)
        checks_out.append(
            {
                "key": key,
                "label_ar": label_ar,
                "status": disp,
                "status_ar": STATUS_AR.get(disp, "غير مؤكد"),
                "confidence": conf,
                "reason_ar": reason,
            }
        )

    if provider == "gemini":
        _apply_visibility_post_rules(checks_out)
        for row in checks_out:
            if row.get("status") == "needs_review":
                needs_review_any = True

    # People count
    people_count = 0
    if people_count_top is not None:
        try:
            people_count = max(0, int(people_count_top))
        except (TypeError, ValueError):
            people_count = 0
    pc_row = _row_for_key(checks_in, "people_count")
    if people_count == 0 and pc_row:
        try:
            people_count = max(people_count, int(pc_row.get("count", pc_row.get("people_count", 0))))
        except (TypeError, ValueError):
            m = re.search(r"(\d+)", str(pc_row.get("reason_ar", "")))
            if m:
                try:
                    people_count = max(people_count, int(m.group(1)))
                except ValueError:
                    pass

    vtypes_from_checks = {
        "mask": "no_mask",
        "glove": "no_gloves",
        "helmet": "no_headcover",
        "uniform": "improper_uniform",
        "trash_floor": "trash_on_floor",
        "waste_area": "improper_waste_area",
    }

    violations_out: list[dict[str, Any]] = []

    if violations_override is not None:
        th_map = violation_thresholds or {}
        default_t = int(default_violation_threshold if default_violation_threshold is not None else violation_conf_threshold)
        for v in violations_override:
            if not isinstance(v, dict):
                continue
            vt = str(v.get("type", "")).strip()
            if not vt:
                continue
            cf = _to_int_confidence(v.get("confidence", 0))
            min_cf = int(th_map.get(vt, default_t))
            if cf < min_cf:
                continue
            reason = str(v.get("reason_ar", "")).strip() or "—"
            violations_out.append(
                {
                    "type": vt,
                    "label_ar": str(v.get("label_ar", "")).strip() or VIOLATION_TYPE_LABELS.get(vt, vt),
                    "confidence": cf,
                    "reason_ar": reason,
                    "description": str(v.get("description", "")).strip() or reason,
                    "status": str(v.get("status", "new")).strip() or "new",
                    **({"person_index": v["person_index"]} if v.get("person_index") is not None else {}),
                    **({"alias_of": v["alias_of"]} if v.get("alias_of") else {}),
                }
            )
            logger.info("violation recorded (override): type=%s conf=%d", vt, cf)
        needs_review_any = needs_review_any or bool(violations_out)
    else:
        existing_types: set[str] = set()

        for row in checks_out:
            if row["key"] == "people_count":
                continue
            orig_status, conf = original_status_by_key.get(row["key"], ("uncertain", 0))
            logger.debug("check key=%s orig=%s conf=%d disp=%s", row["key"], orig_status, conf, row["status"])
            if orig_status == "violation" and conf >= violation_conf_threshold:
                vt = vtypes_from_checks.get(row["key"])
                if vt and vt not in existing_types:
                    reason = row["reason_ar"]
                    violations_out.append(
                        {
                            "type": vt,
                            "label_ar": VIOLATION_TYPE_LABELS.get(vt, row["label_ar"]),
                            "confidence": conf,
                            "reason_ar": reason,
                            "description": reason,
                            "status": "new",
                        }
                    )
                    existing_types.add(vt)
                    logger.info("violation recorded: type=%s conf=%d", vt, conf)
                    if not needs_review_any:
                        needs_review_any = True

    overall = int(round(sum(confidences) / max(1, len(confidences)))) if confidences else 0

    # Build a plain-language Arabic summary
    display_violations = [v for v in violations_out if not v.get("alias_of")]
    vcount = len(display_violations)
    if provider == "yolo" and display_violations:
        parts = [
            f"{v.get('label_ar') or VIOLATION_TYPE_LABELS.get(v['type'], v['type'])} — {int(v.get('confidence', 0))}%"
            for v in display_violations
        ]
        summary = "؛ ".join(parts)
    elif vcount > 0:
        summary = f"تم اكتشاف {vcount} مخالفة."
    elif needs_review_any:
        summary = "بعض الفحوصات تحتاج مراجعة."
    else:
        summary = "لم يتم اكتشاف مخالفات."

    logger.info(
        "finalize: provider=%s violations=%d needs_review=%s overall_conf=%d summary=%s",
        provider, vcount, needs_review_any, overall, summary,
    )

    out: dict[str, Any] = {
        "ok": True,
        "status": "ok",
        "provider": provider,
        "camera_name": camera_name,
        "location": location,
        "people_count": people_count,
        "overall_confidence": overall,
        "needs_review": needs_review_any,
        "checks": checks_out,
        "violations": violations_out,
        "summary": summary,
    }
    if frame_report:
        out["frame_report"] = frame_report
    return out


def _gemini_model_candidates() -> list[str]:
    """Ordered list of model ids to try (configured first, then stable fallbacks)."""
    configured = (settings.MONITORING_GEMINI_MODEL or settings.GEMINI_VISION_MODEL or "").strip()
    # Prefer 2.5 models — they have separate quota from 2.0 on the free tier.
    fallbacks = [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
    ]
    out: list[str] = []
    for m in [configured, *fallbacks] if configured else fallbacks:
        if m and m not in out:
            out.append(m)
    return out


def _friendly_gemini_error(last_err: Exception | None) -> str:
    if last_err is None:
        return "فشل تحليل الصورة عبر Gemini."
    text = str(last_err)
    low = text.lower()
    if (
        "api_key_invalid" in low
        or "invalid api key" in low
        or "api key not valid" in low
        or "permission_denied" in low
        or "reported as leaked" in low
    ):
        return "مفتاح Gemini غير صحيح أو غير مفعّل. تحقق من MONITORING_GEMINI_API_KEY في backend/.env"
    if (
        "not_found" in low
        or "model is not found" in low
        or "not supported for generatecontent" in low
    ):
        return "الموديل غير مدعوم لهذا المفتاح أو نسخة API. تحقق من MONITORING_GEMINI_MODEL في backend/.env"
    if "resource_exhausted" in low or "quota exceeded" in low:
        return "انتهت كوتا Gemini أو تحتاج تفعيل billing. تحقق من حسابك في console.cloud.google.com"
    return "فشل تحليل الصورة عبر Gemini."


def _run_gemini_monitoring(image_bytes: bytes, camera_name: str | None, location: str | None) -> dict[str, Any]:
    key = (settings.MONITORING_GEMINI_API_KEY or settings.GEMINI_API_KEY or "").strip()
    if not key:
        raise ValueError("AI المراقبة غير مفعل. يرجى إضافة مفتاح Gemini API.")

    model_candidates = _gemini_model_candidates()
    logger.info(
        "monitoring gemini: models_to_try=%s image_bytes=%d demo_mode=%s",
        model_candidates, len(image_bytes), settings.MONITORING_AI_DEMO_MODE,
    )

    try:
        from PIL import Image
    except ImportError:
        logger.warning("monitoring: Pillow missing")
        raise ValueError(
            "تعذر تحميل مكتبات الذكاء الاصطناعي على الخادم. "
            "في مجلد backend نفّذ: pip install Pillow"
        ) from None

    # Decode and re-encode as JPEG for consistent Gemini input
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        jpeg_bytes = buf.getvalue()
        logger.info("monitoring gemini: jpeg_bytes=%d", len(jpeg_bytes))
    except Exception as exc:
        logger.warning("monitoring gemini: image decode failed: %s", exc)
        raise ValueError("الصورة غير صالحة.") from exc

    last_err: Exception | None = None
    resp_text = ""
    used_model = ""
    # Try modern SDK first (google-genai), then fallback to legacy (google-generativeai).
    try:
        from google import genai
        from google.genai import types as genai_types

        # 15-second per-model timeout; no SDK-level retry (rely on model cascade instead).
        _http_opts = genai_types.HttpOptions(timeout=15_000, retry_options=None)
        client = genai.Client(api_key=key, http_options=_http_opts)
        try:
            safety_off = [
                genai_types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
                genai_types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
                genai_types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
                genai_types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
            ]
            call_config = genai_types.GenerateContentConfig(safety_settings=safety_off)
        except Exception:
            call_config = None

        for model_name in model_candidates:
            try:
                img_part = genai_types.Part.from_bytes(data=jpeg_bytes, mime_type="image/jpeg")
                if call_config is not None:
                    resp = client.models.generate_content(
                        model=model_name,
                        contents=[GEMINI_PROMPT_MONITORING, img_part],
                        config=call_config,
                    )
                else:
                    resp = client.models.generate_content(
                        model=model_name,
                        contents=[GEMINI_PROMPT_MONITORING, img_part],
                    )
                used_model = model_name
                last_err = None
                try:
                    resp_text = (resp.text or "").strip()
                except Exception:
                    candidates = getattr(resp, "candidates", None) or []
                    if candidates:
                        content = getattr(candidates[0], "content", None)
                        parts = getattr(content, "parts", None) or [] if content else []
                        resp_text = "".join(getattr(p, "text", None) or "" for p in parts).strip()
                if resp_text:
                    break
            except Exception as exc:
                last_err = exc
                logger.warning(
                    "monitoring gemini(request/new-sdk) failed model=%s: %s — %s",
                    model_name,
                    type(exc).__name__,
                    exc,
                )
                continue
    except ImportError:
        logger.info("monitoring: google-genai not available, trying google-generativeai fallback")

    if not resp_text:
        try:
            import google.generativeai as legacy_genai

            legacy_genai.configure(api_key=key)
            pil_image = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
            safety_settings = [
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            ]
            for model_name in model_candidates:
                try:
                    model = legacy_genai.GenerativeModel(model_name=model_name, safety_settings=safety_settings)
                    resp = model.generate_content([GEMINI_PROMPT_MONITORING, pil_image])
                    used_model = model_name
                    last_err = None
                    resp_text = str(getattr(resp, "text", "") or "").strip()
                    if resp_text:
                        break
                except Exception as exc:
                    last_err = exc
                    logger.warning(
                        "monitoring gemini(request/legacy-sdk) failed model=%s: %s — %s",
                        model_name,
                        type(exc).__name__,
                        exc,
                    )
                    continue
        except ImportError as exc:
            last_err = exc

    if not resp_text:
        friendly = _friendly_gemini_error(last_err)
        hint = (
            "تحقق من MONITORING_GEMINI_API_KEY وMONITORING_GEMINI_MODEL في backend/.env، "
            "وتأكد من تثبيت مكتبة واحدة على الأقل: google-genai أو google-generativeai."
        )
        err_bit = f" ({type(last_err).__name__})" if last_err else ""
        logger.error("monitoring gemini: all model attempts failed%s", err_bit)
        raise ValueError(
            f"{friendly}{err_bit} {hint}"
        ) from last_err
    logger.info("monitoring gemini: success with model=%s", used_model)

    logger.info("monitoring gemini: response_len=%d", len(resp_text))
    if resp_text:
        logger.debug("monitoring gemini: raw_text_preview=%.500s", resp_text)

    data = _parse_json_object(resp_text)
    if not data:
        logger.warning("monitoring gemini: JSON parse failed — uncertain fallback. raw=%.500s", resp_text)
        return _finalize_payload(
            provider="gemini",
            camera_name=camera_name,
            location=location,
            checks_in=[],
            people_count_top=0,
        )

    logger.info("monitoring gemini: parsed checks=%d people=%s", len(data.get("checks") or []), data.get("people_count"))

    checks_merged = _merge_checks(data.get("checks"))
    checks_list: list[dict[str, Any]] = []
    for ck, lab in CHECK_DEFS:
        row = checks_merged.get(ck, {})
        checks_list.append(
            {
                "key": ck,
                "label_ar": str(row.get("label_ar", "")).strip() or lab,
                "status": str(row.get("status", "uncertain")).strip().lower(),
                "confidence": _to_int_confidence(row.get("confidence", 0)),
                "reason_ar": str(row.get("reason_ar", "")).strip() or "—",
            }
        )
    try:
        pc = int(data.get("people_count", 0))
    except (TypeError, ValueError):
        pc = 0
    for i, c in enumerate(checks_list):
        if c["key"] == "people_count":
            checks_list[i] = {**c, "reason_ar": f"العدد المقدَّر: {pc}. {c['reason_ar']}".strip()}
            break

    return _finalize_payload(
        provider="gemini",
        camera_name=camera_name,
        location=location,
        checks_in=checks_list,
        people_count_top=pc,
    )


def _analyze_demo(camera_name: str | None, location: str | None) -> dict[str, Any]:
    checks_list = [
        {"key": "mask",           "label_ar": "الكمامة",              "status": "violation", "confidence": 90, "reason_ar": "وضع تجريبي: كشف تجريبي للكمامة فقط."},
        {"key": "glove",          "label_ar": "القفازات",             "status": "safe",      "confidence": 88, "reason_ar": "وضع تجريبي."},
        {"key": "helmet",         "label_ar": "غطاء الرأس / قبعة الشيف", "status": "uncertain", "confidence": 50, "reason_ar": "وضع تجريبي."},
        {"key": "uniform",        "label_ar": "الزي الرسمي",          "status": "safe",      "confidence": 85, "reason_ar": "وضع تجريبي."},
        {"key": "people_count",   "label_ar": "عدد الأشخاص",          "status": "safe",      "confidence": 92, "reason_ar": "وضع تجريبي."},
    ]
    return _finalize_payload(
        provider="demo",
        camera_name=camera_name,
        location=location,
        checks_in=checks_list,
        people_count_top=2,
    )


def analyze_monitoring_frame(
    *,
    image_bytes: bytes,
    content_type: str | None,
    camera_name: str | None,
    location: str | None,
) -> dict[str, Any]:
    logger.info(
        "analyze_monitoring_frame: content_type=%s bytes=%d",
        content_type or "—", len(image_bytes),
    )

    if not image_bytes:
        raise ValueError("الصورة غير صالحة.")

    # Browsers / proxies sometimes send application/octet-stream; PIL validates real image bytes.
    ct = (content_type or "").strip().lower()
    if ct and not ct.startswith("image/") and ct not in (
        "application/octet-stream",
        "binary/octet-stream",
    ):
        raise ValueError("الصورة غير صالحة.")

    if settings.MONITORING_AI_DEMO_MODE:
        return _analyze_demo(camera_name, location)

    if not settings.YOLO_ENABLED:
        raise ValueError("YOLO is disabled (YOLO_ENABLED=false).")

    from app.services.yolo_monitoring_service import analyze_frame_yolo  # noqa: PLC0415

    return analyze_frame_yolo(image_bytes, camera_name, location)
