import { memo, useEffect, useMemo, useState } from "react";

import {
  RESTAURANT_CONNECTION_TYPES,
  buildRtspUrlFromParts,
  getEffectiveRtspUrl,
  maskIpv4Display,
  maskRtspUrlForDisplay,
  resolveStoredPassword,
  validateRestaurantCameraDraft,
} from "../../lib/restaurantCameraStorage.js";

/**
 * tierBorderClass — left border accent for the camera card.
 * Kept light (single 1px border, no glow/blur) to avoid GPU paint storms while scrolling.
 */
function tierBorderClass({ connected, riskTier }) {
  if (!connected) return "border-slate-700";
  const t = riskTier || "neutral";
  if (t === "red") return "border-red-500/60";
  if (t === "yellow") return "border-amber-400/60";
  if (t === "green") return "border-emerald-500/55";
  return "border-emerald-500/40";
}

function emptyDraftFromConfig(cfg) {
  return {
    cameraName: cfg.cameraName || "",
    ipAddress: cfg.ipAddress || "",
    port: cfg.port != null ? String(cfg.port) : "554",
    username: cfg.username || "",
    passwordDraft: "",
    streamPath: cfg.streamPath || "/stream1",
    // Coerce any legacy DEVICE_WEBCAM / UPLOADED_VIDEO saved configs back to IP_CAMERA.
    // Operator-facing camera type is restricted to IP_CAMERA / RTSP_URL only.
    connectionType:
      cfg.connectionType === RESTAURANT_CONNECTION_TYPES.RTSP_URL
        ? RESTAURANT_CONNECTION_TYPES.RTSP_URL
        : RESTAURANT_CONNECTION_TYPES.IP_CAMERA,
    rtspUrl: cfg.rtspUrl || "",
  };
}

/**
 * Compact restaurant CCTV camera card.
 *
 * UI focus: real CCTV operations only — IP/RTSP camera, live preview, and quick
 * actions (تشغيل / إيقاف / تعديل / حذف). All AI checks (mask/gloves/headcover/
 * uniform/wet floor/trash) are auto-driven server-side as soon as monitoring
 * starts; no per-camera AI trigger buttons are exposed.
 *
 * Heavy effects (backdrop-filter, multi-layer gradients, glow shadows) were
 * removed to keep scroll FPS stable on the cameras grid.
 */
function RestaurantCameraCard({
  zone,
  config,
  /** red | yellow | green | neutral */
  riskTier,
  connected,
  liveAnalyzing = false,
  connectionStatusLabel,
  lastConnectionTestLabel,
  lastAnalysisLabel,
  riskLevelLabel,
  activeViolationsCount,
  peopleCount,
  streamPreviewRef,
  onSave,
  onTestConnection,
  onStartLiveMonitoring,
  onStopMonitoring,
  onDelete,
  testBusy,
  saveBusy,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState(() => emptyDraftFromConfig(config));

  useEffect(() => {
    if (!settingsOpen) setDraft(emptyDraftFromConfig(config));
  }, [config, settingsOpen]);

  const generatedRtsp = useMemo(() => {
    if (draft.connectionType !== RESTAURANT_CONNECTION_TYPES.IP_CAMERA) return "";
    const pass =
      String(draft.passwordDraft || "").trim() ||
      resolveStoredPassword(config.passwordEnc);
    return buildRtspUrlFromParts({
      ipAddress: draft.ipAddress,
      port: Number.parseInt(String(draft.port || "554"), 10) || 554,
      username: draft.username,
      password: pass,
      streamPath: draft.streamPath,
    });
  }, [draft, config.passwordEnc]);

  const effectiveRtspSaved = useMemo(() => getEffectiveRtspUrl(config, ""), [config]);

  const validationErrors = validateRestaurantCameraDraft(draft);
  const canSave = validationErrors.length === 0;

  let connectionLedLine = "🔴 غير متصل";
  if (connected && liveAnalyzing) connectionLedLine = "🟢 مباشر";
  else if (connected) connectionLedLine = "🟡 ضعيف";

  const maskedSavedRtsp =
    config.connectionType === RESTAURANT_CONNECTION_TYPES.RTSP_URL && config.rtspUrl
      ? maskRtspUrlForDisplay(config.rtspUrl)
      : effectiveRtspSaved
        ? maskRtspUrlForDisplay(effectiveRtspSaved)
        : "";

  return (
    <article
      dir="rtl"
      className={`flex flex-col overflow-hidden rounded-xl border bg-[#070d1e] ${tierBorderClass({ connected, riskTier })}`}
    >
      {/* Header — compact, no extra gradients */}
      <header className="flex items-start justify-between gap-2 border-b border-white/5 px-3 py-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-bold text-white">
            {config.cameraName?.trim() || zone.displayNameAr}
          </h4>
          <p className="mt-0.5 truncate text-[11px] text-slate-400">{zone.zoneAr}</p>
          {!settingsOpen &&
          config.connectionType === RESTAURANT_CONNECTION_TYPES.IP_CAMERA &&
          String(config.ipAddress || "").trim() ? (
            <p className="mt-0.5 font-mono text-[10px] text-slate-500" dir="ltr">
              {maskIpv4Display(config.ipAddress)}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] font-semibold text-slate-200">{connectionLedLine}</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              connected && liveAnalyzing
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : connected
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                  : "border-slate-600 bg-slate-800/60 text-slate-400"
            }`}
          >
            {connectionStatusLabel}
          </span>
        </div>
      </header>

      {/* Live preview */}
      <div className="relative mx-3 mt-3 overflow-hidden rounded-lg border border-white/5 bg-black">
        <div className="aspect-video w-full">
          <video
            ref={streamPreviewRef}
            className="h-full w-full object-cover"
            playsInline
            muted
            autoPlay
          />
          {!connected ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-3 text-center">
              <p className="text-[11px] font-semibold text-slate-400">لا يوجد بث مباشر</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Compact stats row — 4 KPIs only */}
      <dl className="grid grid-cols-2 gap-2 px-3 py-3 text-[11px]">
        <div className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
          <dt className="text-slate-500">آخر تحليل</dt>
          <dd className="font-medium text-slate-100">{lastAnalysisLabel}</dd>
        </div>
        <div className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
          <dt className="text-slate-500">مستوى الخطر</dt>
          <dd className="font-medium text-slate-100">{riskLevelLabel}</dd>
        </div>
        <div className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
          <dt className="text-slate-500">مخالفات نشطة</dt>
          <dd className="font-mono font-semibold text-slate-100">{activeViolationsCount}</dd>
        </div>
        <div className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
          <dt className="text-slate-500">عدد الأشخاص</dt>
          <dd className="font-mono font-semibold text-slate-100">{peopleCount}</dd>
        </div>
      </dl>

      {/* Quick actions — تشغيل / إيقاف / تعديل / حذف */}
      <div className="flex flex-wrap gap-2 border-t border-white/5 px-3 py-2.5">
        <button
          type="button"
          onClick={() => void onStartLiveMonitoring?.()}
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/20"
        >
          تشغيل
        </button>
        <button
          type="button"
          onClick={() => void onStopMonitoring?.()}
          className="rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800"
        >
          إيقاف
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(emptyDraftFromConfig(config));
            setSettingsOpen((o) => !o);
          }}
          className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-[11px] font-semibold text-sky-100 hover:bg-sky-500/20"
        >
          {settingsOpen ? "إغلاق" : "تعديل"}
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={() => void onDelete?.()}
            className="ms-auto rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-1.5 text-[11px] font-semibold text-red-200 hover:bg-red-500/15"
          >
            حذف
          </button>
        ) : null}
      </div>

      {/* Inline edit panel — collapsed by default. Only IP/RTSP configuration. */}
      {settingsOpen ? (
        <div className="space-y-3 border-t border-white/5 px-3 py-3 text-start">
          <label className="block text-[11px] text-slate-400">
            اسم الكاميرا
            <input
              value={draft.cameraName}
              onChange={(e) => setDraft((d) => ({ ...d, cameraName: e.target.value }))}
              className="mt-1 w-full rounded border border-white/10 bg-[#0B1327] px-3 py-2 text-sm text-white"
              placeholder={zone.displayNameAr}
            />
          </label>

          <label className="block text-[11px] text-slate-400">
            نوع الاتصال
            <select
              value={draft.connectionType}
              onChange={(e) => setDraft((d) => ({ ...d, connectionType: e.target.value }))}
              className="mt-1 w-full rounded border border-white/10 bg-[#0B1327] px-3 py-2 text-sm text-white"
            >
              <option value={RESTAURANT_CONNECTION_TYPES.IP_CAMERA}>كاميرا IP</option>
              <option value={RESTAURANT_CONNECTION_TYPES.RTSP_URL}>رابط RTSP</option>
            </select>
          </label>

          {draft.connectionType === RESTAURANT_CONNECTION_TYPES.RTSP_URL ? (
            <label className="block text-[11px] text-slate-400">
              رابط RTSP الكامل
              <textarea
                value={draft.rtspUrl}
                onChange={(e) => setDraft((d) => ({ ...d, rtspUrl: e.target.value }))}
                rows={2}
                dir="ltr"
                className="mt-1 w-full rounded border border-white/10 bg-[#0B1327] px-3 py-2 font-mono text-xs text-sky-100"
                placeholder="rtsp://user:pass@192.168.1.100:554/stream1"
              />
              {maskedSavedRtsp && !draft.rtspUrl ? (
                <p className="mt-1 font-mono text-[10px] text-slate-500" dir="ltr">
                  المحفوظ: {maskedSavedRtsp}
                </p>
              ) : null}
            </label>
          ) : (
            <>
              <label className="block text-[11px] text-slate-400">
                عنوان IP
                <input
                  value={draft.ipAddress}
                  onChange={(e) => setDraft((d) => ({ ...d, ipAddress: e.target.value }))}
                  dir="ltr"
                  className="mt-1 w-full rounded border border-white/10 bg-[#0B1327] px-3 py-2 font-mono text-sm text-sky-100"
                  placeholder="192.168.1.100"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[11px] text-slate-400">
                  المنفذ
                  <input
                    value={draft.port}
                    onChange={(e) => setDraft((d) => ({ ...d, port: e.target.value }))}
                    dir="ltr"
                    className="mt-1 w-full rounded border border-white/10 bg-[#0B1327] px-3 py-2 font-mono text-sm text-sky-100"
                    placeholder="554"
                  />
                </label>
                <label className="block text-[11px] text-slate-400">
                  مسار البث
                  <input
                    value={draft.streamPath}
                    onChange={(e) => setDraft((d) => ({ ...d, streamPath: e.target.value }))}
                    dir="ltr"
                    className="mt-1 w-full rounded border border-white/10 bg-[#0B1327] px-3 py-2 font-mono text-sm text-sky-100"
                    placeholder="/stream1"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[11px] text-slate-400">
                  المستخدم
                  <input
                    value={draft.username}
                    onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
                    dir="ltr"
                    autoComplete="off"
                    className="mt-1 w-full rounded border border-white/10 bg-[#0B1327] px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block text-[11px] text-slate-400">
                  كلمة المرور
                  <input
                    type="password"
                    value={draft.passwordDraft}
                    onChange={(e) => setDraft((d) => ({ ...d, passwordDraft: e.target.value }))}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded border border-white/10 bg-[#0B1327] px-3 py-2 text-sm text-white"
                    placeholder={config.passwordEnc ? "••••••" : ""}
                  />
                </label>
              </div>

              {generatedRtsp ? (
                <p className="break-all font-mono text-[10px] text-slate-500" dir="ltr">
                  RTSP: {maskRtspUrlForDisplay(generatedRtsp)}
                </p>
              ) : null}
            </>
          )}

          {validationErrors.length > 0 ? (
            <ul className="list-inside list-disc text-[11px] text-amber-200/95">
              {validationErrors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          ) : null}

          <p className="text-[10px] leading-relaxed text-slate-500">
            تُفعَّل جميع فحوصات الذكاء الاصطناعي تلقائياً بعد الحفظ: الكمامة، القفازات، غطاء الرأس، الزي، الأرضية المبللة، النفايات.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={testBusy || !canSave}
              onClick={() => void onTestConnection?.(draft)}
              className="rounded border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-[11px] font-semibold text-sky-100 disabled:opacity-40"
            >
              {testBusy ? "جاري الاختبار…" : "اختبار الاتصال"}
            </button>
            <button
              type="button"
              disabled={saveBusy || !canSave}
              onClick={() => void onSave?.(draft)}
              className="rounded border border-emerald-500/45 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 disabled:opacity-40"
            >
              {saveBusy ? "جاري الحفظ…" : "حفظ"}
            </button>
          </div>

          {lastConnectionTestLabel ? (
            <p className="text-[10px] text-slate-600">{lastConnectionTestLabel}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default memo(RestaurantCameraCard);
