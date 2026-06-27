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

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const rawProfileId = request.nextUrl.searchParams.get('profileId');
  let profileId = user.id;
  if (rawProfileId && rawProfileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', rawProfileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    profileId = rawProfileId;
  }

  const [ctrRes, syncRes] = await Promise.all([
    serviceSupabase
      .from('youtube_video_ctr')
      .select('impressions, clicks, ctr_pct')
      .eq('profile_id', profileId)
      .eq('video_id', videoId)
      .single(),
    serviceSupabase
      .from('youtube_ctr_sync_state')
      .select('job_created_at, reports_processed')
      .eq('profile_id', profileId)
      .single(),
  ]);

  if (ctrRes.error || !ctrRes.data) return NextResponse.json({ ctrPct: null, impressions: null, jobCreatedAt: null });

  return NextResponse.json({
    ctrPct: ctrRes.data.ctr_pct,
    impressions: ctrRes.data.impressions,
    clicks: ctrRes.data.clicks,
    jobCreatedAt: syncRes.data?.job_created_at ?? null,
    reportsProcessed: syncRes.data?.reports_processed ?? 0,
  });
}
