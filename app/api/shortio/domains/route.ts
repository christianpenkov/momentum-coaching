import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');

  let targetProfileId = user.id;
  if (profileId && profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetProfileId = profileId;
  }

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('api_key, metadata')
    .eq('profile_id', targetProfileId)
    .eq('provider', 'shortio')
    .single();

  if (!integ?.api_key) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  // activeDomain vient EXCLUSIVEMENT de metadata (choisi à la connexion ou via le sélecteur) —
  // jamais recalculé depuis l'ordre de retour de l'API Short.io, qui ne garantit rien.
  const activeDomain = (integ.metadata?.domain && integ.metadata?.domain_id)
    ? { id: integ.metadata.domain_id, hostname: integ.metadata.domain }
    : null;

  // Fallback depuis les metadata Supabase (évite un appel API inutile)
  const metaDomains: { id: number; hostname: string }[] = integ.metadata?.all_domains ?? [];

  // Tenter l'API Short.io pour avoir la liste à jour (sert uniquement à peupler le
  // sélecteur — ne détermine jamais activeDomain)
  try {
    const res = await fetch('https://api.short.io/api/domains', {
      headers: { authorization: integ.api_key, accept: 'application/json' },
    });

    if (res.ok) {
      const data = await res.json();
      const domains = (Array.isArray(data) ? data : data.domains ?? []).map((d: any) => ({
        id: d.id,
        hostname: d.hostname,
      }));
      if (domains.length > 0) return NextResponse.json({ activeDomain, domains });
    }
  } catch {
    // API indisponible — on utilise le fallback
  }

  // Fallback : domaines depuis les metadata Supabase
  if (metaDomains.length > 0) {
    return NextResponse.json({ activeDomain, domains: metaDomains });
  }

  if (activeDomain) {
    return NextResponse.json({ activeDomain, domains: [activeDomain] });
  }

  return NextResponse.json({ error: 'Aucun domaine trouvé' }, { status: 404 });
}
