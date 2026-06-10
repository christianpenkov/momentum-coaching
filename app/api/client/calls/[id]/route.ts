import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const callId = params.id;
  if (!callId) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  // Vérifie que le call appartient bien au client (via coach_id ou client_id)
  const { data: callRow } = await supa.from('calls')
    .select('id, coach_id, client_id')
    .eq('id', callId)
    .maybeSingle();

  if (!callRow) return NextResponse.json({ error: 'Call introuvable' }, { status: 404 });

  // Vérification ownership : le call doit appartenir à ce profil
  const { data: clientRow } = await supa.from('clients')
    .select('id, coach_id')
    .eq('profile_id', user.id)
    .maybeSingle();

  const isOwner =
    callRow.coach_id === user.id ||
    (clientRow && callRow.client_id === clientRow.id);

  if (!isOwner) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });

  // Champs autorisés à mettre à jour
  const allowed = ['status', 'no_show', 'no_show_at', 'rescheduled', 'rescheduled_at', 'cancellation_reason', 'deal_closed', 'ig_lead_id'];
  const update: Record<string, any> = {};
  for (const field of allowed) {
    if (field in body) update[field] = body[field];
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  const { error } = await supa.from('calls').update(update).eq('id', callId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
