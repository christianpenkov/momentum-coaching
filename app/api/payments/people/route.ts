import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';

/**
 * Autocomplete du formulaire de création de lien : prospects du pipeline ou
 * clients existants (upsell).
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const profileId = await resolveTargetProfile(user.id, params.get('profileId'));
  if (!profileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const q = (params.get('q') ?? '').trim();
  const kind = params.get('kind') ?? 'prospect';
  if (q.length < 2) return NextResponse.json({ people: [] });

  if (kind === 'client') {
    // Les élèves du coach — pour un upsell.
    const { data } = await supa
      .from('clients')
      .select('id, name, email')
      .eq('coach_id', profileId)
      .is('archived_at', null)
      .ilike('name', `%${q}%`)
      .limit(8);

    return NextResponse.json({
      people: (data ?? []).map(c => ({
        id: c.id, name: c.name, subtitle: c.email ?? 'client', kind: 'client',
      })),
    });
  }

  // Prospects Instagram. not_a_lead exclu : un prospect que l'élève a explicitement
  // écarté ne doit pas revenir dans une liste de sélection.
  const { data } = await supa
    .from('instagram_leads')
    .select('id, ig_username, detected_at, source')
    .eq('profile_id', profileId)
    .is('archived_at', null)
    .eq('not_a_lead', false)
    .ilike('ig_username', `%${q}%`)
    .order('detected_at', { ascending: false })
    .limit(8);

  return NextResponse.json({
    people: (data ?? []).map(l => ({
      id: l.id,
      name: l.ig_username,
      subtitle: `@${l.ig_username}${l.source === 'cold_dm' ? ' · cold DM' : ''}`,
      kind: 'lead',
    })),
  });
}
