import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getToken(profileId: string): Promise<{ token: string; igAccountId: string } | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) return null;
  const igAccountId = (integ.metadata as any)?.ig_account_id || null;
  if (!igAccountId) return null;
  return { token: integ.access_token, igAccountId };
}

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');

  let targetProfileId = user.id;
  if (profileId && profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetProfileId = profileId;
  }

  const creds = await getToken(targetProfileId);
  if (!creds) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const { token, igAccountId } = creds;

  // Récupère les conversations (threads) — limite 20
  const threadsRes = await fetch(
    `https://graph.instagram.com/v21.0/${igAccountId}/conversations?fields=id,updated_time,participants,message_count&limit=50&access_token=${token}`
  );
  const threadsData = await threadsRes.json();

  if (threadsData.error) {
    return NextResponse.json({ error: threadsData.error.message, code: threadsData.error.code }, { status: 400 });
  }

  const threads = threadsData?.data || [];
  const since30d = Date.now() - 30 * 24 * 60 * 60 * 1000;

  // Pour chaque thread récent, récupère les messages
  const recentThreads = threads.filter((t: any) =>
    new Date(t.updated_time).getTime() > since30d
  );

  const threadsWithMessages = await Promise.all(
    recentThreads.slice(0, 20).map(async (thread: any) => {
      const msgRes = await fetch(
        `https://graph.instagram.com/v21.0/${thread.id}/messages?fields=id,message,from,created_time&limit=20&access_token=${token}`
      );
      const msgData = await msgRes.json();
      const messages = msgData?.data || [];

      // L'API retourne du plus récent au plus ancien
      // Identifie l'expéditeur du premier message reçu (le plus ancien = dernier dans le tableau)
      const oldestMsg = messages[messages.length - 1];
      const firstSenderId = oldestMsg?.from?.id;
      // On a répondu si au moins un message vient d'un ID différent du premier expéditeur
      const hasReply = messages.some((m: any) => m.from?.id && m.from.id !== firstSenderId);
      // Premier message incoming = le plus ancien
      const firstIncoming = oldestMsg;

      return {
        threadId: thread.id,
        updatedAt: thread.updated_time,
        messageCount: thread.message_count || messages.length,
        hasReply,
        firstMessage: firstIncoming?.message || null,
        participant: thread.participants?.data?.find((p: any) => p.id !== igAccountId)?.username || thread.participants?.data?.find((p: any) => p.id !== igAccountId)?.name || 'Inconnu',
      };
    })
  );

  // Calcul des stats
  const totalThreads30d = threadsWithMessages.length;
  const repliedThreads = threadsWithMessages.filter(t => t.hasReply).length;
  const responseRate = totalThreads30d > 0 ? Math.round((repliedThreads / totalThreads30d) * 100) : 0;

  // Détection de mots-clés leads dans les premiers messages
  const LEAD_KEYWORDS = ['os', 'info', 'prix', 'tarif', 'intéressé', 'interested', 'programme', 'offre', 'dispo', 'coaching', 'accompagnement', 'comment ça marche', 'combien', 'rejoindre', 'plateforme'];
  const leadConvs = threadsWithMessages.filter(t => {
    if (!t.firstMessage) return false;
    const msg = t.firstMessage.toLowerCase();
    return LEAD_KEYWORDS.some(kw => msg.includes(kw));
  });

  // Comptage par mot-clé
  const keywordCounts: Record<string, number> = {};
  for (const t of threadsWithMessages) {
    if (!t.firstMessage) continue;
    const msg = t.firstMessage.toLowerCase();
    for (const kw of LEAD_KEYWORDS) {
      if (msg.includes(kw)) {
        keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
      }
    }
  }

  return NextResponse.json({
    totalThreads30d,
    repliedThreads,
    responseRate,
    leadCount: leadConvs.length,
    keywordCounts,
    threads: threadsWithMessages.slice(0, 10).map(t => ({
      threadId: t.threadId,
      updatedAt: t.updatedAt,
      messageCount: t.messageCount,
      hasReply: t.hasReply,
      participant: t.participant,
      preview: t.firstMessage ? t.firstMessage.slice(0, 80) : null,
      isLead: leadConvs.some(l => l.threadId === t.threadId),
    })),
  });
}
