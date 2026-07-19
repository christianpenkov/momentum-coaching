'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';

interface Props {
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}

export default function DrawerShell({ onClose, width = 240, children }: Props) {
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.22, ease: 'linear' }}
        onClick={onClose}
        className="dc-drawer-backdrop"
        style={{
          position: 'fixed', right: 0, bottom: 0, zIndex: 2500,
          background: 'rgba(0,0,0,0.08)',
          backdropFilter: 'blur(1px)', WebkitBackdropFilter: 'blur(1px)',
        }}
      />
      {/* Conteneur clippant — empêche le panel de déborder visuellement
          dans la sidebar/topbar pendant le slide, quel que soit son z-index */}
      <div
        className="dc-drawer-panel"
        style={{
          position: 'fixed', bottom: 0, width,
          maxWidth: '86vw',
          overflow: 'hidden',
          zIndex: 2501,
          pointerEvents: 'none',
        }}
      >
        <motion.div
          initial={{ x: '-100%' }}
          animate={{ x: 0 }}
          exit={{ x: '-100%' }}
          transition={{ duration: reducedMotion ? 0 : 0.30, ease: [0.16, 1, 0.3, 1] }}
          style={{
            width: '100%', height: '100%',
            background: 'var(--surface)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            pointerEvents: 'auto',
          }}
        >
          {children}
        </motion.div>
      </div>
    </>,
    document.body
  );
}
