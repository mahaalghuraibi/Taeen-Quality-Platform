import { PLATFORM_BRAND } from "../constants/branding.js";

export default function SKALogo({ compact = false, className = "" }) {
  const iconSizeClass = compact
    ? "h-9 w-9 sm:h-10 sm:w-10 shrink-0"
    : "h-11 w-11 sm:h-12 sm:w-12 md:h-14 md:w-14 shrink-0";
  const titleSizeClass = compact
    ? "text-xs font-extrabold leading-snug text-white sm:text-sm"
    : "text-base font-extrabold leading-[1.2] tracking-tight text-white sm:text-lg md:text-xl";
  const subtitleClass = compact
    ? "text-[10px] leading-snug text-cyan-200/90 md:text-[11px]"
    : "mt-0.5 text-[11px] font-medium leading-snug text-cyan-200/88 sm:text-xs md:text-sm";

  return (
    <span
      className={`group inline-flex min-w-0 max-w-full items-center gap-2.5 sm:gap-3 transition duration-200 hover:drop-shadow-[0_0_14px_rgba(56,189,248,0.3)] ${className}`}
    >
      {/* Inline SVG — replaces missing ska-logo.png */}
      <svg
        className={`${iconSizeClass} drop-shadow-[0_6px_18px_rgba(56,189,248,0.25)] transition duration-200 group-hover:drop-shadow-[0_8px_22px_rgba(56,189,248,0.42)]`}
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden
      >
        <circle cx="24" cy="24" r="22" fill="#0ea5e9" fillOpacity="0.18" stroke="#38bdf8" strokeWidth="1.5"/>
        <ellipse cx="24" cy="24" rx="14" ry="9" stroke="#7dd3fc" strokeWidth="1.5"/>
        <circle cx="24" cy="24" r="5" fill="#38bdf8" fillOpacity="0.9"/>
        <circle cx="24" cy="24" r="2.5" fill="#0c4a6e"/>
        <circle cx="22" cy="22.5" r="1" fill="#fff" fillOpacity="0.6"/>
      </svg>
      <span className="flex min-w-0 flex-1 flex-col items-start justify-center text-start leading-none">
        <span className={titleSizeClass}>{PLATFORM_BRAND.nameAr}</span>
        <span className={subtitleClass}>{PLATFORM_BRAND.taglineAr}</span>
      </span>
    </span>
  );
}
