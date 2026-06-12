import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { pushEvent } from '@/app/api/instagram/webhook-stream/route';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN!;
const APP_SECRET = process.env.INSTAGRAM_CLIENT_SECRET!;

function sanitizeInstagramUsername(raw: string): string {
  return raw.toLowerCase().trim().replace(/^@/, '').replace(/\s+/g, '').replace(/[^a-z0-9._]/g, '');
}

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

// Vérifie la signature Meta pour sécuriser le webhook
function verifySignature(body: string, signature: string | null): boolean {
  if (!signature || !APP_SECRET) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', APP_SECRET)
    .update(body)
    .digest('hex');
  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch { return false; }
}

// GET — handshake de vérification Meta
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[IG Webhook] Vérification réussie');
    return new Response(challenge, { status: 200 });
  }

  return new Response('Verification failed', { status: 403 });
}

// POST — events entrants Meta
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  // Signature obligatoire en prod — si APP_SECRET manque, on rejette pour éviter des DMs forgés
  if (!APP_SECRET) {
    console.error('[IG Webhook] APP_SECRET manquant — rejet');
    return NextResponse.json({ error: 'Configuration manquante' }, { status: 500 });
  }
  if (!verifySignature(rawBody, signature)) {
    console.error('[IG Webhook] Signature invalide');
    return NextResponse.json({ error: 'Signature invalide' }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  // Meta envoie un tableau d'entries — try/catch global pour toujours retourner 200
  const entries = body?.entry || [];
  try {

  // Charge tous les comptes IG une seule fois pour tous les entries
  const { data: allIg } = await serviceSupabase
    .from('integrations')
    .select('profile_id, access_token, metadata')
    .eq('provider', 'instagram');

  for (const entry of entries) {
    const igAccountId = String(entry.id);
    // Trouve le profil par ig_account_id d'abord
    let resolvedMatch: any = (allIg || []).find((r: any) =>
      String(r.metadata?.ig_account_id) === igAccountId
    ) || null;

    // Si pas de match direct : Meta envoie un page_id différent de l'ig_account_id
    // On teste chaque token pour trouver lequel appartient à ce compte
    if (!resolvedMatch) {
      for (const r of (allIg || [])) {
        try {
          const checkRes = await fetch(
            `https://graph.instagram.com/v21.0/${r.metadata?.ig_account_id}?fields=id&access_token=${r.access_token}`
          );
          const checkData = await checkRes.json();
          if (checkData.id && !checkData.error) {
            resolvedMatch = r;
            break;
          }
        } catch {}
      }
    }

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
        if (!matchedLink) { continue; }

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
        await serviceSupabase.from('prospect_events').insert({
          profile_id:       pid,
          prospect_key:     matchedLink.ig_username,
          platform:         'ig',
          event_type:       'calendly_link_sent',
          occurred_at:      now,
          ig_lead_id:       igLeadId,
          prospect_link_id: matchedLink.id,
        });

        console.log(`[IG Webhook] calendly_link_sent — prospect_link: ${matchedLink.id}, url: ${matchedLink.short_url}`);
        pushEvent({ type: 'calendly_link_sent', prospect_link_id: matchedLink.id, short_url: matchedLink.short_url });
        continue;
      }

      // On ne traite que les messages REÇUS (pas nos propres envois)
      if (!senderId || !msgText) continue;

      // Le sender est le prospect — cherche un lead avec cet ig_user_id
      // qui a reçu le LM (lead_magnet_sent = true) et n'a pas encore répondu

      const { data: leadToUpdate } = await serviceSupabase
        .from('instagram_leads')
        .select('id, hook_replied')
        .eq('profile_id', pid)
        .eq('ig_user_id', senderId)
        .eq('lead_magnet_sent', true)
        .eq('hook_replied', false)
        .order('detected_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (leadToUpdate) {
        const hookRepliedAt = new Date().toISOString();
        await serviceSupabase
          .from('instagram_leads')
          .update({
            hook_replied: true,
            hook_reply_text: msgText.slice(0, 500),
            hook_replied_at: hookRepliedAt,
          })
          .eq('id', leadToUpdate.id);

        // Récupère ig_username pour prospect_key
        const { data: leadFull } = await serviceSupabase
          .from('instagram_leads').select('ig_username').eq('id', leadToUpdate.id).single();
        if (leadFull?.ig_username) {
          serviceSupabase.from('prospect_events').insert({
            profile_id:  pid,
            prospect_key: leadFull.ig_username.toLowerCase(),
            platform:    'ig',
            event_type:  'hook_replied',
            occurred_at: hookRepliedAt,
            ig_lead_id:  leadToUpdate.id,
          }).then(({ error: evtErr }) => {
            if (evtErr && !evtErr.message.includes('duplicate')) {
              console.error('[IG Webhook] prospect_events hook_replied:', evtErr.message);
            }
          });
        }

        console.log(`[IG Webhook] hook_replied=true — ig_user_id: ${senderId}, lead: ${leadToUpdate.id}, reply: "${msgText.slice(0, 50)}"`);
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

      if (!commentId || !commentText) continue;

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
        .select('lm_keyword, lm_short_url, lm_url, dm_opener_message, dm_lm_message')
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

      // Cherche le content_link dont le keyword matche le commentaire
      const text = commentText.toLowerCase().trim();
      const cl = cls.find((c: any) => text.includes(c.lm_keyword.toLowerCase()));

      if (!cl) {
        pushEvent({ type: 'keyword_no_match', text, available: cls.map((c: any) => c.lm_keyword) });
        continue;
      }

      const matchedKeyword = cl.lm_keyword;
      console.log(`[IG Webhook] Mot-clé "${matchedKeyword}" matché sur post ${mediaId} — @${commenterUsername}`);
      pushEvent({ type: 'keyword_matched', keyword: matchedKeyword, commenterUsername, mediaId });

      let leadMagnetSent = false;

      // Génère un lien Short.io unique par (lead × post × keyword) si lm_url est disponible
      let shortLink = cl.lm_short_url;
      if (cl.lm_url && commenterUsername) {
        const cleanUsername = sanitizeInstagramUsername(commenterUsername);
        const lmPath = `lm-${cl.lm_keyword.toLowerCase().replace(/[^a-z0-9-]/g, '')}-${cleanUsername}`;
        try {
          // Appel direct Short.io — pas de fetch HTTP interne pour éviter les problèmes d'URL en prod
          const { data: shortioInteg } = await serviceSupabase
            .from('integrations')
            .select('api_key, metadata')
            .eq('profile_id', profile_id)
            .eq('provider', 'shortio')
            .single();

          if (shortioInteg?.api_key && shortioInteg?.metadata?.domain && shortioInteg?.metadata?.domain_id) {
            const apiKey = shortioInteg.api_key;
            const domain = shortioInteg.metadata.domain;
            const domainId = shortioInteg.metadata.domain_id;

            // Construit l'URL avec UTMs
            const destUrl = new URL(cl.lm_url);
            destUrl.searchParams.set('utm_source', 'ig');
            destUrl.searchParams.set('utm_medium', 'dm');
            destUrl.searchParams.set('utm_campaign', `lm-${cl.lm_keyword.toLowerCase()}`);
            destUrl.searchParams.set('utm_content', cleanUsername);

            const res = await attemptShortioCreate(apiKey, { domain, originalURL: destUrl.toString(), title: `LM — ${commenterUsername}`, path: lmPath });

            if (res.status === 409) {
              // Lien déjà existant pour ce lead → récupérer l'URL existante
              const existingRes = await fetch(
                `https://api.short.io/api/links?domain_id=${domainId}&limit=150`,
                { headers: { authorization: apiKey, accept: 'application/json' } }
              );
              const existingData = await existingRes.json().catch(() => ({}));
              const existing = (existingData?.links || []).find((l: any) => l.path === lmPath);
              if (existing) shortLink = existing.secureShortURL || existing.shortURL || shortLink;
            } else if (res.ok) {
              const data = await res.json().catch(() => ({}));
              if (data.secureShortURL || data.shortURL) shortLink = data.secureShortURL || data.shortURL;
            } else {
              console.warn('[IG Webhook] Short.io lien LM personnalisé échoué, fallback lm_short_url, status:', res.status);
            }
          }
        } catch (err) {
          console.warn('[IG Webhook] Short.io lien LM personnalisé exception, fallback lm_short_url:', err);
        }
      }

      // Construit le DM 1 : remplace {{lien_lm}} par le lien, ou utilise le message par défaut
      const rawDm1 = cl.dm_lm_message || `👋 Voici le lien comme promis ! {{lien_lm}}`;
      const dm1Text = rawDm1.replace(/\{\{lien_lm\}\}/gi, shortLink).replace(/{{username}}/gi, `@${commenterUsername || 'toi'}`);

      // Construit le DM 2
      const rawDm2 = cl.dm_opener_message || '';
      const dm2Text = rawDm2.replace(/{{username}}/gi, `@${commenterUsername || 'toi'}`).trim();

      pushEvent({ type: 'lm_found', lmShortUrl: shortLink, dm1Text, dm2Text, mediaId });

      // Envoie DM 1 via private reply sur le commentaire
      const dm1Res = await fetch(
        `https://graph.instagram.com/v21.0/${igAccountId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { comment_id: commentId },
            message: { text: dm1Text },
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
        console.log(`[IG Webhook] DM1 envoyé — message_id: ${dm1Data.message_id}`);
        pushEvent({ type: 'dm1_sent', message_id: dm1Data.message_id, commenterUsername, shortLink });

        // Envoie DM 2 seulement s'il y a un message d'ouverture configuré
        if (commenterId && dm2Text) {
          const dm2Res = await fetch(
            `https://graph.instagram.com/v21.0/${igAccountId}/messages`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recipient: { id: commenterId },
                message: { text: dm2Text },
                access_token,
              }),
            }
          );
          const dm2Data = await dm2Res.json();
          if (dm2Data.error) {
            console.error(`[IG Webhook] Erreur DM2 :`, dm2Data.error);
            pushEvent({ type: 'dm2_error', error: dm2Data.error, commenterUsername });
          } else {
            console.log(`[IG Webhook] DM2 envoyé — message_id: ${dm2Data.message_id}`);
            pushEvent({ type: 'dm2_sent', message_id: dm2Data.message_id, commenterUsername, text: dm2Text });
          }
        }
      }

      // Upsert lead — 1 seule row par prospect (profile_id, ig_user_id)
      // On met à jour le keyword/media/lm si le prospect revient pour un autre LM
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
          detected_at: timestamp,
          lead_magnet_sent: leadMagnetSent,
          tracking_link: shortLink || null,
        }, { onConflict: 'profile_id,ig_user_id', ignoreDuplicates: false })
        .select('id')
        .maybeSingle();

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

      // Historique LM : stocke chaque interaction — idempotent via UNIQUE constraint
      if (commenterId) {
        await serviceSupabase
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
          }, { onConflict: 'profile_id,ig_user_id,media_id,detected_at', ignoreDuplicates: true });
      }

      console.log(`[IG Webhook] Lead stocké — @${commenterUsername}, mot-clé: ${matchedKeyword}`);
      pushEvent({ type: 'lead_stored', commenterUsername, keyword: matchedKeyword, leadMagnetSent });
    }
  }
  } catch (err) {
    console.error('[IG Webhook] Erreur non gérée — Meta recevra quand même 200:', err);
  }

  // Meta exige toujours un 200 immédiat
  return NextResponse.json({ received: true });
}
