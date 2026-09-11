/**
 * Ce que le client voit écrit sur sa page de paiement Stripe.
 *
 * ── Pourquoi ça se choisit ─────────────────────────────────────────────────
 * C'était « Accompagnement », en dur, dans CINQ fichiers — et c'est le mot que
 * lit l'acheteur au moment de sortir sa carte, puis chaque mois sur son relevé
 * bancaire. Tous les coachs ne vendent pas un accompagnement : un consultant
 * vend une prestation, un formateur une formation. Relevé par Chris le
 * 2026-09-08, en voyant « Accompagnement » sur toutes ses ventes de test.
 *
 * ── Pourquoi une liste fermée et pas un champ libre ────────────────────────
 * Ce libellé part chez Stripe, apparaît sur un relevé bancaire et ne se corrige
 * plus une fois le paiement passé. Une liste courte évite la faute de frappe
 * définitive, le nom commercial qui ne dit rien à la banque du client, et le
 * champ vide. Si un jour un coach a besoin d'autre chose, on ajoute une entrée
 * ici — un mot dans un tableau, pas un chantier.
 *
 * ── Pourquoi la construction du nom vit ici aussi ──────────────────────────
 * Les cinq endroits ne se contentaient pas du mot : ils recomposaient chacun
 * « X — Nom », « X — Nom — 2/3 », « Complément — Nom ». Rendre le mot
 * configurable sans rassembler la composition aurait garanti qu'un des cinq
 * garde l'ancien format — le défaut le plus fréquent de ce projet.
 */

/** Le repli, et la valeur par défaut en base. */
export const LIBELLE_PRODUIT_DEFAUT = 'Accompagnement / Coaching';

/**
 * Les libellés proposés. Volontairement génériques : le client doit reconnaître
 * l'achat sur son relevé, pas découvrir un nom commercial.
 *
 * Quatre entrées, arbitrées par Chris le 2026-09-08 sur une première liste de
 * sept. Le principe de son arbitrage : deux mots qui décrivent la MÊME vente
 * ne font qu'une entrée — les séparer force un choix sans conséquence, et deux
 * coachs qui vendent la même chose apparaîtraient différemment sur un relevé.
 *   · « Accompagnement » et « Coaching » réunis — c'est la même prestation
 *   · « Prestation » et « Services » réunis en « Prestation de service »
 *   · « Consultation » devient « Consulting », le mot du métier
 *   · « Programme » retiré : il ne dit pas ce qui est vendu
 */
export const LIBELLES_PRODUIT = [
  'Accompagnement / Coaching',
  'Formation',
  'Consulting',
  'Prestation de service',
] as const;

export type LibelleProduit = typeof LIBELLES_PRODUIT[number];

export function estLibelleValide(v: unknown): v is LibelleProduit {
  return typeof v === 'string' && (LIBELLES_PRODUIT as readonly string[]).includes(v);
}

/**
 * Le libellé choisi par ce coach, ou le repli.
 *
 * Une valeur inconnue en base (colonne modifiée à la main, libellé retiré de la
 * liste un jour) retombe sur le repli plutôt que de partir telle quelle chez
 * Stripe : ce texte n'est plus modifiable une fois le paiement encaissé.
 */
export async function libelleProduitDe(profileId: string): Promise<LibelleProduit> {
  // ⚠️ Import DYNAMIQUE, et deux raisons qui vont dans le même sens.
  //
  // 1. Ce module est importé par des composants `'use client'` pour ses
  //    constantes et ses phrases. Un `import` statique de supabase-js les ferait
  //    tous embarquer la librairie, et un `createClient()` au niveau du module
  //    s'exécuterait dans le navigateur — où `SUPABASE_SERVICE_ROLE_KEY` n'existe
  //    pas, donc « supabaseKey is required » au premier rendu.
  //
  // 2. `npm test` tourne SANS dépendances installées (AGENTS.md). Un import
  //    statique aurait fait échouer lib/libelleProduit.test.ts au chargement,
  //    alors qu'il ne teste que des fonctions pures. Le seul appelant de cette
  //    fonction-ci est du code serveur, où node_modules existe toujours.
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data } = await supa
    .from('profiles').select('libelle_produit').eq('id', profileId).maybeSingle();
  return estLibelleValide(data?.libelle_produit) ? data.libelle_produit : LIBELLE_PRODUIT_DEFAUT;
}

/* ─── Le même produit, mais DANS UNE PHRASE ────────────────────────────────────
 *
 * `nomProduit` sert Stripe : « Accompagnement / Coaching — Marie ». C'est une
 * étiquette, elle se lit seule.
 *
 * Les écrans, eux, écrivent des phrases : « l'accompagnement s'est arrêté »,
 * « l'accompagnement suit son cours ». Y coller l'étiquette telle quelle donnerait
 * « l'Accompagnement / Coaching s'est arrêté » — illisible, et faux en genre dès
 * qu'on choisit « Formation ».
 *
 * ⚠️ D'où une table, et non une transformation : le français ne se déduit pas
 * d'une chaîne. « Formation » prend « la » et accorde le participe, « Consulting »
 * prend « le », « Accompagnement » veut une élision. Un `toLowerCase()` suivi d'un
 * article fixe aurait écrit « la formation s'est arrêté ».
 *
 * ⚠️ Et des PHRASES ENTIÈRES exportées, pas des morceaux à recomposer chez
 * l'appelant. Cinq écrans écrivaient « accompagnement » en dur ; leur donner des
 * briques aurait produit cinq assemblages, donc cinq occasions d'oublier l'accord.
 * C'est exactement le motif qui a fait naître `nomProduit` ici même.
 */

const EN_PHRASE: Record<LibelleProduit, { nom: string; article: string; feminin: boolean }> = {
  'Accompagnement / Coaching': { nom: 'accompagnement', article: 'l’', feminin: false },
  'Formation':                 { nom: 'formation',      article: 'la ', feminin: true  },
  'Consulting':                { nom: 'consulting',     article: 'le ', feminin: false },
  'Prestation de service':     { nom: 'prestation',     article: 'la ', feminin: true  },
};

function enPhrase(libelle: string | null | undefined) {
  return EN_PHRASE[estLibelleValide(libelle) ? libelle : LIBELLE_PRODUIT_DEFAUT];
}

/** Majuscule sur la première lettre, élision comprise (« L’accompagnement »). */
function capitaliser(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** « l’accompagnement », « la formation » — au milieu d'une phrase. */
export function produitDefini(libelle: string | null | undefined): string {
  const p = enPhrase(libelle);
  return `${p.article}${p.nom}`;
}

/** « L’accompagnement s’est arrêté », « La formation s’est arrêtée ». */
export function produitSestArrete(libelle: string | null | undefined): string {
  const p = enPhrase(libelle);
  return `${capitaliser(produitDefini(libelle))} s’est arrêté${p.feminin ? 'e' : ''}`;
}

/** « l’accompagnement suit son cours », « la formation suit son cours ». */
export function produitSuitSonCours(libelle: string | null | undefined): string {
  return `${produitDefini(libelle)} suit son cours`;
}

/**
 * « Accompagnement arrêté », « Formation arrêtée » — sans article.
 *
 * Pour un texte d'exemple dans un champ de saisie, où l'article ferait lourd.
 * Le `nom` est une COLONNE de la table et non le résultat d'un article retiré à
 * l'expression régulière : « l’accompagnement » et « la formation » ne se
 * découpent pas pareil, et une regex y aurait produit « ’accompagnement ».
 */
export function produitArreteSansArticle(libelle: string | null | undefined): string {
  const p = enPhrase(libelle);
  return `${capitaliser(p.nom)} arrêté${p.feminin ? 'e' : ''}`;
}

/**
 * Le nom exact envoyé à Stripe.
 *
 * `rang`/`total` ne s'affichent qu'au-delà d'une échéance : « — 1/1 » sur un
 * comptant ferait croire à un paiement en plusieurs fois.
 */
export function nomProduit(
  libelle: string,
  acheteur: string,
  opts?: { rang?: number; total?: number },
): string {
  const base = `${libelle} — ${acheteur}`;
  const { rang, total } = opts ?? {};
  return rang && total && total > 1 ? `${base} — ${rang}/${total}` : base;
}

/**
 * Le nom d'un complément — ce qu'on encaisse EN PLUS après une hausse de montant.
 *
 * Il ne porte pas le libellé du produit, volontairement : le client a déjà payé
 * son accompagnement, il paie ici un ajustement. Le lui présenter une seconde
 * fois sous le même nom laisserait croire à un second achat du même service.
 */
export function nomComplement(acheteur: string): string {
  return `Complément — ${acheteur}`;
}
