/**
 * Lit une requête Supabase EN ENTIER, page par page.
 *
 * PostgREST tronque toute réponse à 1 000 lignes SANS erreur. Une lecture « tous
 * les événements du profil » qui dépasse ce cap rend donc un résultat partiel qui
 * ressemble à un résultat complet — un comptage faux, une somme de cash fausse, une
 * réparation qui ne répare que le début. Le balayage du 2026-09-05 en a trouvé
 * quatre sur des chemins chauds (pipeline, stats de ventes, archivage OAuth).
 *
 * Équivalent Node de `lireTout` dans supabase/functions/_shared/ig-posts.ts.
 *
 * Usage : `const { data, error } = await lireTout(() => supa.from('t').select('…').eq(…))`
 * — la fabrique est rappelée à chaque page pour poser `.range()` sur une requête
 * neuve. Ne PAS mettre `.limit()` ni `.range()` dans la fabrique. Un `.order()`
 * stable est recommandé : sans lui, deux pages peuvent se recouvrir ou se trouer.
 *
 * Le type des lignes (`T`) est inféré de la requête : rien ne change pour le code
 * qui lit `data` derrière. La signature reste volontairement PLATE (pas de
 * `Awaited<…>` sur le builder) — TypeScript refusait l'inférence en profondeur
 * sur les builders PostgREST (TS2589).
 */
type Erreur = { message: string } | null;

export async function lireTout<T>(
  construire: () => { range: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: Erreur }> },
): Promise<{ data: T[]; error: Erreur }> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let depuis = 0; ; depuis += PAGE) {
    const { data, error } = await construire().range(depuis, depuis + PAGE - 1);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return { data: out, error: null };
}
