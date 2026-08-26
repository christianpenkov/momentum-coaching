import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getYtToken } from '@/lib/yt-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/youtube/backfill-durations
 * Body: { profile_id: string }
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Remplit analytics_yt_videos_history.duration_sec sur les lignes deja collectees.
 *
 * Le cron ecrivait `null` dans cette colonne alors qu'il avait la donnee en main
 * (il s'en sert pour detecter les Shorts). Corrige le 2026-08-21, mais la correction
 * ne vaut que pour les collectes suivantes : sans ce backfill, la colonne « Duree »
 * du tableau reste vide sur toute periode passee, et l'axe de la courbe de retention
 * y bascule en pourcentage au lieu d'afficher des minutes.
 *
 * Operation sure et rejouable : la duree d'une video ne change JAMAIS. On n'ecrase
 * donc aucun historique, on comble un trou avec une valeur qui n'a qu'un seul etat
 * possible. Relancer la route deux fois donne le meme resultat.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const profileId: string | undefined = body.profile_id;
  if (!profileId) return NextResponse.json({ error: 'profile_id requis' }, { status: 400 });

  const accessToken = await getYtToken(profileId);
  if (!accessToken) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  // Les video_id qui n'ont pas encore de duree. distinct : une video a une ligne par
  // jour de snapshot, mais une seule duree a recuperer.
  const { data: rows, error: selErr } = await serviceSupabase
    .from('analytics_yt_videos_history')
    .select('video_id')
    .eq('profile_id', profileId)
    .is('duration_sec', null);
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

  const videoIds = [...new Set((rows ?? []).map(r => r.video_id))].filter(Boolean);
  if (videoIds.length === 0) {
    return NextResponse.json({ ok: true, videos: 0, lignes: 0, message: 'Rien à combler' });
  }

  // L'API accepte 50 ids par appel.
  const BATCH = 50;
  const dureeParVideo = new Map<string, number>();
  const erreurs: string[] = [];

  for (let i = 0; i < videoIds.length; i += BATCH) {
    const lot = videoIds.slice(i, i + BATCH);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${lot.join(',')}&fields=items(id,contentDetails(duration))`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      erreurs.push(`lot_${i}: HTTP ${res.status}`);
      continue;
    }
    const data = await res.json();
    for (const item of data?.items ?? []) {
      // Meme parsing ISO 8601 que le cron (poll-leads/index.ts) : « PT1H5M30S ».
      const m: RegExpMatchArray | null = item?.contentDetails?.duration?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!m) continue;
      const sec = parseInt(m[1] || '0') * 3600 + parseInt(m[2] || '0') * 60 + parseInt(m[3] || '0');
      // Une duree de 0 seconde n'existe pas pour une video publiee : c'est un parsing
      // rate plutot qu'une vraie valeur. On prefere laisser le trou.
      if (sec > 0) dureeParVideo.set(item.id, sec);
    }
  }

  // Un UPDATE par video, sur toutes ses lignes d'historique d'un coup.
  let lignesTouchees = 0;
  for (const [videoId, sec] of dureeParVideo) {
    const { data: upd, error: updErr } = await serviceSupabase
      .from('analytics_yt_videos_history')
      .update({ duration_sec: sec })
      .eq('profile_id', profileId)
      .eq('video_id', videoId)
      .is('duration_sec', null)
      .select('id');
    if (updErr) { erreurs.push(`update_${videoId}: ${updErr.message}`); continue; }
    lignesTouchees += upd?.length ?? 0;
  }

  return NextResponse.json({
    ok: erreurs.length === 0,
    videos_demandees: videoIds.length,
    videos_resolues: dureeParVideo.size,
    lignes: lignesTouchees,
    erreurs,
  });
}
