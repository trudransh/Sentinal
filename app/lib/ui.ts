"use client";

import { useEffect, useRef, useState } from "react";

// Ease-out cubic — matches the design system's overall motion feel.
const ease = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * Animate a numeric value from its previous render to the new target.
 * Used by the balance widget to count-up totals on update.
 */
export function useCountUp(target: number, durationMs = 480): number {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (Number.isNaN(target)) return;
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setShown(from + (target - from) * ease(t));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return shown;
}

/** Human-readable "x ago" for monotonic ms-since-epoch timestamps. */
export function relativeTime(then: number, now = Date.now()): string {
  const ms = Math.max(0, now - then);
  const s = Math.floor(ms / 1000);
  if (s < 5) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Map age to an urgency tier used by the escalation queue. */
export function urgencyTier(createdAt: number, now = Date.now()): "fresh" | "warm" | "urgent" {
  const ageMin = (now - createdAt) / 60000;
  if (ageMin >= 10) return "urgent";
  if (ageMin >= 3) return "warm";
  return "fresh";
}
