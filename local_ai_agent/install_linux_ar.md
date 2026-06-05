# دليل التثبيت — Linux (Ubuntu / Debian)

> عين الجودة · الوكيل المحلي YOLO · Ubuntu 22.04+ / Debian 12+

---

## 1. المتطلبات المسبقة

```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip \
    libgl1-mesa-glx libglib2.0-0 ffmpeg v4l-utils
```

### NVIDIA GPU (اختياري — موصى به للإنتاج)

```bash
# تحقق من البطاقة
nvidia-smi

# إذا لم يظهر — ثبّت التعريف
sudo apt install -y nvidia-driver-535
sudo reboot
```

---

## 2. إنشاء البيئة الافتراضية

```bash
cd /opt/taeen/local_ai_agent   # أو مسار المشروع
python3.11 -m venv .venv
source .venv/bin/activate
python --version
```

---

## 3. تثبيت PyTorch

### مع GPU (CUDA 12.1)

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

### CPU فقط

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

---

## 4. تثبيت بقية المتطلبات

```bash
pip install -r requirements.txt
```

---

## 5. التحقق من CUDA

```bash
python agent.py --gpu-check
```

---

## 6. ضبط الإعداد

```bash
cp config.example.yaml config.yaml
nano config.yaml
```

عدّل `backend_url`, `agent_api_key`, وروابط RTSP.

---

## 7. وضع أوزان YOLO

```bash
mkdir -p models
# انسخ الملفات:
# models/ppe_yolo.pt
# models/environment_yolo.pt
chmod 600 config.yaml   # حماية بيانات الاعتماد
```

---

## 8. الاختبار

```bash
python agent.py --test-camera
python agent.py --test-backend
python agent.py --once
```

---

## 9. التشغيل كخدمة systemd (إنتاج)

أنشئ `/etc/systemd/system/taeen-local-agent.service`:

```ini
[Unit]
Description=عين الجودة — الوكيل المحلي YOLO
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=taeen
Group=taeen
WorkingDirectory=/opt/taeen/local_ai_agent
Environment=PATH=/opt/taeen/local_ai_agent/.venv/bin
ExecStart=/opt/taeen/local_ai_agent/.venv/bin/python agent.py
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

تفعيل الخدمة:

```bash
sudo systemctl daemon-reload
sudo systemctl enable taeen-local-agent
sudo systemctl start taeen-local-agent
sudo systemctl status taeen-local-agent
journalctl -u taeen-local-agent -f
```

---

## 10. جدار الحماية (ufw)

```bash
# اسمح بالخروج HTTPS فقط (افتراضي غالباً)
sudo ufw allow out 443/tcp
# لا تفتح منافذ واردة للوكيل من الإنترنت
```

---

## استكشاف أخطاء Linux

| الخطأ | الحل |
|-------|------|
| `libGL.so.1` مفقود | `sudo apt install libgl1-mesa-glx` |
| RTSP فشل | `ffplay rtsp://...` للاختبار |
| CUDA OOM | زِد `frame_interval_seconds`؛ قلّل الكاميرات |
| Permission denied config | `chmod 600 config.yaml` |
