/**
 * Traitement des événements webhook Instagram.
 *
 * Extrait de `app/api/webhooks/instagram/route.ts` : Next.js n'autorise que
 * `GET`/`POST`/… comme exports d'un fichier `route.ts` et supprime les autres à
 * la compilation — impossible d'y importer une fonction. Ce module existe donc
 * pour que le worker de file (`app/api/cron/process-webhook-queue`) puisse
 * appeler le même traitement que le webhook.
 *
 * Pourquoi une file : Meta exige une réponse en moins de 30 s et DÉSABONNE
 * l'application si les échecs durent 1 h — les DM1 s'arrêtent alors complètement,
 * réabonnement manuel requis. Le traitement synchrone mesurait 2,15 s de moyenne
 * mais 15,55 s au pic, avec UN SEUL compte actif. À 30 élèves, Meta envoie une
 * requête HTTP par commentaire, en parallèle : un post viral suffisait à franchir
 * les 30 s.
 *
 * La fenêtre de private reply est de 7 JOURS côté Meta : un pic de plusieurs
 * milliers de commentaires peut donc s'étaler sur des heures sans rien perdre.
 */
import { createClient } from '@supabase/supabase-js';
import { pushEvent } from '@/app/api/instagram/webhook-stream/route';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);


function sanitizeInstagramUsername(raw: string): string {
  return raw.toLowerCase().trim().replace(/^@/, '').replace(/\s+/g, '').replace(/[^a-z0-9._]/g, '');
}

// Debug temporaire — les logs Vercel CLI ne capturent qu'un seul message par
// invocation serverless (rétention courte, indexation lente), insuffisant pour
// tracer un flux multi-étapes. Écrit en base pour un accès SQL immédiat et fiable.
// À supprimer une fois l'investigation terminée (voir TODOS.md).
function debugLog(message: string, data?: any) {
  serviceSupabase.from('webhook_debug_log').insert({ message, data: data ?? null }).then();
}

// Insensible à la casse ET aux accents pour le matching mot-clé lead magnet — "Méta"
// doit matcher le mot-clé "Meta" configuré par le coach (demande explicite Chris,
// 2026-07-30). NFD décompose les caractères accentués en (lettre de base + diacritique
// séparé), le \p{Diacritic} retire ensuite juste le diacritique.
function normalizeForKeywordMatch(raw: string): string {
  return raw.toLowerCase().trim().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

async function fetchAndStoreAvatar(igUserId: string, accessToken: string): Promise<string | null> {
  try {
    const profileRes = await fetch(
      `https://graph.instagram.com/v22.0/${igUserId}?fields=profile_pic&access_token=${accessToken}`
    );
    if (!profileRes.ok) return null;
    const profileData = await profileRes.json();
    const profilePicUrl: string | undefined = profileData?.profile_pic;
    if (!profilePicUrl) return null;

    const imgRes = await fetch(profilePicUrl);
    if (!imgRes.ok) return null;
    const blob = await imgRes.blob();
    const arrayBuffer = await blob.arrayBuffer();

    const { error: uploadError } = await serviceSupabase.storage
      .from('instagram-avatars')
      .upload(`${igUserId}.jpg`, arrayBuffer, { contentType: 'image/jpeg', upsert: true });

    if (uploadError) return null;

    const { data: { publicUrl } } = serviceSupabase.storage
      .from('instagram-avatars')
      .getPublicUrl(`${igUserId}.jpg`);

    return publicUrl;
  } catch {
    return null;
  }
}

/**
 * Délai entre le DM2 (lien) et le DM3 (question d'ouverture).
 *
 * Envoyer les deux dans la foulée fait mécanique : la personne vient de cliquer,
 * elle lit le lien, et une question qui tombe dans la même seconde se voit.
 *
 * 2 minutes plutôt que quelques secondes (ManyChat utilise ~3 s entre messages
 * d'un même flux) : ici le DM3 n'est pas la suite du DM2, c'est une relance qui
 * doit ressembler à un vrai message de suivi. Les délais de 4-11 min qu'on
 * trouve ailleurs visent la prospection à froid — hors sujet pour une séquence
 * déclenchée par une action de l'utilisateur, qui a déjà quitté la conversation
 * passé quelques minutes.
 *
 * Non ajustable par contenu (choix de Chris) : une seule valeur, tenue.
 */
const DM3_DELAY_MS = 2 * 60 * 1000;

/**
 * Valeurs par défaut du DM2 (le message qui porte le lien), utilisées quand les
 * champs correspondants de `content_links` sont vides.
 *
 * Ces chaînes sont dupliquées à l'identique dans PageLiens.tsx comme
 * placeholders : un champ laissé vide doit montrer exactement ce qui sera
 * envoyé, sinon le placeholder ment.
 */
const DM2_DEFAULT_MESSAGE = 'Voici ton lien 👇';
const DM2_DEFAULT_BUTTON = '📖 Accéder au lien';

async function attemptShortioCreate(apiKey: string, payload: object): Promise<Response> {
  const opts: RequestInit = {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  };
  const res = await fetch('https://api.short.io/links', opts);
  if (!res.ok && res.status !== 409) {
    await new Promise(r => setTimeout(r, 500));
    return fetch('https://api.short.io/links', opts);
  }
  return res;
}

/**
 * Crée le lien Short.io personnalisé d'un prospect (lead magnet).
 *
 * Appelée AU MOMENT DU CLIC sur le bouton du DM1, plus à la réception du
 * commentaire. Raison : le lien n'est envoyé qu'en DM2, donc uniquement aux
 * prospects qui ont cliqué — or seuls 30 à 50 % cliquent. Le créer à chaque
 * commentaire gaspillait la moitié à deux tiers du quota Short.io (plafond
 * d'automation : 1 000 liens/an en gratuit, 10 000/an en Pro — un seul post
 * viral consommait l'année entière), et ajoutait un appel réseau au chemin
 * critique du webhook, celui qui est contraint par les 30 s de Meta.
 *
 * Le tracking est inchangé : le lien reste unique par prospect, donc
 * l'attribution par chemin (`short_url like %/path`) fonctionne à l'identique.
 *
 * Retourne `fallbackUrl` si quoi que ce soit échoue — jamais d'exception : un
 * lien générique vaut mieux qu'un DM2 non envoyé.
 */
async function createProspectLmLink(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  profileId: string;
  lmUrl: string;
  lmKeyword: string;
  username: string;
  mediaId: string | null;
  fallbackUrl: string;
  /** 'lm' pour un commentaire, 'lm-story' pour une réponse à story. */
  pathPrefix?: 'lm' | 'lm-story';
  /** utm_medium : 'dm' depuis un commentaire, 'story' depuis une séquence story. */
  utmMedium?: 'dm' | 'story';
  /** Titre du lien dans Short.io — distingue les deux origines à la lecture. */
  titlePrefix?: string;
}): Promise<string> {
  const {
    supabase, profileId, lmUrl, lmKeyword, username, mediaId, fallbackUrl,
    pathPrefix = 'lm', utmMedium = 'dm', titlePrefix = 'LM',
  } = params;

  if (!lmUrl || !username) return fallbackUrl;

  const cleanUsername = sanitizeInstagramUsername(username);
  const cleanKeyword = lmKeyword.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const lmPath = `${pathPrefix}-${cleanKeyword}-${cleanUsername}`;

  try {
    const { data: shortioInteg } = await supabase
      .from('integrations')
      .select('api_key, metadata')
      .eq('profile_id', profileId)
      .eq('provider', 'shortio')
      .single();

    const apiKey = shortioInteg?.api_key;
    const domain = shortioInteg?.metadata?.domain;
    const domainId = shortioInteg?.metadata?.domain_id;
    if (!apiKey || !domain || !domainId) return fallbackUrl;

    // Nomenclature UTM : un rôle par champ, voir docs/utm-nomenclature.md.
    // utm_content porte l'identifiant du CONTENU d'origine, jamais le pseudo :
    // c'est ce que « Performance par contenu » compare à l'id du post pour
    // rattacher le call. Le prospect va dans utm_term, son champ dédié.
    const destUrl = new URL(lmUrl);
    destUrl.searchParams.set('utm_source', 'ig');
    destUrl.searchParams.set('utm_medium', utmMedium);
    destUrl.searchParams.set('utm_campaign', `${pathPrefix}-${cleanKeyword}`);
    if (mediaId) destUrl.searchParams.set('utm_content', mediaId);
    destUrl.searchParams.set('utm_term', cleanUsername);

    const res = await attemptShortioCreate(apiKey, {
      domain,
      originalURL: destUrl.toString(),
      title: `${titlePrefix} — ${username}`,
      path: lmPath,
    });

    if (res.status === 409) {
      // Lien déjà existant pour ce prospect (re-clic, ou lien créé par l'ancien
      // comportement) → récupérer l'URL existante plutôt qu'échouer.
      const existingRes = await fetch(
        `https://api.short.io/api/links?domain_id=${domainId}&limit=150`,
        { headers: { authorization: apiKey, accept: 'application/json' } }
      );
      const existingData = await existingRes.json().catch(() => ({}));
      const existing = (existingData?.links || []).find((l: { path?: string }) => l.path === lmPath);
      if (existing) return existing.secureShortURL || existing.shortURL || fallbackUrl;
      return fallbackUrl;
    }

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return data.secureShortURL || data.shortURL || fallbackUrl;
    }

    console.warn('[IG Webhook] Short.io lien LM échoué, fallback générique, status:', res.status);
    return fallbackUrl;
  } catch (err) {
    console.warn('[IG Webhook] Short.io lien LM exception, fallback générique:', err);
    return fallbackUrl;
  }
}

// Détecte un Cold DM générique (echo sans lien Calendly connu) : premier message
// manuel envoyé par Chris depuis l'app Instagram à quelqu'un qui vient de le suivre.
// Deux filtres avant de créer une fiche, dans l'ordre (rapide → lent) :
//  1) Table interne : si le destinataire est déjà connu (lead ou prospect_link),
//     ce n'est pas un premier contact mais une RELANCE — on ne crée rien, on ne
//     touche à rien (décision produit Chris : relance != Cold DM, jamais de 2e fiche).
//  2) Fallback API : si inconnu en interne, on vérifie via l'historique réel de la
//     conversation (endpoint conversations Meta) qu'il ne s'agit vraiment que d'un
//     seul message avant de créer la fiche — filtre anti-faux-positif (évite de
//     tracker un message à un ami/autre coach), couvre aussi le cas d'une
//     conversation ancienne antérieure au tracking, invisible en interne.
async function handleColdDmCandidate(params: {
  pid: string;
  recipientId: string;
  resolvedMatch: { access_token: string } | null;
  igAccountId: string;
  canonicalIgAccountId: string | null;
}): Promise<void> {
  const { pid, recipientId, resolvedMatch, igAccountId, canonicalIgAccountId } = params;
  if (!recipientId || !resolvedMatch) return;

  // Filtre 1 — déjà connu du pipeline (lead ou prospect_link) → relance, pas Cold DM.
  // Couvre aussi le cas d'un lead marqué not_a_lead (faux positif confirmé, ex: un
  // pote) : tant que la fiche existe (statut "Ce n'est pas un lead", ligne conservée),
  // aucune nouvelle fiche Cold DM n'est recréée pour ce ig_user_id. Un lead vraiment
  // supprimé (DELETE, ligne effacée) redevient en revanche détectable — comportement
  // attendu, la suppression n'a pas vocation à bloquer durablement contrairement à
  // not_a_lead.
  const [{ data: existingLead }, { data: existingProspect }] = await Promise.all([
    serviceSupabase.from('instagram_leads').select('id').eq('profile_id', pid).eq('ig_user_id', recipientId).maybeSingle(),
    serviceSupabase.from('prospect_links').select('id').eq('profile_id', pid).eq('ig_username', recipientId).maybeSingle(),
  ]);
  if (existingLead || existingProspect) return;

  const { access_token: token } = resolvedMatch;

  // Résout le username du destinataire (l'echo Meta ne le fournit pas directement)
  const profileRes = await fetch(
    `https://graph.instagram.com/v22.0/${recipientId}?fields=id,username&access_token=${token}`
  );
  const profileData = await profileRes.json().catch(() => ({}));
  const recipientUsername: string | null = profileData?.username || null;
  if (!recipientUsername) return;

  // Re-vérifie par username (le filtre 1 était par ig_user_id, un prospect_link créé
  // manuellement dans l'UI est indexé par ig_username — double sécurité anti-doublon)
  const { data: existingProspectByUsername } = await serviceSupabase
    .from('prospect_links')
    .select('id')
    .eq('profile_id', pid)
    .ilike('ig_username', recipientUsername)
    .maybeSingle();
  if (existingProspectByUsername) return;

  // Filtre 2 — fallback API : confirme qu'il s'agit bien du premier (et seul) message
  // de la conversation avant de créer la fiche.
  try {
    const convRes = await fetch(
      `https://graph.instagram.com/v22.0/${canonicalIgAccountId ?? igAccountId}/conversations?user_id=${recipientId}&fields=id,message_count&access_token=${token}`
    );
    const convData = await convRes.json();
    const conv = convData?.data?.[0];
    if (!conv || (conv.message_count ?? 0) > 1) return;
  } catch {
    return;
  }

  const now = new Date().toISOString();
  const { data: newLead } = await serviceSupabase
    .from('instagram_leads')
    .insert({
      profile_id:       pid,
      ig_username:      recipientUsername,
      ig_user_id:       recipientId,
      source:           'cold_dm',
      keyword_matched:  'cold_dm',
      lead_magnet_sent: false,
      hook_replied:     false,
      detected_at:      now,
      ig_account_id:    canonicalIgAccountId ?? igAccountId,
    })
    .select('id')
    .maybeSingle();

  if (newLead?.id) {
    await serviceSupabase.from('prospect_events').upsert({
      profile_id:   pid,
      prospect_key: recipientUsername.toLowerCase(),
      platform:     'ig',
      event_type:   'cold_dm_sent',
      occurred_at:  now,
      ig_lead_id:   newLead.id,
    }, { onConflict: 'ig_lead_id,event_type', ignoreDuplicates: false });

    console.log(`[IG Webhook] cold_dm créé — @${recipientUsername}, lead: ${newLead.id}`);
    pushEvent({ type: 'cold_dm_created', ig_username: recipientUsername, lead_id: newLead.id });
  }
}


/**
 * Traite UN entry Meta (une ligne de `webhook_queue`).
 *
 * Relance ses erreurs plutôt que de les avaler : le worker doit pouvoir marquer
 * l'événement en échec et le réessayer. Les avaler ferait passer un échec pour un
 * succès, et le commentaire serait perdu définitivement — Meta n'autorise qu'un
 * private reply par commentaire.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function processWebhookEntry(queuedEntry: any): Promise<void> {
    const entries = [queuedEntry];
  try {

  // Charge tous les comptes IG une seule fois pour tous les entries
  const { data: allIg } = await serviceSupabase
    .from('integrations')
    .select('profile_id, access_token, metadata')
    .eq('provider', 'instagram');

  for (const entry of entries) {
    const igAccountId = String(entry.id);
    debugLog('entry.id reçu', { igAccountId, comptesConnus: (allIg || []).map((r: any) => r.metadata?.ig_account_id) });
    // Trouve le profil par ig_account_id d'abord
    let resolvedMatch: any = (allIg || []).find((r: any) =>
      String(r.metadata?.ig_account_id) === igAccountId
    ) || null;

    // Si pas de match direct : Meta envoie systématiquement dans entry.id un ID
    // ALTERNATIF (probablement lié à la Page Facebook connectée), jamais l'ig_account_id
    // stocké (résolu via /me au callback OAuth) — confirmé empiriquement le 2026-07-30,
    // toujours vrai, jamais un cas rare. GET graph.instagram.com/{entry.id}?fields=id
    // renvoie le vrai ig_account_id, MAIS seulement avec un token du MÊME compte —
    // n'importe quel autre token échoue avec "missing permissions" (testé : le token de
    // rdj échoue sur l'entry.id d'un autre compte, exactement comme un token tiers). Pas
    // de raccourci "un seul appel suffit" : il faut tester les tokens jusqu'à trouver
    // celui qui répond avec succès. Pour ne pas rescanner tous les tokens à CHAQUE
    // commentaire (coûteux à 20+ élèves), le mapping entry.id→ig_account_id trouvé une
    // fois est mis en cache (stable, ne change jamais) dans ig_entry_id_mapping.
    if (!resolvedMatch) {
      const { data: cached } = await serviceSupabase
        .from('ig_entry_id_mapping')
        .select('ig_account_id')
        .eq('entry_id', igAccountId)
        .maybeSingle();
      if (cached?.ig_account_id) {
        resolvedMatch = (allIg || []).find((r: any) =>
          String(r.metadata?.ig_account_id) === cached.ig_account_id
        ) || null;
        debugLog('résolution entry.id via cache', { igAccountId, ig_account_id: cached.ig_account_id, matched: !!resolvedMatch });
      }
    }
    if (!resolvedMatch) {
      const results = await Promise.allSettled((allIg || []).map(async (r: any) => {
        const resolveRes = await fetch(
          `https://graph.instagram.com/v21.0/${igAccountId}?fields=id&access_token=${r.access_token}`
        );
        const resolveData = await resolveRes.json();
        if (resolveData?.id && !resolveData.error) return r;
        throw new Error('no match');
      }));
      const found = results.find((res): res is PromiseFulfilledResult<any> => res.status === 'fulfilled');
      if (found) {
        resolvedMatch = found.value;
        debugLog('résolution entry.id via scan parallèle', { igAccountId, profile_id: resolvedMatch.profile_id });
        serviceSupabase.from('ig_entry_id_mapping')
          .upsert({ entry_id: igAccountId, ig_account_id: resolvedMatch.metadata?.ig_account_id }, { onConflict: 'entry_id' })
          .then();
      }
    }
    debugLog('resolvedMatch après résolution', {
      profile_id: resolvedMatch?.profile_id ?? null,
      changesLength: (entry.changes || []).length,
      messagingLength: (entry.messaging || []).length,
    });

    // Valeur canonique du compte propriétaire — TOUJOURS celle stockée dans
    // integrations.metadata (résolue une fois via /me au callback OAuth), jamais la
    // valeur brute igAccountId (=entry.id) envoyée par Meta dans ce webhook : dès que
    // le match direct échouait (entry.id ≠ valeur stockée, cas non rare vu le fallback
    // ci-dessus), toutes les écritures posaient le mauvais ig_account_id — cassant
    // l'isolation par compte pour n'importe quel lead créé via ce chemin.
    const canonicalIgAccountId: string | null = resolvedMatch?.metadata?.ig_account_id
      ? String(resolvedMatch.metadata.ig_account_id)
      : igAccountId;

    // ── Events messaging (DMs entrants) — détection réponse au message d'accroche ──
    for (const messaging of entry.messaging || []) {
      const senderId = String(messaging.sender?.id || '');
      const recipientId = String(messaging.recipient?.id || '');
      const msgText: string = messaging.message?.text || '';
      const isEcho = !!messaging.message?.is_echo; // true = DM envoyé par nous, false = DM reçu

      if (!resolvedMatch) continue;
      const { profile_id: pid } = resolvedMatch;

      // Message envoyé par nous (echo) — détecter si on a envoyé un lien Calendly prospect
      if (isEcho && msgText) {
        // recipientId = ig_user_id du destinataire (fourni par Meta dans l'echo)
        // On trouve le prospect_link par URL, puis on vérifie que le destinataire correspond.
        // Si c'est un cold DM (ig_lead_id null) → on crée la fiche lead à ce moment-là.

        const { data: allLinks } = await serviceSupabase
          .from('prospect_links')
          .select('id, short_url, ig_username, ig_lead_id, calendly_link_sent, calendly_link_sent_at, first_click_at')
          .eq('profile_id', pid);

        const matchedLink = (allLinks || []).find(pl => pl.short_url && msgText.includes(pl.short_url));
        if (!matchedLink) {
          // Pas de lien Calendly dans l'echo → candidat Cold DM générique : premier
          // message manuel envoyé par Chris depuis l'app Instagram à quelqu'un qui
          // vient de le suivre, sans commentaire ni lead magnet.
          await handleColdDmCandidate({ pid, recipientId, resolvedMatch, igAccountId, canonicalIgAccountId });
          continue;
        }

        const now = new Date().toISOString();
        let igLeadId: string | null = matchedLink.ig_lead_id ?? null;

        // Sécurité anti-mauvais-destinataire : si le lien est lié à un lead avec un ig_user_id
        // différent du recipientId réel → le coach a envoyé le lien de A à B → on ignore
        if (recipientId && igLeadId) {
          const { data: linkedLead } = await serviceSupabase
            .from('instagram_leads')
            .select('ig_user_id')
            .eq('id', igLeadId)
            .maybeSingle();
          if (linkedLead?.ig_user_id && linkedLead.ig_user_id !== recipientId) {
            console.warn(`[IG Webhook] echo ignoré — lien de ${matchedLink.ig_username} envoyé au mauvais destinataire (${recipientId})`);
            continue;
          }
        }

        // Cold DM : pas de lead existant → on crée la fiche maintenant
        // L'ig_username vient du prospect_link créé manuellement dans l'UI
        if (!igLeadId && matchedLink.ig_username) {
          const { data: newLead } = await serviceSupabase
            .from('instagram_leads')
            .insert({
              profile_id:       pid,
              ig_username:      matchedLink.ig_username,
              ig_user_id:       recipientId || null,
              source:           'cold_dm',
              keyword_matched:  'cold_dm',
              lead_magnet_sent: false,
              hook_replied:     false,
              ig_account_id:    canonicalIgAccountId ?? igAccountId,
            })
            .select('id')
            .single();
          if (newLead) {
            igLeadId = newLead.id;
            await serviceSupabase.from('prospect_links').update({ ig_lead_id: igLeadId }).eq('id', matchedLink.id);
          }
        }

        // Marque le lien comme envoyé.
        // Ne pas écraser calendly_link_sent_at si first_click_at est déjà renseigné :
        // calendly_link_sent_at = timestamp du PREMIER envoi (figé, sert de guard pour linkClickedValid)
        // last_calendly_link_sent_at = timestamp du DERNIER envoi (mis à jour à chaque renvoi,
        //   sert de naturalSignalAt pour calendly_sent dans resolveStage)
        const linkUpdateData: Record<string, any> = {
          calendly_link_sent: true,
          last_calendly_link_sent_at: now,
        };
        if (!matchedLink.calendly_link_sent_at) {
          linkUpdateData.calendly_link_sent_at = now;
        }
        await serviceSupabase
          .from('prospect_links')
          .update(linkUpdateData)
          .eq('id', matchedLink.id);

        // Pas d'override pipeline_overrides — calendly_sent est un signal auto
        // calculé depuis prospect_links.calendly_link_sent dans le pipeline.
        // Un override manuel bloquerait les signaux suivants (ex: link_clicked).

        // Événement prospect_events
        await serviceSupabase.from('prospect_events').upsert({
          profile_id:       pid,
          prospect_key:     matchedLink.ig_username,
          platform:         'ig',
          event_type:       'calendly_link_sent',
          occurred_at:      now,
          ig_lead_id:       igLeadId,
          prospect_link_id: matchedLink.id,
        }, { onConflict: 'prospect_link_id,event_type', ignoreDuplicates: false });

        console.log(`[IG Webhook] calendly_link_sent — prospect_link: ${matchedLink.id}, url: ${matchedLink.short_url}`);
        pushEvent({ type: 'calendly_link_sent', prospect_link_id: matchedLink.id, short_url: matchedLink.short_url });
        continue;
      }

      // Clic sur le bouton LM_LINK_CLICKED → envoyer DM2 (lien) puis DM3 (ouverture)
      // Test generic template (postback) vs quick_reply — Meta peut renvoyer l'un ou l'autre selon le format envoyé
      const quickReplyPayload = messaging.message?.quick_reply?.payload || messaging.postback?.payload;
      if (quickReplyPayload === 'LM_LINK_CLICKED' && senderId) {
        const { data: leadForDm2 } = await serviceSupabase
          .from('instagram_leads')
          .select('id, ig_username, pending_dm2, pending_dm3, keyword_matched, pending_lm_content_id, pending_lm_media_id, story_sequence_id')
          .eq('profile_id', pid)
          .eq('ig_user_id', senderId)
          .eq('lead_magnet_sent', true)
          .order('detected_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (leadForDm2 && resolvedMatch) {
          const { access_token: at } = resolvedMatch;
          const sendDm = (text: string) => fetch(
            `https://graph.instagram.com/v21.0/${canonicalIgAccountId ?? igAccountId}/messages`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recipient: { id: senderId },
                messaging_type: 'RESPONSE',
                message: { text },
                access_token: at,
              }),
            }
          ).then(r => r.json());

          // DM2 sous forme de TEMPLATE avec bouton web_url : le prospect voit un
          // libellé (« 📖 Accéder au guide »), jamais l'URL. Possible ici et pas en
          // DM1 parce que le clic sur le postback du DM1 a déjà ouvert la fenêtre
          // de 24 h — Meta documente que les clics hors plateforme (web_url) ne
          // l'ouvrent PAS, d'où le postback obligatoire en DM1.
          const sendDmWithButton = (url: string, text: string, label: string) => fetch(
            `https://graph.instagram.com/v21.0/${canonicalIgAccountId ?? igAccountId}/messages`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recipient: { id: senderId },
                messaging_type: 'RESPONSE',
                message: {
                  attachment: {
                    type: 'template',
                    payload: {
                      template_type: 'generic',
                      elements: [{
                        title: text.slice(0, 80),
                        buttons: [{ type: 'web_url', url, title: label.slice(0, 20) }],
                      }],
                    },
                  },
                },
                access_token: at,
              }),
            }
          ).then(r => r.json());

          // Création du lien Short.io personnalisé — MAINTENANT, pas au commentaire.
          // Seuls les prospects qui cliquent en consomment un (voir
          // createProspectLmLink pour le détail du quota).
          let lmLink: string | null = leadForDm2.pending_dm2 || null;
          // Textes du DM2 — configurables par contenu (PageLiens). Ces valeurs par
          // défaut sont les mêmes que les placeholders affichés dans l'interface,
          // pour qu'un champ laissé vide envoie exactement ce qui y est montré.
          let lmButtonLabel = DM2_DEFAULT_BUTTON;
          let lmMessageText = DM2_DEFAULT_MESSAGE;
          // Prospect venu d'une story : sa configuration vit sur
          // `story_sequences`, pas sur `content_links`. `story_sequence_id`, posé
          // à la réponse à la story, est ce qui permet de le reconnaître ici.
          if (leadForDm2.story_sequence_id && leadForDm2.ig_username) {
            const { data: seqForLink } = await serviceSupabase
              .from('story_sequences')
              .select('id, lm_url, lm_keyword, dm1_message, dm_link_button_text')
              .eq('id', leadForDm2.story_sequence_id)
              .maybeSingle();

            if (seqForLink?.dm_link_button_text) lmButtonLabel = seqForLink.dm_link_button_text.slice(0, 20);
            if (seqForLink?.dm1_message) {
              // {{lien_lm}} est retiré du texte : dans le gabarit à bouton, c'est
              // le bouton qui porte l'URL. La laisser en clair afficherait le lien
              // deux fois, et le message perdrait ce qui le rend propre.
              lmMessageText = seqForLink.dm1_message
                .replace(/\{\{lien_lm\}\}/gi, '')
                .replace(/{{username}}/gi, `@${leadForDm2.ig_username}`)
                .replace(/\s{2,}/g, ' ')
                .replace(/[:\-–—]\s*$/, '')
                .trim() || DM2_DEFAULT_MESSAGE;
            }
            if (seqForLink?.lm_url) {
              lmLink = await createProspectLmLink({
                supabase: serviceSupabase,
                profileId: pid,
                lmUrl: seqForLink.lm_url,
                lmKeyword: seqForLink.lm_keyword,
                username: leadForDm2.ig_username,
                // utm_content = la séquence, jamais un post : c'est ce que
                // Performance par contenu attend pour rattacher le call.
                mediaId: seqForLink.id ? String(seqForLink.id) : null,
                fallbackUrl: seqForLink.lm_url,
                pathPrefix: 'lm-story',
                utmMedium: 'story',
                titlePrefix: 'LM Story',
              });
            }
          } else if (leadForDm2.pending_lm_content_id && leadForDm2.keyword_matched && leadForDm2.ig_username) {
            const { data: clForLink } = await serviceSupabase
              .from('content_links')
              .select('lm_url, lm_short_url, lm_keyword, dm_link_message, dm_link_button_text')
              .eq('profile_id', pid)
              .eq('content_id', leadForDm2.pending_lm_content_id)
              .eq('lm_keyword', leadForDm2.keyword_matched)
              .maybeSingle();

            // Champs propres au DM2 — plus dm_button_text, qui est celui du DM1 :
            // les deux boutons n'ont pas le même rôle (demander le lien / l'ouvrir).
            if (clForLink?.dm_link_button_text) lmButtonLabel = clForLink.dm_link_button_text;
            if (clForLink?.dm_link_message) lmMessageText = clForLink.dm_link_message;

            if (clForLink?.lm_url) {
              lmLink = await createProspectLmLink({
                supabase: serviceSupabase,
                profileId: pid,
                lmUrl: clForLink.lm_url,
                lmKeyword: clForLink.lm_keyword,
                username: leadForDm2.ig_username,
                mediaId: leadForDm2.pending_lm_media_id ?? null,
                // Repli : le lien générique du contenu, puis ce qui avait été stocké.
                fallbackUrl: clForLink.lm_short_url || leadForDm2.pending_dm2 || '',
              });
              // Le lien effectivement envoyé devient la valeur de référence du lead.
              if (lmLink) {
                await serviceSupabase.from('instagram_leads')
                  .update({ tracking_link: lmLink })
                  .eq('id', leadForDm2.id);
              }
            }
          }

          if (lmLink) {
            const dm2Data = await sendDmWithButton(
              lmLink,
              lmMessageText.replace(/{{username}}/gi, `@${leadForDm2.ig_username || 'toi'}`),
              lmButtonLabel
            );
            if (dm2Data.error) {
              console.error('[IG Webhook] Erreur DM2 (lien) après clic QR:', dm2Data.error);
              pushEvent({ type: 'dm2_error', error: dm2Data.error });
            } else {
              console.log(`[IG Webhook] DM2 (lien) envoyé après clic QR — message_id: ${dm2Data.message_id}`);
              pushEvent({ type: 'dm2_sent', message_id: dm2Data.message_id });
            }
          }

          // DM3 (question d'ouverture) : PLANIFIÉ à +2 min, pas envoyé ici.
          //
          // Envoyer les deux messages dans la foulée fait mécanique — la personne
          // vient de cliquer, elle lit le lien, et une question qui tombe dans la
          // même seconde se voit. 2 minutes la font arriver comme un vrai message
          // de suivi.
          //
          // Le délai NE PEUT PAS être une attente dans ce handler : Meta exige une
          // réponse en moins de 30 s, et désabonne le webhook après 1 h d'échecs.
          // D'où l'horodatage + le cron send-pending-dm3 qui dépile.
          const dm3At = leadForDm2.pending_dm3
            ? new Date(Date.now() + DM3_DELAY_MS).toISOString()
            : null;
          if (dm3At) {
            pushEvent({ type: 'dm3_scheduled', at: dm3At });
          }

          // pending_dm2 consommé ; pending_dm3 conservé jusqu'à son envoi par le cron.
          await serviceSupabase.from('instagram_leads')
            .update({ pending_dm2: null, dm3_scheduled_at: dm3At })
            .eq('id', leadForDm2.id);
        }
        continue;
      }

      // ── Reply à une story (séquences stories — feature ig_stories/story_sequences) ──
      // Contrairement au flux commentaire de posts (où NOUS envoyons le DM1 en premier via
      // private reply), c'est ICI le prospect qui écrit en premier en répondant à la story
      // CTA — la fenêtre 24h Meta est donc déjà ouverte nativement, pas besoin de Quick
      // Reply pour la forcer. On envoie DM1 (lien LM perso) puis DM2 (libre) enchaînés sans
      // attendre de clic. Point critique : ce premier message ne doit PAS marquer
      // hook_replied=true (sinon la card bascule prématurément en "En conversation" dans le
      // pipeline) — awaiting_story_followup=true bloque ça, et seul le message SUIVANT du
      // prospect (capté par le bloc générique hook_replied plus bas) fera basculer la card.
      const storyReplyId: string | undefined = messaging.message?.reply_to?.story?.id;
      if (storyReplyId && senderId && msgText && !isEcho) {
        const { data: story } = await serviceSupabase
          .from('ig_stories')
          .select('id, sequence_id')
          .eq('ig_story_id', storyReplyId)
          .eq('profile_id', pid)
          .maybeSingle();

        if (story?.sequence_id) {
          const { data: seq } = await serviceSupabase
            .from('story_sequences')
            .select('*')
            .eq('id', story.sequence_id)
            .maybeSingle();

          if (seq?.lm_keyword && normalizeForKeywordMatch(msgText).includes(normalizeForKeywordMatch(seq.lm_keyword))) {
            // Cooldown 1 min — même garde anti-doublon que le flux commentaires
            const cooldownCutoff = new Date(Date.now() - 60 * 1000).toISOString();
            const { data: recentDm } = await serviceSupabase
              .from('instagram_lead_lm_history')
              .select('id')
              .eq('ig_user_id', senderId)
              .eq('keyword_matched', seq.lm_keyword)
              .eq('profile_id', pid)
              .gte('detected_at', cooldownCutoff)
              .limit(1)
              .maybeSingle();

            if (recentDm) {
              pushEvent({ type: 'cooldown_skip', ig_user_id: senderId, keyword: seq.lm_keyword });
              continue;
            }

            // Récupère le username du prospect (pas fourni dans le payload messaging)
            let senderUsername = '';
            if (resolvedMatch?.access_token) {
              try {
                const profRes = await fetch(`https://graph.instagram.com/v22.0/${senderId}?fields=username&access_token=${resolvedMatch.access_token}`);
                const profData = await profRes.json();
                senderUsername = profData?.username || '';
              } catch { /* non bloquant — username restera vide si l'appel échoue */ }
            }

            // Lien Short.io perso (lead × séquence × keyword) — via la fonction
            // partagée avec le flux commentaires.
            //
            // Contrairement aux commentaires, la création n'est PAS reportée ici :
            // le prospect a déjà écrit (c'est lui qui répond à la story), donc il
            // est engagé et le lien part immédiatement dans le DM1. Il n'y a pas
            // d'étape de clic intermédiaire où la différer.
            // ── Parcours unifie (2026-08-27) ────────────────────────────
            //
            // On n'envoie plus le lien d'emblee. Le prospect recoit l'accroche
            // et son bouton ; le lien part au clic, dans le bloc
            // LM_LINK_CLICKED, exactement comme pour un commentaire de post.
            //
            // Le lien Short.io personnalise n'est donc plus cree ici : seuls
            // ceux qui cliquent en consomment un (voir createProspectLmLink
            // pour le detail du quota).
            const shortLink: string | null = null;

            const accrocheText = (seq.dm_lm_message || '')
              .replace(/{{username}}/gi, `@${senderUsername || 'toi'}`)
              .replace(/\s{2,}/g, ' ')
              .trim();
            const accrocheBtn = (seq.dm_button_text || DM2_DEFAULT_BUTTON).slice(0, 20);

            // Gabarit generique a bouton postback, comme le DM1 des posts : c'est
            // le clic sur un postback qui ouvre la fenetre de 24 h cote Meta. Un
            // bouton web_url ne l'ouvrirait pas, et le message du lien ne pourrait
            // plus partir.
            const sendAccroche = (text: string, btn: string) => fetch(
              `https://graph.instagram.com/v21.0/${canonicalIgAccountId ?? igAccountId}/messages`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  recipient: { id: senderId },
                  messaging_type: 'RESPONSE',
                  message: {
                    attachment: {
                      type: 'template',
                      payload: {
                        template_type: 'generic',
                        elements: [{
                          title: text.slice(0, 80),
                          buttons: [{ type: 'postback', title: btn, payload: 'LM_LINK_CLICKED' }],
                        }],
                      },
                    },
                  },
                  access_token: resolvedMatch?.access_token,
                }),
              }
            ).then(r => r.json());

            let leadMagnetSent = false;
            if (accrocheText) {
              const dm1Data = await sendAccroche(accrocheText, accrocheBtn);
              if (dm1Data.error) {
                console.error('[IG Webhook] Erreur accroche story:', dm1Data.error);
                pushEvent({ type: 'dm1_error', error: dm1Data.error, ig_user_id: senderId });
              } else {
                leadMagnetSent = true;
                pushEvent({ type: 'dm1_sent', message_id: dm1Data.message_id, ig_user_id: senderId });
              }
            }

            const nowIso = new Date().toISOString();
            const { data: existingLead } = await serviceSupabase
              .from('instagram_leads')
              .select('id, detected_at')
              .eq('profile_id', pid)
              .eq('ig_user_id', senderId)
              .maybeSingle();

            const { data: upsertedLead } = await serviceSupabase
              .from('instagram_leads')
              .upsert({
                profile_id: pid,
                source: 'story_reply',
                ig_username: senderUsername || null,
                ig_user_id: senderId,
                message: msgText.slice(0, 500),
                media_id: storyReplyId,
                keyword_matched: seq.lm_keyword,
                detected_at: existingLead?.detected_at ?? nowIso,
                lead_magnet_sent: leadMagnetSent,
                tracking_link: shortLink || null,
                // La relance est mise de côté ici et programmée au clic, comme
                // pour un post : la planifier dès maintenant l'enverrait à
                // quelqu'un qui n'a jamais demandé le lien.
                pending_dm3: seq.dm2_story_message || null,
                story_sequence_id: story.sequence_id,
                story_id: story.id,
                awaiting_story_followup: true,
                hook_replied: false,
                ig_account_id: canonicalIgAccountId,
              }, { onConflict: 'profile_id,ig_user_id', ignoreDuplicates: false })
              .select('id')
              .maybeSingle();

            if (upsertedLead?.id && senderUsername) {
              serviceSupabase.from('prospect_events').insert({
                profile_id: pid,
                prospect_key: senderUsername.toLowerCase(),
                platform: 'ig',
                event_type: 'lm_sent',
                occurred_at: nowIso,
                ig_lead_id: upsertedLead.id,
              }).then(({ error: evtErr }) => {
                if (evtErr && !evtErr.message.includes('duplicate')) {
                  console.error('[IG Webhook] prospect_events lm_sent (story):', evtErr.message);
                }
              });
            }

            if (senderId) {
              await serviceSupabase
                .from('instagram_lead_lm_history')
                .upsert({
                  profile_id: pid,
                  ig_username: senderUsername || '',
                  ig_user_id: senderId,
                  keyword_matched: seq.lm_keyword,
                  media_id: storyReplyId,
                  lm_url: shortLink || null,
                  lead_magnet_sent: leadMagnetSent,
                  detected_at: nowIso,
                  ig_account_id: canonicalIgAccountId,
                }, { onConflict: 'profile_id,ig_user_id,media_id,detected_at', ignoreDuplicates: true });
            }

            console.log(`[IG Webhook] Lead story stocké — @${senderUsername}, mot-clé: ${seq.lm_keyword}, séquence: ${story.sequence_id}`);
            pushEvent({ type: 'story_lead_stored', ig_username: senderUsername, keyword: seq.lm_keyword, sequence_id: story.sequence_id });
            continue;
          }
        }
      }

      // On ne traite que les messages REÇUS (pas nos propres envois)
      if (!senderId || !msgText) continue;

      // Le sender est le prospect — cherche un lead avec cet ig_user_id qui a soit
      // reçu le LM (lead_magnet_sent = true), soit est un Cold DM (source = 'cold_dm',
      // toujours lead_magnet_sent = false puisqu'il n'y a jamais eu de commentaire/LM),
      // soit un lead story en attente de suivi (awaiting_story_followup = true)
      // — sans ce 2e/3e cas, une réponse à un Cold DM ou à une séquence story ne fait
      // jamais basculer la carte vers "En conversation".
      // On cherche SANS filtrer sur hook_replied pour toujours mettre à jour hook_replied_at
      // (même si déjà true) → permet de détecter un nouveau message après un recul manuel.
      // Note : un lead story avec awaiting_story_followup=true n'atteint CE bloc que sur
      // son message SUIVANT — le tout premier reply (mot-clé matché) est intercepté plus
      // haut et fait `continue` avant d'arriver ici, donc pas de double traitement possible.

      const { data: leadToUpdate } = await serviceSupabase
        .from('instagram_leads')
        .select('id, hook_replied, ig_username, awaiting_story_followup')
        .eq('profile_id', pid)
        .eq('ig_user_id', senderId)
        .or('lead_magnet_sent.eq.true,source.eq.cold_dm,awaiting_story_followup.eq.true')
        .order('detected_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (leadToUpdate) {
        const hookRepliedAt = new Date().toISOString();
        const wasAlreadyReplied = leadToUpdate.hook_replied;
        await serviceSupabase
          .from('instagram_leads')
          .update({
            hook_replied: true,
            hook_reply_text: msgText.slice(0, 500),
            hook_replied_at: hookRepliedAt,
            awaiting_story_followup: false,
          })
          .eq('id', leadToUpdate.id);

        if (leadToUpdate.ig_username) {
          serviceSupabase.from('prospect_events').insert({
            profile_id:  pid,
            prospect_key: leadToUpdate.ig_username.toLowerCase(),
            platform:    'ig',
            event_type:  'hook_replied',
            occurred_at: hookRepliedAt,
            ig_lead_id:  leadToUpdate.id,
          }).then(({ error: evtErr }) => {
            if (evtErr) console.error('[IG Webhook] prospect_events hook_replied:', evtErr.message);
          });
        }

        console.log(`[IG Webhook] hook_replied${wasAlreadyReplied ? ' (repeat)' : ''} — ig_user_id: ${senderId}, lead: ${leadToUpdate.id}, reply: "${msgText.slice(0, 50)}"`);
        pushEvent({ type: 'hook_replied', ig_user_id: senderId, lead_id: leadToUpdate.id, reply_text: msgText.slice(0, 100) });
      }
    }

    // Events sur les changements (commentaires)
    for (const change of entry.changes || []) {
      if (change.field !== 'comments') continue;

      const value = change.value;
      const commentId = value?.id;
      const commentText = value?.text || '';
      const mediaId = value?.media?.id || null;
      const mediaPermalink = value?.media?.permalink || null;
      const commenterId = value?.from?.id ? String(value.from.id) : null;
      const commenterUsername = value?.from?.username || null;
      const timestamp = value?.timestamp
        ? new Date(value.timestamp * 1000).toISOString()
        : new Date().toISOString();

      debugLog('change comments', { commentId, mediaId, commenterUsername, text: commentText });

      if (!commentId || !commentText) continue;
      if (!commenterUsername) {
        console.warn('[IG Webhook] Commentaire sans username (compte supprimé/privé), ignoré:', commentId);
        continue;
      }

      pushEvent({ type: 'comment_received', commentId, commentText, commenterUsername, mediaId, timestamp });

      const integ = resolvedMatch || null;

      if (!integ) {
        pushEvent({ type: 'error', reason: 'profil_non_trouve', igAccountId });
        continue;
      }

      const { profile_id, access_token } = integ;
      pushEvent({ type: 'debug_profile_found', profile_id });

      // Filtre strict : cherche un content_link sur CE post précis avec un keyword qui matche
      // On ne fallback JAMAIS sur un autre post — chaque post a son propre LM
      if (!mediaId) {
        pushEvent({ type: 'error', reason: 'media_id_manquant', commentId });
        continue;
      }

      const { data: contentLinks } = await serviceSupabase
        .from('content_links')
        .select('lm_keyword, lm_short_url, lm_url, dm_opener_message, dm_lm_message, dm_button_text')
        .eq('profile_id', profile_id)
        .eq('content_id', mediaId)
        .not('lm_keyword', 'is', null)
        .not('lm_short_url', 'is', null);

      const cls = contentLinks || [];
      pushEvent({ type: 'debug_content_links', mediaId, count: cls.length, keywords: cls.map((c: any) => c.lm_keyword) });

      if (cls.length === 0) {
        pushEvent({ type: 'no_lm_on_this_post', mediaId });
        continue;
      }

      // Cherche le content_link dont le keyword matche le commentaire — insensible à la
      // casse ET aux accents ("Méta" doit matcher le mot-clé "Meta" configuré par le
      // coach, demande explicite de Chris le 2026-07-30).
      const text = normalizeForKeywordMatch(commentText);
      const cl = cls.find((c: any) => text.includes(normalizeForKeywordMatch(c.lm_keyword)));

      if (!cl) {
        pushEvent({ type: 'keyword_no_match', text, available: cls.map((c: any) => c.lm_keyword) });
        continue;
      }

      const matchedKeyword = cl.lm_keyword;
      console.log(`[IG Webhook] Mot-clé "${matchedKeyword}" matché sur post ${mediaId} — @${commenterUsername}`);
      pushEvent({ type: 'keyword_matched', keyword: matchedKeyword, commenterUsername, mediaId });

      // Cooldown 1 min : si on a déjà envoyé ce LM à cet utilisateur dans la dernière minute, skip
      if (commenterId) {
        const cooldownCutoff = new Date(Date.now() - 60 * 1000).toISOString();
        const { data: recentDm } = await serviceSupabase
          .from('instagram_lead_lm_history')
          .select('id')
          .eq('ig_user_id', commenterId)
          .eq('keyword_matched', matchedKeyword)
          .eq('profile_id', profile_id)
          .gte('detected_at', cooldownCutoff)
          .limit(1)
          .maybeSingle();
        if (recentDm) {
          pushEvent({ type: 'cooldown_skip', commenterUsername, keyword: matchedKeyword });
          continue;
        }
      }

      // Verrou anti-course : Meta envoie parfois 2 notifications webhook quasi simultanées
      // pour le même commentaire (double delivery), avec un detected_at parfois légèrement
      // différent — le cooldown ci-dessus ne suffit pas seul car il lit avant que l'écriture
      // finale (instagram_lead_lm_history, en fin de traitement) n'ait eu lieu. Cet INSERT est
      // atomique : si une requête concurrente a déjà posé le verrou dans les 2 dernières
      // minutes, celle-ci échoue sur la contrainte UNIQUE et on skip tout le traitement (Short.io,
      // envoi DM1, etc).
      if (commenterId) {
        const lockCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        await serviceSupabase
          .from('ig_comment_processing_lock')
          .delete()
          .eq('profile_id', profile_id)
          .eq('ig_user_id', commenterId)
          .eq('media_id', mediaId)
          .lt('locked_at', lockCutoff);

        const { error: lockError } = await serviceSupabase
          .from('ig_comment_processing_lock')
          .insert({ profile_id, ig_user_id: commenterId, media_id: mediaId });

        if (lockError) {
          pushEvent({ type: 'concurrent_processing_skip', commenterUsername, keyword: matchedKeyword });
          continue;
        }
      }

      let leadMagnetSent = false;

      // Le lien Short.io personnalisé n'est PLUS créé ici.
      //
      // Il n'est envoyé qu'en DM2, c'est-à-dire uniquement aux prospects qui ont
      // cliqué sur le bouton du DM1 — or seuls 30 à 50 % cliquent. Le créer dès le
      // commentaire gaspillait la moitié à deux tiers du quota Short.io (plafond
      // d'automation : 1 000 liens/an en gratuit, 10 000/an en Pro — un seul post
      // viral consommait l'année entière) et ajoutait un appel réseau au chemin
      // critique du webhook, celui qui doit répondre à Meta en moins de 30 s sous
      // peine de désabonnement.
      //
      // La création est reportée au clic (bloc LM_LINK_CLICKED, voir
      // createProspectLmLink). `shortLink` reste le lien générique : il sert de
      // repli si la création échoue, et de valeur affichée en attendant le clic.
      const shortLink = cl.lm_short_url;

      // DM1 : accroche SANS le lien — on retire {{lien_lm}} et on nettoie les espaces doubles
      const rawDm1 = cl.dm_lm_message || `👋 Clique sur le bouton pour recevoir le lien !`;
      const dm1Text = rawDm1
        .replace(/\{\{lien_lm\}\}/gi, '')
        .replace(/{{username}}/gi, `@${commenterUsername || 'toi'}`)
        .replace(/\s{2,}/g, ' ')
        .trim();

      // DM2 : le lien seul — stocké en DB, envoyé après clic Quick Reply
      const dm2Text = shortLink;

      // DM3 : message d'ouverture de discussion — stocké en DB, envoyé juste après DM2
      const dm3Text = (cl.dm_opener_message || '').replace(/{{username}}/gi, `@${commenterUsername || 'toi'}`).trim();

      // Texte du bouton Quick Reply — configurable par contenu
      const buttonText = (cl.dm_button_text || '🚀 Je veux le lien !').slice(0, 20);

      pushEvent({ type: 'lm_found', lmShortUrl: shortLink, dm1Text, dm2Text, dm3Text, mediaId });

      // Envoie DM 1 via private reply sur le commentaire
      // Test : generic template (attachment) au lieu de quick_replies — quick_replies ne
      // s'affichait jamais côté client sur un envoi via recipient.comment_id (private reply).
      // Le bouton postback force l'utilisateur à cliquer pour ouvrir la fenêtre 24h Meta.
      // Sans ce clic, le message reste en "Demandes" sans notification push
      const dm1Res = await fetch(
        `https://graph.instagram.com/v21.0/${canonicalIgAccountId ?? igAccountId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { comment_id: commentId },
            messaging_type: 'RESPONSE',
            message: {
              attachment: {
                type: 'template',
                payload: {
                  template_type: 'generic',
                  elements: [
                    {
                      title: dm1Text.slice(0, 80),
                      buttons: [
                        {
                          type: 'postback',
                          title: buttonText,
                          payload: 'LM_LINK_CLICKED',
                        },
                      ],
                    },
                  ],
                },
              },
            },
            access_token,
          }),
        }
      );
      const dm1Data = await dm1Res.json();

      if (dm1Data.error) {
        console.error(`[IG Webhook] Erreur DM1 :`, dm1Data.error);
        pushEvent({ type: 'dm1_error', error: dm1Data.error, commenterUsername });
      } else {
        leadMagnetSent = true;
        console.log(`[IG Webhook] DM1 envoyé (avec QR button) — message_id: ${dm1Data.message_id}`);
        pushEvent({ type: 'dm1_sent', message_id: dm1Data.message_id, commenterUsername });
        // DM2 sera envoyé quand l'utilisateur clique le bouton Quick Reply (LM_LINK_CLICKED)
      }

      // Upsert lead — 1 seule row par prospect (profile_id, ig_user_id)
      // On met à jour le keyword/media/lm si le prospect revient pour un autre LM, mais
      // detected_at ne doit JAMAIS être réécrit sur un lead existant : c'est la date de
      // première détection utilisée pour dériver l'étape du pipeline (natural) et pour
      // classer le lead au bon jour dans les stats — un commentaire répété (même mot-clé,
      // autre post) ne doit ni faire reculer le pipeline ni reclasser le lead à aujourd'hui.
      // Les commentaires répétés restent tracés via instagram_lead_lm_history plus bas.
      const { data: existingLead } = await serviceSupabase
        .from('instagram_leads')
        .select('id, detected_at')
        .eq('profile_id', profile_id)
        .eq('ig_user_id', commenterId)
        .maybeSingle();

      const { data: upsertedLead } = await serviceSupabase
        .from('instagram_leads')
        .upsert({
          profile_id,
          source: 'comment',
          ig_username: commenterUsername,
          ig_user_id: commenterId,
          message: commentText.slice(0, 500),
          media_id: mediaId || commentId,
          media_permalink: mediaPermalink,
          keyword_matched: matchedKeyword,
          detected_at: existingLead?.detected_at ?? timestamp,
          lead_magnet_sent: leadMagnetSent,
          tracking_link: shortLink || null,
          pending_dm2: dm2Text || null,
          pending_dm3: dm3Text || null,
          // Conservés pour créer le lien Short.io personnalisé AU CLIC du DM1
          // (voir createProspectLmLink). content_id retrouve la bonne ligne
          // content_links ; media_id alimente utm_content et doit être figé
          // maintenant — au moment du clic, on ne saurait plus d'où vient le lead.
          pending_lm_content_id: mediaId,
          pending_lm_media_id: mediaId,
          ig_account_id: canonicalIgAccountId,
        }, { onConflict: 'profile_id,ig_user_id', ignoreDuplicates: false })
        .select('id')
        .maybeSingle();

      // Fetch et stocke l'avatar de façon permanente (fire-and-forget)
      if (upsertedLead?.id && commenterId) {
        const igInteg = await serviceSupabase
          .from('integrations')
          .select('access_token')
          .eq('profile_id', profile_id)
          .eq('provider', 'instagram')
          .maybeSingle();
        if (igInteg.data?.access_token) {
          fetchAndStoreAvatar(commenterId, igInteg.data.access_token).then(avatarUrl => {
            if (avatarUrl) {
              serviceSupabase.from('instagram_leads')
                .update({ avatar_url: avatarUrl })
                .eq('id', upsertedLead.id)
                .then();
            }
          });
        }
      }

      // Enregistre l'événement lm_sent dans prospect_events (index partiel = idempotent)
      if (upsertedLead?.id && commenterUsername) {
        serviceSupabase.from('prospect_events').insert({
          profile_id,
          prospect_key:  commenterUsername.toLowerCase(),
          platform:      'ig',
          event_type:    'lm_sent',
          occurred_at:   timestamp,
          ig_lead_id:    upsertedLead.id,
        }).then(({ error: evtErr }) => {
          if (evtErr && !evtErr.message.includes('duplicate')) {
            console.error('[IG Webhook] prospect_events lm_sent:', evtErr.message);
          }
        });
      }

      // Historique LM : stocke chaque interaction — idempotent via UNIQUE constraint sur
      // comment_id (identifiant Meta stable), pas detected_at (peut différer légèrement
      // entre ce webhook et le cron pollIgComments fallback qui traite parfois le même
      // commentaire — voir commentaire détaillé dans supabase/functions/poll-leads/index.ts).
      // ignoreDuplicates SEULEMENT si ce webhook a échoué à envoyer (leadMagnetSent=false)
      // — un true ne doit jamais écraser un false du cron déjà en base par erreur, mais
      // dans le cas rare où le cron aurait écrit sa ligne AVANT ce webhook, un true réel
      // doit pouvoir mettre à jour cette ligne existante (sinon le badge "réclamé" reste
      // bloqué à false malgré un DM1 réellement envoyé).
      if (commenterId) {
        const { error: lmHistoryError } = await serviceSupabase
          .from('instagram_lead_lm_history')
          .upsert({
            profile_id,
            ig_username: commenterUsername || '',
            ig_user_id: commenterId,
            keyword_matched: matchedKeyword,
            media_id: mediaId || commentId,
            lm_url: shortLink || null,
            lead_magnet_sent: leadMagnetSent,
            detected_at: timestamp,
            comment_id: commentId || null,
            ig_account_id: canonicalIgAccountId,
          }, { onConflict: 'profile_id,ig_user_id,media_id,comment_id', ignoreDuplicates: !leadMagnetSent });
        // Ne jamais laisser cette erreur silencieuse — un upsert cassé ici (ex: contrainte
        // DB incompatible avec onConflict) n'empêche pas le DM1 de partir ni "Lead stocké"
        // de s'afficher plus bas, donc invisible sans ce log explicite (bug vécu 2026-08-13,
        // voir migration 20260813000000_add_lm_history_comment_id.sql).
        if (lmHistoryError) console.error('[IG Webhook] instagram_lead_lm_history upsert:', lmHistoryError.message);
      }

      console.log(`[IG Webhook] Lead stocké — @${commenterUsername}, mot-clé: ${matchedKeyword}`);
      pushEvent({ type: 'lead_stored', commenterUsername, keyword: matchedKeyword, leadMagnetSent });
    }
  }
  } catch (err: any) {
    console.error('[IG Webhook] Erreur de traitement:', err);
    debugLog('Erreur non gérée', { message: err?.message, stack: err?.stack });
    // RELANCÉE, contrairement au comportement d'origine qui l'avalait pour
    // renvoyer 200 à Meta. Meta n'attend plus cette réponse (le 200 part dès la
    // mise en file), donc l'erreur doit remonter au worker pour qu'il marque
    // l'événement en échec et le réessaie. L'avaler ferait passer un échec pour
    // un succès, et le commentaire serait perdu définitivement — Meta n'autorise
    // qu'un private reply par commentaire.
    throw err;
  }
}
