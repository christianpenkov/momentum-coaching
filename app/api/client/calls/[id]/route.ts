import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id: callId } = await params;
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

  // Champs autorisés à mettre à jour.
  //
  // `revenue` doit y figurer : la modale de closing manuel du pipeline demande le
  // montant et l'envoie ici (PagePipeline.tsx, cas forward_to_closed), en promettant
  // à l'écran que le chiffre d'affaires sera comptabilisé. Sans lui dans cette liste
  // le serveur jetait le montant en silence — l'appel passait « closé » à 0 €.
  const allowed = ['status', 'no_show', 'no_show_at', 'rescheduled', 'rescheduled_at', 'scheduled_at', 'cancellation_reason', 'deal_closed', 'revenue', 'ig_lead_id', 'is_follow_up'];
  const update: Record<string, any> = {};
  for (const field of allowed) {
    if (field in body) update[field] = body[field];
  }

  // `revenue` porte de l'argent : on refuse une valeur qui n'en est pas plutôt que
  // de laisser Postgres écrire un NaN ou de compter un montant négatif dans le CA.
  // `null` reste accepté : c'est ainsi qu'on efface un montant saisi par erreur.
  if ('revenue' in update && update.revenue !== null) {
    const montant = Number(update.revenue);
    if (!Number.isFinite(montant) || montant < 0) {
      return NextResponse.json({ error: 'Montant invalide' }, { status: 400 });
    }
    update.revenue = montant;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  const { error } = await supa.from('calls').update(update).eq('id', callId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id: callId } = await params;
  if (!callId) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

  const { data: callRow } = await supa.from('calls')
    .select('id, coach_id, client_id')
    .eq('id', callId)
    .maybeSingle();

  if (!callRow) return NextResponse.json({ error: 'Call introuvable' }, { status: 404 });

  const { data: clientRow } = await supa.from('clients')
    .select('id, coach_id')
    .eq('profile_id', user.id)
    .maybeSingle();

  const isOwner =
    callRow.coach_id === user.id ||
    (clientRow && callRow.client_id === clientRow.id);

  if (!isOwner) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });

  // ── Garde-fou : jamais de suppression quand un deal est signé ────────────────
  // Même raisonnement que app/api/client/pipeline/route.ts:215 — ici la suppression
  // pose ignored=true, et toutes les lectures de stats filtrent .neq('ignored', true).
  // Le chiffre d'affaires disparaîtrait donc de Revenue, Deals closés, Closing,
  // Rev/call et Top contenus, sans que personne ne le remarque.
  //
  // C'est le 4ᵉ chemin de suppression que docs/tracking-prospect.md (Règle 4) demande
  // de protéger : deux appelants passent par ici — le bouton « Retirer » sur un appel
  // annulé (PageClientCalls.tsx) et le recul d'une carte post-call (PagePipeline.tsx).
  //
  // Ce qui décide, c'est l'argent réellement encaissé — donc on regarde la table
  // `deals`, qui porte le CA depuis le 2026-08-20, et pas seulement le drapeau
  // deal_closed coché sur l'appel. `canceled` est exclu : un deal annulé ne retient
  // plus rien. Le drapeau reste consulté en second, pour couvrir le cas d'un rapport
  // interrompu avant la création du deal (montant saisi, aucune ligne de deal).
  const { data: dealsLies } = await supa.from('deals')
    .select('id, amount_total, status, buyer_name')
    .eq('call_id', callId)
    .neq('status', 'canceled');

  if (dealsLies && dealsLies.length > 0) {
    const deal = dealsLies[0];
    const montant = deal.amount_total
      ? `${Math.round(Number(deal.amount_total))} €`
      : 'un montant enregistré';
    return NextResponse.json({
      error: `Cet appel porte un deal signé (${montant}). Corrige d'abord son rapport de vente si tu veux vraiment le supprimer — sinon son chiffre d'affaires disparaîtrait de tes statistiques.`,
      code: 'deal_signed',
    }, { status: 409 });
  }

  const { data: callDeal } = await supa.from('calls')
    .select('deal_closed, revenue')
    .eq('id', callId)
    .maybeSingle();

  if (callDeal?.deal_closed) {
    const montant = callDeal.revenue
      ? `${Math.round(Number(callDeal.revenue))} €`
      : 'un montant enregistré';
    return NextResponse.json({
      error: `Cet appel est marqué comme closé (${montant}). Corrige d'abord son rapport de vente si tu veux vraiment le supprimer — sinon son chiffre d'affaires disparaîtrait de tes statistiques.`,
      code: 'deal_signed',
    }, { status: 409 });
  }

  await Promise.all([
    supa.from('prospect_events').delete().eq('call_id', callId),
    supa.from('calls').update({ ignored: true, ig_lead_id: null }).eq('id', callId),
  ]);

  return NextResponse.json({ ok: true });
}
