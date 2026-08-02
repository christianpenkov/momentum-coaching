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
  const overlayRef = useRef<HTMLDivElement>(null);

  // Mobile, variant centered uniquement : l'overlay est centré sur toute la hauteur
  // d'écran (position: fixed, inset: 0), qui ne rétrécit PAS quand le clavier s'ouvre
  // sur iOS/Android (100vh CSS reste fixe) — contrairement à window.visualViewport, qui
  // lui reflète la vraie zone visible. Sans ce recalage, un champ en bas de la boîte
  // centrée (ex. textarea de notes) se retrouve caché sous le clavier, et aucun
  // scrollIntoView() interne ne peut compenser puisque l'overlay lui-même déborde de la
  // zone réellement visible. Le variant 'sheet' n'a pas ce problème : ancré en bas
  // (alignItems: 'flex-end'), il reste naturellement au-dessus du clavier.
  //
  // Quand le clavier est ouvert, on passe aussi de 'center' à 'flex-start' (+ un padding
  // haut réduit) : centrer la boîte dans le peu d'espace restant au-dessus du clavier la
  // pousse encore trop bas, alors que la coller en haut de cet espace remonte le champ
  // actif nettement plus haut, plus lisible au-dessus du clavier.
  useEffect(() => {
    if (variant !== 'centered' || hidden) return;
    if (typeof window === 'undefined' || window.innerWidth > 767) return;
    const vv = window.visualViewport;
    if (!vv || !overlayRef.current) return;

    function update() {
      if (!overlayRef.current || !vv) return;
      const baseH = window.screen.height;
      const kbH = Math.max(0, baseH - vv.height);
      const isKeyboardOpen = kbH > 100;
      overlayRef.current.style.height = `${vv.height}px`;
      overlayRef.current.style.alignItems = isKeyboardOpen ? 'flex-start' : 'center';
    }
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, [variant, hidden]);

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
      ref={overlayRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: '100dvh', zIndex: 2500,
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
          // 'hidden auto' (pas juste 'hidden') : permet à un champ de saisie interne de
          // scroller dans la vue restante au-dessus du clavier sur mobile, sans quoi
          // scrollIntoView() n'a aucun effet — rien à scroller dans un overflow:hidden.
          overflow: 'hidden auto',
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
