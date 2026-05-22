import { useState } from "react";
import { isRenderableImageSrc } from "../../utils/dishHelpers.js";
import { IconDish } from "./icons.jsx";

export default function FoodImageThumb({
  src,
  alt = "",
  sizeClass = "h-24 w-24",
  emptyLabel = "لا توجد صورة",
}) {
  const [failed, setFailed] = useState(false);
  const show = isRenderableImageSrc(src) && !failed;
  return (
    <div
      className={`${sizeClass} shrink-0 overflow-hidden rounded-xl bg-[#0B1327] ring-1 ring-white/10`}
    >
      {show ? (
        <img
          alt={alt}
          src={src}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-slate-500">
          <IconDish className="h-8 w-8 opacity-45" />
          <span className="text-center text-[10px] leading-tight text-slate-500">{emptyLabel}</span>
        </div>
      )}
    </div>
  );
}
