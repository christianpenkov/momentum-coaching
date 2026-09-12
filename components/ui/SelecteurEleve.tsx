'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import { useEscapeKey } from '@/lib/useEscapeKey';

/**
 * Le titre de « Mes Stats » vu par le coach, transformé en sélecteur d'élève.
 *
 * ── Pourquoi le titre et pas un contrôle de plus ─────────────────────────────
 * Le nom de l'élève EST déjà le titre de la page. En faire un bouton n'ajoute
 * aucune hauteur à un en-tête déjà dense, et met le geste là où l'œil va : on lit
 * le nom, on clique le nom. C'est le motif de Linear et de Vercel.
 *
 * Avant, changer d'élève demandait quatre écrans — revenir au portefeuille,
 * retrouver la ligne, rouvrir la fiche, recliquer sur Stats.
 *
 * ── Ce que le composant ne fait PAS ──────────────────────────────────────────
 * Il ne charge rien. La liste des élèves vient de `useSupabaseClients()`, déjà
 * monté sur `/clients/[id]/analytics` — c'est l'appelant qui la lui passe, pour
 * que PageClientStats reste utilisable sur les deux routes qui n'ont pas ce
 * contexte (`/mes-stats` du coach, `/client/stats` de l'élève, où il n'y a
 * d'ailleurs rien à sélectionner).
 */

/** Un élève tel que le menu en a besoin. `id` est celui de la table `clients`. */
export interface EleveSelectionnable {
  id: string;
  nom: string;
  niche: string | null;
  photo: string | null;
  semaine: number | null;
}

/**
 * En dessous de ce nombre, un champ de recherche encombre plus qu'il n'aide : on
 * balaie cinq noms plus vite qu'on ne tape. Au-delà, il devient le moyen normal
 * d'atteindre quelqu'un. Le seuil est ici, pas dans le JSX, pour qu'il se change
 * en un endroit quand le portefeuille grandit.
 */
const SEUIL_RECHERCHE = 8;

/**
 * Hauteur d'une ligne du menu : 7 px de marge intérieure de chaque côté, plus deux
 * lignes de texte (nom 12,5 px et niche 10,5 px, interlignage 1,3).
 *
 * Écrite ici parce qu'elle sert à CALCULER la hauteur du menu, pas seulement à le
 * décrire. Changer la typographie d'une ligne sans changer ce nombre couperait la
 * liste à un endroit arbitraire.
 */
const HAUTEUR_LIGNE = 44;

/**
 * Cinq élèves visibles, puis on fait défiler.
 *
 * La demi-ligne ajoutée n'est pas de la marge : c'est l'indice de défilement. Une
 * ligne coupée en deux dit « il y en a d'autres » mieux qu'une barre de défilement,
 * qui reste invisible sur macOS tant qu'on n'a pas commencé à faire défiler.
 */
const LIGNES_VISIBLES = 5;
const HAUTEUR_LISTE = HAUTEUR_LIGNE * (LIGNES_VISIBLES + 0.5);

/** Insensible aux accents et à la casse : « penkov » doit trouver « Penkov ». */
const normaliser = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export default function SelecteurEleve({
  eleveCourant,
  eleves,
  hrefPour,
}: {
  eleveCourant: EleveSelectionnable;
  /** Les élèves ACTIFS. L'appelant a déjà retiré les archivés. */
  eleves: EleveSelectionnable[];
  /** L'URL vers laquelle basculer, calculée par l'appelant (elle emporte l'onglet et la période). */
  hrefPour: (eleve: EleveSelectionnable) => string;
}) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState('');
  // Index survolé au clavier. -1 = aucun, l'anneau de focus reste sur le champ.
  const [actif, setActif] = useState(-1);
  const declencheur = useRef<HTMLButtonElement>(null);
  const panneau = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const liste = useRef<HTMLDivElement>(null);

  const avecRecherche = eleves.length > SEUIL_RECHERCHE;

  const listeFiltree = useMemo(() => {
    const q = normaliser(recherche);
    if (!q) return eleves;
    return eleves.filter(e => normaliser(e.nom).includes(q) || normaliser(e.niche ?? '').includes(q));
  }, [eleves, recherche]);

  const fermer = (rendreLeFocus = true) => {
    setOuvert(false);
    setRecherche('');
    setActif(-1);
    // Sans ce retour de focus, l'utilisateur au clavier se retrouve au début du
    // document après une fermeture — il devrait retraverser toute la page.
    if (rendreLeFocus) declencheur.current?.focus();
  };

  useEscapeKey(() => fermer(), ouvert);

  // Clic en dehors. `mousedown` et non `click` : un `click` se déclenche après le
  // relâchement, donc un glissé commencé DANS le menu et fini dehors le fermait.
  useEffect(() => {
    if (!ouvert) return;
    const surClic = (e: MouseEvent) => {
      const cible = e.target as Node;
      if (panneau.current?.contains(cible) || declencheur.current?.contains(cible)) return;
      fermer(false);
    };
    document.addEventListener('mousedown', surClic);
    return () => document.removeEventListener('mousedown', surClic);
  }, [ouvert]);

  // À l'ouverture, le focus va au champ quand il existe, sinon au panneau : dans
  // les deux cas les flèches sont opérantes immédiatement.
  useEffect(() => {
    if (!ouvert) return;
    if (avecRecherche) champ.current?.focus();
    else panneau.current?.focus();
  }, [ouvert, avecRecherche]);

  // Des que la liste defile, deplacer la selection au clavier ne suffit plus : la
  // ligne surlignee peut etre hors du cadre, et l'utilisateur voit une liste figee
  // pendant que la selection avance dans le vide. `block: 'nearest'` ne bouge rien
  // tant que la ligne est deja visible — pas de saut a chaque fleche.
  useEffect(() => {
    if (actif < 0) return;
    liste.current?.querySelector<HTMLElement>(`[data-i="${actif}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [actif]);

  const basculer = (e: EleveSelectionnable) => {
    fermer(false);
    if (e.id === eleveCourant.id) return;
    router.push(hrefPour(e));
  };

  const surTouche = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (listeFiltree.length === 0) return;
      const pas = e.key === 'ArrowDown' ? 1 : -1;
      setActif(i => {
        const suivant = i + pas;
        // Boucle : arrivé en bas on repart en haut. Sur une liste courte c'est ce
        // qu'on attend, et ça évite de rester bloqué sans savoir pourquoi.
        if (suivant < 0) return listeFiltree.length - 1;
        if (suivant >= listeFiltree.length) return 0;
        return suivant;
      });
      return;
    }
    if (e.key === 'Home') { e.preventDefault(); setActif(0); return; }
    if (e.key === 'End') { e.preventDefault(); setActif(listeFiltree.length - 1); return; }
    if (e.key === 'Enter') {
      const cible = listeFiltree[actif] ?? (listeFiltree.length === 1 ? listeFiltree[0] : null);
      if (cible) { e.preventDefault(); basculer(cible); }
    }
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {/* `margin-left: -5px` compense le `padding-left` : la pastille s'aligne donc
          exactement sur le bord gauche du sous-titre, bouton ou pas. */}
      <button
        ref={declencheur}
        type="button"
        onClick={() => setOuvert(o => !o)}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-label={`Élève affiché : ${eleveCourant.nom}. Changer d'élève`}
        className="selecteur-eleve-declencheur"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 11,
          border: '1px solid transparent', borderRadius: 10,
          padding: '4px 10px 4px 5px', marginLeft: -5,
          background: ouvert ? 'var(--surface)' : 'transparent',
          borderColor: ouvert ? 'var(--border)' : 'transparent',
          cursor: 'pointer', font: 'inherit', textAlign: 'left',
        }}
      >
        <Avatar avatarUrl={eleveCourant.photo ?? undefined} initials={getInitials(eleveCourant.nom)} nom={eleveCourant.nom} size={34} />
        <h1 className="page-title" style={{ fontSize: 23, margin: 0 }}>{eleveCourant.nom}</h1>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ flexShrink: 0, transform: ouvert ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-quick) var(--ease-out)' }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {ouvert && (
        <div
          ref={panneau}
          role="menu"
          tabIndex={-1}
          onKeyDown={surTouche}
          aria-label="Choisir un élève"
          className="champ-nu"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 30,
            width: 288, padding: 5, outline: 'none',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 11, boxShadow: 'var(--shadow-menu)',
          }}
        >
          {avecRecherche && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '3px 3px 5px', padding: '7px 10px', borderRadius: 8, background: 'var(--surface-chat-field)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
              </svg>
              <input
                ref={champ}
                value={recherche}
                onChange={e => { setRecherche(e.target.value); setActif(-1); }}
                placeholder="Chercher un élève"
                aria-label="Chercher un élève"
                className="champ-nu"
                style={{ border: 0, background: 'transparent', outline: 'none', font: 'inherit', fontSize: 12.5, color: 'var(--ink)', width: '100%' }}
              />
            </div>
          )}

          <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', padding: '6px 10px 4px' }}>
            Portefeuille · {eleves.length} élève{eleves.length > 1 ? 's' : ''}
          </div>

          {/* Une recherche sans résultat le DIT. Une liste qui se vide sans un mot
              se lit comme un bug de chargement. */}
          {listeFiltree.length === 0 && (
            <div style={{ padding: '10px 10px 12px', fontSize: 12, color: 'var(--muted)' }}>
              Aucun élève ne correspond à « {recherche} ».
            </div>
          )}

          <div ref={liste} style={{ maxHeight: HAUTEUR_LISTE, overflowY: 'auto' }}>
            {listeFiltree.map((e, i) => {
              const courant = e.id === eleveCourant.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  role="menuitem"
                  data-i={i}
                  aria-current={courant || undefined}
                  onClick={() => basculer(e)}
                  onMouseEnter={() => setActif(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '7px 10px', border: 0, borderRadius: 8, cursor: 'pointer',
                    font: 'inherit', textAlign: 'left', color: 'var(--ink)',
                    background: courant ? 'var(--accent-brand-soft)' : i === actif ? 'var(--surface-2)' : 'transparent',
                  }}
                >
                  <Avatar avatarUrl={e.photo ?? undefined} initials={getInitials(e.nom)} nom={e.nom} size={26} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nom}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.3 }}>
                      {e.niche || 'Infopreneur'}{e.semaine ? ` · S${e.semaine}` : ''}
                    </span>
                  </span>
                  {courant && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-brand)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
