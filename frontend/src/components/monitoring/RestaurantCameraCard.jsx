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
import {
  assessRestaurantCameraDraft,
  securityStatusBadgeClass,
} from "../../utils/cameraSecurity.js";

/** Always-on smart checks applied to every monitoring zone (server-side). */
const DETECTION_TYPES_AR = [
  "الكمامة",
  "القفازات",
  "غطاء الرأس",
  "الزي الرسمي",
  "الأرضية المبللة",
  "النفايات",
];

function emptyDraftFromConfig(cfg) {
  return {
    cameraName: cfg.cameraName || "",
    ipAddress: cfg.ipAddress || "",
    port: cfg.port != null ? String(cfg.port) : "554",
    username: cfg.username || "",
    passwordDraft: "",
    streamPath: cfg.streamPath || "/stream1",
    connectionType:
      cfg.connectionType === RESTAURANT_CONNECTION_TYPES.RTSP_URL
        ? RESTAURANT_CONNECTION_TYPES.RTSP_URL
        : RESTAURANT_CONNECTION_TYPES.IP_CAMERA,
    rtspUrl: cfg.rtspUrl || "",
  };
}

/** Is a real stream configured for this zone (IP or RTSP)? */
function isConfigured(config) {
  if (config.connectionType === RESTAURANT_CONNECTION_TYPES.RTSP_URL) {
    return Boolean(String(config.rtspUrl || "").trim());
  }
  return Boolean(String(config.ipAddress || "").trim());
}

/** Connection status → label + colour, derived from config + last test result. */
function connectionStatus(config) {
  if (!isConfigured(config)) {
    return { label: "غير متصلة", cls: "border-slate-600 bg-slate-800/60 text-slate-400" };
  }
  if (config.lastConnectionTestOk === true) {
    return { label: "متصلة", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" };
  }
  if (config.lastConnectionTestOk === false) {
    return { label: "تحتاج مراجعة", cls: "border-amber-500/40 bg-amber-500/10 text-amber-200" };
  }
  return { label: "غير متصلة", cls: "border-slate-600 bg-slate-800/60 text-slate-400" };
}

function borderClass(configured, status) {
  if (!configured) return "border-slate-700/70";
  if (status.label === "متصلة") return "border-emerald-500/40";
  if (status.label === "تحتاج مراجعة") return "border-amber-400/45";
  return "border-slate-700/70";
}

/**
 * Monitoring zone camera card (final-delivery, production CCTV only).
 *
 * Shows the linked restaurant RTSP/IP camera for one fixed zone with its
 * connection + network-security status, last check time, the always-on smart
 * checks, and inline configuration. No device/webcam preview — when no camera
 * is linked a clean empty state is shown instead of a black video box.
 */
function RestaurantCameraCard({
  zone,
  config,
  lastConnectionTestLabel,
  lastAnalysisLabel,
  activeViolationsCount,
  onSave,
  onTestConnection,
  onDelete,
  testBusy,
  saveBusy,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState(() => emptyDraftFromConfig(config));

  useEffect(() => {
    if (!settingsOpen) setDraft(emptyDraftFromConfig(config));
  }, [config, settingsOpen]);

  const configured = isConfigured(config);
  const status = connectionStatus(config);

  const generatedRtsp = useMemo(() => {
    if (draft.connectionType !== RESTAURANT_CONNECTION_TYPES.IP_CAMERA) return "";
    const pass =
      String(draft.passwordDraft || "").trim() || resolveStoredPassword(config.passwordEnc);
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
  const securityLive = useMemo(() => assessRestaurantCameraDraft(draft, config), [draft, config]);
  const canSave = validationErrors.length === 0;

  const maskedSavedRtsp =
    config.connectionType === RESTAURANT_CONNECTION_TYPES.RTSP_URL && config.rtspUrl
      ? maskRtspUrlForDisplay(config.rtspUrl)
      : effectiveRtspSaved
        ? maskRtspUrlForDisplay(effectiveRtspSaved)
        : "";

  const openEdit = () => {
    setDraft(emptyDraftFromConfig(config));
    setSettingsOpen((o) => !o);
  };

  return (
    <article
      dir="rtl"
      className={`flex flex-col overflow-hidden rounded-xl border bg-[#070d1e] ${borderClass(configured, status)}`}
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-2 border-b border-white/5 px-3 py-2.5">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-bold text-white">
            {config.cameraName?.trim() || zone.displayNameAr}
          </h4>
          <p className="mt-0.5 truncate text-[11px] text-slate-400">{zone.zoneAr}</p>
          {configured && config.connectionType === RESTAURANT_CONNECTION_TYPES.IP_CAMERA ? (
            <p className="mt-0.5 font-mono text-[10px] text-slate-500" dir="ltr">
              {maskIpv4Display(config.ipAddress)}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${status.cls}`}>
            {status.label}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${securityStatusBadgeClass(
              securityLive.security_status,
            )}`}
            title={securityLive.security_warnings?.join(" · ") || ""}
          >
            الأمان: {securityLive.security_status_ar}
          </span>
        </div>
      </header>

      {!configured && !settingsOpen ? (
        /* Clean empty state — no black video box */
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-300">لم يتم ربط كاميرا بعد</p>
          <p className="text-[11px] leading-relaxed text-slate-500">
            أضف كاميرا RTSP من شبكة المطعم لبدء المراقبة.
          </p>
        </div>
      ) : (
        <>
          {/* Status rows */}
          <dl className="grid grid-cols-2 gap-2 px-3 py-3 text-[11px]">
            <div className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
              <dt className="text-slate-500">الحالة</dt>
              <dd className="font-medium text-slate-100">{configured ? "نشطة" : "غير مفعّلة"}</dd>
            </div>
            <div className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
              <dt className="text-slate-500">مخالفات اليوم</dt>
              <dd className="font-mono font-semibold text-slate-100">{activeViolationsCount}</dd>
            </div>
            <div className="col-span-2 rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
              <dt className="text-slate-500">آخر فحص اتصال</dt>
              <dd className="font-medium text-slate-100">
                {lastConnectionTestLabel || "لم يُجرَ اختبار بعد"}
              </dd>
            </div>
            <div className="col-span-2 rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
              <dt className="text-slate-500">آخر تحليل</dt>
              <dd className="font-medium text-slate-100">{lastAnalysisLabel || "—"}</dd>
            </div>
          </dl>

          {/* Detection types (always-on) */}
          <div className="border-t border-white/5 px-3 py-2.5">
            <p className="mb-1.5 text-[10px] text-slate-500">الفحوصات الذكية المفعّلة</p>
            <div className="flex flex-wrap gap-1">
              {DETECTION_TYPES_AR.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] px-2 py-0.5 text-[10px] text-emerald-200/90"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 border-t border-white/5 px-3 py-2.5">
        <button
          type="button"
          onClick={openEdit}
          className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-[11px] font-semibold text-sky-100 hover:bg-sky-500/20"
        >
          {settingsOpen ? "إغلاق" : "تعديل"}
        </button>
        <button
          type="button"
          disabled={testBusy || !configured}
          onClick={() => void onTestConnection?.(emptyDraftFromConfig(config))}
          className="rounded-lg border border-white/15 bg-[#0B1327] px-3 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-[#111c36] disabled:opacity-40"
        >
          {testBusy ? "جاري الاختبار…" : "اختبار الاتصال"}
        </button>
        {onDelete ? (
          <button
            type="button"
            disabled={!configured}
            onClick={() => void onDelete?.()}
            className="ms-auto rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-1.5 text-[11px] font-semibold text-red-200 hover:bg-red-500/15 disabled:opacity-40"
          >
            تعطيل
          </button>
        ) : null}
      </div>

      {/* Inline edit panel */}
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
                    placeholder={config.passwordEnc || config.hasPassword ? "••••••" : ""}
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

          {securityLive.security_warnings?.length > 0 ? (
            <ul
              className={`space-y-1 rounded-lg border px-3 py-2 text-[11px] ${securityStatusBadgeClass(
                securityLive.security_status,
              )}`}
            >
              {securityLive.security_warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          <p className="text-[10px] leading-relaxed text-slate-500">
            يجب أن تكون الكاميرا داخل شبكة المطعم المحلية، ولا يتم كشف رابط RTSP على الإنترنت.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={testBusy || !canSave}
              onClick={() => void onTestConnection?.(draft)}
              className="rounded border border-white/15 bg-[#0B1327] px-3 py-1.5 text-[11px] font-semibold text-slate-200 disabled:opacity-40"
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
        </div>
      ) : null}
    </article>
  );
}

export default memo(RestaurantCameraCard);
