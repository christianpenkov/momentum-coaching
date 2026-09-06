import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';
import { refreshDealStatus } from '@/lib/dealStatus';

/**
 * Marquer une échéance comme envoyée (ou revenir en arrière).
 *
 * Momentum ne peut pas SAVOIR qu'un lien a été envoyé : l'élève le colle dans son
 * DM Instagram, hors de la plateforme. Seule sa déclaration fait foi — d'où ce
 * marquage manuel, réversible parce qu'on se trompe de ligne.
 *
 * C'est ce qui distingue « je dois envoyer ce lien » de « j'attends que le client
 * paie » : deux situations qui appellent des actions différentes.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.installmentId) return NextResponse.json({ error: 'installmentId requis' }, { status: 400 });

  // Le deal porte le profil : on remonte depuis l'échéance pour vérifier l'accès.
  const { data: inst } = await supa
    .from('deal_installments')
    .select('id, status, deals!inner(profile_id)')
    .eq('id', body.installmentId)
    .maybeSingle();

  if (!inst) return NextResponse.json({ error: 'Échéance introuvable' }, { status: 404 });

  const ownerId = (inst as any).deals?.profile_id;
  const allowed = await resolveTargetProfile(user.id, ownerId);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  // Une échéance payée ne revient pas à « envoyée » : le paiement fait foi sur
  // la déclaration.
  if (inst.status === 'paid') {
    return NextResponse.json({ error: 'Échéance déjà payée' }, { status: 409 });
  }

  // ── Échéance encaissée hors Stripe ─────────────────────────────────────────
  // Virement, espèces : aucun webhook ne viendra jamais confirmer ce paiement,
  // c'est l'élève qui déclare l'avoir reçu. `match_method = 'manual'` garde la
  // trace que ce montant est DÉCLARÉ et non constaté par Stripe — la
  // distinction ne doit jamais se perdre dans les chiffres.
  if (body.received === true) {
    const { data: full } = await supa
      .from('deal_installments')
      .select('id, deal_id, amount, rank')
      .eq('id', body.installmentId)
      .single();
    if (!full) return NextResponse.json({ error: 'Échéance introuvable' }, { status: 404 });

    // ── Le montant se saisit, il ne se suppose pas ───────────────────────────
    // Un virement arrive rarement au centime près : frais bancaires, arrondi,
    // acompte. Enregistrer d'office le montant attendu écrirait un chiffre que
    // personne n'a vu passer sur le compte.
    //
    // Chaque déclaration porte un identifiant propre — plusieurs virements
    // partiels peuvent donc s'accumuler sur la même échéance sans s'écraser.
    const brut = body.amount === undefined ? Number(full.amount) : Number(body.amount);
    if (!Number.isFinite(brut) || brut <= 0) {
      return NextResponse.json({ error: 'Montant invalide' }, { status: 400 });
    }
    const recu = Math.round(brut * 100) / 100;
    const quand = body.date ? new Date(body.date) : new Date();
    if (Number.isNaN(quand.getTime())) {
      return NextResponse.json({ error: 'Date invalide' }, { status: 400 });
    }

    const { error: payErr } = await supa.from('deal_payments').insert({
      deal_id: full.deal_id,
      installment_id: full.id,
      stripe_payment_id: `offline_${full.id}_${Date.now()}`,
      amount: recu,
      currency: 'eur',
      paid_at: quand.toISOString(),
      status: 'succeeded',
      match_method: 'manual',
    });
    if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

    // ── L'échéance est-elle soldée ? ─────────────────────────────────────────
    // On somme ce qui a réellement été déclaré sur elle plutôt que de la passer
    // en `paid` sur la seule existence d'une déclaration : un acompte de 200 €
    // sur une échéance de 500 € ne la solde pas.
    const { data: sesPaiements } = await supa
      .from('deal_payments')
      .select('amount, status')
      .eq('installment_id', full.id);

    const surCetteEcheance = (sesPaiements ?? []).reduce((s, p) =>
      p.status === 'succeeded' ? s + Number(p.amount)
      : p.status === 'refunded' ? s - Number(p.amount)
      : s, 0);
    const soldee = surCetteEcheance >= Number(full.amount) - 0.01;

    if (soldee) {
      await supa.from('deal_installments').update({ status: 'paid' }).eq('id', full.id);
    }

    // ── Le statut de la vente suit la règle commune, EFFETS COMPRIS ─────────
    //
    // Compter les échéances restantes disait « soldée » dès la dernière ligne
    // cochée, même si les montants déclarés n'atteignaient pas le total. D'où le
    // recalcul depuis le cash.
    //
    // ⚠️ Mais ce recalcul était fait ICI, à la main, au lieu d'appeler la source
    // unique. Il ne gardait donc que la moitié de la règle : le statut, sans
    // aucun de ses effets. Un virement déclaré sur une vente CLÔTURÉE ne levait
    // pas `unexpected_payment_at`, n'écrivait rien au journal et n'envoyait
    // aucune notification — alors que le chemin Stripe fait les trois.
    //
    // Une partition corrigée d'un seul côté : l'argent qui entre par Stripe
    // était signalé, celui qui entre par virement dormait en silence sur une
    // vente que plus personne ne regarde. Relevé le 2026-09-06.
    //
    // `argentEntrant: true` — c'est bien un encaissement, pas un remboursement.
    await refreshDealStatus(supa, full.deal_id, { argentEntrant: true });

    const { count: restantes } = await supa
      .from('deal_installments')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', full.deal_id)
      .neq('status', 'paid');

    return NextResponse.json({
      ok: true, received: true, amount: recu, soldee, remaining: restantes ?? 0,
    });
  }

  const sent = body.sent !== false;

  const { error } = await supa.from('deal_installments').update({
    sent_at: sent ? new Date().toISOString() : null,
    status: sent ? 'sent' : 'pending',
  }).eq('id', body.installmentId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, sent });
}
