"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Phase C — quiet count-up for meaningful KPIs only.
 * Duration 0.9s with primary easing; honors prefers-reduced-motion
 * (jumps straight to the final value). tabular-nums for stability.
 */
export function CountUp({
  value,
  durationMs = 900,
}: {
  value: number;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Reduced motion: zero-duration tween resolves to the final value
    // on the first frame (no synchronous setState in the effect body).
    const effectiveDuration = prefersReduced ? 0 : durationMs;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (effectiveDuration || 1e-6));
      // easeOutExpo-ish settle (calm, no overshoot for ops numbers)
      const eased = t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setDisplay(Math.round(value * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, durationMs]);

  return (
    <span className="tabular-nums">{display.toLocaleString()}</span>
  );
}
