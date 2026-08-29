'use client';

import { useEffect, useRef } from 'react';
import { useHauteurClavier } from '@/lib/useHauteurClavier';
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
   * coins arrondis). Utilisé par RapportModal aux étapes 'revenue' et 'comment'. */
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
  const clavier = useHauteurClavier();

  // Le champ actif est remonté quand le clavier APPARAÎT, pas à chaque frappe :
  // l'effet ne se déclenche que sur un changement de hauteur de clavier. Un
  // scrollIntoView posé sur le `ref` du champ se rejouerait à chaque caractère
  // tapé (une fonction fléchée en ligne change d'identité à chaque rendu), et le
  // défilement lisse se battrait contre l'utilisateur pendant qu'il écrit.
  //
  // Il doit passer APRÈS le rendu qui contracte la feuille : tant qu'elle a son
  // ancienne taille, le contenu n'a rien à faire défiler et l'appel est sans effet.
  useEffect(() => {
    if (clavier === 0 || hidden || !boxRef.current) return;
    const actif = document.activeElement;
    if (!(actif instanceof HTMLElement) || !boxRef.current.contains(actif)) return;
    if (actif.tagName !== 'INPUT' && actif.tagName !== 'TEXTAREA') return;
    const t = setTimeout(() => actif.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0);
    return () => clearTimeout(t);
  }, [clavier, hidden]);

  // Mobile, variant centered uniquement : l'overlay est centré sur toute la hauteur
  // d'écran (position: fixed, inset: 0), qui ne rétrécit PAS quand le clavier s'ouvre
  // sur iOS/Android (100vh CSS reste fixe) — contrairement à window.visualViewport, qui
  // lui reflète la vraie zone visible. Sans ce recalage, un champ en bas de la boîte
  // centrée (ex. textarea de notes) se retrouve caché sous le clavier, et aucun
  // scrollIntoView() interne ne peut compenser puisque l'overlay lui-même déborde de la
  // zone réellement visible.
  //
  // ⚠️ Le variant 'sheet' N'EST PAS épargné, contrairement à ce que disait cette
  // note. Être ancré en bas ne protège de rien : `flex-end` colle la feuille au bas
  // du viewport de MISE EN PAGE, celui-là même que le clavier recouvre. Un champ
  // situé en bas d'un sheet passe donc dessous — constaté le 2026-08-30 sur
  // l'objection « Autre » du rapport de vente. Il est traité plus bas, en rendu
  // déclaratif (`clavier`), et NON dans l'effet impératif ci-dessous : un sheet qui
  // porte une saisie se re-rend à chaque frappe, et React réécrirait alors le
  // `height: 100dvh` d'origine, faisant retomber la feuille sous le clavier entre
  // deux événements de `visualViewport`.
  //
  // ⚠️ `fullScreen` seul NE SUFFIT PAS, et c'est le piège : il fixe la feuille à
  // `100vh`, une unité qui ignore le clavier au même titre que `100dvh`. La zone de
  // défilement se termine donc SOUS le clavier — une fois en bas, il n'y a plus rien
  // à faire défiler et le champ ne peut plus remonter, quel que soit le
  // scrollIntoView. Il faut que la feuille se CONTRACTE réellement.
  //
  // Quand le clavier est ouvert, on passe aussi de 'center' à 'flex-start' (+ un padding
  // haut réduit) : centrer la boîte dans le peu d'espace restant au-dessus du clavier la
  // pousse encore trop bas, alors que la coller en haut de cet espace remonte le champ
  // actif nettement plus haut, plus lisible au-dessus du clavier.
  //
  // maxHeight sur la boîte (boxRef) reste sinon capé à 92vh — une unité CSS qui NE
  // rétrécit PAS avec le clavier sur mobile (contrairement à visualViewport.height) :
  // la boîte peut donc rester visuellement "haute" même une fois l'overlay réduit,
  // repoussant un champ situé en bas de son contenu plus bas que nécessaire dans
  // l'espace réellement visible. On recalcule aussi sa hauteur max en JS pour qu'elle
  // se contracte réellement avec le clavier.
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
      if (boxRef.current) {
        boxRef.current.style.maxHeight = isKeyboardOpen ? `${vv.height - 32}px` : '';
      }
      // Scroller le champ focus dans la zone désormais réduite — seulement APRÈS avoir
      // posé la nouvelle maxHeight ci-dessus, sinon le contenu n'a encore rien à
      // scroller (le conteneur a toujours son ancienne taille non contrainte) et
      // scrollIntoView() n'a aucun effet visible.
      if (isKeyboardOpen && boxRef.current) {
        const active = document.activeElement;
        if (active instanceof HTMLElement && boxRef.current.contains(active) &&
            (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
          active.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
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

  // Une sélection de texte à la souris (drag qui déborde de la boîte) déclenche un
  // mousedown dans la boîte mais peut relâcher (mouseup/click) sur l'overlay — sans ce
  // garde, ce simple drag de sélection était interprété comme un clic sur l'overlay et
  // fermait le modal. On ne ferme que si le clic a démarré ET s'est terminé sur
  // l'overlay lui-même (pas de sélection en cours ni de drag depuis le contenu).
  //
  // DECLARE AVANT le  ci-dessous : place apres, ce hook n'etait pas
  // execute quand le modal etait masque, le nombre de hooks changeait d'un rendu a
  // l'autre et React levait l'erreur #300 (« Rendered fewer hooks than expected »).
  // Meme defaut que celui trouve dans PageClientStats le 2026-08-21.
  const overlayMouseDownOnSelf = useRef(false);

  if (typeof document === 'undefined' || hidden) return null;

  const isSheet = variant === 'sheet';
  const handleOverlayClick = onOverlayClick ?? onClose;

  // La hauteur réellement visible au-dessus du clavier. `100dvh` vaut la hauteur du
  // viewport de mise en page, dont le clavier occupe le bas : on la lui retranche.
  // Appliqué au sheet uniquement — le variant centré a son propre recalage impératif
  // juste au-dessus, et lui n'a pas de saisie qui le re-rende à chaque frappe.
  const visible = isSheet && clavier > 0 ? `calc(100dvh - ${clavier}px)` : null;

  return createPortal(
    <motion.div
      ref={overlayRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onMouseDown={e => { overlayMouseDownOnSelf.current = e.target === e.currentTarget; }}
      onClick={e => {
        if (e.target === e.currentTarget && overlayMouseDownOnSelf.current) handleOverlayClick();
        overlayMouseDownOnSelf.current = false;
      }}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: visible ?? '100dvh', zIndex: 2500,
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
          width: '100%', maxWidth: width,
          // Le clavier ouvert prime sur tout : la feuille se contracte a la zone
          // visible, sinon sa zone de defilement se termine sous le clavier.
          maxHeight: visible ?? (fullScreen ? '100vh' : '90vh'),
          height: visible ?? (fullScreen ? '100vh' : undefined),
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
