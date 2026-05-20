import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ACCESS_TOKEN_KEY } from "../constants.js";
import { analyzeMask } from "../services/maskDetectionService.js";

// Box colours per class
const BOX_COLORS = {
  mask: "#22c55e",     // green — compliant
  no_mask: "#ef4444",  // red   — violation
};
const DEFAULT_COLOR = "#f59e0b";

function drawBoxes(canvas, img, boxes) {
  const ctx = canvas.getContext("2d");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);

  for (const box of boxes) {
    const color = BOX_COLORS[box.class_name] ?? DEFAULT_COLOR;
    const { x1, y1, x2, y2, class_name, confidence } = box;
    const w = x2 - x1;
    const h = y2 - y1;

    // Box stroke
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, canvas.width / 300);
    ctx.strokeRect(x1, y1, w, h);

    // Label background
    const label = `${class_name} ${(confidence * 100).toFixed(1)}%`;
    const fontSize = Math.max(12, canvas.width / 50);
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textW = ctx.measureText(label).width + 8;
    const textH = fontSize + 6;
    ctx.fillStyle = color;
    ctx.fillRect(x1, Math.max(0, y1 - textH), textW, textH);

    // Label text
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x1 + 4, Math.max(fontSize, y1 - 4));
  }
}

export default function MaskDetectionTest() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);   // {detected, violations, boxes}
  const [error, setError] = useState(null);

  const imgRef = useRef(null);
  const canvasRef = useRef(null);

  // Redirect to login when token is absent
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  useEffect(() => {
    if (!token) navigate("/login", { replace: true });
  }, [token, navigate]);

  const handleFileChange = useCallback((e) => {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    setFile(chosen);
    setResult(null);
    setError(null);
    const url = URL.createObjectURL(chosen);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, []);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      if (!file || !token) return;
      setLoading(true);
      setError(null);
      setResult(null);

      const res = await analyzeMask(token, file);
      setLoading(false);

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          // Token expired or invalid — clear it and redirect to login
          localStorage.removeItem(ACCESS_TOKEN_KEY);
          navigate("/login", { replace: true });
          return;
        }
        setError(res.error ?? "حدث خطأ غير متوقع");
        return;
      }
      setResult(res.data);
    },
    [file, token]
  );

  // Draw boxes on canvas whenever result or image changes
  useEffect(() => {
    if (!result || !canvasRef.current || !imgRef.current) return;
    const img = imgRef.current;
    if (img.complete && img.naturalWidth > 0) {
      drawBoxes(canvasRef.current, img, result.boxes ?? []);
    } else {
      img.onload = () => drawBoxes(canvasRef.current, img, result.boxes ?? []);
    }
  }, [result, previewUrl]);

  const hasViolation = result?.violations?.length > 0;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <button style={styles.backBtn} onClick={() => navigate(-1)}>← رجوع</button>
          <h1 style={styles.title}>اختبار كشف الكمامة</h1>
          <p style={styles.subtitle}>
            ارفع صورة لاختبار نموذج <strong>mask_best.pt</strong> — يكشف عن وجود / غياب الكمامة
          </p>
        </div>

        {/* Upload form */}
        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.fileLabel}>
            <span style={styles.fileLabelText}>
              {file ? file.name : "اختر صورة (JPG / PNG / WEBP)"}
            </span>
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </label>

          <button
            type="submit"
            disabled={!file || loading}
            style={{
              ...styles.submitBtn,
              opacity: !file || loading ? 0.5 : 1,
              cursor: !file || loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "جاري التحليل…" : "تحليل الصورة"}
          </button>
        </form>

        {/* Error */}
        {error && (
          <div style={styles.errorBox}>
            <strong>خطأ: </strong>{error}
          </div>
        )}

        {/* Image + canvas overlay */}
        {previewUrl && (
          <div style={styles.canvasWrapper}>
            {/* Hidden img used as drawImage source */}
            <img
              ref={imgRef}
              src={previewUrl}
              alt="preview"
              style={{ display: "none" }}
              crossOrigin="anonymous"
            />
            {result ? (
              <canvas
                ref={canvasRef}
                style={styles.canvas}
              />
            ) : (
              <img
                src={previewUrl}
                alt="preview"
                style={styles.canvas}
              />
            )}
          </div>
        )}

        {/* Results panel */}
        {result && (
          <div style={styles.resultsPanel}>
            {/* Summary badge */}
            <div
              style={{
                ...styles.badge,
                background: hasViolation ? "#fef2f2" : "#f0fdf4",
                borderColor: hasViolation ? "#fca5a5" : "#86efac",
                color: hasViolation ? "#b91c1c" : "#15803d",
              }}
            >
              {hasViolation
                ? `⚠️ مخالفة: بدون كمامة (${result.violations.join(", ")})`
                : result.detected
                ? "✅ الكمامة موجودة — لا مخالفات"
                : "ℹ️ لم يتم اكتشاف أي شخص في الصورة"}
            </div>

            {/* Boxes table */}
            {result.boxes.length > 0 && (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>#</th>
                    <th style={styles.th}>الفئة</th>
                    <th style={styles.th}>الثقة</th>
                    <th style={styles.th}>x1</th>
                    <th style={styles.th}>y1</th>
                    <th style={styles.th}>x2</th>
                    <th style={styles.th}>y2</th>
                  </tr>
                </thead>
                <tbody>
                  {result.boxes.map((box, i) => (
                    <tr key={i} style={styles.tr}>
                      <td style={styles.td}>{i + 1}</td>
                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.classTag,
                            background: BOX_COLORS[box.class_name] ?? DEFAULT_COLOR,
                          }}
                        >
                          {box.class_name}
                        </span>
                      </td>
                      <td style={styles.td}>{(box.confidence * 100).toFixed(1)}%</td>
                      <td style={styles.td}>{box.x1}</td>
                      <td style={styles.td}>{box.y1}</td>
                      <td style={styles.td}>{box.x2}</td>
                      <td style={styles.td}>{box.y2}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline styles ──────────────────────────────────────────────────────────────
const styles = {
  page: {
    minHeight: "100vh",
    background: "#0f172a",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    padding: "2rem 1rem",
    fontFamily: "'Segoe UI', Arial, sans-serif",
    direction: "rtl",
  },
  card: {
    background: "#1e293b",
    borderRadius: "1rem",
    padding: "2rem",
    width: "100%",
    maxWidth: "860px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    color: "#e2e8f0",
  },
  header: {
    marginBottom: "1.5rem",
  },
  backBtn: {
    background: "transparent",
    border: "1px solid #475569",
    color: "#94a3b8",
    borderRadius: "0.5rem",
    padding: "0.3rem 0.8rem",
    cursor: "pointer",
    fontSize: "0.85rem",
    marginBottom: "0.75rem",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
    margin: "0 0 0.25rem",
    color: "#f1f5f9",
  },
  subtitle: {
    fontSize: "0.9rem",
    color: "#94a3b8",
    margin: 0,
  },
  form: {
    display: "flex",
    gap: "0.75rem",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: "1.25rem",
  },
  fileLabel: {
    flex: 1,
    minWidth: "200px",
    display: "flex",
    alignItems: "center",
    background: "#0f172a",
    border: "1px dashed #475569",
    borderRadius: "0.5rem",
    padding: "0.6rem 1rem",
    cursor: "pointer",
  },
  fileLabelText: {
    color: "#94a3b8",
    fontSize: "0.9rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  submitBtn: {
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: "0.5rem",
    padding: "0.65rem 1.5rem",
    fontSize: "0.95rem",
    fontWeight: 600,
    transition: "opacity 0.15s",
  },
  errorBox: {
    background: "#450a0a",
    border: "1px solid #b91c1c",
    borderRadius: "0.5rem",
    padding: "0.75rem 1rem",
    color: "#fca5a5",
    marginBottom: "1rem",
    fontSize: "0.9rem",
  },
  canvasWrapper: {
    width: "100%",
    background: "#0f172a",
    borderRadius: "0.75rem",
    overflow: "hidden",
    marginBottom: "1.25rem",
    display: "flex",
    justifyContent: "center",
  },
  canvas: {
    maxWidth: "100%",
    maxHeight: "520px",
    objectFit: "contain",
    display: "block",
  },
  resultsPanel: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  badge: {
    border: "1px solid",
    borderRadius: "0.6rem",
    padding: "0.65rem 1rem",
    fontWeight: 600,
    fontSize: "0.95rem",
    textAlign: "center",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.85rem",
  },
  th: {
    background: "#0f172a",
    color: "#94a3b8",
    padding: "0.5rem 0.75rem",
    textAlign: "center",
    fontWeight: 600,
    borderBottom: "1px solid #334155",
  },
  tr: {
    borderBottom: "1px solid #1e293b",
  },
  td: {
    padding: "0.45rem 0.75rem",
    textAlign: "center",
    color: "#cbd5e1",
  },
  classTag: {
    display: "inline-block",
    color: "#fff",
    borderRadius: "0.35rem",
    padding: "0.15rem 0.5rem",
    fontSize: "0.8rem",
    fontWeight: 600,
  },
};
