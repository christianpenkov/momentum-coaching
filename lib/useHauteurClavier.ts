'use client';

import { useEffect, useState } from 'react';

/**
 * La hauteur occupée par le clavier virtuel, en pixels. Zéro s'il est fermé.
 *
 * ── Le problème qu'il résout ───────────────────────────────────────────────
 * Une feuille ancrée en bas (`position: fixed; bottom: 0`) se colle au bas du
 * viewport de MISE EN PAGE, qui ne rétrécit pas quand le clavier s'ouvre sur
 * iOS ni sur Android. Le clavier se pose donc PAR-DESSUS le bas de la feuille —
 * c'est-à-dire par-dessus le champ qu'on vient de toucher, et par-dessus les
 * boutons de validation.
 *
 * Aucun `scrollIntoView` ne peut compenser : le conteneur lui-même déborde de la
 * zone réellement visible, il n'a nulle part où faire défiler.
 *
 * `visualViewport` est la seule mesure qui reflète cette zone. On en déduit la
 * hauteur du clavier, dont la feuille se décolle.
 *
 * ── Pourquoi un seuil de 100 px ────────────────────────────────────────────
 * Les barres d'URL qui se rétractent au défilement produisent des écarts de
 * quelques dizaines de pixels, sans rapport avec un clavier. Réagir à ces
 * micro-variations ferait sautiller la feuille pendant le simple défilement.
 *
 * ── Pourquoi `scroll` en plus de `resize` ──────────────────────────────────
 * iOS décale le viewport visuel (`offsetTop`) sans toujours changer sa hauteur :
 * sans cet écouteur, la feuille reste calée sur une position périmée.
 */
export interface Clavier {
  /** La hauteur occupée par le clavier, en pixels. Zéro s'il est fermé. */
  hauteur: number;
  /**
   * Le haut de la zone visible, en pixels depuis le haut du viewport de MISE EN
   * PAGE — `visualViewport.offsetTop`.
   *
   * ⚠️ Indispensable, et l'oublier se voit tout de suite. iOS ne se contente pas
   * de rétrécir la zone visible quand le clavier s'ouvre : il la DÉCALE. Poser
   * une feuille à `top: 0` la place donc au haut du viewport de mise en page,
   * c'est-à-dire au-dessus de l'écran — son titre était coupé (constaté le
   * 2026-09-04 sur la clôture). `position: fixed` se cale sur le viewport de mise
   * en page, qui ne bouge pas : `top: dessus` remet la feuille au haut VISIBLE.
   */
  dessus: number;
  /** La hauteur réellement visible — `visualViewport.height`. */
  visible: number;
}

export function useHauteurClavier(): Clavier {
  const [etat, setEtat] = useState<Clavier>({ hauteur: 0, dessus: 0, visible: 0 });

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;

    function mesurer() {
      if (!vv) return;
      const occupe = window.innerHeight - vv.height - vv.offsetTop;
      setEtat({
        hauteur: occupe > 100 ? Math.round(occupe) : 0,
        dessus: Math.round(vv.offsetTop),
        visible: Math.round(vv.height),
      });
    }

    mesurer();
    vv.addEventListener('resize', mesurer);
    vv.addEventListener('scroll', mesurer);
    return () => {
      vv.removeEventListener('resize', mesurer);
      vv.removeEventListener('scroll', mesurer);
    };
  }, []);

  return etat;
}
