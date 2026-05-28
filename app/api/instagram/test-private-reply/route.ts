import { NextResponse } from 'next/server';

const IG_ID = process.env.INSTAGRAM_TEST_IG_ID!;
const TOKEN = process.env.INSTAGRAM_TEST_TOKEN!;

// GET /api/instagram/test-private-reply?comment_id=XXX&message=YYY
// Envoie un private reply sur un commentaire IG — teste si le DM arrive bien dans la boîte
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const commentId = searchParams.get('comment_id');
  const message = searchParams.get('message') || 'Voici ton lead magnet 👉 [lien test]';

  if (!commentId) {
    return NextResponse.json({ error: 'comment_id manquant' }, { status: 400 });
  }

  if (!IG_ID || !TOKEN) {
    return NextResponse.json({ error: 'INSTAGRAM_TEST_IG_ID ou INSTAGRAM_TEST_TOKEN manquant dans .env' }, { status: 500 });
  }

  // Étape 1 : récupère les infos du commentaire
  const commentRes = await fetch(
    `https://graph.instagram.com/v21.0/${commentId}?fields=id,text,from,timestamp&access_token=${TOKEN}`
  );
  const commentData = await commentRes.json();

  if (commentData.error) {
    return NextResponse.json({ step: 'get_comment', error: commentData.error }, { status: 400 });
  }

  // Étape 2 : envoie le private reply via Send Message API
  const replyRes = await fetch(
    `https://graph.instagram.com/v21.0/${IG_ID}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: message },
        access_token: TOKEN,
      }),
    }
  );
  const replyData = await replyRes.json();

  // Étape 3 : si succès, envoie un 2ème DM (question d'ouverture)
  let followUpData = null;
  if (!replyData.error && replyData.message_id) {
    // Récupère l'ID de la conversation depuis le premier message
    const convRes = await fetch(
      `https://graph.instagram.com/v21.0/${IG_ID}/conversations?user_id=${commentData.from?.id}&fields=id&access_token=${TOKEN}`
    );
    const convData = await convRes.json();
    const convId = convData?.data?.[0]?.id;

    if (convId) {
      const followUpRes = await fetch(
        `https://graph.instagram.com/v21.0/${IG_ID}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { conversation_id: convId },
            message: { text: "C'est quoi ton objectif principal en ce moment ?" },
            access_token: TOKEN,
          }),
        }
      );
      followUpData = await followUpRes.json();
    }
  }

  return NextResponse.json({
    comment: commentData,
    privateReply: replyData,
    followUp: followUpData,
    success: !replyData.error,
  });
}
