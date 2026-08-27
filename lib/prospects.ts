import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Upsert un prospect non-IG (YT ou Autres) sur (profile_id, email).
 * Si le lead n'a pas d'email, on upsert sur (profile_id, name, source) — moins fiable
 * mais permet quand même de dédupliquer les rebooks du même invité.
 * Retourne le prospect.id à utiliser comme prospect_key dans pipeline_overrides.
 */
/**
 * Retrouve ou cree le prospect correspondant a un call.
 *
 * Delegue a la fonction SQL `resolve_prospect`, source de verite unique
 * partagee avec l'Edge Function sync-calendly. Cette derniere tourne en Deno et
 * ne peut pas importer ce fichier : sans la fonction SQL, la logique existerait
 * en deux exemplaires — ce qui est exactement ce qui a produit le bug corrige le
 * 2026-08-27, ou seul le chemin Vercel posait prospect_id.
 *
 * Renvoie null quand rien ne permet d'identifier la personne, et quand elle a
 * ete supprimee du pipeline : une suppression est une decision du coach, la
 * resolution automatique n'a pas a la defaire.
 */
export async function upsertProspect({
  profileId,
  platform,
  email,
  name,
  source,
}: {
  profileId: string;
  platform: 'yt' | 'other';
  email: string | null;
  name: string | null;
  source: string | null;
}): Promise<string | null> {
  if (!email && !name) return null;

  const { data, error } = await serviceSupabase.rpc('resolve_prospect', {
    p_profile_id: profileId,
    p_email: email,
    p_name: name,
    p_platform: platform,
    p_source: source,
  });

  if (error) {
    console.error('[prospects] resolve_prospect:', error.message);
    return null;
  }
  return (data as string | null) ?? null;
}
