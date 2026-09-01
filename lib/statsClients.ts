import type { Period } from '@/components/ui/PeriodPill';

/* Stats Clients — les règles pures de la page coach.
 *
 * Tout ce qui peut être décidé sans React, sans réseau et sans base vit ici, pour être
 * testé par `npm test`. La page ne fait qu'appliquer.
 *
 * Le fil rouge du fichier : une même valeur ne se manipule pas de la même façon selon
 * sa NATURE, et c'est la source de bug la plus coûteuse de ce domaine. Voir `NATURE`
 * plus bas, et le tableau des quatre natures dans AGENTS.md.
 */

/* ═══ Les métriques, en un seul endroit ═══════════════════════════════════════
 *
 * Trois correspondances risquaient d'être écrites en dur à trois endroits — métrique →
 * titre, métrique → unité, métrique → nature. Une seule table, lue par le graphe, le
 * tableau et le sélecteur. C'est le motif exact des onze écarts entre écrans du
 * 2026-08-19 : une règle recopiée diverge dès que l'une des copies bouge.
 */

export type Metrique =
  | 'abonnesIg' | 'abonnesYt' | 'vues' | 'publications'
  | 'clics' | 'leads' | 'callsBookes' | 'ventes' | 'cashCollecte';

/** Ce qu'on peut faire d'une valeur quand on la regroupe sur une fenêtre.
 *
 *  `niveau` — une photo à un instant (des abonnés). On garde la DERNIÈRE valeur non
 *  nulle. Les sommer donnerait sept fois le nombre d'abonnés sur une semaine.
 *
 *  `flux` — un compteur sur la période (des vues, des calls, du cash). On SOMME. En
 *  prendre la dernière ne verrait qu'un jour sur sept.
 *
 *  Il existe une troisième nature dans `analytics_daily_snapshots`, le CUMUL depuis le
 *  début (`calls_booked`, `deals_closed`, `revenue`), et une quatrième, le dédupliqué
 *  (`ig_reach`). Aucune des deux n'entre ici : les cumuls sont recalculés depuis les
 *  tables sources, et le dédupliqué n'a aucune agrégation correcte au niveau
 *  portefeuille. Voir AGENTS.md.
 */
export type Nature = 'niveau' | 'flux';

export interface DefinitionMetrique {
  /** Titre de la carte quand cette métrique est affichée. D23 : jamais écrit en dur
   *  au-dessus d'un sélecteur, sinon il devient faux au premier changement. */
  titre: string;
  unite: '' | '€';
  nature: Nature;
  /** Libellé en cumulé, pour l'axe des semaines d'accompagnement. */
  titreCumule: string;
}

export const METRIQUES: Record<Metrique, DefinitionMetrique> = {
  abonnesIg:    { titre: 'Abonnés Instagram', unite: '',  nature: 'niveau', titreCumule: 'Abonnés Instagram (en % depuis S1)' },
  abonnesYt:    { titre: 'Abonnés YouTube',   unite: '',  nature: 'niveau', titreCumule: 'Abonnés YouTube (en % depuis S1)' },
  vues:         { titre: 'Vues générées',     unite: '',  nature: 'flux',   titreCumule: 'Vues cumulées' },
  publications: { titre: 'Publications',      unite: '',  nature: 'flux',   titreCumule: 'Publications cumulées' },
  clics:        { titre: 'Clics sur les liens', unite: '', nature: 'flux',  titreCumule: 'Clics cumulés' },
  leads:        { titre: 'Leads',             unite: '',  nature: 'flux',   titreCumule: 'Leads cumulés' },
  callsBookes:  { titre: 'Calls bookés',      unite: '',  nature: 'flux',   titreCumule: 'Calls bookés cumulés' },
  ventes:       { titre: 'Ventes',            unite: '',  nature: 'flux',   titreCumule: 'Ventes cumulées' },
  cashCollecte: { titre: 'Cash collecté',     unite: '€', nature: 'flux',   titreCumule: 'Cash collecté cumulé' },
};

/** Regroupe une série de valeurs quotidiennes selon la nature de la métrique.
 *  `null` traversé = trou, jamais zéro : un 0 affirme qu'il ne s'est rien passé. */
export function agreger(valeurs: (number | null)[], nature: Nature): number | null {
  const connues = valeurs.filter((v): v is number => v !== null && v !== undefined);
  if (connues.length === 0) return null;
  if (nature === 'niveau') return connues[connues.length - 1];
  return connues.reduce((s, v) => s + v, 0);
}

/* ═══ La période gouverne tout ═══════════════════════════════════════════════ */

export type Granularite = 'jour' | 'semaine' | 'mois';

/** D22 : 7 points en semaine, 30 en mois, un point par mois en All-Time. */
export function granulariteDe(period: Period, allTime: boolean): Granularite {
  if (allTime) return 'mois';
  return 'jour';
}

/** D22 : l'intitulé de la colonne courbe est CALCULÉ depuis la période. Les « 12
 *  semaines » codées en dur de la première maquette étaient un défaut non motivé, et
 *  faisaient poser la question « au bout d'un an, ça donne quoi ». Avec cette règle,
 *  la fenêtre est toujours bornée par le sélecteur : la question ne se pose plus. */
export function intituleColonneCourbe(period: Period, allTime: boolean): string {
  if (allTime) return "Depuis l'arrivée";
  return period === 7 ? 'Cette semaine' : 'Ce mois';
}

/** D7 : la référence de comparaison suit la période. Piège à ne pas reproduire — une
 *  carte qui annonce « vs semaine précédente » alors que le sélecteur est sur le mois. */
export function libelleComparaison(period: Period, allTime: boolean): string {
  if (allTime) return 'vs mois précédent';
  return period === 7 ? 'vs semaine précédente' : 'vs mois précédent';
}

/* ═══ Semaine d'accompagnement ═══════════════════════════════════════════════
 *
 * L'axe du graphe §5. `onboarding_completed_at` et non `integrations_ready_at` : c'est
 * l'ANCIENNETÉ qu'on mesure ici, pas le périmètre des données. Les deux dates coexistent
 * dans ce chantier et ne se remplacent pas — voir docs/perimetre-stats-referentiel.md.
 */
export function semaineAccompagnement(arrivee: string | null, a: Date = new Date()): number | null {
  if (!arrivee) return null;
  const debut = new Date(arrivee).getTime();
  if (Number.isNaN(debut)) return null;
  const jours = Math.floor((a.getTime() - debut) / 86_400_000);
  if (jours < 0) return null;
  return Math.floor(jours / 7) + 1; // S1 dès le premier jour
}

/** D21 : on ne trace que les élèves qui ont une trajectoire. En dessous, ils ont deux
 *  points, pas une forme — et le graphe sert à lire une forme. */
export const JOURS_MINIMUM_TRAJECTOIRE = 5;

export function ancienneteEnJours(arrivee: string | null, a: Date = new Date()): number | null {
  if (!arrivee) return null;
  const debut = new Date(arrivee).getTime();
  if (Number.isNaN(debut)) return null;
  return Math.max(0, Math.floor((a.getTime() - debut) / 86_400_000));
}

/* ═══ Le tableau ═════════════════════════════════════════════════════════════ */

export type EtatEleve = 'installation' | 'connexion_cassee' | 'trop_recent';

export interface LigneEleve {
  id: string;
  profileId: string | null;
  nom: string;
  niche: string | null;
  semaine: number | null;
  abonnesIg: number | null;
  abonnesYt: number | null;
  variationIg: number | null;
  variationYt: number | null;
  publications: number | null;
  leads: number | null;
  callsBookes: number | null;
  cashContracte: number;
  cashCollecte: number;
  serie: (number | null)[];
  etat: EtatEleve | null;
}

/** D42 : dix critères, et chacun NOMME sa métrique. « Mouvement » a disparu — un tri
 *  qui s'applique par défaut, sans que le coach l'ait choisi, est celui qui doit le
 *  moins se deviner. */
export type CritereTri =
  | 'varIg' | 'varYt' | 'aboIg' | 'aboYt'
  | 'publications' | 'leads' | 'calls' | 'cash' | 'anciennete' | 'nom';

export const LIBELLES_TRI: Record<CritereTri, string> = {
  varIg:        "Variation d'abonnés IG",
  varYt:        "Variation d'abonnés YT",
  aboIg:        'Abonnés IG',
  aboYt:        'Abonnés YT',
  publications: 'Publications',
  leads:        'Leads',
  calls:        'Calls bookés',
  cash:         'Cash collecté',
  anciennete:   'Ancienneté',
  nom:          'Nom',
};

const VALEUR_TRI: Record<Exclude<CritereTri, 'nom'>, (l: LigneEleve) => number | null> = {
  // La variation est prise en VALEUR ABSOLUE : les fortes hausses et les fortes baisses
  // remontent ensemble. Une chute est au moins aussi intéressante qu'une montée.
  varIg:        l => (l.variationIg === null ? null : Math.abs(l.variationIg)),
  varYt:        l => (l.variationYt === null ? null : Math.abs(l.variationYt)),
  aboIg:        l => l.abonnesIg,
  aboYt:        l => l.abonnesYt,
  publications: l => l.publications,
  leads:        l => l.leads,
  calls:        l => l.callsBookes,
  cash:         l => l.cashCollecte,
  anciennete:   l => l.semaine,
};

/** Trie sans muter le tableau reçu.
 *
 *  ⚠️ Les valeurs inconnues (`null`) finissent TOUJOURS en bas, dans les deux sens.
 *  Un élève dont on ne sait rien ne doit pas coiffer la liste en tri croissant : « on
 *  ne sait pas » n'est pas « le plus petit ». */
export function trierLignes(
  lignes: LigneEleve[],
  critere: CritereTri,
  sens: 'asc' | 'desc',
): LigneEleve[] {
  const copie = [...lignes];
  if (critere === 'nom') {
    return copie.sort((a, b) =>
      a.nom.localeCompare(b.nom, 'fr') * (sens === 'asc' ? 1 : -1));
  }
  const valeur = VALEUR_TRI[critere];
  return copie.sort((a, b) => {
    const va = valeur(a);
    const vb = valeur(b);
    if (va === null && vb === null) return a.nom.localeCompare(b.nom, 'fr');
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va === vb) return a.nom.localeCompare(b.nom, 'fr');
    return sens === 'asc' ? va - vb : vb - va;
  });
}

/** Recherche par nom ou par niche, insensible à la casse et aux espaces de bordure. */
export function filtrerLignes(lignes: LigneEleve[], requete: string): LigneEleve[] {
  const q = requete.trim().toLowerCase();
  if (!q) return lignes;
  return lignes.filter(l =>
    l.nom.toLowerCase().includes(q) || (l.niche || '').toLowerCase().includes(q));
}

/* ═══ Affichage ══════════════════════════════════════════════════════════════ */

export function formaterValeur(v: number | null, unite: '' | '€'): string {
  if (v === null || v === undefined) return '—';
  const n = Math.round(v).toLocaleString('fr-FR');
  return unite === '€' ? `${n} €` : n;
}

export function formaterVariation(v: number | null): string {
  if (v === null || v === undefined) return '—';
  // Le vrai signe moins, pas le trait d'union : le tiret se confond avec le « — » qui
  // marque l'inconnu juste au-dessus dans la même colonne.
  return `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString('fr-FR')}`;
}

/** D2 : le taux de collecté, plafonné à 100 %.
 *  Sans plafond, un trop-perçu sur une vente vient effacer la dette d'une autre dans le
 *  total — c'est la raison d'être de `encaisseRetenu()` dans lib/dealCash.ts. */
export function tauxCollecte(collecte: number, contracte: number): number | null {
  if (!contracte || contracte <= 0) return null;
  return Math.min(100, Math.round((collecte / contracte) * 100));
}
