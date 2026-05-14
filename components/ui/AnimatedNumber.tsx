'use client';

import { useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  formatter?: (n: number) => string;
  className?: string;
}

export default function AnimatedNumber({ value, duration = 600, formatter, className }: AnimatedNumberProps) {
  const [displayed, setDisplayed] = useState(0);
  const startTime = useRef<number | null>(null);
  const frameId = useRef<number | null>(null);
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    prefersReducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion.current) {
      setDisplayed(value);
      return;
    }
    const start = 0;
    const end = value;

    const animate = (timestamp: number) => {
      if (!startTime.current) startTime.current = timestamp;
      const elapsed = timestamp - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(start + (end - start) * eased));
      if (progress < 1) {
        frameId.current = requestAnimationFrame(animate);
      }
    };

    startTime.current = null;
    frameId.current = requestAnimationFrame(animate);
    return () => {
      if (frameId.current) cancelAnimationFrame(frameId.current);
    };
  }, [value, duration]);

  const output = formatter ? formatter(displayed) : displayed.toLocaleString('fr-FR');
  return <span className={className}>{output}</span>;
}
