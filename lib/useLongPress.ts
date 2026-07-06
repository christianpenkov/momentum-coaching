import { useRef, useEffect, useCallback } from 'react';

// Appui long tactile (mobile) — ouvre le menu contextuel des messages, équivalent
// du clic droit desktop. ~500ms de maintien, annulé si le doigt bouge (scroll).
//
// Le retour haptique iOS (cf. lib ios-haptics) nécessite un <input type="checkbox"
// switch"> superposé en position:absolute;inset:0 par-dessus la zone tactile — le
// haptique natif WebKit ne se déclenche que sur un vrai tap physique dessus, jamais
// sur un .click() JS différé. Mais un switch superposé en plein cadre devient la
// cible réelle de TOUS les events (touch ET clic droit desktop), donc les listeners
// attachés au wrapper/enfants en dessous ne les reçoivent jamais. Solution : ce hook
// crée et gère lui-même ce switch, et attache tous les listeners (tactile + clic
// droit) DIRECTEMENT dessus — le natif (haptique) et notre JS (détection long-press
// / menu contextuel) tournent sur le même élément, sans conflit d'event target.
export function useLongPress(
  onTrigger: (x: number, y: number) => void,
  enabled: boolean,
  delay = 500,
) {
  const containerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  const clear = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled || typeof document === 'undefined') return;

    let input: HTMLInputElement | null = null;
    let cancelled = false;

    // Insertion différée d'une frame : le switch (position:absolute;width/height:100%)
    // doit être ajouté après que le layout du message (dimensions réelles de la bulle,
    // qui dépendent de son contenu texte/image) soit stabilisé — sinon son hit-test
    // peut se retrouver décalé par rapport à la bulle affichée à l'écran (observé :
    // seul le dernier message, monté après stabilisation du scroll, vibrait de façon
    // fiable ; les messages plus anciens, montés puis re-layoutés, non).
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;

      input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      input.setAttribute('aria-hidden', 'true');
      Object.assign(input.style, {
        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
        margin: '0', opacity: '0', cursor: 'pointer',
        clipPath: 'inset(0 round 999px)', touchAction: 'manipulation',
      });
      input.style.setProperty('-webkit-tap-highlight-color', 'transparent');
      container.style.position = 'relative';

      // Le haptique iOS du switch se déclenche sur l'event `click` natif, qui suit
      // `touchend` — pas sur `touchstart`. Tant que le minuteur de long-press n'a
      // pas expiré, on considère le geste comme "pas encore un long-press" et on
      // annule ce click natif (touchend -> preventDefault) : le toggle n'a jamais
      // lieu, donc pas de haptique sur un simple tap. Dès que le délai est atteint
      // (longPressReachedRef=true), le prochain click est laissé passer normalement.
      const longPressReachedRef = { current: false };

      const onTouchStart = (e: TouchEvent) => {
        const touch = e.touches[0];
        startPos.current = { x: touch.clientX, y: touch.clientY };
        movedRef.current = false;
        longPressReachedRef.current = false;
        timerRef.current = setTimeout(() => {
          if (!movedRef.current) {
            longPressReachedRef.current = true;
            onTriggerRef.current(touch.clientX, touch.clientY);
          }
        }, delay);
      };

      const onTouchMove = (e: TouchEvent) => {
        if (!startPos.current) return;
        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - startPos.current.x);
        const dy = Math.abs(touch.clientY - startPos.current.y);
        if (dx > 10 || dy > 10) { movedRef.current = true; clear(); }
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (!longPressReachedRef.current) e.preventDefault();
        clear();
      };

      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        onTriggerRef.current(e.clientX, e.clientY);
      };

      input.addEventListener('touchstart', onTouchStart, { passive: true });
      input.addEventListener('touchmove', onTouchMove, { passive: true });
      input.addEventListener('touchend', onTouchEnd);
      input.addEventListener('touchcancel', onTouchEnd);
      input.addEventListener('contextmenu', onContextMenu);
      // Pas de preventDefault() sur 'click' ici : ça perturbait le timing exact
      // du haptique natif WebKit (observé : vibration différée au tap suivant,
      // ou totalement absente de façon aléatoire). Le switch est invisible
      // (opacity:0), son focus/style natif ne se voit de toute façon jamais.
      // On réinitialise `checked` juste après le toggle (au tick suivant, pour
      // laisser le haptique natif se jouer) — sinon le switch alterne
      // coché/décoché à chaque tap, et WebKit ne semble déclencher le haptique
      // fiablement que dans un seul sens du toggle.
      input.addEventListener('click', () => {
        setTimeout(() => { if (input) input.checked = false; }, 0);
      });

      container.insertAdjacentElement('beforeend', input);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clear();
      input?.remove();
    };
  }, [delay, clear, enabled]);

  return { ref: containerRef as React.RefObject<HTMLDivElement> };
}
