# الوكيل المحلي للذكاء الاصطناعي — عين الجودة

> **Local AI Agent v1.0** · يونيو 2026  
> يشغّل YOLO محلياً داخل شبكة المطعم ويرسل التنبيهات فقط إلى المنصة السحابية.

---

## لماذا الوكيل المحلي أفضل من Render للـ YOLO؟

| المعيار | Render (سحابي) | الوكيل المحلي |
|---------|----------------|---------------|
| الوصول إلى الكاميرات | ❌ لا يمكن الوصول لـ RTSP داخل LAN | ✅ مباشر عبر الشبكة المحلية |
| GPU | ❌ محدود / مكلف | ✅ RTX محلي بكامل الطاقة |
| زمن الاستجابة | بطيء (رفع إطار → سحابة → رد) | فوري (إطار → YOLO → تنبيه) |
| الخصوصية | بث RTSP يخرج من المطعم | ✅ الكاميرات تبقى داخل LAN |
| التكلفة الشهرية | Render GPU مرتفع | جهاز محلي لمرة واحدة |
| الاستقرار | يتأثر بحدود الذاكرة/الشبكة | يعمل 24/7 على جهاز مخصص |

**الخلاصة:** الكاميرات IP/RTSP موجودة داخل شبكة المطعم ولا يمكن للخادم السحابي الوصول إليها. الوكيل المحلي يحل هذه المشكلة ويستفيد من GPU محلي قوي.

---

## المعمارية

```
┌─────────────────────────────────────────────────────────────┐
│                    شبكة المطعم المحلية (LAN)                │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ كاميرا   │  │ كاميرا   │  │ كاميرا   │  RTSP/IP         │
│  │ المطبخ   │  │ التخزين  │  │ التحضير  │                  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
│       │             │             │                         │
│       └─────────────┼─────────────┘                         │
│                     ▼                                       │
│         ┌───────────────────────┐                           │
│         │  Local AI Agent       │                           │
│         │  Python + YOLO + CUDA │                           │
│         │                       │                           │
│         │  ┌─ PPE model ──────┐ │  قفازات، كمامة،           │
│         │  │  (نفس الإطار)    │ │  غطاء رأس، زي رسمي        │
│         │  └─ Env model ─────┘ │  أرضية مبللة، نفايات،     │
│         │                       │  اتساخ، ممر مسدود         │
│         └───────────┬───────────┘                           │
└─────────────────────┼───────────────────────────────────────┘
                      │ HTTPS فقط
                      │ POST /api/v1/local-agent/alerts
                      │ (تنبيهات + لقطات دليل — بدون RTSP)
                      ▼
         ┌───────────────────────┐
         │  Render Backend       │
         │  PostgreSQL           │
         │  monitoring_alerts    │
         └───────────┬───────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  لوحة المشرف          │
         │  (Dashboard)          │
         │  التنبيهات + الأدلة   │
         └───────────────────────┘
```

---

## كيف يُحلّل الإطار الواحد (PPE + البيئة معاً)

في **كل دورة** لكل كاميرا:

1. يُقرأ إطار واحد من RTSP.
2. يُمرَّر **نفس الإطار** على نموذج PPE → يكشف: `no_gloves`, `no_mask`, `no_headcover`, `improper_uniform`.
3. يُمرَّر **نفس الإطار** على نموذج البيئة → يكشف: `wet_floor`, `trash_on_floor`, `unclean_area`, `blocked_path`, `unsafe_area`.
4. يُدمَج الناتجان — إطار واحد قد ينتج **عدة مخالفات في آن واحد**.
5. لكل مخالفة فوق عتبة الثقة: لقطة دليل + إرسال إلى الخادم.

---

## المتطلبات السريعة

| البند | القيمة |
|-------|--------|
| Python | 3.10+ |
| PyTorch | 2.1+ (مع CUDA لـ NVIDIA) |
| Ultralytics YOLO | 8.1+ |
| OpenCV | 4.8+ |
| CUDA | لبطاقات NVIDIA (اختياري للاختبار) |
| تخزين | 100GB+ موصى به |
| شبكة | LAN مستقرة + إنترنت للخادم |

انظر **`docs/LOCAL_YOLO_AGENT_REQUIREMENTS_AR.md`** لجدول الأجهزة الكامل.

---

## التثبيت السريع

### Windows
انظر **`install_windows_ar.md`**

### Linux
انظر **`install_linux_ar.md`**

### خطوات مشتركة

```bash
cd local_ai_agent
python -m venv .venv
# Windows:  .venv\Scripts\activate
# Linux:    source .venv/bin/activate

# GPU (NVIDIA CUDA 12.1 مثال):
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

# CPU فقط (اختبار):
# pip install torch torchvision

pip install -r requirements.txt
cp config.example.yaml config.yaml
# عدّل config.yaml: backend_url, agent_api_key, rtsp_url لكل كاميرا
```

---

## ضبط المفتاح على الخادم (Render)

في لوحة Render → Environment Variables للـ Backend:

```
AGENT_API_KEY=<مفتاح-سري-قوي-32-حرفاً-أو-أكثر>
```

انسخ **نفس القيمة** إلى `agent_api_key` في `config.yaml` المحلي.

---

## أوامر التشغيل

```bash
# التحقق من GPU
python agent.py --gpu-check

# اختبار كاميرا واحدة (RTSP)
python agent.py --test-camera

# اختبار الاتصال بالخادم والمفتاح
python agent.py --test-backend

# دورة واحدة (اختبار كامل)
python agent.py --once

# التشغيل المستمر (الإنتاج)
python agent.py
```

**أمر الإنتاج الرئيسي:**

```bash
python agent.py
```

---

## ربط الكاميرات

1. تأكد أن الكاميرات **IP/RTSP** داخل شبكة المطعم (192.168.x.x).
2. احصل على رابط RTSP من إعدادات الكاميرا أو دليل الشركة المصنعة.
3. الصيغة الشائعة: `rtsp://username:password@IP:554/stream1`
4. أضف كل كاميرا في `config.yaml` مع `camera_id` و `zone_id` المطابقين للمنصة.
5. شغّل `python agent.py --test-camera` للتحقق.

> **أمان:** لا تشارك `config.yaml` ولا ترفعه لأي مكان عام — يحتوي على بيانات اعتماد الكاميرات.

---

## كيف تصل التنبيهات للوحة المشرف

1. الوكيل يكتشف مخالفة → يُرسل `POST /api/v1/local-agent/alerts`.
2. الخادم يخزّن في `monitoring_alerts` (PostgreSQL) مع لقطة الدليل.
3. المشرف يفتح لوحة التحكم → قسم **التنبيهات** → يرى المخالفة فوراً.
4. المصدر: `local_ai_agent` — لا يظهر أي رابط RTSP في الواجهة.

---

## التحقق من عمل GPU

```bash
python agent.py --gpu-check
```

المخرجات المتوقعة (GPU):

```
agent_version=1.0.0
torch=2.1.0+cu121
cuda_available=True
cuda_version=12.1
device_count=1
  gpu[0]=NVIDIA GeForce RTX 3060
selected_device=cuda
```

إذا ظهر `cuda_available=False` → الوكيل يعمل على CPU (أبطأ، مناسب لكاميرا واحدة للاختبار).

---

## اختبار بكاميرا واحدة أولاً

1. اترك كاميرا واحدة فقط في `config.yaml`.
2. `python agent.py --test-camera` — تأكد من قراءة الإطار.
3. `python agent.py --test-backend` — تأكد من المفتاح.
4. `python agent.py --once` — دورة كاملة YOLO + إرسال.
5. افتح لوحة المشرف وتحقق من ظهور التنبيه.
6. أضف بقية الكاميرات تدريجياً.

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---------|------|
| `cuda_available=False` | ثبّت PyTorch مع CUDA؛ حدّث تعريف NVIDIA |
| `Out of memory` GPU | قلّل عدد الكاميرات؛ ارفع `frame_interval_seconds`؛ استخدم GPU أقوى |
| فشل RTSP | تحقق من IP/منفذ/اسم مستخدم؛ جرّب VLC على نفس الرابط |
| HTTP 401 | `agent_api_key` لا يطابق `AGENT_API_KEY` على Render |
| HTTP 503 | لم يُضبط `AGENT_API_KEY` على الخادم بعد |
| تنبيهات مكررة | زِد `alert_cooldown_seconds` في config.yaml |
| بطء شديد | استخدم GPU؛ قلّل دقة الكاميرا من إعداداتها |

---

## هيكل المجلد

```
local_ai_agent/
├── agent.py              # البرنامج الرئيسي
├── config.yaml           # إعداد التشغيل (عدّل للإنتاج)
├── config.example.yaml   # نموذج آمن للنسخ
├── requirements.txt
├── README_AR.md          # هذا الملف
├── install_windows_ar.md
├── install_linux_ar.md
├── models/
│   ├── ppe_yolo.pt       # ضع أوزان PPE هنا
│   └── environment_yolo.pt
└── snapshots/            # لقطات مؤقتة (تُنشأ تلقائياً)
```

---

## المراجع

- `docs/LOCAL_YOLO_AGENT_REQUIREMENTS_AR.md` — مواصفات الأجهزة
- `docs/CAMERA_SECURITY_AR.md` — أمان الكاميرات
- `docs/DATABASE_ARCHITECTURE_AR.md` — معمارية قاعدة البيانات
