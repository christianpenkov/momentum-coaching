import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { mapWithConcurrency } from '../_shared/rate-limit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const CALENDLY_CLIENT_ID = Deno.env.get('CALENDLY_CLIENT_ID') || '';
const CALENDLY_CLIENT_SECRET = Deno.env.get('CALENDLY_CLIENT_SECRET') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Dupliqué depuis lib/contentId.ts (Deno edge function, pas d'import cross-runtime
// possible — même pattern déjà accepté ailleurs dans ce repo, ex. poll-leads/index.ts).
// Un utm_content valide est un vrai identifiant de contenu (post IG, vidéo YT, ou
// séquence story) — jamais un pseudo Instagram slugifié ou une autre valeur libre.
function isValidContentId(s: string | null | undefined): boolean {
  if (!s) return false;
  if (/^\d{10,}$/.test(s)) return true; // post IG
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return true; // vidéo YT
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true; // séquence story
  return false;
}

/**
 * ⚠️ Équivalent Deno de `resolveClickId` (lib/click-redirect.ts) — pas d'import
 * cross-runtime possible, même contrainte que isValidContentId ci-dessus. Une
 * copie qui se sait copie vaut mieux que deux implémentations qui s'ignorent.
 *
 * Calendly rend `salesforce_uuid` tel qu'il l'a figé au moment du clic :
 * n'importe qui peut y avoir mis n'importe quoi en fabriquant une URL. Une
 * valeur externe non conforme n'est jamais écrite (docs/utm-nomenclature.md).
 */
function resolveClickId(entrant: string | null | undefined): string | null {
  if (!entrant) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entrant)
    ? entrant.toLowerCase()
    : null;
}

/**
 * ⚠️ Équivalent Deno de `resolveCallSource` (lib/contentId.ts) — pas d'import
 * cross-runtime possible. Toute modification de la règle doit être répercutée
 * dans les deux.
 *
 * `calls.source` doit valoir `plateforme_medium` (ig_bio, yt_description…).
 * Certains vieux liens portent le domaine Short.io dans utm_source, ce qui
 * produisait `ubizenai.s.gy_description` — inexploitable pour l'attribution,
 * qui regroupe par plateforme. Quand utm_source n'est pas une plateforme
 * connue, on la déduit du contenu ; sinon on n'écrit rien, même règle que pour
 * utm_content (mieux vaut pas de source qu'une source fausse).
 */
/**
 * ⚠️ Équivalent Deno de `resolveUtmMedium` (lib/contentId.ts).
 *
 * Nomenclature fermée (4 valeurs) — contrairement à utm_campaign, dont les
 * valeurs sont libres par conception et ne peuvent donc pas être validées.
 * Aucune anomalie constatée sur ce champ : la garde est préventive, les données
 * étant propres par chance et non par conception.
 */
function resolveUtmMedium(incoming: string | null | undefined): string | undefined {
  if (!incoming) return undefined;
  return ['bio', 'description', 'dm', 'story'].includes(incoming) ? incoming : undefined;
}

function resolveCallSource(
  utmSource: string | null | undefined,
  utmMedium: string | null | undefined,
  utmContent?: string | null,
): string | undefined {
  if (!utmSource) return undefined;
  const platform = ['ig', 'yt'].includes(utmSource)
    ? utmSource
    : (utmContent && /^[A-Za-z0-9_-]{11}$/.test(utmContent)) ? 'yt'
    : (utmContent && /^\d{10,}$/.test(utmContent)) ? 'ig'
    : null;
  if (!platform) return undefined;
  return [platform, utmMedium].filter(Boolean).join('_');
}

async function getCalendlyToken(profileId: string): Promise<string | null> {
  const { data: integ } = await supabase
    .from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', profileId)
    .eq('provider', 'calendly')
    .single();

  if (!integ?.access_token) return null;

  const expired = integ.expires_at &&
    new Date(integ.expires_at).getTime() < Date.now() + 5 * 60 * 1000;

  if (!expired) return integ.access_token;
  // Pas de refresh possible sans credentials → retourner le token existant (peut être expiré côté Calendly)
  if (!integ.refresh_token || !CALENDLY_CLIENT_ID || !CALENDLY_CLIENT_SECRET) return integ.access_token;

  const credentials = btoa(`${CALENDLY_CLIENT_ID}:${CALENDLY_CLIENT_SECRET}`);
  const res = await fetch('https://auth.calendly.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: integ.refresh_token,
    }),
  });

  const data = await res.json();
  if (!data.access_token) return null;

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : null;

  await supabase.from('integrations').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token || integ.refresh_token,
    expires_at: expiresAt,
  }).eq('profile_id', profileId).eq('provider', 'calendly');

  return data.access_token;
}

/** Lit une liste Calendly EN ENTIER, en suivant `pagination.next_page`.
 *
 *  Avant : un seul appel `count=100`, et tout ce qui depassait etait perdu sans le
 *  moindre signal. La fenetre couvrant les 60 prochains jours, un eleve qui remplit
 *  son agenda depassait la borne et ses rendez-vous n'entraient en base qu'une fois
 *  les precedents passes — donc parfois apres l'heure du rendez-vous lui-meme.
 *
 *  ⚠️ La reponse HTTP est VERIFIEE. Sans ce controle, un 429 (Calendly limite a
 *  60 requetes/minute et par jeton) rendait `collection` undefined : zero event, zero
 *  erreur, et `last_synced_at` avancait quand meme. La marge de 48 h absorbait le coup,
 *  mais rien ne l'aurait signale si la panne avait dure plus longtemps.
 *
 *  Rend une ERREUR plutot qu'une liste partielle : mieux vaut ne rien conclure et
 *  reprendre au cycle suivant, la borne basse n'ayant pas bouge. */
const PAGES_CALENDLY_MAX = 10;

async function listerEventsCalendly(
  url: string,
  accessToken: string,
): Promise<{ events: any[]; erreur: string | null }> {
  const events: any[] = [];
  let suivante: string | null = url;

  for (let page = 0; page < PAGES_CALENDLY_MAX && suivante; page++) {
    let res: Response;
    try {
      res = await fetch(suivante, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch (e: any) {
      return { events, erreur: `calendly_reseau: ${e?.message || 'unknown'}` };
    }
    if (!res.ok) {
      // 429 : Calendly renvoie `Retry-After`. On ne retente pas ici — le cycle suivant
      // arrive dans 30 minutes et la borne basse n'aura pas avance.
      const apres = res.headers.get('retry-after');
      return { events, erreur: `calendly_http_${res.status}${apres ? `_retry_after_${apres}s` : ''}` };
    }
    const data = await res.json().catch(() => null);
    if (!data) return { events, erreur: 'calendly_reponse_illisible' };
    events.push(...(data.collection || []));
    suivante = data.pagination?.next_page ?? null;
  }

  // Borne atteinte avec une page suivante en attente : on le DIT, au lieu de tronquer
  // en silence.
  if (suivante) return { events, erreur: `calendly_pagination_bornee_${PAGES_CALENDLY_MAX}_pages` };
  return { events, erreur: null };
}

async function syncCalendlyEleve(
  profileId: string,
  connectedAt: string,
  lastSyncedAt: string | null
): Promise<{ synced: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  const accessToken = await getCalendlyToken(profileId);
  if (!accessToken) return { synced: 0, skipped: 0, errors: ['no_token'] };

  // `user_uri` identifie le compte Calendly : il ne change JAMAIS pour une intégration
  // donnée. Il était pourtant redemandé à `/users/me` à chaque passage, et `metadata`
  // réécrit dans la foulée — un appel réseau et une écriture par élève et par passage,
  // soit 1 920 de chaque par jour à 40 élèves, pour une valeur identique.
  //
  // C'est le profil « donnée immuable » de docs/checklist-scalabilite.md : à collecter
  // une fois, jamais à rafraîchir. On ne redemande que si elle manque.
  const { data: integMeta } = await supabase
    .from('integrations')
    .select('metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'calendly')
    .maybeSingle();

  let userUri: string | null = (integMeta?.metadata as any)?.user_uri ?? null;

  if (!userUri) {
    const meRes = await fetch('https://api.calendly.com/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // Vérifiée, contrairement à avant : un 429 tombait sur `user_uri_not_found`, un
    // message qui accusait le compte alors que c'était la limite de débit.
    if (!meRes.ok) return { synced: 0, skipped: 0, errors: [`calendly_users_me_http_${meRes.status}`] };
    const meData = await meRes.json().catch(() => null);
    userUri = meData?.resource?.uri ?? null;
    if (!userUri) return { synced: 0, skipped: 0, errors: ['user_uri_not_found'] };

    await supabase.from('integrations')
      .update({ metadata: { ...meData?.resource, user_uri: userUri } })
      .eq('profile_id', profileId)
      .eq('provider', 'calendly');
  }

  // Marge de sécurité : le vrai tri "call généré par Momentum ou pas" se fait en aval sur
  // booked_at vs first_connected_at, donc élargir la fenêtre d'ingestion ici ne coûte rien
  // et évite de rater un call proche du cutoff.
  //
  // Fenêtre INCRÉMENTALE (2026-08-19) : sans elle, on repartait de connectedAt à chaque
  // exécution — soit tout l'historique, toutes les minutes (4 076 s de compute/jour
  // mesurés à 4 élèves, ~141 % d'une journée projeté à 30). On repart désormais de la
  // dernière synchro réussie, en conservant la marge de 48 h par-dessus
  // (cf. feedback_connected_at_margin : un call booké juste avant une reconnexion de
  // token ne doit jamais être exclu).
  //
  // Le borne basse ne remonte JAMAIS au-delà de connectedAt - 48 h : si last_synced_at
  // était antérieur (impossible en pratique, mais défensif), on garde connectedAt.
  const connectedFloor = new Date(connectedAt).getTime() - 48 * 3600_000;
  const incrementalFloor = lastSyncedAt
    ? new Date(lastSyncedAt).getTime() - 48 * 3600_000
    : connectedFloor;
  const minStartTime = new Date(Math.max(connectedFloor, incrementalFloor)).toISOString();

  // +60 jours au lieu de +180 : personne ne réserve à 6 mois, et un call planifié
  // au-delà entrera dans la fenêtre bien avant sa date. Réversible si un cas réel apparaît.
  const maxStartTime = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch events actifs + annulés en parallèle, paginés et vérifiés.
  const base = `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&count=100&min_start_time=${minStartTime}&max_start_time=${maxStartTime}`;
  const [actifs, annules] = await Promise.all([
    listerEventsCalendly(base, accessToken),
    listerEventsCalendly(`${base}&status=canceled`, accessToken),
  ]);

  // ⚠️ On SORT si Calendly a refusé, sans rien écrire et sans laisser avancer la borne.
  // L'appelant n'horodate que les profils sans erreur : la fenêtre reste donc en place
  // et le cycle suivant reprend tout. Écrire ici sur une liste partielle marquerait des
  // journées comme traitées alors qu'elles ne l'ont pas été.
  if (actifs.erreur || annules.erreur) {
    return { synced: 0, skipped: 0, errors: [actifs.erreur, annules.erreur].filter(Boolean) as string[] };
  }

  const allEvents = [...actifs.events, ...annules.events];

  // Skip des events en état TERMINAL : un call annulé et déjà enregistré comme tel
  // ne changera plus jamais côté Calendly. Sans ce filtre, on refaisait un fetch
  // /invitees pour chacun d'eux à chaque exécution — c'est là que se concentrait
  // l'essentiel du gaspillage (1 appel réseau + 3 à 8 requêtes Supabase par event).
  //
  // On ne skippe QUE les annulés déjà connus. Les events actifs sont toujours
  // retraités : leur invitee peut changer (reprogrammation, no-show, réponses au
  // questionnaire), et l'upsert est idempotent donc rejouer ne coûte que du temps.
  const uuidsInPage = allEvents
    .map((e: any) => e.uri?.split('/').pop())
    .filter(Boolean) as string[];

  const terminalUuids = new Set<string>();
  if (uuidsInPage.length) {
    const { data: knownRows } = await supabase
      .from('calls')
      .select('calendly_event_uuid, canceled_at, canceled_by')
      .eq('coach_id', profileId)
      .eq('status', 'canceled')
      .in('calendly_event_uuid', uuidsInPage);
    for (const row of knownRows || []) {
      // Terminal = annulé ET on a déjà l'auteur de l'annulation.
      //
      // `canceled_by` plutôt que `canceled_at` comme témoin : le webhook temps
      // réel peut avoir posé un canceled_at approximatif (instant de réception,
      // quand Calendly n'envoie pas la date exacte) sans jamais avoir l'auteur.
      // Se fier à canceled_at aurait figé cette approximation pour toujours,
      // puisque l'event ne serait plus jamais retraité. canceled_by n'est écrit
      // que lorsque l'objet `cancellation` complet a été lu.
      if (row.calendly_event_uuid && row.canceled_by) terminalUuids.add(row.calendly_event_uuid);
    }
  }

  let skipped = 0;

  // Parallélise tous les appels invitees — critique pour ne pas dépasser 150s
  const results = await Promise.allSettled(allEvents.map(async (event: any) => {
    const eventUuid = event.uri?.split('/').pop() || '';
    if (!eventUuid) return false;

    // Déjà annulé en base ET toujours annulé côté Calendly → rien ne peut changer.
    if (event.status === 'canceled' && terminalUuids.has(eventUuid)) {
      skipped++;
      return false;
    }

    const scheduledAt = event.start_time || null;
    const endTime = event.end_time || null;
    const isCanceled = event.status === 'canceled';

    // Objet `cancellation` de Calendly : porte le MOMENT réel de l'annulation et
    // son auteur. Sans lui, la timeline du pipeline datait « Call annulé » à
    // l'heure du rendez-vous — la seule date disponible, mais fausse.
    // Savoir qu'un call a été annulé 2 h avant, et par le prospect, ne se lit pas
    // comme une annulation la veille par l'hôte.
    const cancellation = event.cancellation ?? null;
    const canceledAt: string | null = cancellation?.created_at ?? null;
    const canceledBy: string | null = cancellation?.canceled_by ?? null;

    let duration: string | null = null;
    if (scheduledAt && endTime) {
      const mins = Math.round(
        (new Date(endTime).getTime() - new Date(scheduledAt).getTime()) / 60000
      );
      duration = `${mins} min`;
    }

    const inviteesRes = await fetch(
      `https://api.calendly.com/scheduled_events/${eventUuid}/invitees?count=10`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const inviteesData = await inviteesRes.json();
    const invitees: any[] = inviteesData?.collection || [];
    const invitee = invitees[0] || null;

    const inviteeEmail = invitee?.email || null;
    const inviteeName = invitee?.name || null;
    const bookedAt = invitee?.created_at || null;
    const questionsAndAnswers = invitee?.questions_and_answers || null;
    const tracking = invitee?.tracking || null;
    const utmSource = tracking?.utm_source || null;
    const utmMedium = tracking?.utm_medium || null;
    const utmCampaign = tracking?.utm_campaign || null;
    const utmContent = tracking?.utm_content || null;
    // utm_term = le prospect (voir docs/utm-nomenclature.md, un rôle par champ).
    const utmTerm = tracking?.utm_term || null;
    // Click ID des liens PARTAGÉS — troisième et dernier chemin d'écriture des
    // rendez-vous. La migration UTM du 2026-08-19 avait dû traiter les trois :
    // n'en corriger que deux laisse le cron effacer ce que le webhook a écrit.
    const clickId = resolveClickId(tracking?.salesforce_uuid);
    const source = resolveCallSource(utmSource, utmMedium, utmContent) ?? null;

    const igUserIdFromUtm = utmCampaign?.startsWith('lead-') ? utmCampaign.slice(5) : null;
    const prospectSlugFromUtm = utmCampaign?.startsWith('prospect-') ? utmCampaign.slice(9) : null;
    const shortLinkPath = utmContent || null;

    const oldInviteeUrl: string | null = invitee?.old_invitee || null;
    const isRescheduled: boolean = invitee?.rescheduled === true;
    const newInviteeUrl: string | null = invitee?.new_invitee || null;
    let inheritedIgLeadId: string | null = null;
    let inheritedProspectLinkId: string | null = null;
    let inheritedSource: string | null = null;
    // click_id et clicked_at héritent comme source : une reprogrammation ne doit
    // pas effacer le clic à l'origine du rendez-vous.
    let inheritedClickId: string | null = null;
    let inheritedClickedAt: string | null = null;
    let resolvedIgLeadId: string | null = null;
    let resolvedProspectLinkId: string | null = null;

    if (isCanceled && isRescheduled && newInviteeUrl) {
      await supabase.from('calls')
        .update({ status: 'canceled', next_rescheduled_uri: newInviteeUrl })
        .eq('calendly_event_uuid', eventUuid);
    } else if (oldInviteeUrl) {
      const oldEventUuid = oldInviteeUrl.split('/').at(-3) || null;
      if (oldEventUuid) {
        const { data: oldCall } = await supabase
          .from('calls')
          .select('id, ig_lead_id, prospect_link_id, source, click_id, clicked_at')
          .eq('calendly_event_uuid', oldEventUuid)
          .maybeSingle();
        if (oldCall) {
          inheritedIgLeadId = oldCall.ig_lead_id ?? null;
          inheritedProspectLinkId = oldCall.prospect_link_id ?? null;
          inheritedSource = oldCall.source ?? null;
          inheritedClickId = oldCall.click_id ?? null;
          inheritedClickedAt = oldCall.clicked_at ?? null;
          await supabase.from('calls')
            .update({ status: 'canceled' })
            .eq('id', oldCall.id);
        }
      }
    }

    if (igUserIdFromUtm) {
      const { data: leadRow } = await supabase
        .from('instagram_leads')
        .select('id')
        .eq('ig_user_id', igUserIdFromUtm)
        .eq('profile_id', profileId)
        .order('detected_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      resolvedIgLeadId = leadRow?.id ?? null;
    }

    // Rattachement du call a une personne. Cette fonction ne le posait pas du
    // tout : sur 13 calls sans ig_lead_id, 11 n'avaient aucun prospect_id, et le
    // pipeline affichait donc une fiche par call au lieu d'une par personne.
    let resolvedProspectId: string | null = null;

    if (shortLinkPath) {
      const { data: pl } = await supabase
        .from('prospect_links')
        .select('id, ig_lead_id, prospect_id')
        .eq('profile_id', profileId)
        .filter('short_url', 'like', `%/${shortLinkPath}`)
        .maybeSingle();
      if (pl) {
        resolvedProspectLinkId = pl.id;
        resolvedIgLeadId = resolvedIgLeadId ?? pl.ig_lead_id ?? null;
        // Un lien de suivi genere pour quelqu'un de deja connu porte son
        // identite : elle fait autorite sur la resolution par e-mail, qui
        // echouerait si la personne reserve avec une autre adresse.
        resolvedProspectId = pl.prospect_id ?? null;
      }
    }

    if (!resolvedIgLeadId && !resolvedProspectLinkId && prospectSlugFromUtm) {
      const guessedUsername = prospectSlugFromUtm.replace(/-/g, '_');
      const { data: pl } = await supabase
        .from('prospect_links')
        .select('id, ig_lead_id, ig_username')
        .eq('profile_id', profileId)
        .or(`ig_username.eq.${guessedUsername},ig_username.eq.${prospectSlugFromUtm}`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pl) {
        resolvedProspectLinkId = pl.id;
        resolvedIgLeadId = pl.ig_lead_id ?? null;
      }
      if (!resolvedIgLeadId) {
        const { data: leadRow } = await supabase
          .from('instagram_leads')
          .select('id')
          .eq('profile_id', profileId)
          .or(`ig_username.eq.${guessedUsername},ig_username.eq.${prospectSlugFromUtm}`)
          .order('detected_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        resolvedIgLeadId = leadRow?.id ?? null;
      }
    }

    const finalIgLeadId = resolvedIgLeadId ?? inheritedIgLeadId;
    const finalProspectLinkId = resolvedProspectLinkId ?? inheritedProspectLinkId;

    // A defaut d'identite portee par le lien, on resout par e-mail. La logique
    // vit dans la fonction SQL `resolve_prospect`, partagee avec la route
    // Vercel : cette fonction tourne en Deno et ne peut pas importer
    // lib/prospects.ts, et c'est precisement d'avoir laisse les deux chemins
    // diverger qui a produit le bug corrige ici.
    //
    // Rien pour un call rattache a un lead Instagram : il se groupe par
    // ig_lead_id, mecanisme deja en place et prioritaire.
    let finalProspectId = resolvedProspectId;
    if (!finalProspectId && !finalIgLeadId && (inviteeEmail || inviteeName)) {
      const { data: resolved, error: resolveErr } = await supabase.rpc('resolve_prospect', {
        p_profile_id: profileId,
        p_email: inviteeEmail ?? null,
        p_name: inviteeName ?? null,
        p_platform: String(utmSource || '').toLowerCase().startsWith('yt') ? 'yt' : 'other',
        p_source: source,
      });
      if (resolveErr) console.error('[sync-calendly] resolve_prospect:', resolveErr.message);
      finalProspectId = (resolved as string | null) ?? null;
    }

    const upsertData: Record<string, any> = {
      coach_id: profileId,
      client_id: null,
      call_type: 'calendly',
      calendly_event_uuid: eventUuid,
      calendly_uri: event.uri,
      topic: event.name || 'Appel découverte',
      scheduled_at: scheduledAt,
      duration,
      join_url: event.location?.join_url || null,
      invitee_email: inviteeEmail,
      invitee_name: inviteeName,
      prospect_id: finalProspectId,
      calendly_qa: questionsAndAnswers,
      // Si le call vient d'un lien description ou bio IG, garder la source UTM (ig_description / ig_bio)
      // Écraser en ig_dm seulement si c'est un vrai DM (pas de medium description/bio)
      source: finalIgLeadId && utmMedium !== 'description' && utmMedium !== 'bio'
        ? 'ig_dm'
        : (source ?? inheritedSource),
      status: isCanceled ? 'canceled' : 'active',
      ready: 'pending',
      reminder_sent: false,
    };
    // Écrits seulement s'ils existent : un call redevenu actif (report) ne doit
    // pas conserver la date d'annulation du précédent, et un upsert avec null
    // écraserait une valeur déjà correcte.
    if (canceledAt) upsertData.canceled_at = canceledAt;
    if (canceledBy) upsertData.canceled_by = canceledBy;
    if (isCanceled && cancellation?.reason) upsertData.cancellation_reason = cancellation.reason;
    if (utmCampaign)         upsertData.utm_campaign    = utmCampaign;
    let contenuValide: string | undefined;
    if (utmContent) {
      // ⚠️ Équivalent Deno de `resolveUtmContent` (lib/contentId.ts). Cette Edge
      // Function ne peut pas importer depuis lib/ (pas d'import cross-runtime),
      // d'où la duplication — les deux autres appelants (webhook et bouton
      // Rafraîchir) utilisent bien la fonction partagée. TOUTE modification de la
      // règle doit être répercutée ici : c'est cette divergence à trois copies qui
      // a permis au bug du 2026-08-19 de passer inaperçu.
      if (!isValidContentId(utmContent)) {
        const { data: existingUtm } = await supabase.from('calls')
          .select('utm_content').eq('calendly_event_uuid', eventUuid).maybeSingle();
        // Une valeur invalide (pseudo figé côté Calendly au moment du clic) n'est JAMAIS
        // écrite : on garde l'identifiant valide déjà en base, sinon on laisse le champ
        // tel quel. Avant, le pseudo était réinscrit faute de mieux — ce qui a réintroduit
        // 15 anomalies après la migration UTM du 2026-08-19, qui avait justement vidé ces
        // champs. Le pseudo a son propre champ : utm_term, écrit juste en dessous.
        if (existingUtm?.utm_content && isValidContentId(existingUtm.utm_content)) {
          contenuValide = existingUtm.utm_content;
        }
      } else {
        contenuValide = utmContent;
      }
      if (contenuValide !== undefined) upsertData.utm_content = contenuValide;
    }
    // Règle partagée : un canal hors nomenclature n'est jamais recopié.
    const resolvedMedium = resolveUtmMedium(utmMedium);
    if (resolvedMedium)      upsertData.utm_medium      = resolvedMedium;
    if (utmTerm)             upsertData.utm_term        = utmTerm;
    // L'hérité prime : on crédite le PREMIER contact (même règle que source).
    const effectiveClickId = inheritedClickId ?? clickId;
    if (effectiveClickId) {
      upsertData.click_id = effectiveClickId;
      // Recopié sur le call, ce qui rend la purge de link_clicks sans perte
      // d'attribution (400 jours).
      let clickedAt: string | null = inheritedClickId ? inheritedClickedAt : null;
      if (!inheritedClickId) {
        const { data: clic } = await supabase.from('link_clicks')
          .select('occurred_at').eq('id', effectiveClickId).maybeSingle();
        clickedAt = clic?.occurred_at ?? null;
      }
      // Champ vide plutôt que champ faux : ligne purgée ou identifiant fabriqué
      // laissent `clicked_at` vide, jamais une date inventée.
      if (clickedAt) upsertData.clicked_at = clickedAt;
    }
    // ⚠️ short_link_path porte la MEME valeur qu'utm_content — c'est litteralement
    // `utmContent` (voir sa definition plus haut). Il recevait pourtant la valeur
    // BRUTE quand utm_content recevait la valeur VALIDEE : la garde ne protegeait
    // qu'une des deux copies, et l'autre accueillait exactement ce que la garde
    // existe pour recaler (le pseudo fige par Calendly, cf. les anomalies du
    // 2026-08-19). Les deux colonnes suivent desormais la meme valeur.
    if (contenuValide !== undefined) upsertData.short_link_path = contenuValide;
    if (finalProspectLinkId) upsertData.prospect_link_id = finalProspectLinkId;
    if (bookedAt)            upsertData.booked_at       = bookedAt;

    if (finalIgLeadId) {
      const { data: existingCall } = await supabase.from('calls')
        .select('ig_lead_id, short_link_path')
        .eq('calendly_event_uuid', eventUuid)
        .maybeSingle();
      const alreadyResolved = existingCall && (existingCall.ig_lead_id || existingCall.short_link_path);
      if (!alreadyResolved) {
        upsertData.ig_lead_id = finalIgLeadId;
      }
    }

    const { data: callRow } = await supabase.from('calls')
      .upsert(upsertData, { onConflict: 'calendly_event_uuid', ignoreDuplicates: false })
      .select('id, ig_lead_id')
      .maybeSingle();

    const effectiveIgLeadId = finalIgLeadId ?? callRow?.ig_lead_id ?? null;
    if (!isCanceled && callRow?.id && effectiveIgLeadId) {
      const { data: igLead } = await supabase
        .from('instagram_leads').select('ig_username').eq('id', effectiveIgLeadId).single();
      if (igLead) {
        // RPC upsert_prospect_event_call_booked (pas .upsert() du client JS) : l'index
        // unique réel prospect_events_call_event_uidx est PARTIEL
        // (UNIQUE (call_id, event_type) WHERE call_id IS NOT NULL) — le client Supabase
        // JS ne peut cibler un ON CONFLICT que sur un index/contrainte total, donc
        // .upsert({...}, { onConflict: 'call_id,event_type' }) échouait systématiquement
        // ("no unique or exclusion constraint matching the ON CONFLICT specification"),
        // reproduit et confirmé le 2026-08-14. La RPC fait l'upsert en SQL brut, où
        // Postgres résout nativement l'ON CONFLICT contre un index partiel. Même RPC
        // utilisée par le webhook temps réel (app/api/webhooks/calendly/route.ts) —
        // les deux convergent sur la même ligne en cas de course serrée.
        supabase.rpc('upsert_prospect_event_call_booked', {
          p_profile_id: profileId,
          p_prospect_key: igLead.ig_username.toLowerCase(),
          p_platform: 'ig',
          p_event_type: 'call_booked',
          // Moment réel de la réservation (bookedAt), pas l'heure du call (scheduledAt).
          p_occurred_at: bookedAt ?? new Date().toISOString(),
          p_ig_lead_id: effectiveIgLeadId,
          p_prospect_link_id: finalProspectLinkId,
          p_call_id: callRow.id,
        }).then(({ error: evtErr }: any) => {
          if (evtErr) console.error('[sync-calendly] prospect_events:', evtErr.message);
        });
        await supabase.from('instagram_leads')
          .update({ calendly_event_uuid: eventUuid })
          .eq('id', effectiveIgLeadId);
      }
    }

    if (isCanceled && callRow?.ig_lead_id) {
      const { data: leadRow } = await supabase
        .from('instagram_leads').select('ig_username, profile_id').eq('id', callRow.ig_lead_id).single();
      if (leadRow) {
        const { data: eventsRows } = await supabase
          .from('prospect_events')
          .select('event_type')
          .eq('profile_id', leadRow.profile_id)
          .eq('prospect_key', leadRow.ig_username.toLowerCase())
          .eq('platform', 'ig')
          .order('occurred_at', { ascending: false });

        let bestStage = 'lm_sent';
        if (eventsRows?.some((e: any) => e.event_type === 'link_clicked')) bestStage = 'link_clicked';
        else if (eventsRows?.some((e: any) => e.event_type === 'calendly_link_sent')) bestStage = 'calendly_sent';

        await supabase.from('pipeline_overrides').upsert({
          profile_id: leadRow.profile_id,
          prospect_key: leadRow.ig_username.toLowerCase(),
          platform: 'ig',
          stage: bestStage,
          reason: 'canceled',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'profile_id,prospect_key,platform' });
      }
    }

    return true;
  }));

  const synced = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
  results.forEach(r => {
    if (r.status === 'rejected') errors.push(`event_error: ${r.reason?.message || 'unknown'}`);
  });

  return { synced, skipped, errors };
}

Deno.serve(async (req: Request) => {
  const auth = req.headers.get('authorization');
  if (!auth || auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401 });
  }

  // Filigrane de passage : la preuve que ce cron est encore INVOQUE.
  //
  // Pose AU PLUS TOT, juste apres l'authentification, et non a la fin. La question que
  // pose `crons_sante` est « le planificateur appelle-t-il encore cette URL ? » — c'est
  // la panne invisible de la plateforme : un cron qui ne tourne plus n'echoue pas, il
  // se tait, et un silence ne se distingue pas d'un succes.
  //
  // Un echec SURVENU PENDANT l'execution est deja couvert par `cron_runs`, et les deux
  // ne doivent pas se recouvrir. Marquer a la fin ferait en plus passer un simple
  // depassement de temps pour une mort du cron — une fausse alerte, c'est-a-dire le
  // debut d'une alerte qu'on n'ouvre plus.
  //
  // Le seuil de silence vit sur la LIGNE (`crons_passages.silence_max`), pas ici : la
  // RPC ne met a jour que l'horodatage, donc changer la cadence de ce cron se repercute
  // en base sans toucher au code.
  //
  // Strictement non bloquant : un filigrane muet vaut mieux qu'un cron qui tombe.
  try {
    const { error: filigraneErr } = await supabase.rpc('marquer_passage_cron', { p_nom: 'sync-calendly' });
    if (filigraneErr) console.error('[sync-calendly] filigrane de passage:', filigraneErr.message);
  } catch (e) { console.error('[sync-calendly] filigrane de passage:', e); }

  const { data: integrations } = await supabase
    .from('integrations')
    .select('profile_id, connected_at, first_connected_at, last_synced_at, profiles!inner(role)')
    .eq('provider', 'calendly')
    .eq('profiles.role', 'client');

  if (!integrations?.length) {
    return new Response(JSON.stringify({ ok: true, synced: 0, profiles: 0 }), { status: 200 });
  }

  // Borne haute de la fenêtre, figée AVANT le traitement : tout event arrivant pendant
  // l'exécution sera repris au cycle suivant (la marge de 48 h le garantit).
  const runStartedAt = new Date().toISOString();

  // Concurrence BORNÉE à 5, comme poll-leads.
  //
  // `Promise.all` lançait tous les profils d'un coup — le commentaire disait
  // « largement suffisant pour 20 élèves », ce qui est vrai et cesse de l'être à 40 :
  // chaque profil enchaîne un appel `/invitees` par rendez-vous non terminal, et 40
  // profils simultanés ouvrent autant de rafales concurrentes dans une fonction qui
  // dispose de 150 s.
  //
  // Le quota Calendly, lui, n'est pas en cause : 60 requêtes par minute et par JETON,
  // donc par élève. Ce qui se partage ici, c'est le temps d'exécution, pas le quota.
  const settled = await mapWithConcurrency(integrations as any[], 5, (integ: any) => {
    // first_connected_at, PAS connected_at — ce dernier est reecrit a CHAQUE
    // reconnexion OAuth, et il sert de PLANCHER a la fenetre d'ingestion
    // (`connectedAt - 48 h`, voir plus haut). Un eleve qui reconnecte simplement le
    // MEME compte Calendly rehausserait donc ce plancher a aujourd'hui : ses
    // rendez-vous passes resteraient en base mais cesseraient d'etre rafraichis, et
    // une annulation ulterieure ne serait jamais vue. Panne silencieuse, declenchee
    // par un geste anodin.
    //
    // `first_connected_at` ne bouge jamais apres la premiere connexion : c'est la
    // seule borne qui decrit « depuis quand ce compte nous appartient ».
    const connectedAt = integ.first_connected_at || integ.connected_at || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return syncCalendlyEleve(integ.profile_id, connectedAt, integ.last_synced_at ?? null)
      .then(r => ({ profile_id: integ.profile_id, ...r }));
  });
  const results = settled.map((r, i) => r.status === 'fulfilled'
    ? r.value
    : { profile_id: (integrations as any[])[i].profile_id, synced: 0, skipped: 0, errors: [String((r as any).reason?.message || 'unknown')] });

  // Avancer last_synced_at UNIQUEMENT pour les profils sans erreur. Un profil en échec
  // garde son ancienne borne et rattrapera la fenêtre complète au cycle suivant — c'est
  // ce qui rend l'incrémental sûr : en cas de doute, on retraite trop, jamais trop peu.
  const okProfileIds = results.filter(r => !r.errors.length).map(r => r.profile_id);
  if (okProfileIds.length) {
    const { error: stampErr } = await supabase
      .from('integrations')
      .update({ last_synced_at: runStartedAt })
      .eq('provider', 'calendly')
      .in('profile_id', okProfileIds);
    if (stampErr) console.error('[sync-calendly] last_synced_at:', stampErr.message);
  }

  const totalSynced = results.reduce((acc, r) => acc + r.synced, 0);
  const allErrors: Record<string, string[]> = {};
  for (const r of results) {
    if (r.errors.length) allErrors[r.profile_id] = r.errors;
  }

  // Trace EN BASE, pas seulement dans la réponse HTTP.
  //
  // Les erreurs partaient dans le corps de la réponse, que cron-job.org jette. La
  // fonction pouvait donc échouer sur tous les profils pendant des jours sans que rien
  // ne l'indique — et c'est le chemin qui alimente les calls, donc le tunnel de vente.
  // Convention du projet (AGENTS.md) : n'écrire QUE les passages en échec, la table se
  // purge seule à 30 jours.
  //
  // Ne jamais faire échouer un passage à cause de sa propre journalisation.
  if (Object.keys(allErrors).length) {
    try {
      await supabase.from('cron_runs').insert({
        fonction: 'sync-calendly',
        profils_en_erreur: Object.keys(allErrors).length,
        erreurs: allErrors,
      });
    } catch (e) {
      console.error('[sync-calendly] cron_runs insert failed', e);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    synced: totalSynced,
    skipped: results.reduce((acc, r) => acc + (r.skipped || 0), 0),
    profiles: integrations.length,
    errors: allErrors,
  }), { status: 200 });
});
