import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getStripeAccess, resolveTargetProfile } from '@/lib/stripe-account';
import { createDealPaymentLink } from '@/lib/stripe-payment-links';
import { isValidContentId } from '@/lib/contentId';
import { dateDeVente } from '@/lib/callSeries';
import { contenuConversion, contenuActivation } from '@/lib/attribution-roles';

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

  // Encaissement HORS Stripe — virement, espèces, tout ce qui ne transite pas
  // par la plateforme. Personne ne peut alors confirmer le paiement
  // automatiquement : c'est l'élève qui déclare.
  //
  // Comptant  → le paiement est enregistré tout de suite (l'argent est là).
  // Plusieurs → l'échéancier est créé sans lien Stripe, et chaque échéance
  //             remonte dans Relances à sa date pour être cochée « reçu ».
  //
  // Le deal existe dans tous les cas : sans lui il manquerait au cash et à
  // l'attribution par contenu, alors que la vente a bien eu lieu.
  const offline = body.offline === true || body.skipLink === true;

  const access = offline ? null : await getStripeAccess(profileId);
  if (!offline && !access) {
    return NextResponse.json(
      { error: 'Stripe non connecté', code: 'stripe_disconnected' },
      { status: 409 },
    );
  }

  // Un compte Stripe connecté mais dont le dossier n'est pas finalisé (identité,
  // activité, IBAN) accepte la connexion OAuth SANS ERREUR, puis refuse tout
  // paiement. Sans ce contrôle, Momentum créerait un lien parfaitement valide
  // que le client ne pourrait pas payer — et l'élève ne le découvrirait qu'au
  // moment où sa vente échoue.
  //
  // Vérifié en amont de la création du deal : mieux vaut aucun deal qu'un deal
  // portant un lien mort.
  // Uniquement en LIVE : en mode test, un compte Connect encaisse sans dossier
  // complet — `charges_enabled` reste false alors que les paiements passent
  // (vérifié le 21/08/2026 : 300 € encaissés avec le drapeau à false).
  // Appliquer la garde en test bloquerait des paiements qui fonctionnent.
  const isLiveMode = !process.env.STRIPE_SECRET_KEY?.startsWith('sk_test');
  if (isLiveMode && access?.accountId) {
    try {
      const acct = await access.stripe.accounts.retrieve(access.accountId);
      if (!acct.charges_enabled) {
        const due = (acct.requirements?.currently_due ?? []).length;
        return NextResponse.json({
          error: due > 0
            ? 'Ton compte Stripe n’est pas encore activé : il reste des informations à fournir chez Stripe (identité, activité, IBAN). Aucun paiement ne peut aboutir tant que ce n’est pas fait.'
            : 'Ton compte Stripe n’accepte pas encore les paiements. Vérifie son état sur dashboard.stripe.com.',
          code: 'stripe_charges_disabled',
        }, { status: 409 });
      }
    } catch {
      // Stripe injoignable : on laisse passer plutôt que de bloquer une vente
      // sur une panne réseau. Le pire cas redevient l'ancien comportement.
    }
  }

  // ── Attribution ────────────────────────────────────────────────────────────
  // Reprise du lead quand il existe. Un deal sans lead reste légitime : sans ce
  // cas, l'élève créerait un faux lead pour encaisser, ce qui polluerait son
  // pipeline et ses taux de conversion.
  let firstTouch: string | null = null;
  let attributionSource = 'manual';
  // Un prospect sélectionné depuis un call sans lead : on récupère au passage son
  // ig_lead_id/prospect_id s'il en a un, et l'attribution portée par le call.
  // Date de la VENTE. Par defaut l'instant de la saisie ; remplacee par la date du
  // rendez-vous des qu'il y en a un — voir le bloc `if (body.callId)` juste dessous.
  let signedAt = new Date().toISOString();
  let igLeadId: string | null = body.igLeadId ?? null;
  let prospectId: string | null = body.prospectId ?? null;

  if (body.callId) {
    const { data: call } = await supa
      .from('calls')
      .select('ig_lead_id, prospect_id, utm_content, utm_medium, source, scheduled_at, booked_at, outcome, invitee_email, invitee_name')
      .eq('id', body.callId)
      .eq('coach_id', profileId)
      .maybeSingle();
    if (call) {
      // ── QUAND la vente a-t-elle ete faite ? ────────────────────────────────
      //
      // La regle vit dans `dateDeVente` (lib/callSeries.ts), avec ses tests. Elle
      // n'est PAS inline ici : elle ne s'observe qu'au moment ou une vente est
      // creee, donc elle serait invérifiable tant qu'aucune ne l'est — une regle
      // qu'on ne peut pas verifier est une regle qu'on affirme.
      //
      // En resume : la date de TENUE du PREMIER rendez-vous de la chaine, avec
      // repli sur l'instant de saisie si ce rendez-vous n'a pas encore eu lieu.
      //
      // Il faut donc les autres rendez-vous de la meme personne : un 2e rendez-vous
      // ne cree pas d'opportunite nouvelle, et c'est le premier qui date la vente.
      // On les cherche par `prospect_id` — la fiche persistante — avec repli sur
      // l'e-mail, seul lien disponible quand la fiche n'existe pas encore.
      const critere: [string, string] | null = call.prospect_id
        ? ['prospect_id', call.prospect_id]
        : (call.invitee_email ? ['invitee_email', call.invitee_email] : null);
      let callsDuProspect: any[] = [{ ...call, id: body.callId }];
      if (critere) {
        const { data: fratrie } = await supa
          .from('calls')
          .select('id, scheduled_at, booked_at, outcome, invitee_email, invitee_name')
          .eq('coach_id', profileId)
          .eq(critere[0], critere[1])
          .neq('ignored', true);
        // Le rendez-vous rapporte doit etre dans le lot : sans lui, `dateDeVente` ne
        // trouve pas son opportunite et retombe sur l'instant de saisie en silence.
        if (fratrie?.length) {
          callsDuProspect = fratrie.some(c => c.id === body.callId)
            ? fratrie
            : [...fratrie, { ...call, id: body.callId }];
        }
      }
      signedAt = dateDeVente(callsDuProspect, body.callId, new Date());

      igLeadId = igLeadId ?? call.ig_lead_id;
      prospectId = prospectId ?? call.prospect_id;

      // ── QUEL CONTENU a déclenché ce rendez-vous ? ───────────────────────────
      //
      // La règle vit dans `contenuConversion` (lib/attribution-roles.ts). Elle n'est
      // PAS inline ici, et l'appel doit lui passer le journal : sans lui, elle retombe
      // sur l'`utm_content` du lien — ce qui était le comportement d'avant le
      // 2026-09-03, et il était faux pour les rendez-vous venus d'un DM.
      //
      // Motif, en une phrase : il n'existe qu'UN lien Calendly par personne, gravé une
      // fois avec le contenu que portait sa fiche ce jour-là, et jamais regravé. Le
      // journal, lui, dit quel lead magnet elle avait pris juste avant de réserver.
      //
      // Le journal ne concerne qu'Instagram : une vente sans `ig_lead_id` (bio, YouTube,
      // vente manuelle) n'en a pas, et `contenuConversion` retombe alors sur le lien —
      // ce qui est correct pour elle, son lien EST porté par un contenu.
      let journalDuProspect: { media_id: string | null; detected_at: string; lead_magnet_sent?: boolean | null }[] = [];
      if (call.ig_lead_id) {
        const { data: fiche } = await supa
          .from('instagram_leads').select('ig_user_id').eq('id', call.ig_lead_id).maybeSingle();
        if (fiche?.ig_user_id) {
          const { data: prises } = await supa
            .from('instagram_lead_lm_history')
            .select('media_id, detected_at, lead_magnet_sent')
            .eq('profile_id', profileId)
            .eq('ig_user_id', fiche.ig_user_id);
          journalDuProspect = prises ?? [];
        }
      }
      const contenu = contenuConversion(
        {
          utm_content: call.utm_content,
          utm_medium: call.utm_medium,
          source: call.source,
          booked_at: call.booked_at,
          scheduled_at: call.scheduled_at,
        },
        journalDuProspect,   // `[]` quand la vente n'a pas de fiche Instagram
      );

      // `isValidContentId` reste indispensable : le champ a longtemps reçu des pseudos
      // slugifiés (bug documenté PageLiens.tsx:1897), et le journal peut porter un
      // `media_id` nul pour une story hors séquence.
      if (isValidContentId(contenu)) {
        firstTouch = contenu;
        attributionSource = 'content';
      } else if (call.source) {
        attributionSource = 'organic';
      }
    }
  }

  // ── Reprise du rendez-vous quand le coach a cliqué la PERSONNE ──────────────
  //
  // « Créer un lien de paiement » propose des personnes ET des rendez-vous, mais pas
  // pour tout le monde : la liste des appels exclut ceux rattachés à un lead Instagram
  // ou à un prospect (`payments/people`, `.is('ig_lead_id', null).is('prospect_id',
  // null)`). Pour ces deux-là, le modal ne propose donc JAMAIS leur rendez-vous, même
  // quand il en existe un — seulement la personne.
  //
  // Sans cette reprise, un contenu qui EXISTE est perdu parce que le coach a cliqué la
  // seule chose qu'on lui offrait. Le cas est structurel, pas une erreur de sa part.
  //
  // ⚠️ Le prospect YouTube est le plus net : sa ligne `prospects` n'est créée QUE par
  // le webhook Calendly, au moment d'une réservation. Il a donc forcément un
  // rendez-vous, forcément une source, et forcément un contenu — celui de la
  // description de la vidéo, où l'UTM dit vrai.
  //
  // On ne rattache PAS le deal à ce rendez-vous (`call_id` reste nul) : ce serait une
  // décision de modèle, pas d'attribution, et elle changerait aussi la date de vente.
  // On lui emprunte seulement de quoi répondre « quel contenu a déclenché ça ».
  if (!body.callId && (igLeadId || prospectId)) {
    const requete = supa
      .from('calls')
      .select('utm_content, utm_medium, source, booked_at, scheduled_at')
      .eq('coach_id', profileId)
      .neq('ignored', true)
      .order('booked_at', { ascending: false, nullsFirst: false })
      .limit(1);
    const { data: rdv } = igLeadId
      ? await requete.eq('ig_lead_id', igLeadId)
      : await requete.eq('prospect_id', prospectId!);
    const dernierRdv = rdv?.[0];

    if (dernierRdv) {
      // Un lead Instagram a un journal, un prospect YouTube n'en a pas — et il n'en a
      // pas besoin : son lien est PORTÉ par sa vidéo, donc son UTM fait autorité.
      let journal: { media_id: string | null; detected_at: string; lead_magnet_sent?: boolean | null }[] = [];
      if (igLeadId) {
        const { data: fiche } = await supa
          .from('instagram_leads').select('ig_user_id').eq('id', igLeadId).maybeSingle();
        if (fiche?.ig_user_id) {
          const { data: prises } = await supa
            .from('instagram_lead_lm_history')
            .select('media_id, detected_at, lead_magnet_sent')
            .eq('profile_id', profileId)
            .eq('ig_user_id', fiche.ig_user_id);
          journal = prises ?? [];
        }
      }
      const contenu = contenuConversion(dernierRdv, journal);
      if (isValidContentId(contenu)) {
        firstTouch = contenu;
        attributionSource = 'content';
      }
    }
  }

  if (igLeadId) {
    const { data: lead } = await supa
      .from('instagram_leads')
      // `media_id` n'est plus selectionne : plus rien ne le lit depuis que le repli
      // a ete retire. Un champ ramene mais jamais utilise fait croire au prochain
      // lecteur qu'il sert a quelque chose — exactement ce que la suppression visait.
      .select('ig_user_id, source')
      .eq('id', igLeadId)
      .maybeSingle();

    // ⚠️ DERNIER RECOURS, et rien d'autre.
    //
    // Ce bloc ECRASAIT le contenu calculé au-dessus par `instagram_leads.media_id` —
    // le champ mutable, réécrit à chaque nouveau commentaire, celui que
    // `attribution-roles.ts` interdit explicitement. Toute vente rattachée à une fiche
    // Instagram perdait donc l'attribution correcte, en silence et sans exception.
    //
    // Il garde une raison d'être, une seule : une vente SANS rendez-vous — upsell,
    // vente conclue à la main — n'a pas de call, donc pas de `booked_at` à interroger.
    // ⚠️ `/api/payments/links` est le SEUL endroit du produit où une vente est créée
    // (vérifié le 2026-09-03 : un unique `insert` sur `deals` dans tout le dépôt), donc
    // ce chemin est le seul à devoir traiter ce cas.
    //
    // Même dans ce cas, on demande d'abord au JOURNAL ce que la personne avait pris
    // avant la vente. La fiche n'est consultée que s'il ne dit rien.
    if (!firstTouch && lead?.ig_user_id) {
      const { data: prises } = await supa
        .from('instagram_lead_lm_history')
        .select('media_id, detected_at, lead_magnet_sent')
        .eq('profile_id', profileId)
        .eq('ig_user_id', lead.ig_user_id);
      const contenuAvantLaVente = contenuActivation(prises ?? [], signedAt);
      if (isValidContentId(contenuAvantLaVente)) {
        firstTouch = contenuAvantLaVente;
        attributionSource = 'content';
      }
    }

    // ⚠️ `instagram_leads.media_id` a DISPARU du chemin d'attribution, et pour de bon.
    //
    // Il servait de repli ultime quand le journal ne dit rien. Ce repli est
    // inatteignable : la fiche et le journal sont ecrits par le MEME evenement, la
    // detection d'un commentaire. Une fiche qui porte un contenu a donc toujours au
    // moins une ligne de journal. Mesure le 2026-09-03 sur les 6 fiches du profil de
    // test — les deux sans journal n'ont aucun `media_id`, les quatre avec en ont un.
    //
    // Le garder aurait ete du code mort portant une regle interdite : quelqu'un
    // finit par « reparer » ce qu'il trouve, et ce repli est precisement celui que
    // `attribution-roles.ts` bannit. Si l'invariant cassait un jour, la vente n'aurait
    // simplement aucun contenu — un trou plutot qu'une valeur fausse.
    if (!firstTouch && lead?.source === 'cold_dm') attributionSource = 'cold_dm';
    else if (!firstTouch && lead) attributionSource = 'organic';
  } else if (prospectId) {
    // Le contenu a déjà été repris de son rendez-vous juste au-dessus s'il en a un.
    // `organic` ne s'applique donc qu'à un prospect qui n'en a aucun — cas théorique,
    // puisqu'une ligne `prospects` naît d'une réservation, mais qui reste le bon repli
    // si la ligne survit à la suppression de son appel.
    if (!firstTouch) attributionSource = 'organic';
  } else if (body.clientId) {
    attributionSource = 'client_existant';
  }

  // Alimente la colonne « Type » côté coach : élève Momentum ou client direct.
  // Un deal issu d'un CALL vient du pipeline, même sans lead Instagram rattaché
  // (prospect YouTube, call pris hors DM) — le classer « client direct » le
  // faisait passer pour une vente hors pipeline dans les stats du coach.
  const buyerKind = body.clientId ? 'student'
    : (igLeadId || prospectId || body.callId) ? null
    : 'external';

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
    signed_at: signedAt,
    status: 'open',
    first_touch_content_id: firstTouch,
    last_touch_content_id: firstTouch,
    attribution_source: attributionSource,
  }).select('id').single();

  if (dealErr) return NextResponse.json({ error: dealErr.message }, { status: 500 });

  // ── Encaissement hors Stripe ───────────────────────────────────────────────
  if (offline || !access) {
    // `alreadyReceived` : l'argent est DÉJÀ là (virement reçu avant le call,
    // espèces en main) — par opposition à un paiement simplement convenu, qui
    // n'arrivera que plus tard. Enregistrer les deux pareil gonflerait le cash
    // collecté d'un argent qui n'est pas encore entré.
    const alreadyReceived = body.alreadyReceived === true;

    if (plan === 'one_shot' || !count) {
      // Encaissé : on enregistre le paiement. `match_method = manual` distingue
      // pour toujours ce montant DÉCLARÉ d'un montant CONSTATÉ par Stripe.
      if (alreadyReceived) {
        await supa.from('deal_payments').insert({
          deal_id: deal.id,
          // Pas d'id Stripe puisqu'il n'y a pas de transaction Stripe ; l'id du
          // deal garantit l'unicité de la clé (deal_id, stripe_payment_id).
          stripe_payment_id: `offline_${deal.id}`,
          amount,
          currency: 'eur',
          paid_at: new Date().toISOString(),
          status: 'succeeded',
          match_method: 'manual',
        });
        await supa.from('deals').update({ status: 'paid' }).eq('id', deal.id);
        return NextResponse.json({ dealId: deal.id, mode: 'offline_paid', url: null });
      }

      // Attendu : une échéance unique à la date convenue. Elle remonte dans
      // Relances et déclenche les rappels comme n'importe quelle autre — sans
      // elle, un virement promis serait oublié faute de trace.
      const { error: instErr } = await supa.from('deal_installments').insert({
        deal_id: deal.id,
        rank: 1,
        amount,
        due_on: body.dueOn ?? new Date().toISOString().slice(0, 10),
        status: 'pending',
      });
      if (instErr) return NextResponse.json({ error: instErr.message }, { status: 500 });

      // Le deal reste `one_shot` : un versement unique n'est pas un échéancier,
      // et la contrainte deals_installments_count_check impose > 1. C'est la
      // ligne deal_installments seule qui porte la date attendue et fait
      // remonter le paiement dans Relances.
      return NextResponse.json({ dealId: deal.id, mode: 'offline_pending', url: null });
    }

    // Plusieurs fois : Momentum porte l'échéancier, puisque ni Stripe ni
    // personne d'autre ne le détient. Sans lui, impossible de savoir quelle
    // échéance reste à encaisser.
    const per = Math.round((amount / count) * 100) / 100;
    const first = Math.round((amount - per * (count - 1)) * 100) / 100;
    const signedAt = new Date();
    const rows = Array.from({ length: count }, (_, i) => {
      const rank = i + 1;
      const due = new Date(signedAt.getTime() + i * INTERVAL_DAYS[interval] * 86400_000);
      return {
        deal_id: deal.id,
        rank,
        amount: rank === 1 ? first : per,
        due_on: due.toISOString().slice(0, 10),
        status: 'pending',
      };
    });
    const { data: created, error: instErr } = await supa
      .from('deal_installments').insert(rows).select('id, rank, amount');
    if (instErr) return NextResponse.json({ error: instErr.message }, { status: 500 });

    // Acompte déjà versé : le premier versement est souvent encaissé le jour de
    // la signature. Le laisser « à encaisser » ferait remonter dans Relances
    // une action déjà faite, et sous-estimerait le cash collecté.
    if (alreadyReceived) {
      const first1 = (created ?? []).find(i => i.rank === 1);
      if (first1) {
        await supa.from('deal_payments').insert({
          deal_id: deal.id,
          installment_id: first1.id,
          stripe_payment_id: `offline_${first1.id}`,
          amount: first1.amount,
          currency: 'eur',
          paid_at: new Date().toISOString(),
          status: 'succeeded',
          match_method: 'manual',
        });
        await supa.from('deal_installments')
          .update({ status: 'paid' }).eq('id', first1.id);
      }
    }

    return NextResponse.json({
      dealId: deal.id, mode: 'offline_installments', url: null, installments: count,
    });
  }

  // Au-delà d'ici `access` est garanti non-null par le retour ci-dessus ; la
  // constante le rend explicite pour le typage des appels Stripe.
  const stripeAccess = access;
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
        }, stripeAccess);

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
    }, stripeAccess);

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
