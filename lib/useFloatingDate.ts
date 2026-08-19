'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * Date des messages actuellement à l'écran, pour la pastille flottante en haut de
 * la messagerie (même repère que WhatsApp/Telegram).
 *
 * Pourquoi pas `position: sticky` : les zones de messages sont en
 * `flex-direction: column-reverse` (architecture retenue pour corriger le bug de
 * scroll, commit dec462c), et sticky ne fonctionne PAS dans un conteneur
 * *-reverse — limitation connue des navigateurs, sans contournement CSS. Les
 * applications de messagerie utilisent donc toutes une pastille en superposition
 * pilotée en JS, ce que fait ce hook.
 *
 * Principe : on lit la position des séparateurs de date déjà rendus
 * (`[data-date-label]`) par rapport au haut de la zone de scroll, et on retient
 * le dernier qui est passé au-dessus de la ligne de flottaison. Pas
 * d'IntersectionObserver : il ne dit que « visible / pas visible », alors qu'il
 * faut ici savoir lequel est le plus proche du haut — un simple calcul de
 * position est à la fois plus simple et plus juste.
 */
export function useFloatingDate(
  scrollRef: RefObject<HTMLElement | null>,
  deps: unknown[] = [],
): { label: string | null } {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function compute() {
      const container = scrollRef.current;
      if (!container) return;
      const containerTop = container.getBoundingClientRect().top;
      const nodes = container.querySelectorAll<HTMLElement>('[data-date-label]');
      if (!nodes.length) { setLabel(null); return; }

      // Les séparateurs sont parcourus dans l'ordre DOM ; en column-reverse, cet
      // ordre va du plus récent au plus ancien. Celui qui doit s'afficher est le
      // dernier dont le haut est encore au-dessus de la ligne de flottaison
      // (12px sous le bord haut, pour basculer pile quand la pastille recouvre
      // le vrai séparateur).
      let current: string | null = null;
      for (const node of nodes) {
        const top = node.getBoundingClientRect().top - containerTop;
        if (top <= 12) { current = node.dataset.dateLabel ?? null; break; }
      }
      // Aucun séparateur passé au-dessus : on est sur le groupe le plus ancien
      // affiché, donc sa date (dernier nœud DOM).
      if (!current) {
        const last = nodes[nodes.length - 1];
        current = last?.dataset.dateLabel ?? null;
      }
      setLabel(prev => (prev === current ? prev : current));
    }

    // Pastille TOUJOURS affichée (choix de Chris) : elle sert de repère permanent
    // « quel jour je lis », pas d'indication fugace pendant le défilement.
    compute();
    el.addEventListener('scroll', compute, { passive: true });
    return () => el.removeEventListener('scroll', compute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, ...deps]);

  return { label };
}
