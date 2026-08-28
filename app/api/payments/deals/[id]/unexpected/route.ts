import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';

/**
 * Prendre acte d'un paiement inattendu sans rouvrir la vente.
 *
 * DELETE /api/payments/deals/[id]/unexpected
 *
 * ── Le cas ────────────────────────────────────────────────────────────────
 * De l'argent arrive sur une vente clôturée ou annulée. Momentum ne devine pas
 * si le client a repris ses paiements ou s'est trompé : il pose la question et
 * laisse deux réponses.
 *
 * « Réouvrir » passe par `DELETE …/end`, qui remet la vente en cours.
 * Cette route-ci est l'autre réponse : « c'était une erreur, je vais lui
 * rendre ». Elle éteint l'alerte sans toucher au statut ni à l'argent — le
 * remboursement se fait dans Stripe, et sera constaté comme n'importe quel
 * autre.
 *
 * L'argent reste compté tant qu'il n'est pas rendu : l'effacer ici afficherait
 * un encaissé plus bas que le solde réel du compte.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id: dealId } = await params;

  const { data: deal } = await supa
    .from('deals')
    .select('id, profile_id, unexpected_payment_at')
    .eq('id', dealId)
    .maybeSingle();

  if (!deal) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 });

  const allowed = await resolveTargetProfile(user.id, deal.profile_id);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  if (!deal.unexpected_payment_at) return NextResponse.json({ ok: true, deja: true });

  await supa.from('deals').update({ unexpected_payment_at: null }).eq('id', dealId);

  await supa.from('deal_events').insert({
    deal_id: dealId,
    kind: 'unexpected_ack',
    label: 'Paiement inattendu — à rembourser',
    actor_id: user.id,
    meta: { signaleLe: deal.unexpected_payment_at },
  });

  return NextResponse.json({ ok: true });
}
