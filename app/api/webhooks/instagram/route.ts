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
        // Cherche TOUS les prospect_links (peu importe si déjà envoyé) pour matcher l'URL
        const { data: prospectLinks } = await serviceSupabase
          .from('prospect_links')
          .select('id, short_url, ig_username, ig_lead_id, calendly_link_sent')
          .eq('profile_id', pid);

        const now = new Date().toISOString();
        for (const pl of prospectLinks || []) {
          if (pl.short_url && msgText.includes(pl.short_url)) {
            // Met à jour calendly_link_sent (idempotent si déjà true)
            await serviceSupabase
              .from('prospect_links')
              .update({ calendly_link_sent: true, calendly_link_sent_at: now })
              .eq('id', pl.id);

            // Efface l'override pipeline → le signal reprend la main
            await serviceSupabase
              .from('pipeline_overrides')
              .delete()
              .eq('profile_id', pid)
              .eq('prospect_key', pl.ig_username)
              .eq('platform', 'ig');

            // Insère l'événement dans prospect_events
            await serviceSupabase.from('prospect_events').insert({
              profile_id:       pid,
              prospect_key:     pl.ig_username,
              platform:         'ig',
              event_type:       'calendly_link_sent',
              occurred_at:      now,
              ig_lead_id:       pl.ig_lead_id ?? null,
              prospect_link_id: pl.id,
            });

            console.log(`[IG Webhook] calendly_link_sent — prospect_link: ${pl.id}, url: ${pl.short_url}`);
            pushEvent({ type: 'calendly_link_sent', prospect_link_id: pl.id, short_url: pl.short_url });
            break;
          }
        }
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
        await serviceSupabase
          .from('instagram_leads')
          .update({
            hook_replied: true,
            hook_reply_text: msgText.slice(0, 500),
            hook_replied_at: new Date().toISOString(),
          })
          .eq('id', leadToUpdate.id);

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
        .select('lm_keyword, lm_short_url, dm_opener_message, dm_lm_message')
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
      const shortLink = cl.lm_short_url;

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
