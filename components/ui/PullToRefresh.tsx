'use client';

import { useEffect, useRef, useState } from 'react';
import { haptic } from '@/lib/haptics';

/**
 * Tirer vers le bas pour rafraîchir, sur le conteneur scrollable de l'app.
 *
 * Geste attendu par réflexe sur mobile, absent de l'app jusqu'ici : la seule
 * façon de recharger était de fermer et rouvrir.
 *
 * Ne s'active que si le conteneur est DÉJÀ tout en haut au moment où le doigt
 * se pose : sinon on capterait un scroll normal. Et seulement pour un geste
 * franchement vertical, sinon un swipe horizontal (carrousel, retour iOS)
 * déclencherait le rafraîchissement.
 *
 * Résistance progressive : l'indicateur suit le doigt de moins en moins vite à
 * mesure qu'on tire, comme sur iOS. Sans elle le geste paraît « mou ».
 */

const TRIGGER_PX = 72;   // distance à franchir pour déclencher
const MAX_PULL = 110;    // plafond visuel, au-delà on ne suit plus le doigt
const RESISTANCE = 0.55; // fraction du déplacement réellement appliquée

export default function PullToRefresh({ onRefresh }: { onRefresh: () => void | Promise<void> }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Refs et non state : lus dans des handlers tactiles à haute fréquence, où
  // une valeur périmée provoquerait des sauts.
  const startY = useRef(0);
  const startX = useRef(0);
  const active = useRef(false);
  const armed = useRef(false);
  const refreshingRef = useRef(false);
  // Miroir de `pull` lisible dans onTouchEnd sans mettre `pull` en dépendance
  // de l'effet, ce qui réattacherait les écouteurs à chaque frame du geste.
  const pullRef = useRef(0);
  pullRef.current = pull;

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.main-content');
    if (!scroller) return;

    /**
     * Remonte depuis le point touché jusqu'au premier conteneur qui défile
     * VRAIMENT à la verticale.
     *
     * Indispensable : plusieurs écrans ont leur propre zone défilante à
     * l'intérieur de `.main-content`, laquelle reste alors figée à
     * scrollTop = 0. Se fier au seul `.main-content` faisait donc croire
     * qu'on était « tout en haut » quel que soit l'endroit où on se trouvait
     * dans la liste interne — la messagerie déclenchait un rafraîchissement
     * dès qu'on remontait dans l'historique, et le pipeline voyait son
     * défilement bloqué par le preventDefault.
     */
    function scrollerSousLeDoigt(cible: EventTarget | null): HTMLElement {
      let el = cible instanceof Element ? cible : null;
      while (el && el !== scroller) {
        const cs = getComputedStyle(el);
        const defile = /(auto|scroll)/.test(cs.overflowY);
        if (defile && el.scrollHeight > el.clientHeight + 1) return el as HTMLElement;
        el = el.parentElement;
      }
      return scroller!;
    }

    /**
     * Le conteneur est-il déjà au bord HAUT visuel ?
     *
     * `scrollTop` seul ne suffit pas : en `column-reverse`, les navigateurs ne
     * s'accordent pas sur son origine (0 en bas puis valeurs négatives chez
     * les uns, 0 en haut chez les autres — mesuré ici à 0 quelle que soit la
     * position). S'y fier ferait croire « en haut » partout et rearmerait le
     * geste au milieu de l'historique, exactement le bug corrigé.
     *
     * `getBoundingClientRect()` du premier enfant ne dépend d'aucune de ces
     * conventions : on regarde si le contenu affleure vraiment le bord haut
     * du conteneur, à quelques pixels près.
     */
    function estEnHaut(el: HTMLElement): boolean {
      if (el.scrollHeight <= el.clientHeight + 1) return true; // rien à faire défiler
      const inverse = getComputedStyle(el).flexDirection === 'column-reverse';
      // En column-reverse le premier élément du DOM est en BAS visuellement :
      // c'est le dernier enfant qui borde le haut.
      const bord = inverse ? el.lastElementChild : el.firstElementChild;
      if (!bord) return el.scrollTop <= 0;
      const haut = bord.getBoundingClientRect().top;
      const hautConteneur = el.getBoundingClientRect().top;
      return haut >= hautConteneur - 2;
    }

    function onTouchStart(e: TouchEvent) {
      if (refreshingRef.current) return;
      const t = e.touches[0];
      startY.current = t.clientY;
      startX.current = t.clientX;
      // Le geste ne peut naître qu'en haut du contenu réellement scrollé :
      // ailleurs, c'est un scroll ordinaire et il ne faut surtout pas
      // l'intercepter.
      const cible = scrollerSousLeDoigt(t.target);
      active.current = estEnHaut(cible);
      armed.current = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (!active.current || refreshingRef.current) return;
      const t = e.touches[0];
      const dy = t.clientY - startY.current;
      const dx = Math.abs(t.clientX - startX.current);

      if (dy <= 0) { setPull(0); return; }
      // Geste plus horizontal que vertical : ce n'est pas un pull-to-refresh.
      if (!armed.current && dx > Math.abs(dy)) { active.current = false; return; }
      if (dy > 8) armed.current = true;
      if (!armed.current) return;

      // preventDefault ici seulement : on a la certitude que le geste nous
      // appartient, donc on peut bloquer le rebond élastique natif.
      if (e.cancelable) e.preventDefault();

      const eased = Math.min(dy * RESISTANCE, MAX_PULL);
      setPull(prev => {
        // Petit retour tactile au franchissement du seuil, une seule fois.
        if (prev < TRIGGER_PX && eased >= TRIGGER_PX) haptic('light');
        return eased;
      });
    }

    async function onTouchEnd() {
      if (!active.current) return;
      active.current = false;
      const shouldRefresh = pullRef.current >= TRIGGER_PX;
      if (!shouldRefresh) { setPull(0); return; }

      setRefreshing(true);
      refreshingRef.current = true;
      setPull(TRIGGER_PX); // l'indicateur reste visible pendant le chargement
      try {
        await onRefresh();
      } catch {
        // Hors ligne, le refetch échoue. L'indicateur disparaît quand même
        // plutôt que de tourner indéfiniment ; le bandeau global (OfflineBanner)
        // dit déjà pourquoi, inutile d'ajouter un second message ici.
      } finally {
        setRefreshing(false);
        refreshingRef.current = false;
        setPull(0);
      }
    }

    // passive: false sur touchmove, sinon preventDefault est ignoré.
    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd);
    scroller.addEventListener('touchcancel', onTouchEnd);
    return () => {
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [onRefresh]);

  if (pull <= 0 && !refreshing) return null;

  const progress = Math.min(pull / TRIGGER_PX, 1);
  const ready = progress >= 1;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: `calc(env(safe-area-inset-top, 0px) + ${Math.max(0, pull - 34)}px)`,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 900,
        width: 30,
        height: 30,
        borderRadius: '50%',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-elev)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Suit le doigt sans transition pendant le geste, puis revient en
        // douceur au relâchement.
        transition: refreshing ? 'top 200ms ease-out' : 'none',
        opacity: Math.min(progress * 1.4, 1),
        pointerEvents: 'none',
      }}
    >
      <svg
        width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke={ready || refreshing ? 'var(--accent-brand)' : 'var(--muted)'}
        strokeWidth="2.4" strokeLinecap="round"
        style={{
          // Tourne avec le geste, puis en continu pendant le chargement.
          transform: refreshing ? undefined : `rotate(${progress * 270}deg)`,
          animation: refreshing ? 'spin 0.8s linear infinite' : undefined,
        }}
      >
        <path d="M21 12a9 9 0 1 1-6.2-8.6" />
        <polyline points="21 3 21 9 15 9" />
      </svg>
    </div>
  );
}
