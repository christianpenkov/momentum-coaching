import { NextRequest, NextResponse } from 'next/server';
import { requireCallAccess, serviceSupabase } from '@/lib/callAccess';
import { calculerCash, type LignePaiement } from '@/lib/dealCash';
import { desactiverLiensDuDeal } from '@/lib/stripe-payment-links';

// PATCH /api/calls/[id]/rapport
//
// Body : { no_show?, deal_closed?, revenue?, outcome?, qualified?,
//          objection?, objection_autre?, lead_rapport_comment? }
//
// Seul l'élève hôte du call (coach_id = user.id pour les calls Calendly) peut
// remplir. La liste blanche ci-dessous est STRICTE : un champ non déclaré est
// ignoré en silence, donc tout nouveau champ du rapport doit être ajouté ici en
// même temps que dans lib/rapportPatch.ts.
//
// ── CE QUI A ÉTÉ RETIRÉ LE 2026-08-27 ─────────────────────────────────────────
//
// Cette route écrivait aussi un `pipeline_overrides` à chaque rapport, via une
// fonction outcomeToStage() qui traduisait le résultat en étape de kanban
// (`showed_up`, `closed`, `call_booked`…).
//
// C'est exactement la double écriture que la refonte du pipeline élimine :
// l'issue d'un lead n'est PLUS stockée nulle part, elle est calculée à
// l'affichage par lib/pipelineStage.ts à partir du call lui-même. Garder cet
// override, c'était écrire deux fois le même fait — et l'écriture partait en
// fire-and-forget, avec une erreur seulement loguée. Si elle échouait, le
// pipeline et les statistiques se contredisaient sans que rien ne le signale.
//
// Le classement à la main continue, lui, d'écrire dans `pipeline_overrides` :
// c'est sa seule source, puisqu'un lead classé sans rendez-vous n'a aucune ligne
// dans `calls`. Les deux ne se marchent pas dessus — le call gagne toujours.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Authentification + contrôle d'appartenance : logique déplacée telle quelle dans
  // lib/callAccess.ts, partagée avec la route des brouillons. C'est la seule
  // définition de « qui a le droit de toucher ce call » — l'avertissement sur
  // client_id des calls Calendly y est conservé intégralement.
  const access = await requireCallAccess(id);
  if (!access.ok) return access.response;

  const { data: call } = await serviceSupabase
    .from('calls')
    .select('id')
    .eq('id', id)
    .single();

  if (!call) return NextResponse.json({ error: 'Call introuvable' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if (typeof body.no_show === 'boolean')    patch.no_show = body.no_show;
  if (typeof body.deal_closed === 'boolean') patch.deal_closed = body.deal_closed;
  if (typeof body.revenue === 'number')     patch.revenue = body.revenue;
  if (typeof body.outcome === 'string')     patch.outcome = body.outcome;
  if (typeof body.qualified === 'boolean')  patch.qualified = body.qualified;
  if (typeof body.lead_rapport_comment === 'string') patch.lead_rapport_comment = body.lead_rapport_comment.slice(0, 2000) || null;

  // L'objection et son texte libre. `objection_autre` accepte `null` en plus
  // d'une chaîne : c'est ainsi qu'on EFFACE un texte devenu faux quand l'élève
  // corrige son rapport et change d'objection.
  if (typeof body.objection === 'string')   patch.objection = body.objection;
  if (typeof body.objection_autre === 'string') patch.objection_autre = body.objection_autre.slice(0, 500) || null;
  else if (body.objection_autre === null)   patch.objection_autre = null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucune donnée à mettre à jour' }, { status: 400 });
  }

  // ── La vente cesse d'en être une ────────────────────────────────────────────
  // Corriger un rapport de « vente conclue » vers autre chose laissait le deal
  // intact dans la page Paiements : le pipeline disait « pas de vente » pendant
  // que le cash contracté continuait de la compter. Deux écrans qui se
  // contredisent, sans que rien ne l'explique.
  //
  // Ce qui décide, c'est l'argent réellement encaissé — donc `deals`, qui porte
  // le cash depuis le 2026-08-20, et pas le drapeau `deal_closed` du call.
  if (patch.deal_closed === false) {
    const { data: deals } = await serviceSupabase
      .from('deals')
      .select('id, profile_id, amount_total, deal_payments(amount, status)')
      .eq('call_id', id)
      .neq('status', 'canceled');

    for (const deal of deals ?? []) {
      const cash = calculerCash((deal as { deal_payments?: LignePaiement[] }).deal_payments);

      // De l'argent est entré : on refuse plutôt que de le faire disparaître des
      // statistiques. « Pas de vente » et « ce client m'a payé » sont
      // contradictoires — si les deux sont vrais, il y a une erreur de saisie,
      // et elle se corrige en remboursant, pas en effaçant.
      if (cash.net > 0.01) {
        return NextResponse.json({
          error: `Cette vente a déjà encaissé ${Math.round(cash.net)} €. Pour la repasser en « pas de vente », il faut d'abord rembourser ton client.`,
          code: 'deal_encaisse',
          dealId: deal.id,
          encaisse: cash.net,
        }, { status: 409 });
      }
    }

    // Rien d'encaissé : la vente est annulée, et ses liens cessent d'être
    // payables. Sans cette désactivation, un client qui retrouve un lien dans sa
    // conversation paierait une vente qui n'existe plus.
    for (const deal of deals ?? []) {
      await serviceSupabase.from('deals').update({ status: 'canceled' }).eq('id', deal.id);
      await desactiverLiensDuDeal(serviceSupabase, deal.id, String(deal.profile_id));
    }
  }

  const { error } = await serviceSupabase
    .from('calls')
    .update(patch)
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
