import { useEffect, useRef, useState } from "react";

/**
 * Mount children only after the placeholder enters (or nears) the viewport.
 * Keeps Recharts (~330 kB) off the critical path until the user scrolls to analytics.
 */
export default function LazyWhenVisible({ children, minHeight = 224, rootMargin = "180px 0px" }) {
  const hostRef = useRef(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || show) return undefined;

    if (typeof IntersectionObserver === "undefined") {
      setShow(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold: 0.01 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [show, rootMargin]);

  return (
    <div ref={hostRef} style={show ? undefined : { minHeight }}>
      {show ? children : (
        <div
          className="h-full min-h-[inherit] rounded-2xl border border-white/10 bg-[#060d1f]/50"
          aria-hidden
        />
      )}
    </div>
  );
}
