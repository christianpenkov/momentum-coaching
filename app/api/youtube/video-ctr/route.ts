import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/youtube/video-ctr?videoId=xxx&profileId=yyy
// Retourne le CTR pondéré all-time d'une vidéo depuis youtube_video_ctr
export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get('videoId');
  if (!videoId) return NextResponse.json({ error: 'videoId requis' }, { status: 400 });

  // profileId optionnel — si absent, on utilise l'user connecté
  let profileId = request.nextUrl.searchParams.get('profileId');
  if (!profileId) {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    profileId = user.id;
  }

  const { data, error } = await serviceSupabase
    .from('youtube_video_ctr')
    .select('impressions, clicks, ctr_pct')
    .eq('profile_id', profileId)
    .eq('video_id', videoId)
    .single();

  if (error || !data) return NextResponse.json({ ctrPct: null, impressions: null });

  return NextResponse.json({
    ctrPct: data.ctr_pct,
    impressions: data.impressions,
    clicks: data.clicks,
  });
}
