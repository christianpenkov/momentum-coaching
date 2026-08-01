'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
  /** 'centered' (défaut) : boîte centrée desktop-style. 'sheet' : glisse depuis le
   * bas de l'écran (mobile-first, ex. RapportModal) — coins arrondis en haut
   * seulement, pas d'ombre portée classique. */
  variant?: 'centered' | 'sheet';
  /** 'sheet' uniquement — bascule vers un mode plein écran (pas de marge, pas de
   * coins arrondis). Utilisé par RapportModal à l'étape 'revenue'. */
  fullScreen?: boolean;
  /** Remplace le comportement par défaut au clic sur l'overlay (ferme directement).
   * Utile pour intercepter la fermeture avec une confirmation (ex. RapportModal
   * "Fermer sans terminer ?"). Si absent, l'overlay appelle onClose. */
  onOverlayClick?: () => void;
  /** Cache l'overlay/le wrapper — utilisé quand le contenu gère son propre portal
   * indépendant par-dessus (ex. CelebrationOverlay de RapportModal). */
  hidden?: boolean;
}

export default function ModalShell({
  onClose, width = 620, children, variant = 'centered', fullScreen = false,
  onOverlayClick, hidden = false,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const focusable = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined' || hidden) return null;

  const isSheet = variant === 'sheet';
  const handleOverlayClick = onOverlayClick ?? onClose;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 2500,
        background: isSheet ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.5)',
        backdropFilter: isSheet ? undefined : 'blur(4px)',
        display: 'flex',
        alignItems: isSheet ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isSheet ? 0 : '16px',
      }}
    >
      <motion.div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        initial={isSheet ? { opacity: 0, y: '100%' } : { opacity: 0, scale: 0.96, y: 8 }}
        animate={isSheet ? { opacity: 1, y: 0 } : { opacity: 1, scale: 1, y: 0 }}
        exit={isSheet ? { opacity: 0, y: '100%' } : { opacity: 0, scale: 0.96, y: 8 }}
        transition={isSheet ? { type: 'spring', stiffness: 380, damping: 34 } : { type: 'spring', stiffness: 400, damping: 30 }}
        onClick={e => e.stopPropagation()}
        style={isSheet ? {
          width: '100%', maxWidth: width, maxHeight: fullScreen ? '100vh' : '90vh',
          height: fullScreen ? '100vh' : undefined,
          background: 'var(--surface)',
          borderRadius: fullScreen ? 0 : '20px 20px 0 0',
          overflow: 'hidden auto',
          display: 'flex', flexDirection: 'column',
          zIndex: 2501,
        } : {
          width, maxWidth: '96vw', maxHeight: '92vh',
          background: 'var(--surface)',
          borderRadius: 'var(--r-modal)',
          boxShadow: 'var(--shadow-modal)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          zIndex: 2501,
        }}
      >
        {children}
      </motion.div>
    </motion.div>,
    document.body
  );
}
