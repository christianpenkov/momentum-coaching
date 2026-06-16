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

  if (email) {
    // Vérifie si le prospect existe déjà et est supprimé manuellement
    const { data: existing } = await serviceSupabase
      .from('prospects')
      .select('id, deleted')
      .eq('profile_id', profileId)
      .eq('email', email)
      .maybeSingle();

    // Prospect supprimé → ne pas réactiver, retourner null pour que le call soit fantôme
    if (existing && (existing as any).deleted) return null;

    const { data } = await serviceSupabase
      .from('prospects')
      .upsert({
        profile_id: profileId,
        platform,
        email,
        name,
        source,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'profile_id,email' })
      .select('id')
      .maybeSingle();
    return data?.id ?? null;
  }

  // Pas d'email : lookup par (profile_id, name, source) puis insert si absent
  const { data: existing } = await serviceSupabase
    .from('prospects')
    .select('id')
    .eq('profile_id', profileId)
    .eq('name', name!)
    .eq('source', source ?? '')
    .maybeSingle();

  if (existing) return existing.id;

  const { data: inserted } = await serviceSupabase
    .from('prospects')
    .insert({ profile_id: profileId, platform, email: null, name, source, updated_at: new Date().toISOString() })
    .select('id')
    .maybeSingle();
  return inserted?.id ?? null;
}
