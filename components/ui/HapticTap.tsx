'use client';

import { useRef, useEffect, useState } from 'react';
import { haptic, isIOS, type HapticIntensity } from '@/lib/haptics';

/**
 * Enveloppe un élément interactif pour lui donner un retour haptique sur les
 * deux plateformes.
 *
 * ANDROID : navigator.vibrate() au tap, via lib/haptics.
 *
 * iOS : Apple a fermé le déclenchement programmatique en 26.5. Seul un tap
 * physique direct sur un <input type="checkbox" switch> natif joue encore le
 * tick. On superpose donc un vrai switch, invisible (opacity 0), exactement aux
 * dimensions de l'enfant : le doigt touche le switch, l'œil voit le bouton.
 *
 * Le switch est aria-hidden et non focusable : il n'existe que pour le doigt.
 * Le bouton réel dessous garde son rôle, son label et son focus clavier, donc
 * la navigation au clavier et les lecteurs d'écran ne voient aucune différence.
 *
 * Le clic n'est pas intercepté : le switch laisse passer l'événement vers
 * l'enfant (pointer-events sur le switch, mais on relaie le clic), pour ne pas
 * avoir à dupliquer le onClick de l'appelant.
 *
 * À réserver aux actions qui comptent (valider, envoyer, cocher). Sur de la
 * navigation ordinaire, l'haptique devient du bruit.
 */
export default function HapticTap({
  children,
  intensity = 'light',
  disabled = false,
}: {
  children: React.ReactNode;
  intensity?: HapticIntensity;
  disabled?: boolean;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  // Le switch iOS n'est monté qu'après hydratation : son rendu dépend de la
  // plateforme, donc le poser côté serveur provoquerait un écart d'hydratation.
  const [iosMode, setIosMode] = useState(false);

  useEffect(() => {
    setIosMode(isIOS());
  }, []);

  // Android : vibration au tap, en phase de capture pour partir avant que le
  // handler de l'enfant ne déclenche un éventuel changement de page.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || disabled || iosMode) return;
    const onPointerDown = () => haptic(intensity);
    el.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => el.removeEventListener('pointerdown', onPointerDown);
  }, [intensity, disabled, iosMode]);

  return (
    <span
      ref={wrapRef}
      style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}
    >
      {children}
      {iosMode && !disabled && (
        <input
          type="checkbox"
          // `switch` est un attribut WebKit non standard : c'est lui qui fait
          // jouer le tick natif. React le laisse passer tel quel.
          {...{ switch: '' }}
          aria-hidden="true"
          tabIndex={-1}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            margin: 0,
            opacity: 0,
            // Le switch doit recevoir le toucher (c'est tout son objet), mais le
            // clic est relayé à l'enfant juste en dessous par le handler.
            cursor: 'pointer',
            // Le clip empêche la zone tactile de déborder du bouton visible :
            // sans lui, WebKit dessine un contrôle plus large que son conteneur
            // et capterait des taps à côté du bouton.
            clipPath: 'inset(0 round 8px)',
            appearance: 'none',
            WebkitAppearance: 'none',
          }}
          onClick={(e) => {
            // Le switch a joué son tick. On relaie le clic à l'élément réel
            // pour que le onClick de l'appelant s'exécute normalement, sans
            // qu'il ait à connaître l'existence de ce composant.
            e.preventDefault();
            e.stopPropagation();
            const target = wrapRef.current?.firstElementChild as HTMLElement | null;
            target?.click();
          }}
        />
      )}
    </span>
  );
}
