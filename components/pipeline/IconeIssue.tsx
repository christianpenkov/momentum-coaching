'use client';

// ── Le symbole d'une issue ────────────────────────────────────────────────────
//
// Un carré de couleur ne dit rien : il faut avoir appris la légende pour lire
// « gris = pas qualifié ». Et pour qui distingue mal les couleurs, « Perdu »
// (brun) et « Pas qualifié » (gris) sont exactement le même carré.
//
// Chaque issue porte donc un dessin qui redit ce que la couleur dit. Un seul
// vocabulaire graphique : contour, 1,7 px, bouts arrondis, boîte de 24. Sinon on
// lit cinq icônes venues de cinq endroits différents.
//
// Ce fichier existe pour être importé des DEUX côtés — le board (PagePipeline)
// et la vue liste (PipelineListView). Le garder dans PagePipeline obligeait la
// vue liste à importer son propre parent.

const CHEMINS_ISSUE: Record<string, string> = {
  // Flèche qui revient en arrière : reprendre contact.
  to_recontact:  'M9 14 4 9l5-5 M4 9h9a7 7 0 0 1 0 14h-3',
  // Un rendez-vous barré : la case était réservée, personne n'est venu.
  no_show:       'M3 8h18 M8 3v4 M16 3v4 M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M9 13l6 6 M15 13l-6 6',
  // Cercle barré : la personne existe, la cible non.
  not_qualified: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M6 6l12 12',
  // Croix dans un cercle : l'affaire est close, sans vente.
  lost:          'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9 9l6 6 M15 9l-6 6',
  // Coche dans un cercle : la seule issue qui rapporte.
  closed:        'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M8.5 12.2l2.4 2.4 4.6-4.9',
};

export default function IconeIssue({ issueKey, taille = 14 }: { issueKey: string; taille?: number }) {
  const d = CHEMINS_ISSUE[issueKey];
  // Pas de dessin connu : on ne met rien. Une forme inventée mentirait sur la
  // nature de l'issue, et un carré au hasard est précisément ce qu'on retire.
  if (!d) return null;
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block' }}>
      {d.split(' M').map((part, i) => <path key={i} d={i === 0 ? part : `M${part}`} />)}
    </svg>
  );
}
