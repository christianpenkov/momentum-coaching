import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';

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

    const { error: payErr } = await supa.from('deal_payments').insert({
      deal_id: full.deal_id,
      installment_id: full.id,
      stripe_payment_id: `offline_${full.id}`,
      amount: full.amount,
      currency: 'eur',
      paid_at: new Date().toISOString(),
      status: 'succeeded',
      match_method: 'manual',
    });
    if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

    await supa.from('deal_installments')
      .update({ status: 'paid' })
      .eq('id', full.id);

    // Le deal passe à « payé » quand plus aucune échéance n'est en attente.
    const { count: restantes } = await supa
      .from('deal_installments')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', full.deal_id)
      .neq('status', 'paid');

    if ((restantes ?? 0) === 0) {
      await supa.from('deals').update({ status: 'paid' }).eq('id', full.deal_id);
    }

    return NextResponse.json({ ok: true, received: true, remaining: restantes ?? 0 });
  }

  const sent = body.sent !== false;

  const { error } = await supa.from('deal_installments').update({
    sent_at: sent ? new Date().toISOString() : null,
    status: sent ? 'sent' : 'pending',
  }).eq('id', body.installmentId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, sent });
}
