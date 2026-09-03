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
  /** Photo de profil, quand elle existe. Facultative : un élève sans photo retombe sur
   *  ses initiales, et aucun appelant n'est obligé de la fournir. */
  photo?: string | null;
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

/* ═══ La suite des fenêtres de l'axe ══════════════════════════════════════════
 *
 * Le graphe et la colonne courbe doivent afficher un point par fenêtre, y compris pour
 * les fenêtres où la base n'a rien — sinon un jour sans collecte décale toute la courbe
 * vers la gauche et fait mentir l'axe. La suite est donc construite ici, à partir des
 * bornes, et les valeurs viennent s'y poser.
 *
 * Les dates sont en `AAAA-MM-JJ`, la forme rendue par la fonction SQL, pour que la
 * jointure se fasse sur des chaînes identiques et jamais sur des objets Date — deux
 * fuseaux horaires suffisent à décaler une jointure de Date d'un jour.
 */

function isoJour(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** La fenêtre à laquelle appartient une date, sous la même forme que `sequenceFenetres`.
 *
 *  ⚠️ Les deux DOIVENT obéir à la même règle, sinon un élément tombe dans une fenêtre
 *  que l'axe n'affiche pas et disparaît sans bruit. C'est pour ça que `sequenceFenetres`
 *  appelle cette fonction plutôt que de recalculer les bornes de son côté : une règle
 *  écrite deux fois finit toujours par diverger.
 *
 *  Les bornes suivent `date_trunc` de Postgres — lundi pour la semaine (norme ISO),
 *  premier du mois pour le mois — pour que la jointure avec la fonction SQL se fasse
 *  sur des chaînes identiques. */
export function fenetreDe(d: Date, granularite: Granularite): string | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (granularite === 'mois') c.setUTCDate(1);
  else if (granularite === 'semaine') c.setUTCDate(c.getUTCDate() - ((c.getUTCDay() + 6) % 7));
  return isoJour(c);
}

export function sequenceFenetres(debut: Date, fin: Date, granularite: Granularite): string[] {
  const out: string[] = [];
  const premiere = fenetreDe(debut, granularite);
  if (premiere === null) return out;
  if (!(fin instanceof Date) || Number.isNaN(fin.getTime())) return out;

  const c = new Date(premiere + 'T00:00:00Z');
  // Plafond de sécurité : une borne aberrante ne doit produire ni une boucle sans fin,
  // ni un tableau de plusieurs millions d'entrées.
  const plafond = granularite === 'mois' ? 240 : 400;
  const derniere = granularite === 'mois' ? fenetreDe(fin, 'mois')! : null;

  while (out.length < plafond) {
    const courante = isoJour(c);
    if (derniere !== null) { if (courante > derniere) break; }
    else if (c.getTime() > fin.getTime()) break;
    out.push(courante);
    if (granularite === 'mois') c.setUTCMonth(c.getUTCMonth() + 1);
    else if (granularite === 'semaine') c.setUTCDate(c.getUTCDate() + 7);
    else c.setUTCDate(c.getUTCDate() + 1);
  }
  return out;
}

/* ═══ Répartir des lignes métier dans les fenêtres de l'axe ═══════════════════
 *
 * Les calls, les ventes et les encaissements ne viennent PAS de la fonction SQL : ils
 * sont lus depuis leurs tables sources et regroupés ici. Deux raisons.
 *
 * 1. Le cash collecté obéit à `lib/dealCash.ts`, qui déduit les remboursements. Le
 *    réécrire en SQL créerait une deuxième définition du cash — sept lectures sommaient
 *    déjà les paiements à la main sans jamais déduire un remboursement (2 800 €
 *    affichés pour 2 600 € en caisse, corrigé le 2026-08-30).
 * 2. Ces tables n'ont aucun problème de volume. La fonction SQL existe pour les 15 000
 *    lignes de snapshots quotidiens ; quelques milliers de calls se regroupent en
 *    mémoire sans qu'on le sente.
 */

/** Range chaque élément dans sa fenêtre. Un élément dont la date tombe hors de l'axe
 *  est écarté — jamais rangé dans la fenêtre la plus proche, ce qui le compterait dans
 *  une période où il n'a pas eu lieu. */
export function repartirParFenetre<T>(
  elements: T[],
  dateDe: (e: T) => string | null | undefined,
  fenetres: string[],
  granularite: Granularite,
): T[][] {
  const paquets: T[][] = fenetres.map(() => []);
  const index = new Map(fenetres.map((f, i) => [f, i]));
  for (const e of elements) {
    const brut = dateDe(e);
    if (!brut) continue;
    const d = new Date(brut);
    const f = fenetreDe(d, granularite);
    if (f === null) continue;
    const i = index.get(f);
    if (i === undefined) continue;
    paquets[i].push(e);
  }
  return paquets;
}

/* ═══ Export CSV du tableau ═══════════════════════════════════════════════
 *
 * D48 : UN seul export, celui du tableau du bas, parce que c'est le seul endroit de la
 * page où une ligne = un élève. Exporter le graphe demanderait de choisir une forme
 * (large ? longue ?) que personne n'a demandée.
 *
 * ⚠️ Cinq pièges, tous déjà payés ailleurs sur des exports français :
 *
 * 1. Le SÉPARATEUR est le point-virgule. Excel en configuration française lit la virgule comme un
 *    séparateur décimal, donc un CSV à virgules s'ouvre en UNE seule colonne.
 * 2. Les DÉCIMALES prennent la virgule, pour la même raison en sens inverse.
 * 3. Le fichier commence par un BOM UTF-8. Sans lui, Excel lit du Latin-1 et « Léa »
 *    devient « LÃ©a » — sur des noms d'élèves, c'est immédiatement visible.
 * 4. Une valeur qui commence par =, +, - ou @ est interprétée comme une FORMULE par
 *    Excel et LibreOffice. Un nom d'élève vient d'une saisie : c'est une injection, pas
 *    une coquetterie. On la neutralise par une apostrophe.
 * 5. Une valeur INCONNUE laisse la cellule vide, jamais zéro — même règle que le graphe.
 *    Un zéro affirme « il ne s'est rien passé », le vide dit « on ne sait pas ».
 */

const SEPARATEUR = ';';

/** Prépare une valeur pour une cellule : neutralise les formules, puis échappe. */
export function cellule(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let t = typeof v === 'number'
    ? (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','))
    : v;
  // Neutralisation d'injection : l'apostrophe force Excel à traiter la suite comme du
  // texte. Le tabulateur et le retour chariot sont visés aussi — ils permettent de
  // masquer le début réel de la valeur.
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  if (t.includes(SEPARATEUR) || t.includes('"') || t.includes('\n') || t.includes('\r')) {
    t = '"' + t.replace(/"/g, '""') + '"';
  }
  return t;
}

const COLONNES: { titre: string; de: (l: LigneEleve) => string | number | null }[] = [
  { titre: 'Élève',                de: l => l.nom },
  { titre: 'Niche',                de: l => l.niche },
  { titre: 'Semaine de programme', de: l => l.semaine },
  { titre: 'Abonnés Instagram',    de: l => l.abonnesIg },
  { titre: 'Variation Instagram',  de: l => l.variationIg },
  { titre: 'Abonnés YouTube',      de: l => l.abonnesYt },
  { titre: 'Variation YouTube',    de: l => l.variationYt },
  { titre: 'Publications',         de: l => l.publications },
  { titre: 'Leads',                de: l => l.leads },
  { titre: 'Calls bookés',         de: l => l.callsBookes },
  { titre: 'Cash contracté (€)',   de: l => l.cashContracte },
  { titre: 'Cash collecté (€)',    de: l => l.cashCollecte },
];

/** Le tableau tel qu'il est affiché — même ordre, même filtre. Un export qui ne
 *  correspond pas à ce qu'on a sous les yeux est pire que pas d'export du tout. */
export function versCsv(lignes: LigneEleve[]): string {
  const entete = COLONNES.map(c => cellule(c.titre)).join(SEPARATEUR);
  const corps = lignes.map(l => COLONNES.map(c => cellule(c.de(l))).join(SEPARATEUR));
  // CRLF : c'est ce qu'attend Excel, et tous les autres tableurs l'acceptent.
  return '\uFEFF' + [entete, ...corps].join('\r\n') + '\r\n';
}

/** Le nom du fichier porte la période : deux exports téléchargés le même jour sur deux
 *  périodes différentes ne doivent pas se confondre dans le dossier Téléchargements. */
export function nomFichierCsv(debut: Date, fin: Date): string {
  const j = (d: Date) => d.toISOString().slice(0, 10);
  return `momentum-eleves_${j(debut)}_${j(fin)}.csv`;
}

/* ═══ Dater la page ═══════════════════════════════════════════════════════ */

/** Écart en JOURS CALENDAIRES entre deux dates `AAAA-MM-JJ`.
 *
 *  ⚠️ Calendaires, pas « en heures divisées par 24 ». La première version calculait
 *  `(maintenant − minuit UTC du jour) / 86 400 000`, et le résultat dépendait donc de
 *  l'HEURE à laquelle on ouvrait la page : la même donnée s'affichait « aujourd'hui »
 *  le matin, « hier » l'après-midi et « il y a 2 j » le soir. Constaté le 2026-09-02 —
 *  la page annonçait « hier » pour une donnée du 31 août.
 *
 *  Les deux bornes sont des dates nues, donc `Date.UTC` est exact et l'heure d'été
 *  n'entre jamais en jeu. */
export function ecartEnJours(depuis: string, jusqua: string): number | null {
  const lire = (iso: string): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(t) ? null : t;
  };
  const a = lire(depuis);
  const b = lire(jusqua);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

/** « aujourd'hui », « hier », « il y a 4 j ». `aujourdhui` doit être la date PARISIENNE
 *  du jour (`parisDateStr`), pas une date UTC : passé minuit à Paris et avant minuit
 *  UTC, les deux diffèrent, et l'écran afficherait un jour de trop. */
export function libelleFraicheur(dernierJour: string | null | undefined, aujourdhui: string): string | null {
  if (!dernierJour) return null;
  const n = ecartEnJours(dernierJour, aujourdhui);
  if (n === null) return null;
  // Une date dans le futur ne devrait pas exister, mais si elle arrive on préfère
  // « aujourd'hui » à « il y a -3 j ».
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return 'hier';
  return `il y a ${n} j`;
}
