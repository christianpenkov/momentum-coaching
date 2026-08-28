/**
 * Icônes des en-têtes de colonne — Business micro.
 *
 * Un seul jeu pour les trois tableaux (« Breakdown par source », « Performance par
 * contenu », « Performance LM »). Quatorze colonnes portent le même nom d'un tableau à
 * l'autre : elles doivent porter le même symbole, sinon l'icône ment. D'où le fichier
 * unique plutôt que du SVG recopié dans chaque en-tête.
 *
 * Grammaire : un OBJET, plus ce qu'on en a fait.
 *   maillon + curseur  → un lien cliqué
 *   calendrier + avion → un rendez-vous envoyé
 *   calendrier + coche → un rendez-vous tenu
 *   deux étages + barre → un ratio
 *
 * Réglages communs : boîte 16×16, trait 1,5, extrémités arrondies, `currentColor` —
 * les mêmes que les flèches Cold DM / DM organique déjà présentes dans l'écran, pour
 * que l'ensemble reste homogène. La couleur vient donc du `color` de l'en-tête, y
 * compris quand une colonne est active pour le tri.
 */
import React from 'react';

export type NomIcone =
  | 'clicLien'          // clic sur un lien : desc., Calendly DM, « Clics / Liens »
  | 'commentaireLm'     // mot-clé écrit en commentaire
  | 'clicLeadMagnet'    // clic sur un lien de lead magnet
  | 'leadsGeneres'      // des personnes, pas des interactions
  | 'conversationDm'    // le prospect a répondu
  | 'calendlyEnvoye'    // rendez-vous proposé
  | 'callBooke'         // date posée
  | 'callHonore'        // date tenue
  | 'callQualifie'      // jugement porté sur le prospect
  | 'close'             // affaire faite
  | 'revenue'           // argent contracté
  | 'vuesParCall'
  | 'cashParVue';

/**
 * Les trois colonnes de ratio sont plus denses (deux étages et une barre dans 16 px).
 * Elles sont rendues un cran plus grand — sans ça, l'étage du haut devient illisible.
 */
const PLUS_GRANDES: ReadonlySet<NomIcone> = new Set<NomIcone>(['cashParVue']);

const TRACES: Record<NomIcone, React.ReactNode> = {
  clicLien: (
    <>
      <path d="M6.7 8.6a2.6 2.6 0 0 0 3.9.3l1.9-1.9a2.6 2.6 0 0 0-3.7-3.7l-1.1 1.1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.4 7.1a2.6 2.6 0 0 0-3.9-.3L2.6 8.7a2.6 2.6 0 0 0 3.7 3.7l1.1-1.1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m10.4 10.1 4.4 2-1.9.5-.7 1.8-1.8-4.3Z" strokeWidth="1.35" strokeLinejoin="round" />
    </>
  ),
  commentaireLm: (
    <>
      <path d="M13.7 9.2a1.5 1.5 0 0 1-1.5 1.5H5.6L2.6 13.5V3.5A1.5 1.5 0 0 1 4.1 2h8.1a1.5 1.5 0 0 1 1.5 1.5v5.7Z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.4 4.6 5.6 8.2M9.1 4.6l-.8 3.6M5.1 5.6h4.7M4.8 7.3h4.7" strokeWidth="1.3" strokeLinecap="round" />
    </>
  ),
  clicLeadMagnet: (
    <>
      <path d="M2.6 6.9h8.2v6.4a.8.8 0 0 1-.8.8H3.4a.8.8 0 0 1-.8-.8V6.9ZM1.9 4.4h9.6v2.5H1.9zM6.7 4.4v9.7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.7 4.4S6.2 1.6 4.6 1.6a1.4 1.4 0 0 0 0 2.8M6.7 4.4s.5-2.8 2.1-2.8a1.4 1.4 0 0 1 0 2.8" strokeWidth="1.4" strokeLinecap="round" />
      <path d="m9.9 9.6 4.5 2.1-2 .5-.7 1.9-1.8-4.5Z" strokeWidth="1.4" strokeLinejoin="round" />
    </>
  ),
  leadsGeneres: (
    <>
      <circle cx="6.4" cy="4.9" r="2.7" strokeWidth="1.5" />
      <path d="M1.8 14.2c0-2.6 2.1-4.4 4.6-4.4 1 0 2 .3 2.8.8" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12.2 9.5v4.6M9.9 11.8h4.6" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  conversationDm: (
    <>
      <path d="M11.3 8.4a1.3 1.3 0 0 1-1.3 1.3H4.4L2 11.9V3.4a1.3 1.3 0 0 1 1.3-1.3H10a1.3 1.3 0 0 1 1.3 1.3v5Z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.1 5.6h.6A1.3 1.3 0 0 1 15 6.9v5l-2.4-2.2H7.4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  calendlyEnvoye: (
    <>
      <path d="M2.2 4.6a1.2 1.2 0 0 1 1.2-1.2h6.9a1.2 1.2 0 0 1 1.2 1.2v3M2.2 4.6v8a1.2 1.2 0 0 0 1.2 1.2h3.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.2 6.8h9.3M4.9 1.9v2.6M9 1.9v2.6" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m14.6 8.6-5.2 2 2.2.9.9 2.2 2.1-5.1Z" strokeWidth="1.4" strokeLinejoin="round" />
    </>
  ),
  callBooke: (
    <>
      <path d="M2.2 4.6a1.2 1.2 0 0 1 1.2-1.2h9.2a1.2 1.2 0 0 1 1.2 1.2v8a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2v-8Z" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M2.2 6.9h11.6M5.2 1.9v2.6M10.8 1.9v2.6" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="10.4" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  callHonore: (
    <>
      <path d="M2.2 4.6a1.2 1.2 0 0 1 1.2-1.2h9.2a1.2 1.2 0 0 1 1.2 1.2v8a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2v-8Z" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M2.2 6.9h11.6M5.2 1.9v2.6M10.8 1.9v2.6" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m5.5 10.5 1.8 1.8 3.2-3.2" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  callQualifie: (
    <path d="M8 1.9 10 6l4.5.6-3.3 3.1.8 4.5L8 12.1l-4 2.1.8-4.5L1.5 6.6 6 6 8 1.9Z" strokeWidth="1.5" strokeLinejoin="round" />
  ),
  close: (
    <>
      <path d="M3.6 14.4V2.1" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3.6 2.6h7.9l-1.7 2.9 1.7 2.9H3.6" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </>
  ),
  revenue: (
    <>
      <rect x="1.3" y="3.8" width="13.4" height="8.4" rx="1.4" strokeWidth="1.5" />
      <path d="M9.6 6.3a2.3 2.3 0 0 0-1.7-.7A2.4 2.4 0 0 0 5.6 8a2.4 2.4 0 0 0 2.3 2.4c.7 0 1.3-.3 1.7-.7M4.9 7.3h3.2M4.9 8.8h3.2" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  // « Vues / call » et « Rev / call » : un seul objet. Le libellé porte déjà la
  // division, et empiler un second objet dans 16 px le rendait illisible sans rien
  // ajouter au sens (essayé, mesuré, abandonné).
  vuesParCall: (
    <>
      <path d="M1.2 8S3.6 3.4 8 3.4 14.8 8 14.8 8 12.4 12.6 8 12.6 1.2 8 1.2 8Z" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2.1" strokeWidth="1.5" />
    </>
  ),
  // Seule composition conservée : billet € divisé par œil. Trois étages dans 16 px,
  // d'où la largeur maximale donnée à chaque élément et le rendu un cran plus grand.
  cashParVue: (
    <>
      <rect x="0.6" y="0.6" width="14.8" height="6.2" rx="1.1" strokeWidth="1.3" />
      <path d="M9.8 2.4a1.9 1.9 0 0 0-1.3-.5 1.9 1.9 0 0 0 0 3.8c.5 0 1-.2 1.3-.5" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5.7 3.2h3.3M5.7 4.5h3.3" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M1.3 8.3h13.4" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M1.6 12.6s2.5-2.7 6.4-2.7 6.4 2.7 6.4 2.7-2.5 2.7-6.4 2.7-6.4-2.7-6.4-2.7Z" strokeWidth="1.35" strokeLinejoin="round" />
      <circle cx="8" cy="12.6" r="1.4" strokeWidth="1.25" />
    </>
  ),
};

/**
 * Icône d'en-tête. `aria-hidden` : le libellé texte de la colonne la suit toujours,
 * l'icône n'ajoute rien pour un lecteur d'écran et ne ferait que doubler l'annonce.
 */
export function IconeColonne({ nom }: { nom: NomIcone }) {
  const taille = PLUS_GRANDES.has(nom) ? 15 : 13;
  return (
    <svg
      width={taille} height={taille} viewBox="0 0 16 16"
      fill="none" stroke="currentColor" aria-hidden="true" focusable="false"
      style={{ flex: 'none', opacity: 0.75, verticalAlign: 'middle' }}
    >
      {TRACES[nom]}
    </svg>
  );
}

/**
 * En-tête de colonne : icône puis libellé, alignés sur la même ligne de base.
 *
 * `inline-flex` et non `flex` : les cellules d'en-tête sont alignées à droite dans
 * deux des trois tableaux, et un conteneur en `flex` occuperait toute la largeur, ce
 * qui casserait cet alignement.
 */
export function EnteteColonne({ nom, children }: { nom: NomIcone; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <IconeColonne nom={nom} />
      {children}
    </span>
  );
}
