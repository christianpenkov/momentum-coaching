import { NextResponse } from 'next/server';
import { CALL_TYPES_VENTE } from '@/lib/callTypes';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveYtVideoTitles } from '@/lib/ytVideoTitles';
import { resolveIgPostMeta } from '@/lib/igPostMeta';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Référence stable "toutes les intégrations obligatoires connectées pour la 1ère
  // fois" (posée par un trigger DB, jamais réécrite) — pas une intégration spécifique,
  // voir docs/integrations-ready-at-vs-onboarding-completed-at.md.
  const { data: clientRow } = await supa.from('clients')
    .select('integrations_ready_at')
    .eq('profile_id', user.id)
    .maybeSingle();
  const integrationsReadyAt: string | null = clientRow?.integrations_ready_at ?? null;

  let callsQuery = supa.from('calls')
    // calendly_event_uuid + next_rescheduled_uri : servent à relier un call
    // reprogrammé à celui qui le remplace, pour n'afficher qu'UNE carte par
    // prospect (voir le chaînage dans PagePipeline).
    .select('id, invitee_name, invitee_email, scheduled_at, booked_at, status, no_show, no_show_at, deal_closed, revenue, outcome, source, ig_lead_id, prospect_id, utm_content, utm_medium, utm_campaign, short_link_path, created_at, rescheduled, rescheduled_at, cancellation_reason, lead_deleted, is_follow_up, lead_rapport_comment, calendly_event_uuid, next_rescheduled_uri, canceled_at, canceled_by, fathom_share_url, objection, objection_autre, relance_at')
    .eq('coach_id', user.id)
    .in('call_type', CALL_TYPES_VENTE)
    .neq('ignored', true)
    .order('scheduled_at', { ascending: false });

  if (integrationsReadyAt) {
    // Un call réservé (booked_at) avant que toutes les intégrations obligatoires soient
    // connectées n'a pas pu être généré par le pipeline Momentum — fallback sur
    // scheduled_at si booked_at manque.
    callsQuery = callsQuery.or(
      `booked_at.gte.${integrationsReadyAt},and(booked_at.is.null,scheduled_at.gte.${integrationsReadyAt})`
    );
  }

  const [leadsRes, prospectsRes, nonIgProspectsRes, callsRes, overridesRes, clicksRes, eventsRes, lmHistoryRes, fusionsRes, dealsRes] = await Promise.all([
    supa.from('instagram_leads')
      .select('id, ig_username, ig_user_id, keyword_matched, lead_magnet_sent, hook_replied, hook_replied_at, tracking_link, detected_at, media_id, source, avatar_url')
      .eq('profile_id', user.id)
      .is('archived_at', null)
      .eq('not_a_lead', false)
      .order('detected_at', { ascending: false }),
    // archived_at : le pipeline unit cette table avec instagram_leads par ig_username.
    // Sans le filtre, un prospect dont le lead vient d'être archivé (bascule vers un
    // autre compte Instagram) revenait par ici — et s'affichait à une étape erronée,
    // le lead qui portait hook_replied ayant été filtré de l'autre source.
    supa.from('prospect_links')
      // `ig_lead_id`, `prospect_id` et `source_at_creation` disent À QUI appartient
      // ce lien. Sans eux, l'écran ne pouvait pas le savoir : il traitait TOUT lien
      // comme un lien Instagram, et un lien de suivi généré pour quelqu'un venu de
      // YouTube créait une carte dans l'onglet Instagram. Les trois colonnes
      // existent en base depuis le 2026-08-27 ; seule cette requête les ignorait.
      .select('id, ig_username, short_url, content_id, created_at, calendly_link_sent, calendly_link_sent_at, last_calendly_link_sent_at, first_click_at, min_stage_reached, ig_lead_id, prospect_id, source_at_creation')
      .eq('profile_id', user.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
    // Pas de filtre `deleted` : la colonne n'existe pas sur `prospects`. Postgres
    // refusait donc la requête (42703), le résultat retombait sur `?? []` et
    // `nonIgProspects` était TOUJOURS vide — vérifié en base le 2026-08-27 :
    // 2 lignes valides pour le profil, 0 renvoyée. La suppression d'un prospect
    // passe par `not_a_lead`, déjà filtré ci-dessous.
    supa.from('prospects')
      .select('id, platform, email, name, source, created_at')
      .eq('profile_id', user.id)
      .eq('not_a_lead', false)
      .order('created_at', { ascending: false }),
    callsQuery,
    supa.from('pipeline_overrides')
      .select('prospect_key, platform, stage, updated_at, reason, natural_at_override')
      .eq('profile_id', user.id),
    supa.from('shortio_link_daily_snapshots')
      .select('short_url, human_clicks')
      .eq('profile_id', user.id)
      .gte('date', since30d),
    supa.from('prospect_events')
      .select('id, prospect_key, platform, event_type, occurred_at, ig_lead_id, prospect_link_id, call_id')
      .eq('profile_id', user.id)
      .order('occurred_at', { ascending: false }),
    supa.from('instagram_lead_lm_history')
      .select('id, ig_username, ig_user_id, keyword_matched, media_id, detected_at')
      .eq('profile_id', user.id)
      .is('archived_at', null)
      .order('detected_at', { ascending: false }),
    // Les doublons déjà tranchés : fusionnés (avec la liste des rendez-vous
    // déplacés, pour pouvoir séparer) ou refusés (pour ne plus reposer la
    // question). Sans cette lecture, le bandeau reproposerait à chaque
    // chargement une paire sur laquelle l'élève a déjà répondu.
    supa.from('fusions_fiches')
      .select('ig_lead_id, prospect_id, statut, call_ids, decided_at')
      .eq('profile_id', user.id),
    // ── LE MONTANT D'UNE VENTE VIENT DE `deals`, PAS DE `calls.revenue` ───────
    // `calls.revenue` est la trace du montant DÉCLARÉ dans le rapport de call.
    // Corriger une vente depuis la page Paiements écrit dans `deals`,
    // `deal_installments` et `deal_events` — jamais dans `calls`, et c'est
    // volontaire : la trace du rapport doit rester telle qu'elle a été saisie,
    // c'est sur elle que `ventes_sante_montants` repère les écarts inexpliqués.
    //
    // Tant que personne ne corrige un montant, les deux coïncident et rien ne se
    // voit. Dès qu'on en corrige un, le pipeline annonce l'ancien.
    //
    // `status <> 'canceled'` : une vente annulée ne compte pas.
    supa.from('deals')
      .select('call_id, amount_total, status')
      .eq('profile_id', user.id)
      .neq('status', 'canceled')
  ]);

  // Map ig_story_id → nom de séquence, pour distinguer un media_id "post" (permalink
  // Instagram permanent) d'un media_id "story" (contenu éphémère 24h, sans permalink
  // exploitable après expiration — le lien "Voir le post" doit alors pointer vers
  // notre propre séquence plutôt que vers Instagram).
  const { data: storyRows } = await supa
    .from('ig_stories')
    .select('ig_story_id, sequence_id, story_sequences!ig_stories_sequence_id_fkey(name)')
    .eq('profile_id', user.id)
    .is('archived_at', null)
    .not('sequence_id', 'is', null);
  const storySequenceByMediaId: Record<string, { sequenceId: string; sequenceName: string }> = {};
  for (const row of storyRows ?? []) {
    const seqName = (row as any).story_sequences?.name;
    if (row.sequence_id && seqName) {
      storySequenceByMediaId[row.ig_story_id] = { sequenceId: row.sequence_id, sequenceName: seqName };
    }
  }

  if (clicksRes.error) console.warn('[pipeline] shortio_link_daily_snapshots fetch failed:', clicksRes.error.message);
  if (eventsRes.error) console.warn('[pipeline] prospect_events fetch failed:', eventsRes.error.message);

  // Agrège human_clicks par short_url sur 30j
  const clicksByUrl = new Map<string, number>();
  for (const row of clicksRes.data ?? []) {
    if (!row.short_url) continue;
    clicksByUrl.set(row.short_url, (clicksByUrl.get(row.short_url) ?? 0) + (row.human_clicks ?? 0));
  }

  const prospects = (prospectsRes.data ?? []).map((p: any) => ({
    ...p,
    humanClicks30d: p.short_url ? (clicksByUrl.get(p.short_url) ?? 0) : 0,
  }));

  // Titres des vidéos YouTube associées aux calls (utm_content = video_id quand
  // utm_medium === 'description') — cache DB, oEmbed seulement pour les IDs manquants.
  const ytVideoIds = (callsRes.data ?? [])
    .filter((c: any) => c.utm_medium === 'description' && c.utm_content)
    .map((c: any) => c.utm_content as string);
  const ytVideoTitles = await resolveYtVideoTitles(user.id, ytVideoIds);

  // Métadonnées des posts Instagram (légende, permalink, thumbnail) : à la fois pour les
  // calls venant d'un lien en description de post (utm_content = media_id), et pour
  // l'historique des lead magnets réclamés (instagram_lead_lm_history.media_id) — cache
  // DB, Graph API à la demande seulement pour les media_id manquants.
  const igMediaIds = [
    ...(callsRes.data ?? [])
      .filter((c: any) => c.source === 'ig_description' && c.utm_content)
      .map((c: any) => c.utm_content as string),
    ...(lmHistoryRes.data ?? [])
      .filter((l: any) => l.media_id)
      .map((l: any) => l.media_id as string),
  ];
  const igPostMeta = await resolveIgPostMeta(user.id, igMediaIds);

  return NextResponse.json({
    leads: leadsRes.data ?? [],
    prospects,
    nonIgProspects: nonIgProspectsRes.data ?? [],
    fusions: fusionsRes.data ?? [],
    deals: dealsRes.data ?? [],
    calls: callsRes.data ?? [],
    overrides: overridesRes.data ?? [],
    events: eventsRes.data ?? [],
    lmHistory: lmHistoryRes.data ?? [],
    ytVideoTitles,
    igPostMeta,
    storySequenceByMediaId,
  });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { prospect_key, platform, stage, reason, natural_at_override } = body;
  if (!prospect_key || !platform || !stage) return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });

  const { error } = await supa.from('pipeline_overrides').upsert({
    profile_id: user.id, prospect_key, platform, stage, updated_at: new Date().toISOString(),
    ...(reason ? { reason } : {}),
    ...(natural_at_override !== undefined ? { natural_at_override } : {}),
  }, { onConflict: 'profile_id,prospect_key,platform' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Marque un lead comme faux positif ("pas un prospect", ex: un pote détecté
// comme lead) — contrairement à DELETE, la ligne reste en place (not_a_lead =
// true) pour bloquer la recréation automatique d'une fiche Cold DM par le
// webhook (voir handleColdDmCandidate, IG uniquement), tout en restant exclue
// des stats sur toutes les plateformes (IG via instagram_leads, YT/Autres via
// prospects).
export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { ig_username, prospect_id, call_id, not_a_lead } = body;
  if (typeof not_a_lead !== 'boolean' || (!ig_username && !prospect_id && !call_id)) {
    return NextResponse.json({ error: 'ig_username, prospect_id ou call_id, et not_a_lead requis' }, { status: 400 });
  }

  // `call_id` : le rendez-vous n'a aucune fiche prospect derrière lui (call
  // orphelin d'une source inconnue). Il n'y a donc pas de `not_a_lead` à poser
  // quelque part — on l'exclut par `ignored`, la convention du projet que toute
  // requête sur `calls` respecte déjà (`ignored is not true`).
  //
  // Sans cette branche, le geste « Non, ce n'est pas un lead » ne faisait RIEN
  // sur ces cartes-là : c'est exactement le cas que couvrait `dismissed`, retiré
  // le 2026-08-27. `lead_deleted` reste à false — on n'efface rien, on exclut.
  const { error } = call_id
    ? await supa.from('calls')
        .update({ ignored: not_a_lead })
        .eq('coach_id', user.id)
        .eq('id', call_id)
    : ig_username
    ? await supa.from('instagram_leads')
        .update({ not_a_lead })
        .eq('profile_id', user.id)
        .eq('ig_username', ig_username)
    : await supa.from('prospects')
        .update({ not_a_lead } as any)
        .eq('profile_id', user.id)
        .eq('id', prospect_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { ig_username, prospect_id, call_id, platform } = body;

  // ── Garde-fou : jamais de suppression quand un deal est signé ────────────────
  // Supprimer un prospect marque ses calls ignored=true, et toutes les lectures de
  // stats filtrent .neq('ignored', true) : le chiffre d'affaires disparaît donc de
  // Revenue, Deals closés, Closing, Rev/call et Top contenus. Personne ne le remarque,
  // ni l'élève qui supprime ni le coach qui suit ses chiffres.
  //
  // « Ce n'est pas un lead » et « cette personne m'a payé » sont contradictoires : si
  // les deux sont vrais, il y a une erreur de saisie. On refuse donc la suppression et
  // on renvoie vers la correction du rapport de vente, désormais possible depuis le
  // pipeline et la modale Infos (voir docs/tracking-prospect.md).
  //
  // Le geste « Pas un lead » (PATCH not_a_lead) reste disponible et non destructif pour
  // écarter un faux positif sans rien perdre.
  const dealGuard = supa.from('calls')
    .select('id, invitee_name, revenue')
    .eq('coach_id', user.id)
    .eq('deal_closed', true)
    .neq('ignored', true)
    .limit(1);

  if (call_id && !prospect_id && platform !== 'ig') dealGuard.eq('id', call_id);
  else if (prospect_id && platform !== 'ig') dealGuard.eq('prospect_id', prospect_id);
  else if (ig_username) {
    const { data: guardLeads } = await supa.from('instagram_leads')
      .select('id').eq('profile_id', user.id).eq('ig_username', ig_username);
    const guardLeadIds = (guardLeads ?? []).map((l: any) => l.id);
    if (guardLeadIds.length === 0) dealGuard.eq('id', '00000000-0000-0000-0000-000000000000');
    else dealGuard.in('ig_lead_id', guardLeadIds);
  }

  const { data: signedDeals } = await dealGuard;
  if (signedDeals && signedDeals.length > 0) {
    const deal = signedDeals[0];
    const montant = deal.revenue ? `${Math.round(Number(deal.revenue))} €` : 'un montant enregistré';
    return NextResponse.json({
      error: `Ce prospect a un deal signé (${montant}). Corrige d'abord son rapport de vente si tu veux vraiment le supprimer — sinon son chiffre d'affaires disparaîtrait de tes statistiques.`,
      code: 'deal_signed',
    }, { status: 409 });
  }

  // ── Suppression YT / Autre — cas fallback : card.key = call.id (pas de prospect) ──
  if (call_id && !prospect_id && platform !== 'ig') {
    // Récupère l'email du call pour bloquer tous les futurs calls du même email
    const { data: callToDelete } = await supa.from('calls')
      .select('invitee_email').eq('id', call_id).maybeSingle();
    const email = callToDelete?.invitee_email ?? null;

    const ops = [
      supa.from('calls').update({ ignored: true, lead_deleted: true })
        .eq('coach_id', user.id).eq('id', call_id),
      supa.from('pipeline_overrides').delete()
        .eq('profile_id', user.id).eq('prospect_key', call_id),
      supa.from('prospect_events').delete()
        .eq('profile_id', user.id).eq('prospect_key', call_id),
      ...(email ? [supa.from('calls').update({ ignored: true, lead_deleted: true })
        .eq('coach_id', user.id).eq('invitee_email', email)] : []),
    ];
    await Promise.all(ops);
    return NextResponse.json({ ok: true });
  }

  // ── Suppression YT / Autre — cas normal : card.key = prospect_id ─────────────
  if (prospect_id && platform !== 'ig') {
    // Récupère l'email du prospect pour bloquer tous les futurs calls du même email
    const { data: prospectRow } = await supa.from('prospects')
      .select('email').eq('id', prospect_id).maybeSingle();
    const email = prospectRow?.email ?? null;

    const ops = [
      supa.from('calls').update({ ignored: true, lead_deleted: true })
        .eq('coach_id', user.id).eq('prospect_id', prospect_id),
      supa.from('pipeline_overrides').delete()
        .eq('profile_id', user.id).eq('prospect_key', prospect_id),
      supa.from('prospect_events').delete()
        .eq('profile_id', user.id).eq('prospect_key', prospect_id),
      // `not_a_lead` et non `deleted` : cette colonne-là n'existe pas, et le
      // `as any` masquait l'erreur — l'écriture échouait en silence, le prospect
      // restait donc « supprimé » uniquement par ses calls ignorés. C'est aussi
      // le champ que la lecture filtre, les deux côtés se répondent enfin.
      supa.from('prospects').update({ not_a_lead: true })
        .eq('profile_id', user.id).eq('id', prospect_id),
      ...(call_id ? [supa.from('calls').update({ ignored: true, lead_deleted: true })
        .eq('coach_id', user.id).eq('id', call_id)] : []),
      ...(email ? [supa.from('calls').update({ ignored: true, lead_deleted: true })
        .eq('coach_id', user.id).eq('invitee_email', email)] : []),
    ];
    await Promise.all(ops);
    return NextResponse.json({ ok: true });
  }

  // ── Suppression IG (ig_username) ─────────────────────────────────────────────
  if (!ig_username) return NextResponse.json({ error: 'ig_username ou prospect_id requis' }, { status: 400 });

  // Récupère les ig_lead_ids et ig_user_ids à supprimer avant de faire les deletes
  const { data: leadsToDelete } = await supa
    .from('instagram_leads')
    .select('id, ig_user_id')
    .eq('profile_id', user.id)
    .eq('ig_username', ig_username);

  const leadIds = (leadsToDelete ?? []).map((l: any) => l.id);
  const igUserIds = (leadsToDelete ?? []).map((l: any) => l.ig_user_id).filter(Boolean);

  const deleteOps = [
    supa.from('instagram_leads').delete().eq('profile_id', user.id).eq('ig_username', ig_username).then(),
    supa.from('prospect_links').delete().eq('profile_id', user.id).eq('ig_username', ig_username).then(),
    supa.from('pipeline_overrides').delete().eq('profile_id', user.id).eq('prospect_key', ig_username).then(),
    supa.from('prospect_events').delete().eq('profile_id', user.id).eq('prospect_key', ig_username.toLowerCase()).then(),
  ];

  if (leadIds.length > 0) {
    deleteOps.push(
      supa.from('prospect_events').delete().eq('profile_id', user.id).in('ig_lead_id', leadIds).then(),
      supa.from('calls').update({ ignored: true, ig_lead_id: null }).eq('coach_id', user.id).in('ig_lead_id', leadIds).then(),
    );
  }

  if (igUserIds.length > 0) {
    deleteOps.push(
      supa.from('instagram_lead_lm_history').delete().eq('profile_id', user.id).in('ig_user_id', igUserIds).then(),
    );
  }

  await Promise.all(deleteOps);

  return NextResponse.json({ ok: true });
}
