# دليل التثبيت — Windows

> عين الجودة · الوكيل المحلي YOLO · Windows 10/11

---

## 1. المتطلبات المسبقة

| البرنامج | الإصدار | الرابط |
|----------|---------|--------|
| Python | 3.10 أو 3.11 | https://www.python.org/downloads/ |
| NVIDIA Driver | أحدث | https://www.nvidia.com/drivers |
| CUDA Toolkit | 12.1 (لـ GPU) | https://developer.nvidia.com/cuda-downloads |
| Git (اختياري) | أحدث | https://git-scm.com/download/win |

> عند تثبيت Python: فعّل **"Add Python to PATH"**.

---

## 2. إنشاء البيئة الافتراضية

افتح **PowerShell** أو **CMD** كمسؤول:

```powershell
cd C:\path\to\ska-system\local_ai_agent
python -m venv .venv
.venv\Scripts\activate
python --version
```

---

## 3. تثبيت PyTorch

### مع GPU (NVIDIA + CUDA 12.1)

```powershell
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

### CPU فقط (اختبار بدون GPU)

```powershell
pip install torch torchvision
```

---

## 4. تثبيت بقية المتطلبات

```powershell
pip install -r requirements.txt
```

---

## 5. التحقق من CUDA

```powershell
python -c "import torch; print('CUDA:', torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
```

أو:

```powershell
python agent.py --gpu-check
```

---

## 6. ضبط الإعداد

```powershell
copy config.example.yaml config.yaml
notepad config.yaml
```

عدّل:
- `backend_url` — عنوان Render
- `agent_api_key` — نفس `AGENT_API_KEY` على الخادم
- `rtsp_url` لكل كاميرا
- مسارات النماذج في `models/`

---

## 7. وضع أوزان YOLO

انسخ ملفات `.pt` إلى:

```
local_ai_agent\models\ppe_yolo.pt
local_ai_agent\models\environment_yolo.pt
```

---

## 8. الاختبار

```powershell
python agent.py --test-camera
python agent.py --test-backend
python agent.py --once
```

---

## 9. التشغيل كخدمة Windows (إنتاج)

### باستخدام NSSM (موصى به)

1. حمّل NSSM: https://nssm.cc/download
2. ثبّت الخدمة:

```powershell
nssm install TaeenLocalAgent "C:\path\to\local_ai_agent\.venv\Scripts\python.exe" "C:\path\to\local_ai_agent\agent.py"
nssm set TaeenLocalAgent AppDirectory "C:\path\to\local_ai_agent"
nssm set TaeenLocalAgent DisplayName "عين الجودة — الوكيل المحلي"
nssm set TaeenLocalAgent Description "YOLO violation detection for restaurant cameras"
nssm start TaeenLocalAgent
```

### أو Task Scheduler

1. افتح **Task Scheduler** → Create Task
2. Trigger: At startup
3. Action: Start program → `python.exe` مع arguments: `agent.py`
4. Start in: مسار `local_ai_agent`

---

## 10. جدار الحماية

- اسمح لـ Python بالوصول للشبكة المحلية (LAN) للكاميرات.
- اسمح بالاتصال الصادر HTTPS (443) إلى `taeen-quality-platform.onrender.com`.
- **لا** تفتح منافذ واردة من الإنترنت للوكيل.

---

## استكشاف أخطاء Windows

| الخطأ | الحل |
|-------|------|
| `python` غير معروف | أعد تثبيت Python مع Add to PATH |
| `DLL load failed` (torch) | ثبّت Visual C++ Redistributable 2015–2022 |
| RTSP timeout | جرّب الرابط في VLC أولاً |
| CUDA not available | حدّث تعريف NVIDIA؛ أعد تثبيت torch+cu121 |
