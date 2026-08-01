import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/instagram/test-video-duration
// Teste si le champ video_duration (endpoint /media) est réellement renvoyé par Meta
// sur des Reels récents, et explore les alternatives possibles (champ duration,
// insights ig_reels_video_view_total_time).
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, metadata')
    .eq('profile_id', user.id)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) return NextResponse.json({ error: 'Instagram non connecté' }, { status: 404 });

  const token = integ.access_token;
  const igAccountId = (integ.metadata as any)?.ig_account_id;
  const safeJson = async (r: Response) => { try { return await r.json(); } catch { return { error: 'parse_failed' }; } };

  // Liste des reels récents
  const mediaData = await fetch(
    `https://graph.instagram.com/v22.0/${igAccountId}/media?fields=id,media_type,media_product_type,timestamp&limit=20&access_token=${token}`
  ).then(safeJson);

  const reels = (mediaData?.data || []).filter((m: any) => m.media_product_type === 'REELS' || m.media_type === 'VIDEO');
  const latestReel = reels[0] ?? null;

  if (!latestReel) {
    return NextResponse.json({ error: 'aucun_reel_trouve', mediaData });
  }

  const [fieldsWithVideoDuration, fieldsWithDuration, fieldsAll, insightsTotalTime] = await Promise.all([
    fetch(`https://graph.instagram.com/v22.0/${latestReel.id}?fields=id,media_type,media_product_type,video_duration&access_token=${token}`).then(safeJson),
    fetch(`https://graph.instagram.com/v22.0/${latestReel.id}?fields=id,media_type,media_product_type,duration&access_token=${token}`).then(safeJson),
    fetch(`https://graph.instagram.com/v22.0/${latestReel.id}?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink,video_duration,duration,view_count,total_views_count&access_token=${token}`).then(safeJson),
    fetch(`https://graph.instagram.com/v22.0/${latestReel.id}/insights?metric=ig_reels_video_view_total_time,ig_reels_avg_watch_time,views&access_token=${token}`).then(safeJson),
  ]);

  return NextResponse.json({
    igAccountId,
    latest_reel: latestReel,
    field_video_duration: fieldsWithVideoDuration,
    field_duration: fieldsWithDuration,
    all_fields_attempt: fieldsAll,
    insights_watch_time: insightsTotalTime,
  });
}
