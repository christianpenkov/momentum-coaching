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

// Génère un lien Short.io avec UTM pour tracker la source exacte
async function generateShortLink(profileId: string, igUsername: string, mediaId: string, calendlyUrl: string): Promise<string | null> {
  const { data: shortio } = await serviceSupabase
    .from('integrations')
    .select('api_key, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'shortio')
    .single();

  if (!shortio?.api_key) return null;

  const domain = (shortio.metadata as any)?.domain;
  if (!domain) return null;

  // UTM uniques par personne + par post
  const slug = `${igUsername}_${mediaId}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 50);
  const destUrl = new URL(calendlyUrl);
  destUrl.searchParams.set('utm_source', 'ig');
  destUrl.searchParams.set('utm_medium', 'dm');
  destUrl.searchParams.set('utm_campaign', slug);

  const res = await fetch('https://api.short.io/links', {
    method: 'POST',
    headers: {
      authorization: shortio.api_key,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      domain,
      originalURL: destUrl.toString(),
      title: `DM — @${igUsername}`,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  return data.secureShortURL || data.shortURL || null;
}

// Vérifie la signature Meta pour sécuriser le webhook
function verifySignature(body: string, signature: string | null): boolean {
  if (!signature || !APP_SECRET) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', APP_SECRET)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
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

  // Vérifie la signature (désactivé en mode test si APP_SECRET absent)
  if (APP_SECRET && !verifySignature(rawBody, signature)) {
    console.error('[IG Webhook] Signature invalide');
    return NextResponse.json({ error: 'Signature invalide' }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  // Meta envoie un tableau d'entries
  const entries = body?.entry || [];

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

      // Stocke le lead en DB
      await serviceSupabase
        .from('instagram_leads')
        .insert({
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
        });

      console.log(`[IG Webhook] Lead stocké — @${commenterUsername}, mot-clé: ${matchedKeyword}`);
      pushEvent({ type: 'lead_stored', commenterUsername, keyword: matchedKeyword, leadMagnetSent });
    }
  }

  // Meta exige toujours un 200 immédiat
  return NextResponse.json({ received: true });
}
