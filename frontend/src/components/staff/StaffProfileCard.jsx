import { staffAvatarInitials, staffWelcomeDisplayName } from "../../utils/avatarInitials.js";
import StaffProfileAvatar from "../shared/StaffProfileAvatar.jsx";

export default function StaffProfileCard({ staffProfileLoading, staffMe }) {
  const displayName =
    staffProfileLoading && !staffMe?.email
      ? "…"
      : staffWelcomeDisplayName(staffMe?.username, staffMe?.full_name, staffMe?.email);
  const branchLabel = staffMe?.branch_name?.trim() ? staffMe.branch_name : "—";
  const supervisorLabel = (() => {
    const s = String(staffMe?.supervisor_name || "").trim();
    if (!s || s.toLowerCase() === "supervisor") return "—";
    return s;
  })();

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
      <div className="flex min-w-0 flex-1 flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
        <StaffProfileAvatar
          imageUrl={staffMe?.avatar_url}
          initials={staffAvatarInitials(staffMe?.username, staffMe?.email)}
          sizeClass="h-[4.5rem] w-[4.5rem] sm:h-24 sm:w-24"
          textClass="text-lg sm:text-2xl"
        />
        <div className="min-w-0 flex-1 space-y-3 sm:space-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-sky/90">
              لوحة الموظف
            </p>
            <h2 className="mt-1.5 text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl lg:text-[2rem]">
              {displayName}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-[0.9375rem]">
              نظرة موحّدة على توثيق الأطباق وجودة السجل اليومي
            </p>
          </div>
          <dl className="grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-3 lg:max-w-xl">
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">الفرع</dt>
              <dd className="text-sm font-medium text-slate-200">{branchLabel}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                المشرف المسؤول
              </dt>
              <dd className="text-sm font-medium text-slate-200">{supervisorLabel}</dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 lg:flex-col lg:items-end">
        <span className="inline-flex rounded-full border border-white/14 bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium text-slate-300 ring-1 ring-white/[0.04]">
          عين الجودة
        </span>
      </div>
    </div>
  );
}
