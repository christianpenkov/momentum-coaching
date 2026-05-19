import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Récupère le token Instagram valide pour un profil
async function getToken(profileId: string): Promise<{ token: string; igAccountId: string } | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, expires_at, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) return null;

  const needsRefresh = integ.expires_at &&
    new Date(integ.expires_at).getTime() < Date.now() + 5 * 24 * 60 * 60 * 1000;

  let token = integ.access_token;

  if (needsRefresh) {
    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`
    );
    const data = await res.json();
    if (data.access_token) {
      token = data.access_token;
      const expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null;
      await serviceSupabase.from('integrations').update({
        access_token: token,
        expires_at: expiresAt,
      }).eq('profile_id', profileId).eq('provider', 'instagram');
    }
  }

  const igAccountId = (integ.metadata as any)?.ig_account_id || null;
  if (!igAccountId) return null;
  return { token, igAccountId };
}

// Poll DMs pour un profil
async function pollDMs(profileId: string, token: string, igAccountId: string, keywords: string[], since: Date) {
  const threadsRes = await fetch(
    `https://graph.instagram.com/v21.0/${igAccountId}/conversations?fields=id,updated_time,participants,message_count&limit=50&access_token=${token}`
  );
  const threadsData = await threadsRes.json();
  if (threadsData.error) return [];

  const threads = (threadsData.data || []).filter(
    (t: any) => new Date(t.updated_time).getTime() > since.getTime()
  );

  const leads: any[] = [];

  await Promise.all(threads.map(async (thread: any) => {
    const msgRes = await fetch(
      `https://graph.instagram.com/v21.0/${thread.id}/messages?fields=id,message,from,created_time&limit=20&access_token=${token}`
    );
    const msgData = await msgRes.json();
    const messages: any[] = msgData?.data || [];

    // Cherche les messages entrants (pas du compte lui-même) qui contiennent un mot-clé
    for (const msg of messages) {
      if (!msg.message || msg.from?.id === igAccountId) continue;
      const text = msg.message.toLowerCase();
      for (const kw of keywords) {
        if (text.includes(kw)) {
          const participant = thread.participants?.data?.find((p: any) => p.id !== igAccountId);
          leads.push({
            profile_id: profileId,
            source: 'dm',
            ig_username: participant?.username || participant?.name || null,
            ig_user_id: msg.from?.id ? String(msg.from.id) : null,
            message: msg.message.slice(0, 500),
            media_id: thread.id, // thread_id comme identifiant unique pour les DMs
            media_permalink: null,
            keyword_matched: kw,
            detected_at: new Date(msg.created_time).toISOString(),
          });
          break; // un seul lead par message même si plusieurs mots-clés matchent
        }
      }
    }
  }));

  return leads;
}

// Poll commentaires pour un profil
async function pollComments(profileId: string, token: string, igAccountId: string, keywords: string[], since: Date) {
  // Récupère les 20 derniers médias
  const mediaRes = await fetch(
    `https://graph.instagram.com/v21.0/${igAccountId}/media?fields=id,permalink,timestamp&limit=20&access_token=${token}`
  );
  const mediaData = await mediaRes.json();
  if (mediaData.error) return [];

  const recentMedia = (mediaData.data || []).filter(
    (m: any) => new Date(m.timestamp).getTime() > since.getTime() - 90 * 24 * 60 * 60 * 1000 // posts des 90 derniers jours
  );

  const leads: any[] = [];

  await Promise.all(recentMedia.map(async (media: any) => {
    const commRes = await fetch(
      `https://graph.instagram.com/v21.0/${media.id}/comments?fields=id,text,timestamp,from,username&limit=50&access_token=${token}`
    );
    const commData = await commRes.json();
    if (commData.error) return;

    for (const comment of commData.data || []) {
      if (!comment.text) continue;
      if (new Date(comment.timestamp).getTime() < since.getTime()) continue;

      const text = comment.text.toLowerCase();
      for (const kw of keywords) {
        if (text.includes(kw)) {
          leads.push({
            profile_id: profileId,
            source: 'comment',
            ig_username: comment.from?.username || comment.username || null,
            ig_user_id: comment.from?.id ? String(comment.from.id) : null,
            message: comment.text.slice(0, 500),
            media_id: media.id,
            media_permalink: media.permalink || null,
            keyword_matched: kw,
            detected_at: new Date(comment.timestamp).toISOString(),
          });
          break;
        }
      }
    }
  }));

  return leads;
}

// Endpoint appelé par le cron Vercel
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  // Récupère tous les profils ayant Instagram connecté ET au moins un mot-clé
  const { data: profiles } = await serviceSupabase
    .from('integrations')
    .select('profile_id, last_ig_poll')
    .eq('provider', 'instagram');

  if (!profiles?.length) return NextResponse.json({ polled: 0 });

  const profileIds = profiles.map(p => p.profile_id);

  const { data: keywordRows } = await serviceSupabase
    .from('lead_magnet_keywords')
    .select('profile_id, keyword')
    .in('profile_id', profileIds);

  // Groupe les mots-clés par profil
  const keywordsByProfile: Record<string, string[]> = {};
  for (const row of keywordRows || []) {
    if (!keywordsByProfile[row.profile_id]) keywordsByProfile[row.profile_id] = [];
    keywordsByProfile[row.profile_id].push(row.keyword);
  }

  // Filtre les profils qui ont des mots-clés
  const profilesToPoll = profiles.filter(p => (keywordsByProfile[p.profile_id]?.length || 0) > 0);

  let polled = 0;
  let leadsFound = 0;

  for (const profile of profilesToPoll) {
    try {
      const creds = await getToken(profile.profile_id);
      if (!creds) continue;

      const { token, igAccountId } = creds;
      const keywords = keywordsByProfile[profile.profile_id];

      // Depuis le dernier poll, ou 24h max si jamais pollé
      const since = profile.last_ig_poll
        ? new Date(profile.last_ig_poll)
        : new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [dmLeads, commentLeads] = await Promise.all([
        pollDMs(profile.profile_id, token, igAccountId, keywords, since),
        pollComments(profile.profile_id, token, igAccountId, keywords, since),
      ]);

      const allLeads = [...dmLeads, ...commentLeads];

      if (allLeads.length > 0) {
        // Upsert pour éviter les doublons (contrainte unique sur profile_id, source, ig_user_id, keyword_matched, media_id)
        await serviceSupabase
          .from('instagram_leads')
          .upsert(allLeads, { onConflict: 'profile_id,source,ig_user_id,keyword_matched,media_id', ignoreDuplicates: true });
        leadsFound += allLeads.length;
      }

      // Met à jour le timestamp du dernier poll
      await serviceSupabase
        .from('integrations')
        .update({ last_ig_poll: new Date().toISOString() })
        .eq('profile_id', profile.profile_id)
        .eq('provider', 'instagram');

      polled++;
    } catch {
      // Continue sur les autres profils si l'un échoue
    }
  }

  return NextResponse.json({ polled, leadsFound });
}
