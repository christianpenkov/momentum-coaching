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

      // Vérifie si ce lead existe déjà (anti-doublon)
      const { data: existing } = await serviceSupabase
        .from('instagram_leads')
        .select('id')
        .eq('profile_id', profile_id)
        .eq('source', 'comment')
        .eq('ig_user_id', commenterId || '')
        .eq('keyword_matched', matchedKeyword)
        .eq('media_id', mediaId || commentId)
        .maybeSingle();

      if (existing) {
        console.log(`[IG Webhook] Lead déjà existant — skip`);
        pushEvent({ type: 'duplicate_skipped', commenterUsername, keyword: matchedKeyword });
        continue;
      }

      let leadMagnetSent = false;

      // Envoie le private reply (DM 1 — lead magnet)
      const dm1Res = await fetch(
        `https://graph.instagram.com/v21.0/${igAccountId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { comment_id: commentId },
            message: { text: '👋 Voici ton lead magnet gratuit : [lien] — profites-en bien !' },
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
        pushEvent({ type: 'dm1_sent', message_id: dm1Data.message_id, commenterUsername, text: '👋 Voici ton lead magnet gratuit : [lien]' });

        // Envoie la question d'ouverture (DM 2)
        if (commenterId) {
          const convRes = await fetch(
            `https://graph.instagram.com/v21.0/${igAccountId}/conversations?user_id=${commenterId}&fields=id&access_token=${access_token}`
          );
          const convData = await convRes.json();
          const conversationId = convData?.data?.[0]?.id;

          if (conversationId) {
            const dm2Res = await fetch(
              `https://graph.instagram.com/v21.0/${igAccountId}/messages`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  recipient: { conversation_id: conversationId },
                  message: { text: "C'est quoi ton objectif principal en ce moment ? 🎯" },
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
              pushEvent({ type: 'dm2_sent', message_id: dm2Data.message_id, commenterUsername, text: "C'est quoi ton objectif principal en ce moment ? 🎯" });
            }
          } else {
            pushEvent({ type: 'dm2_skipped', reason: 'conversation_id non trouvé', commenterUsername });
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
        });

      console.log(`[IG Webhook] Lead stocké — @${commenterUsername}, mot-clé: ${matchedKeyword}`);
      pushEvent({ type: 'lead_stored', commenterUsername, keyword: matchedKeyword, leadMagnetSent });
    }
  }

  // Meta exige toujours un 200 immédiat
  return NextResponse.json({ received: true });
}
