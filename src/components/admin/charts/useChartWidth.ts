"use client";

/**
 * The rendered width of a chart's container.
 *
 * Charts here draw at real pixel coordinates rather than scaling a fixed
 * viewBox, because a scaled viewBox stretches the text with the geometry —
 * axis labels end up condensed on narrow screens and bloated on wide ones.
 * Measuring instead keeps type at its intended size at every width.
 *
 * Returns 0 until the first measurement. Callers render nothing at 0, which
 * also keeps the server render from emitting a chart at a guessed width that
 * then jumps on hydration.
 */

import { useEffect, useRef, useState } from "react";

export function useChartWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Not all environments provide it (jsdom without a polyfill, older
    // browsers). One measurement is better than none, and better than throwing.
    if (typeof ResizeObserver === "undefined") {
      setWidth(element.getBoundingClientRect().width);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      // Sub-pixel jitter from a flex parent would otherwise re-render on every
      // frame of an unrelated animation.
      setWidth((prev) => (Math.abs(prev - next) < 1 ? prev : next));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
