'use client';

import { ViewTransition } from 'react';

/**
 * Enveloppe le contenu de page dans une View Transition.
 *
 * Remplace l'ancienne implémentation manuelle (setTimeout 80ms + fondu piloté
 * par usePathname), qui créait un trou visuel : le contenu disparaissait, on
 * attendait, le nouveau arrivait. Une app native fait toujours chevaucher la
 * sortie et l'entrée — c'est ce que l'API navigateur fait nativement.
 *
 * Les animations elles-mêmes vivent dans globals.css (::view-transition-*),
 * pas ici : le nom de transition choisi ci-dessous ne fait que les déclencher.
 *
 * `default="none"` : sans lui, ce ViewTransition s'animerait aussi pendant des
 * transitions qui ne le concernent pas (ex. un morph d'avatar ailleurs dans la
 * page). Les animations ne se jouent que pour les types listés.
 *
 * Les navigateurs sans View Transitions API ignorent l'animation ; la
 * navigation reste fonctionnelle, sans trou ni écran vide.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{
        'nav-forward': 'nav-forward',
        'nav-back': 'nav-back',
        default: 'page-fade',
      }}
      exit={{
        'nav-forward': 'nav-forward',
        'nav-back': 'nav-back',
        default: 'page-fade',
      }}
    >
      {/* Conserve la structure de layout de l'ancien composant : le contenu de
          page est un conteneur flex qui doit pouvoir se rétracter (minHeight:0)
          pour que les zones scrollables internes fonctionnent. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </ViewTransition>
  );
}
