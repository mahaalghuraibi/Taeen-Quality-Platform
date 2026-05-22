import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ACCESS_TOKEN_KEY } from "../constants.js";
import { analyzePeopleCount } from "../services/peopleCountService.js";

const BOX_COLOR = "#3b82f6";        // blue — person box
const VIOLATION_BOX_COLOR = "#ef4444"; // red when crowd limit exceeded

function drawBoxes(canvas, img, boxes, violation) {
  const ctx = canvas.getContext("2d");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);

  const color = violation ? VIOLATION_BOX_COLOR : BOX_COLOR;
  const fontSize = Math.max(11, canvas.width / 55);
  ctx.font = `bold ${fontSize}px sans-serif`;

  boxes.forEach((box, idx) => {
    const { x1, y1, x2, y2, confidence } = box;
    const w = x2 - x1;
    const h = y2 - y1;

    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, canvas.width / 300);
    ctx.strokeRect(x1, y1, w, h);

    const label = `P${idx + 1} ${(confidence * 100).toFixed(0)}%`;
    const textW = ctx.measureText(label).width + 8;
    const textH = fontSize + 6;
    ctx.fillStyle = color;
    ctx.fillRect(x1, Math.max(0, y1 - textH), textW, textH);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x1 + 4, Math.max(fontSize, y1 - 4));
  });
}

export default function PeopleCountTest() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [maxAllowed, setMaxAllowed] = useState(5);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const imgRef = useRef(null);
  const canvasRef = useRef(null);

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

      const res = await analyzePeopleCount(token, file, maxAllowed);
      setLoading(false);

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem(ACCESS_TOKEN_KEY);
          navigate("/login", { replace: true });
          return;
        }
        setError(res.error ?? "حدث خطأ غير متوقع");
        return;
      }
      setResult(res.data);
    },
    [file, token, maxAllowed, navigate]
  );

  // Draw boxes whenever result or preview changes
  useEffect(() => {
    if (!result || !canvasRef.current || !imgRef.current) return;
    const img = imgRef.current;
    const draw = () => drawBoxes(canvasRef.current, img, result.boxes ?? [], result.violation);
    if (img.complete && img.naturalWidth > 0) draw();
    else img.onload = draw;
  }, [result, previewUrl]);

  const isViolation = result?.violation;

  return (
    <div style={S.page}>
      <div style={S.card}>

        {/* Header */}
        <div style={S.header}>
          <button style={S.backBtn} onClick={() => navigate(-1)}>← رجوع</button>
          <h1 style={S.title}>عداد الأشخاص</h1>
          <p style={S.subtitle}>
            ارفع صورة لعد الأشخاص تلقائياً — والتنبيه عند تجاوز الحد المسموح
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={S.form}>
          <label style={S.fileLabel}>
            <span style={S.fileLabelText}>
              {file ? file.name : "اختر صورة (JPG / PNG / WEBP)"}
            </span>
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </label>

          <div style={S.limitWrapper}>
            <label style={S.limitLabel}>الحد الأقصى</label>
            <input
              type="number"
              min={1}
              max={100}
              value={maxAllowed}
              onChange={(e) => setMaxAllowed(Number(e.target.value) || 5)}
              style={S.limitInput}
            />
          </div>

          <button
            type="submit"
            disabled={!file || loading}
            style={{
              ...S.submitBtn,
              opacity: !file || loading ? 0.5 : 1,
              cursor: !file || loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "جاري التحليل…" : "تحليل الصورة"}
          </button>
        </form>

        {/* Error */}
        {error && (
          <div style={S.errorBox}>
            <strong>خطأ: </strong>{error}
          </div>
        )}

        {/* Image / canvas */}
        {previewUrl && (
          <div style={S.canvasWrapper}>
            <img
              ref={imgRef}
              src={previewUrl}
              alt="preview"
              style={{ display: "none" }}
              crossOrigin="anonymous"
            />
            {result ? (
              <canvas ref={canvasRef} style={S.canvas} />
            ) : (
              <img src={previewUrl} alt="preview" style={S.canvas} />
            )}
          </div>
        )}

        {/* Results panel */}
        {result && (
          <div style={S.resultsPanel}>

            {/* Count badge */}
            <div
              style={{
                ...S.countBadge,
                background: isViolation ? "#450a0a" : "#0c2340",
                borderColor: isViolation ? "#b91c1c" : "#1d4ed8",
              }}
            >
              <span style={{ ...S.countNum, color: isViolation ? "#fca5a5" : "#93c5fd" }}>
                {result.people_count}
              </span>
              <span style={S.countLabel}>شخص مكتشف</span>
              <span style={{ ...S.countMax, color: isViolation ? "#fca5a5" : "#64748b" }}>
                / الحد {result.max_allowed}
              </span>
            </div>

            {/* Status message */}
            <div
              style={{
                ...S.badge,
                background: isViolation ? "#fef2f2" : result.people_count === 0 ? "#1e293b" : "#f0fdf4",
                borderColor: isViolation ? "#fca5a5" : result.people_count === 0 ? "#334155" : "#86efac",
                color: isViolation ? "#b91c1c" : result.people_count === 0 ? "#94a3b8" : "#15803d",
              }}
            >
              {isViolation ? "⚠️" : result.people_count === 0 ? "ℹ️" : "✅"} {result.message}
            </div>

            {/* Boxes table */}
            {result.boxes.length > 0 && (
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>#</th>
                    <th style={S.th}>الثقة</th>
                    <th style={S.th}>x1</th>
                    <th style={S.th}>y1</th>
                    <th style={S.th}>x2</th>
                    <th style={S.th}>y2</th>
                  </tr>
                </thead>
                <tbody>
                  {result.boxes.map((box, i) => (
                    <tr key={i} style={S.tr}>
                      <td style={S.td}>
                        <span style={{
                          ...S.personTag,
                          background: isViolation ? VIOLATION_BOX_COLOR : BOX_COLOR,
                        }}>
                          P{i + 1}
                        </span>
                      </td>
                      <td style={S.td}>{(box.confidence * 100).toFixed(1)}%</td>
                      <td style={S.td}>{box.x1}</td>
                      <td style={S.td}>{box.y1}</td>
                      <td style={S.td}>{box.x2}</td>
                      <td style={S.td}>{box.y2}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Diagnostics removed from supervisor view — kept only for admin debugging */}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles (same dark theme as /mask-check) ────────────────────────────────────
const S = {
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
  header: { marginBottom: "1.5rem" },
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
  title: { fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.25rem", color: "#f1f5f9" },
  subtitle: { fontSize: "0.9rem", color: "#94a3b8", margin: 0 },
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
  limitWrapper: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  limitLabel: { fontSize: "0.85rem", color: "#94a3b8", whiteSpace: "nowrap" },
  limitInput: {
    width: "60px",
    background: "#0f172a",
    border: "1px solid #475569",
    borderRadius: "0.4rem",
    color: "#e2e8f0",
    padding: "0.4rem 0.5rem",
    fontSize: "0.9rem",
    textAlign: "center",
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
  canvas: { maxWidth: "100%", maxHeight: "520px", objectFit: "contain", display: "block" },
  resultsPanel: { display: "flex", flexDirection: "column", gap: "1rem" },
  countBadge: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.5rem",
    border: "1px solid",
    borderRadius: "0.75rem",
    padding: "1rem 1.25rem",
  },
  countNum: { fontSize: "2.5rem", fontWeight: 800, lineHeight: 1 },
  countLabel: { fontSize: "1rem", color: "#94a3b8" },
  countMax: { fontSize: "0.85rem", marginRight: "auto" },
  badge: {
    border: "1px solid",
    borderRadius: "0.6rem",
    padding: "0.65rem 1rem",
    fontWeight: 600,
    fontSize: "0.95rem",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" },
  th: {
    background: "#0f172a",
    color: "#94a3b8",
    padding: "0.5rem 0.75rem",
    textAlign: "center",
    fontWeight: 600,
    borderBottom: "1px solid #334155",
  },
  tr: { borderBottom: "1px solid #1e293b" },
  td: { padding: "0.45rem 0.75rem", textAlign: "center", color: "#cbd5e1" },
  personTag: {
    display: "inline-block",
    color: "#fff",
    borderRadius: "0.35rem",
    padding: "0.15rem 0.5rem",
    fontSize: "0.8rem",
    fontWeight: 600,
  },
  modelInfo: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
    flexWrap: "wrap",
    fontSize: "0.78rem",
    color: "#64748b",
    paddingTop: "0.25rem",
  },
  modelInfoLabel: { color: "#475569", fontWeight: 600 },
  modelInfoChip: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "0.3rem",
    padding: "0.1rem 0.45rem",
    fontFamily: "monospace",
    color: "#94a3b8",
  },
};
