"""Fixed monitoring zones — must match frontend MONITORING_ZONE_DEFINITIONS ids."""

from __future__ import annotations

MONITORING_ZONE_IDS = ("kitchen", "storage", "prep")

MONITORING_ZONE_DEFAULTS: dict[str, dict[str, str]] = {
    "kitchen": {
        "zone_id": "kitchen",
        "cam_code": "CAM-01",
        "zone_ar": "منطقة المطبخ",
        "display_name_ar": "كاميرا المطبخ الرئيسية",
    },
    "storage": {
        "zone_id": "storage",
        "cam_code": "CAM-02",
        "zone_ar": "منطقة التخزين",
        "display_name_ar": "كاميرا التخزين",
    },
    "prep": {
        "zone_id": "prep",
        "cam_code": "CAM-03",
        "zone_ar": "منطقة تحضير الطعام",
        "display_name_ar": "كاميرا التحضير",
    },
}

CONNECTION_TYPE_IP = "ip_camera"
CONNECTION_TYPE_RTSP = "rtsp_url"
