import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getStripeAccess, resolveTargetProfile } from '@/lib/stripe-account';
import { createDealPaymentLink } from '@/lib/stripe-payment-links';
import { isValidContentId } from '@/lib/contentId';

/**
 * Création d'un deal et de son (ses) lien(s) de paiement.
 *
 * POST /api/payments/links
 *   { buyerName, amount, paymentPlan, installmentsCount?, installmentInterval?,
 *     igLeadId? | prospectId? | callId? | clientId?, buyerEmail?, profileId? }
 *
 * Un seul de ces quatre identifiants est renseigné — ils désignent des tables
 * différentes, et se tromper de champ violerait une clé étrangère. Un deal sans
 * aucun des quatre reste légitime : c'est le cas « hors pipeline ».
 *
 * Trois plans possibles :
 *   one_shot            → 1 lien du montant total
 *   installments_auto   → 1 lien en subscription ; Stripe prélève N fois puis
 *                         s'arrête (bornage posé par le webhook, cf.
 *                         ensureInstallmentSchedule)
 *   installments_manual → N liens, un par échéance, envoyés à la main
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const INTERVAL_DAYS = { month: 30, week: 7 } as const;

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });

  const profileId = await resolveTargetProfile(user.id, body.profileId ?? null);
  if (!profileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const buyerName = String(body.buyerName ?? '').trim();
  const amount = Number(body.amount);
  const plan = String(body.paymentPlan ?? 'one_shot');
  const count = body.installmentsCount ? Number(body.installmentsCount) : null;
  const interval = (body.installmentInterval ?? 'month') as 'month' | 'week';

  if (!buyerName) return NextResponse.json({ error: 'Nom requis' }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Montant invalide' }, { status: 400 });
  }
  if (plan !== 'one_shot' && (!count || count < 2)) {
    return NextResponse.json({ error: 'Nombre d\'échéances invalide' }, { status: 400 });
  }

  const access = await getStripeAccess(profileId);
  if (!access) {
    return NextResponse.json(
      { error: 'Stripe non connecté', code: 'stripe_disconnected' },
      { status: 409 },
    );
  }

  // ── Attribution ────────────────────────────────────────────────────────────
  // Reprise du lead quand il existe. Un deal sans lead reste légitime : sans ce
  // cas, l'élève créerait un faux lead pour encaisser, ce qui polluerait son
  // pipeline et ses taux de conversion.
  let firstTouch: string | null = null;
  let attributionSource = 'manual';
  // Un prospect sélectionné depuis un call sans lead : on récupère au passage son
  // ig_lead_id/prospect_id s'il en a un, et l'attribution portée par le call.
  let igLeadId: string | null = body.igLeadId ?? null;
  let prospectId: string | null = body.prospectId ?? null;

  if (body.callId) {
    const { data: call } = await supa
      .from('calls')
      .select('ig_lead_id, prospect_id, utm_content, source')
      .eq('id', body.callId)
      .eq('coach_id', profileId)
      .maybeSingle();
    if (call) {
      igLeadId = igLeadId ?? call.ig_lead_id;
      prospectId = prospectId ?? call.prospect_id;
      // utm_content ne vaut que si c'est un vrai ID de contenu : le champ a
      // longtemps reçu des pseudos slugifiés (bug documenté PageLiens.tsx:1897).
      if (isValidContentId(call.utm_content)) {
        firstTouch = call.utm_content;
        attributionSource = 'content';
      } else if (call.source) {
        attributionSource = 'organic';
      }
    }
  }

  if (igLeadId) {
    const { data: lead } = await supa
      .from('instagram_leads')
      .select('media_id, source')
      .eq('id', igLeadId)
      .maybeSingle();
    if (lead?.media_id) { firstTouch = lead.media_id; attributionSource = 'content'; }
    else if (lead?.source === 'cold_dm') attributionSource = 'cold_dm';
    else if (lead) attributionSource = 'organic';
  } else if (prospectId) {
    // Prospect YouTube ou « autre » : pas de media_id, l'origine reste la source.
    attributionSource = 'organic';
  } else if (body.clientId) {
    attributionSource = 'client_existant';
  }

  // Élève de la plateforme ou client externe — alimente la colonne « Type » côté coach.
  const buyerKind = body.clientId ? "student" : (igLeadId || prospectId) ? null : "external";

  const { data: deal, error: dealErr } = await supa.from('deals').insert({
    profile_id: profileId,
    call_id: body.callId ?? null,
    ig_lead_id: igLeadId,
    prospect_id: prospectId,
    client_id: body.clientId ?? null,
    buyer_name: buyerName,
    buyer_email: body.buyerEmail ?? null,
    buyer_kind: buyerKind,
    amount_total: amount,
    currency: 'eur',
    payment_plan: plan,
    installments_count: count,
    installment_interval: plan === 'one_shot' ? null : interval,
    signed_at: new Date().toISOString(),
    status: 'open',
    first_touch_content_id: firstTouch,
    last_touch_content_id: firstTouch,
    attribution_source: attributionSource,
  }).select('id').single();

  if (dealErr) return NextResponse.json({ error: dealErr.message }, { status: 500 });

  const productName = `Accompagnement — ${buyerName}`;

  try {
    // ── Mode manuel : N échéances, N liens ───────────────────────────────────
    if (plan === 'installments_manual' && count) {
      const per = Math.round((amount / count) * 100) / 100;
      // Le reliquat d'arrondi va sur la première échéance : la somme des liens
      // doit faire exactement le montant du deal, au centime près.
      const first = Math.round((amount - per * (count - 1)) * 100) / 100;
      const signedAt = new Date();
      const links: { rank: number; url: string; amount: number; dueOn: string }[] = [];
      let firstLink: Awaited<ReturnType<typeof createDealPaymentLink>> | null = null;

      for (let rank = 1; rank <= count; rank++) {
        const amt = rank === 1 ? first : per;
        const due = new Date(signedAt.getTime() + (rank - 1) * INTERVAL_DAYS[interval] * 86400_000);

        const { data: inst, error: instErr } = await supa.from('deal_installments').insert({
          deal_id: deal.id,
          rank,
          amount: amt,
          due_on: due.toISOString().slice(0, 10),
          status: 'pending',
        }).select('id').single();
        if (instErr) throw instErr;

        const link = await createDealPaymentLink({
          profileId,
          dealId: deal.id,
          amount: amt,
          productName: `${productName} — ${rank}/${count}`,
          leadId: igLeadId,
          installmentId: inst.id,
          contentId: firstTouch,
          prospectHandle: body.prospectHandle ?? null,
        }, access);

        await supa.from('deal_installments').update({
          stripe_payment_link_id: link.paymentLinkId,
          short_url: link.url,
          stripe_url: link.stripeUrl,
          shortio_link_id: link.shortioId,
        }).eq('id', inst.id);

        links.push({ rank, url: link.url, amount: amt, dueOn: due.toISOString().slice(0, 10) });
        if (rank === 1) firstLink = link;
      }

      // Le premier lien est celui que l'élève envoie tout de suite : il devient
      // aussi celui du deal, pour que la page Paiements ait toujours quelque chose
      // à copier sans avoir à ouvrir l'échéancier.
      await supa.from('deals').update({
        short_url: firstLink?.url ?? links[0].url,
        stripe_url: firstLink?.stripeUrl ?? null,
        shortio_link_id: firstLink?.shortioId ?? null,
      }).eq('id', deal.id);
      return NextResponse.json({ dealId: deal.id, mode: 'manual', links });
    }

    // ── Comptant ou prélèvement automatique : un seul lien ───────────────────
    const link = await createDealPaymentLink({
      profileId,
      dealId: deal.id,
      amount: plan === 'installments_auto' && count ? amount / count : amount,
      productName,
      leadId: igLeadId,
      customerEmail: body.buyerEmail ?? null,
      contentId: firstTouch,
      prospectHandle: body.prospectHandle ?? null,
      installments: plan === 'installments_auto' && count
        ? { count, interval }
        : null,
    }, access);

    await supa.from('deals').update({
      stripe_payment_link_id: link.paymentLinkId,
      short_url: link.url,
      stripe_url: link.stripeUrl,
      shortio_link_id: link.shortioId,
    }).eq('id', deal.id);

    return NextResponse.json({ dealId: deal.id, mode: plan, url: link.url });
  } catch (err) {
    // Le deal existe mais Stripe a refusé : on le supprime plutôt que de laisser
    // une ligne sans lien, invisible et impossible à payer.
    await supa.from('deals').delete().eq('id', deal.id);
    const message = err instanceof Error ? err.message : 'Création du lien impossible';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
