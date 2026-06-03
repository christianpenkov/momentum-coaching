'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [displayChildren, setDisplayChildren] = useState(children);
  const [visible, setVisible] = useState(true);
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (pathname !== prevPathname.current) {
      prevPathname.current = pathname;
      setVisible(false);
      const t = setTimeout(() => {
        setDisplayChildren(children);
        setVisible(true);
      }, 80);
      return () => clearTimeout(t);
    } else {
      setDisplayChildren(children);
    }
  }, [pathname, children]);

  return (
    <div style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateX(0)' : 'translateX(16px)',
      transition: visible ? 'opacity 0.2s ease-out, transform 0.2s ease-out' : 'none',
    }}>
      {displayChildren}
    </div>
  );
}
