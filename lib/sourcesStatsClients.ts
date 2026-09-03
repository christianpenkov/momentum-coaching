/* Quelles intégrations alimentent la page Stats Clients, et ce que chacune apporte.
 *
 * ⚠️ CE FICHIER EXISTE POUR QU'IL N'Y AIT QU'UNE LISTE. Le 2026-09-03, la page testait
 * `provider === 'instagram' || provider === 'youtube'` écrit en dur dans un composant.
 * `app/api/integrations/health/route.ts` prévient pourtant noir sur blanc : « Rien n'est
 * recalculé ici — ni la liste des providers. Un écran qui les redéciderait serait la
 * copie suivante d'une règle qui doit valoir partout pareil. » C'était exactement ça.
 *
 * La référence des intégrations OBLIGATOIRES reste la vue `integrations_sante`, qui en
 * compte sept. Ce fichier ne la contredit pas : il dit lesquelles des sept alimentent
 * CET écran, et ce que le coach perd quand elle manque.
 *
 * Pourquoi cinq et pas sept — tranché avec Chris le 2026-09-03. Fathom et Google
 * Calendar sont obligatoires pour la plateforme (enregistrement des appels, agenda),
 * mais **Stats Clients n'affiche rien qui en dépende**. Les signaler ici enverrait le
 * coach reconnecter un outil qui ne changerait pas un chiffre de la page.
 *
 * ⚠️ Et surtout : AGENTS.md prévient que sur les vues de santé, `etat <> 'ok'` n'est PAS
 * un filtre d'anomalie — « les chercher comme des pannes fait remonter 23 faux
 * positifs ». Une intégration non connectée n'est pas une panne. Le bandeau n'annonce
 * donc jamais une panne : il annonce **ce qui manquera à l'écran**, ce qui est vrai et
 * vérifiable par le coach en regardant la colonne concernée.
 */

export interface SourcePage {
  provider: string;
  libelle: string;
  /** Ce que le coach ne verra PAS pour cet élève. Rédigé pour tomber après
   *  « il manque … », donc sans majuscule ni verbe. */
  apporte: string;
  /** Vrai pour les sources d'audience (Instagram, YouTube). Un élève qui n'en a AUCUNE
   *  ne figure sur aucun graphe : sa conséquence est plus grave qu'une colonne vide, et
   *  le bandeau la formule autrement. */
  audience: boolean;
}

export const SOURCES_PAGE: readonly SourcePage[] = [
  { provider: 'instagram', libelle: 'Instagram',  apporte: 'ses abonnés, vues et publications Instagram', audience: true },
  { provider: 'youtube',   libelle: 'YouTube',    apporte: 'ses abonnés, vues et publications YouTube',   audience: true },
  { provider: 'shortio',   libelle: 'Short.io',   apporte: 'ses clics et ses leads',                      audience: false },
  { provider: 'calendly',  libelle: 'Calendly',   apporte: 'ses calls bookés',                            audience: false },
  { provider: 'stripe',    libelle: 'Stripe',     apporte: 'son cash contracté et collecté',              audience: false },
];

/** Les deux obligatoires que cette page n'utilise pas. Nommées pour que personne ne les
 *  rajoute « par cohérence » sans relire le motif ci-dessus. */
export const HORS_PAGE = ['fathom', 'google'] as const;

export interface LigneIntegration {
  profile_id: string;
  provider: string | null;
  status: string | null;
}

/** Un statut qui signale une intégration TOMBÉE, par opposition à jamais branchée.
 *  Les deux se ressemblent à l'écran et n'appellent pas la même action : l'une a des
 *  chiffres figés qui faussent les totaux, l'autre n'a jamais rien eu. */
const STATUTS_CASSES = new Set(['error', 'expired', 'revoked']);

export interface EtatSources {
  /** Providers de cette page effectivement branchés (quel que soit leur statut). */
  branchees: Set<string>;
  /** Providers de cette page dont le statut signale une panne. */
  cassees: Set<string>;
}

/** Regroupe les lignes d'`integrations` par élève, en ne retenant que les providers de
 *  cette page. Une intégration hors page (Fathom, Google) est ignorée, pas comptée
 *  comme manquante. */
export function etatDesSources(lignes: LigneIntegration[]): Map<string, EtatSources> {
  const utiles = new Set(SOURCES_PAGE.map(s => s.provider));
  const out = new Map<string, EtatSources>();
  for (const l of lignes) {
    if (!l.provider || !utiles.has(l.provider)) continue;
    let e = out.get(l.profile_id);
    if (!e) { e = { branchees: new Set(), cassees: new Set() }; out.set(l.profile_id, e); }
    e.branchees.add(l.provider);
    if (l.status && STATUTS_CASSES.has(l.status)) e.cassees.add(l.provider);
  }
  return out;
}

/** Les sources de cette page qui manquent à un élève, dans l'ordre de `SOURCES_PAGE`.
 *  L'ordre est stable et volontaire : l'audience d'abord, parce que c'est elle qui
 *  décide si l'élève apparaît sur les graphes. */
export function sourcesManquantes(etat: EtatSources | undefined): SourcePage[] {
  return SOURCES_PAGE.filter(s => !etat?.branchees.has(s.provider));
}

/** Vrai quand l'élève n'a NI Instagram NI YouTube : il ne figure alors sur aucun graphe,
 *  et aucune ligne de son tableau ne porte d'abonnés. C'est une conséquence d'une autre
 *  nature qu'une colonne vide, d'où sa propre phrase dans le bandeau. */
export function sansAudience(etat: EtatSources | undefined): boolean {
  return !SOURCES_PAGE.some(s => s.audience && etat?.branchees.has(s.provider));
}

/** « Instagram et YouTube », « Short.io, Calendly et Stripe ». Une énumération française
 *  correcte, pas un `join(', ')` qui laisserait « a, b, c ». */
export function enumerer(mots: string[]): string {
  if (mots.length === 0) return '';
  if (mots.length === 1) return mots[0];
  return `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`;
}
