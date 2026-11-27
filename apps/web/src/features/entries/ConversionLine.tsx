import { useEffect, useRef, useState } from "react";
import { convertAmount, parseAmount } from "@domain/currency.ts";
import { formatCents } from "../../design/Money";
import { duration, easeStandard, motionMode } from "../../design/motion";

/**
 * "≈ $124.20 CAD" under the amount (MAZ-151, docs/design/motion.md › Entries in several currencies).
 * Typing shows each new converted amount at once (typing is the motion); when the rate arrives or
 * changes, the amount counts to its new value over `emphasized`, as Totals do. Under reduced motion
 * the new amount appears at once.
 */
export function ConversionLine({ amount, code, rate, home, loading }: { amount: string; code: string; rate: string | null; home: string; loading: boolean }) {
  const target = rate ? converted(amount, code, rate, home) : null;
  const [counting, setCounting] = useState<number | null>(null);
  const shown = useRef<number | null>(target);
  const lastRate = useRef(rate);

  useEffect(() => {
    const from = shown.current;
    const rateChanged = lastRate.current !== rate;
    lastRate.current = rate;
    if (!rateChanged || target === null || from === null || from === target || motionMode() !== "full" || typeof requestAnimationFrame !== "function") {
      shown.current = target;
      setCounting(null);
      return;
    }
    const ms = duration("emphasized");
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / ms);
      const next = progress >= 1 ? target : Math.round(from + (target - from) * easeStandard(progress));
      shown.current = next;
      setCounting(progress >= 1 ? null : next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [rate, target]);

  const text = target === null ? (loading ? "Looking up the rate…" : "Enter a rate to convert") : `≈ ${formatCents(counting ?? target, home)} ${home}`;
  return (
    <p className="amount-hero__conversion pk-num" aria-live="polite">
      {counting === null ? text : <span aria-hidden="true">{text}</span>}
    </p>
  );
}

function converted(amount: string, code: string, rate: string, home: string): number {
  try {
    return convertAmount(amount.trim() ? parseAmount(amount, code) : 0, code, rate, home);
  } catch {
    return 0;
  }
}
