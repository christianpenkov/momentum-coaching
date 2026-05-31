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

  for (const entry of entries) {
    const igAccountId = entry.id;

    // Events sur les changements (commentaires, mentions, etc.)
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

      // Log temps réel — event brut reçu
      pushEvent({ type: 'comment_received', commentId, commentText, commenterUsername, mediaId, timestamp });

      // Trouve le profil qui possède ce compte IG
      const { data: integ } = await serviceSupabase
        .from('integrations')
        .select('profile_id, access_token')
        .eq('provider', 'instagram')
        .contains('metadata', { ig_account_id: igAccountId })
        .single();

      if (!integ) {
        pushEvent({ type: 'error', reason: 'profil_non_trouve', igAccountId });
        continue;
      }

      const { profile_id, access_token } = integ;
      pushEvent({ type: 'debug_profile_found', profile_id });

      // Récupère les mots-clés configurés pour ce profil
      const { data: keywordRows } = await serviceSupabase
        .from('lead_magnet_keywords')
        .select('keyword')
        .eq('profile_id', profile_id);

      const keywords = (keywordRows || []).map((r: any) => r.keyword.toLowerCase());
      pushEvent({ type: 'debug_keywords', keywords, commentText, commentTextLower: commentText.toLowerCase() });

      if (keywords.length === 0) {
        pushEvent({ type: 'error', reason: 'aucun_mot_cle_configure', profile_id });
        continue;
      }

      // Vérifie si le commentaire contient un mot-clé
      const text = commentText.toLowerCase();
      const matchedKeyword = keywords.find((kw: string) => text.includes(kw));
      pushEvent({ type: 'debug_keyword_check', text, keywords, matchedKeyword: matchedKeyword || null });
      if (!matchedKeyword) continue;

      console.log(`[IG Webhook] Mot-clé "${matchedKeyword}" détecté — @${commenterUsername} sur media ${mediaId}`);
      pushEvent({ type: 'keyword_matched', keyword: matchedKeyword, commenterUsername, mediaId });


      let leadMagnetSent = false;
      let shortLink: string | null = null;

      // Source de vérité : content_links — stocke lm_short_url + dm_opener_message par post
      // Cherche d'abord par media_id + keyword, puis fallback par keyword seul
      const { data: contentLinkExact } = await serviceSupabase
        .from('content_links')
        .select('lm_short_url, dm_opener_message, dm_lm_message')
        .eq('profile_id', profile_id)
        .eq('content_id', mediaId || '')
        .ilike('lm_keyword', matchedKeyword)
        .maybeSingle();

      const { data: contentLinkFallback } = !contentLinkExact ? await serviceSupabase
        .from('content_links')
        .select('lm_short_url, dm_opener_message, dm_lm_message')
        .eq('profile_id', profile_id)
        .ilike('lm_keyword', matchedKeyword)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle() : { data: null };

      const cl = contentLinkExact || contentLinkFallback;

      if (!cl?.lm_short_url) {
        pushEvent({ type: 'lm_not_found_no_dm', matchedKeyword, mediaId });
      } else {
        shortLink = cl.lm_short_url;
        const rawOpener = cl.dm_opener_message || "C'est quoi ton objectif principal en ce moment ?";
        const dmOpener = rawOpener.replace(/{{username}}/gi, `@${commenterUsername || 'toi'}`);
        pushEvent({ type: 'lm_found', lmShortUrl: shortLink, dmOpener, mediaId });

        // Envoie le private reply (DM 1 — lien LM pré-généré)
        const dm1Res = await fetch(
          `https://graph.instagram.com/v21.0/${igAccountId}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipient: { comment_id: commentId },
              message: { text: cl.dm_lm_message ? cl.dm_lm_message.replace(/{{username}}/gi, `@${commenterUsername || 'toi'}`) + ` ${shortLink}` : `👋 Voici le lien comme promis ! ${shortLink}` },
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

          // Envoie le DM opener (DM 2) — message configuré sur le contenu
          if (commenterId) {
            const dm2Res = await fetch(
              `https://graph.instagram.com/v21.0/${igAccountId}/messages`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  recipient: { id: commenterId },
                  message: { text: dmOpener },
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
              pushEvent({ type: 'dm2_sent', message_id: dm2Data.message_id, commenterUsername, text: dmOpener });
            }
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
