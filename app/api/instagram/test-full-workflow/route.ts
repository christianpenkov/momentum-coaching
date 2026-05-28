import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const KEYWORD = 'ok';

// GET /api/instagram/test-full-workflow
// Workflow complet :
// 1. Récupère le dernier post IG
// 2. Scan les commentaires → cherche le mot-clé "OK"
// 3. Pour chaque commentaire matchant → envoie private reply (LM) + DM suivi (question)
// 4. Stocke le lead en DB
export async function GET() {
  const steps: any[] = [];

  // Récupère l'utilisateur connecté et son token IG depuis la DB
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, metadata')
    .eq('profile_id', user.id)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) {
    return NextResponse.json({ error: 'Compte Instagram non connecté sur ce profil' }, { status: 404 });
  }

  const TOKEN = integ.access_token;
  const IG_ID = (integ.metadata as any)?.ig_account_id;

  if (!IG_ID) {
    return NextResponse.json({ error: 'ig_account_id manquant dans les métadonnées de l\'intégration' }, { status: 404 });
  }

  steps.push({ step: 0, action: `Compte IG connecté — ig_account_id: ${IG_ID}` });

  // ÉTAPE 1 — Récupère le dernier post
  steps.push({ step: 1, action: 'Récupération du dernier post IG' });
  const mediaRes = await fetch(
    `https://graph.instagram.com/v21.0/${IG_ID}/media?fields=id,permalink,timestamp,caption&limit=1&access_token=${TOKEN}`
  );
  const mediaData = await mediaRes.json();

  if (mediaData.error) {
    return NextResponse.json({ steps, error: 'Impossible de récupérer les posts', detail: mediaData.error }, { status: 400 });
  }

  const post = mediaData?.data?.[0];
  if (!post) {
    return NextResponse.json({ steps, error: 'Aucun post trouvé sur ce compte' }, { status: 404 });
  }

  steps.push({ step: 1, result: { postId: post.id, permalink: post.permalink, timestamp: post.timestamp } });

  // ÉTAPE 2 — Récupère les commentaires du dernier post
  steps.push({ step: 2, action: `Scan des commentaires sur le post ${post.id}` });
  const commRes = await fetch(
    `https://graph.instagram.com/v21.0/${post.id}/comments?fields=id,text,timestamp,from,username&limit=50&access_token=${TOKEN}`
  );
  const commData = await commRes.json();

  if (commData.error) {
    return NextResponse.json({ steps, error: 'Impossible de récupérer les commentaires', detail: commData.error }, { status: 400 });
  }

  const comments = commData?.data || [];
  steps.push({ step: 2, result: { totalComments: comments.length, comments: comments.map((c: any) => ({ id: c.id, text: c.text, from: c.from?.username || c.username })) } });

  // ÉTAPE 3 — Filtre les commentaires avec le mot-clé
  const matching = comments.filter((c: any) => c.text?.toLowerCase().includes(KEYWORD));
  steps.push({ step: 3, action: `Filtrage mot-clé "${KEYWORD}"`, result: { matchingCount: matching.length } });

  if (matching.length === 0) {
    return NextResponse.json({
      steps,
      success: false,
      message: `Aucun commentaire contenant "${KEYWORD}" trouvé sur le dernier post. Poste le commentaire puis rappelle cette route.`,
    });
  }

  const results: any[] = [];

  for (const comment of matching) {
    const commentId = comment.id;
    const commenterUsername = comment.from?.username || comment.username || 'inconnu';
    const commenterId = comment.from?.id ? String(comment.from.id) : null;

    const commentResult: any = { commentId, commenterUsername, commenterId };

    // ÉTAPE 4 — Envoie le private reply (DM 1 = lead magnet)
    steps.push({ step: 4, action: `Private reply → @${commenterUsername} (comment ${commentId})` });
    const dm1Res = await fetch(
      `https://graph.instagram.com/v21.0/${IG_ID}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { comment_id: commentId },
          message: { text: '👋 Voici ton lead magnet gratuit : [lien test] — profites-en bien !' },
          access_token: TOKEN,
        }),
      }
    );
    const dm1Data = await dm1Res.json();
    commentResult.dm1 = dm1Data;
    steps.push({ step: 4, result: dm1Data });

    // ÉTAPE 5 — Envoie la question d'ouverture (DM 2) via conversation_id
    if (!dm1Data.error) {
      steps.push({ step: 5, action: `Question d'ouverture → @${commenterUsername}` });

      // Récupère la conversation ouverte avec cette personne
      let conversationId: string | null = null;

      if (commenterId) {
        const convRes = await fetch(
          `https://graph.instagram.com/v21.0/${IG_ID}/conversations?user_id=${commenterId}&fields=id&access_token=${TOKEN}`
        );
        const convData = await convRes.json();
        conversationId = convData?.data?.[0]?.id || null;
      }

      if (conversationId) {
        const dm2Res = await fetch(
          `https://graph.instagram.com/v21.0/${IG_ID}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipient: { conversation_id: conversationId },
              message: { text: "C'est quoi ton objectif principal en ce moment ? 🎯" },
              access_token: TOKEN,
            }),
          }
        );
        const dm2Data = await dm2Res.json();
        commentResult.dm2 = dm2Data;
        steps.push({ step: 5, result: dm2Data });
      } else {
        commentResult.dm2 = { skipped: 'conversation_id non trouvé — DM 2 non envoyé' };
        steps.push({ step: 5, result: commentResult.dm2 });
      }
    }

    // ÉTAPE 6 — Stocke le lead en DB
    steps.push({ step: 6, action: `Stockage lead @${commenterUsername} en DB` });
    const { error: dbError } = await serviceSupabase
      .from('instagram_leads')
      .upsert({
        profile_id: user.id,
        source: 'comment',
        ig_username: commenterUsername,
        ig_user_id: commenterId,
        message: comment.text?.slice(0, 500) || null,
        media_id: post.id,
        media_permalink: post.permalink || null,
        keyword_matched: KEYWORD,
        detected_at: new Date(comment.timestamp).toISOString(),
        lead_magnet_sent: !dm1Data.error,
      }, { onConflict: 'profile_id,source,ig_user_id,keyword_matched,media_id', ignoreDuplicates: true });

    commentResult.dbStored = !dbError;
    commentResult.dbError = dbError?.message || null;
    steps.push({ step: 6, result: { stored: !dbError, error: dbError?.message } });

    results.push(commentResult);
  }

  return NextResponse.json({
    success: true,
    post: { id: post.id, permalink: post.permalink },
    keywordMatched: KEYWORD,
    leadsProcessed: results.length,
    steps,
    results,
  });
}
