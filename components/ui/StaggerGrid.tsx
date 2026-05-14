'use client';

import { LazyMotion, domAnimation, m, useReducedMotion } from 'framer-motion';

interface Props {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function StaggerGrid({ children, className, style }: Props) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className} style={style}>{children}</div>;

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        className={className}
        style={style}
        initial="hidden"
        animate="visible"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}

export function StaggerItem({ children, className, style }: Props) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className} style={style}>{children}</div>;

  return (
    <m.div
      className={className}
      style={style}
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.22, ease: 'easeOut' } as object}
    >
      {children}
    </m.div>
  );
}
