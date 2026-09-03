'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Icon, { IconName } from '../ui/Icon';
import Avatar from '../ui/Avatar';

/**
 * Le menu « Plus », commun au coach et à l'élève.
 *
 * Reprend le motif des feuilles de réglages iOS : un en-tête avec sa croix,
 * une carte d'identité, puis des groupes titrés, chacun rendu comme UNE carte
 * blanche sur le fond crème avec des séparateurs en retrait.
 *
 * Ce n'est pas un choix décoratif : la liste plate précédente alignait sept
 * destinations sans hiérarchie, alors qu'elles ne se ressemblent pas — suivre
 * ses leads, s'organiser et gérer ses contenus sont trois intentions
 * différentes. Les groupes rendent cette différence lisible sans rien écrire.
 *
 * La feuille monte du bas et s'arrête à la hauteur de son contenu. Elle est
 * plafonnée à 88 % de l'écran et défile au-delà, plutôt que de déborder sous
 * la barre du bas.
 */

export interface MoreGroupe {
  titre: string;
  liens: {
    href: string;
    icon: IconName;
    label: string;
    /** Affiché à droite du libellé. Réservé à ce qui appelle une action. */
    valeur?: string | number | null;
  }[];
}

// Doit rester aligné sur la transition CSS : le composant reste monté le temps
// de l'animation de sortie, sinon React le démonte instantanément et le
// panneau saute au lieu de redescendre.
//
// Volontairement court : au-delà, la descente se fait sentir comme un délai
// avant l'écran suivant. Une sortie est toujours plus rapide qu'une entrée —
// l'utilisateur a déjà décidé, on ne le fait pas patienter.
const EXIT_MS = 160;

export default function MoreSheetShell({
  onClose, groupes, profil,
}: {
  onClose: () => void;
  groupes: MoreGroupe[];
  profil: {
    nom: string;
    sousTitre: string;
    avatarUrl?: string | null;
    initiales: string;
    seed?: string;
    /** Où mène la carte d'identité — les Réglages, dans les deux rôles. */
    href: string;
  };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const sheetRef = useRef<HTMLDivElement>(null);
  // 'entering' le temps d'un frame pour que la transition CSS ait un état de
  // départ à animer ; 'open' ensuite ; 'closing' pendant la sortie.
  const [phase, setPhase] = useState<'entering' | 'open' | 'closing'>('entering');

  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = useCallback(() => {
    setPhase('closing');
    setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  // Navigation lancée TOUT DE SUITE, panneau qui redescend par-dessus : la page
  // charge pendant l'animation au lieu d'attendre sa fin. Attendre rendait le
  // menu perceptiblement plus lent que la navigation directe.
  const closeThen = useCallback((href: string) => {
    setPhase('closing');
    router.push(href);
    setTimeout(onClose, EXIT_MS);
  }, [onClose, router]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [close]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  const shown = phase === 'open';

  const ligneActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return createPortal(
    <>
      <div
        className="more-voile"
        style={{ opacity: shown ? 1 : 0 }}
        onClick={close}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="more-feuille"
        style={{
          transform: shown ? 'translateY(0)' : 'translateY(100%)',
          transition: shown
            ? 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)'
            : `transform ${EXIT_MS}ms cubic-bezier(0.4, 0, 1, 1)`,
        }}
      >
        <header className="more-entete">
          <button type="button" className="more-fermer" onClick={close} aria-label="Fermer le menu">
            <Icon name="x" size={19} />
          </button>
          <span className="more-titre">Menu</span>
          {/* Contrepoids de la croix : sans lui le titre ne serait pas centré
              sur la feuille mais sur l'espace restant. */}
          <span className="more-entete-cale" aria-hidden="true" />
        </header>

        <div className="more-corps">
          <button
            type="button"
            className="more-carte more-profil"
            onClick={() => closeThen(profil.href)}
          >
            <Avatar initials={profil.initiales} avatarUrl={profil.avatarUrl} size={38} seed={profil.seed} />
            <span className="more-profil-texte">
              <span className="more-profil-nom">{profil.nom}</span>
              <span className="more-profil-sous">{profil.sousTitre}</span>
            </span>
            <Icon name="chevR" size={15} className="more-chevron" />
          </button>

          {groupes.map(groupe => (
            <section className="more-groupe" key={groupe.titre}>
              <h2 className="more-groupe-titre">{groupe.titre}</h2>
              <div className="more-carte">
                {groupe.liens.map(({ href, icon, label, valeur }) => (
                  <Link
                    key={href}
                    href={href}
                    // preventDefault + closeThen : la navigation part tout de
                    // suite, mais le démontage du panneau est différé pour
                    // qu'il ait le temps de redescendre.
                    onClick={(e) => { e.preventDefault(); closeThen(href); }}
                    className={`more-ligne${ligneActive(href) ? ' active' : ''}`}
                  >
                    <Icon name={icon} size={19} className="more-ligne-icone" />
                    <span className="more-ligne-label">{label}</span>
                    {valeur != null && valeur !== '' && (
                      <span className="more-ligne-valeur">{valeur}</span>
                    )}
                    <Icon name="chevR" size={15} className="more-chevron" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>,
    document.body
  );
}
