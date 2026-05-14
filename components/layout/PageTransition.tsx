'use client';

import { usePathname } from 'next/navigation';
import { LazyMotion, domAnimation, m, useReducedMotion } from 'framer-motion';

const variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();

  if (reduced) return <>{children}</>;

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        key={pathname}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={variants}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        style={{ display: 'contents' }}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}
