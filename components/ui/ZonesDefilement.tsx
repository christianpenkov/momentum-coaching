'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Les deux bords d'un fil à défilement, cliquables à la souris.
 *
 * Le fil se manipule au doigt sur mobile et au pavé tactile sur portable. Avec
 * une souris à molette verticale, il n'existe aucun geste : les pastilles
 * permettaient d'y aller, mais pas d'avancer d'un cran.
 *
 * À DROITE, le bout de la carte suivante dépasse déjà — il porte l'affordance,
 * on ne fait que le rendre cliquable. À GAUCHE rien ne dépasse : un voile vers
 * la couleur du fond marque la continuité (un contenu qui passe dessous se lit
 * comme « ça continue »), et un chevron paraît au survol.
 *
 * Les deux zones s'effacent quand elles ne mènent nulle part — au début pour
 * celle de gauche, à la fin pour celle de droite. Une zone qui promet un
 * contenu absent est pire que pas de zone du tout.
 *
 * Desktop uniquement (voir .fil-zone dans globals.css) : au doigt le
 * glissement suffit, et ces zones prendraient de la largeur utile là où elle
 * est le plus comptée.
 */

const SEUIL = 4; // px de tolérance : un défilement natif ne retombe jamais pile sur 0

export default function ZonesDefilement({
  cible,
  gap,
  libelleAvant = 'Éléments suivants',
  libelleArriere = 'Éléments précédents',
}: {
  /** Le conteneur qui défile. */
  cible: React.RefObject<HTMLElement | null>;
  /** Écart entre deux éléments, pour calculer un pas d'exactement une carte. */
  gap: number;
  libelleAvant?: string;
  libelleArriere?: string;
}) {
  const [peutReculer, setPeutReculer] = useState(false);
  const [peutAvancer, setPeutAvancer] = useState(false);
  // Miroir lisible dans les gestionnaires sans remettre `cible` en dépendance.
  const majRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = cible.current;
    if (!el) return;

    function maj() {
      const e = cible.current;
      if (!e) return;
      const restant = e.scrollWidth - e.clientWidth - e.scrollLeft;
      setPeutReculer(e.scrollLeft > SEUIL);
      setPeutAvancer(restant > SEUIL);
    }
    majRef.current = maj;
    maj();

    el.addEventListener('scroll', maj, { passive: true });
    // La liste peut changer de longueur (un rapport rempli disparaît) ou la
    // fenêtre être redimensionnée : sans cela une zone resterait affichée en
    // bout de course.
    const ro = new ResizeObserver(maj);
    ro.observe(el);
    for (const enfant of Array.from(el.children)) ro.observe(enfant);

    return () => {
      el.removeEventListener('scroll', maj);
      ro.disconnect();
    };
  }, [cible]);

  function pas(sens: 1 | -1) {
    const el = cible.current;
    const premier = el?.firstElementChild as HTMLElement | null;
    if (!el || !premier) return;
    const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({
      left: sens * (premier.offsetWidth + gap),
      behavior: reduit ? 'auto' : 'smooth',
    });
  }

  return (
    <>
      <button
        type="button"
        className={`fil-zone fil-zone-arriere${peutReculer ? ' visible' : ''}`}
        aria-label={libelleArriere}
        aria-hidden={!peutReculer}
        tabIndex={peutReculer ? 0 : -1}
        onClick={() => pas(-1)}
      >
        <svg className="fil-zone-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <button
        type="button"
        className={`fil-zone fil-zone-avant${peutAvancer ? ' visible' : ''}`}
        aria-label={libelleAvant}
        aria-hidden={!peutAvancer}
        tabIndex={peutAvancer ? 0 : -1}
        onClick={() => pas(1)}
      />
    </>
  );
}
