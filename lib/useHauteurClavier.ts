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
export function useHauteurClavier(): number {
  const [hauteur, setHauteur] = useState(0);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;

    function mesurer() {
      if (!vv) return;
      const occupe = window.innerHeight - vv.height - vv.offsetTop;
      setHauteur(occupe > 100 ? Math.round(occupe) : 0);
    }

    mesurer();
    vv.addEventListener('resize', mesurer);
    vv.addEventListener('scroll', mesurer);
    return () => {
      vv.removeEventListener('resize', mesurer);
      vv.removeEventListener('scroll', mesurer);
    };
  }, []);

  return hauteur;
}
