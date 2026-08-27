import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Enregistre une relance sur un lead classé « À recontacter ».
//
// C'est le filet de sécurité du geste automatique : le webhook Instagram détecte
// déjà les DM sortants (`is_echo`), mais il peut manquer un message, et sans
// écriture la date de relance ne se reporterait jamais — le lead sortirait du
// cycle en Perdu alors qu'on vient de lui écrire.
//
// L'écriture passe par la RPC insert_prospect_event_relance : une relance est
// RÉPÉTABLE (c'est tout son intérêt), donc elle ne peut pas emprunter
// upsert_prospect_event_by_lead qui garantit « au plus un par lead ». La RPC
// incrémente `cycle` et ignore un second appel dans l'heure.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const { prospect_key, platform } = body ?? {};
  if (typeof prospect_key !== 'string' || !prospect_key.trim()) {
    return NextResponse.json({ error: 'prospect_key requis' }, { status: 400 });
  }
  if (platform !== 'ig' && platform !== 'yt' && platform !== 'other') {
    return NextResponse.json({ error: 'platform invalide' }, { status: 400 });
  }

  // Le lead Instagram, s'il en existe un : l'événement porte alors son id, ce qui
  // permet de le rattacher à la bonne fiche même si le pseudo change plus tard.
  let igLeadId: string | null = null;
  if (platform === 'ig') {
    const { data } = await supa
      .from('instagram_leads')
      .select('id')
      .eq('profile_id', user.id)
      .eq('ig_username', prospect_key)
      .is('archived_at', null)
      .order('detected_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    igLeadId = data?.id ?? null;
  }

  const { data, error } = await supa.rpc('insert_prospect_event_relance', {
    p_profile_id:   user.id,
    p_prospect_key: prospect_key,
    p_platform:     platform,
    p_occurred_at:  new Date().toISOString(),
    p_ig_lead_id:   igLeadId,
    p_metadata:     { source: 'manuel' },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, cycle: data ?? null });
}
