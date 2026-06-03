import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/instagram/test-reach-breakdown
// Teste le breakdown follower/non-follower au niveau compte ET au niveau média
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

  const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);
  const safeJson = async (r: Response) => { try { return await r.json(); } catch { return { error: 'parse_failed' }; } };

  // Récupère les médias pour trouver un reel récent
  const mediaData = await fetch(
    `https://graph.instagram.com/v22.0/${igAccountId}/media?fields=id,media_type,timestamp&limit=20&access_token=${token}`
  ).then(safeJson);

  const latestReel = (mediaData?.data || []).find((m: any) => m.media_type === 'VIDEO' || m.media_type === 'REEL') ?? null;
  const latestImage = (mediaData?.data || []).find((m: any) => m.media_type === 'IMAGE') ?? null;

  // ── NIVEAU COMPTE ──────────────────────────────────────────────────────────
  const [a1, a2, a3] = await Promise.all([
    // Exact endpoint demandé : reach + breakdown=follow_type + period=day
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach&breakdown=follow_type&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
    // Variante : metric_type=total_value (format agrégé Meta v20+)
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach&metric_type=total_value&breakdown=follow_type&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
    // Variante : period=lifetime
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach&breakdown=follow_type&period=lifetime&access_token=${token}`).then(safeJson),
  ]);

  // ── NIVEAU MÉDIA ───────────────────────────────────────────────────────────
  const reelTests = latestReel ? await Promise.all([
    // Exact endpoint demandé : reach + breakdown=follow_type sur le reel
    fetch(`https://graph.instagram.com/v22.0/${latestReel.id}/insights?metric=reach&breakdown=follow_type&access_token=${token}`).then(safeJson),
    // Sans breakdown pour baseline
    fetch(`https://graph.instagram.com/v22.0/${latestReel.id}/insights?metric=reach&access_token=${token}`).then(safeJson),
  ]) : [{ skipped: 'aucun reel' }, { skipped: 'aucun reel' }];

  const imageTests = latestImage ? await Promise.all([
    fetch(`https://graph.instagram.com/v22.0/${latestImage.id}/insights?metric=reach&breakdown=follow_type&access_token=${token}`).then(safeJson),
    fetch(`https://graph.instagram.com/v22.0/${latestImage.id}/insights?metric=reach&access_token=${token}`).then(safeJson),
  ]) : [{ skipped: 'aucune image' }, { skipped: 'aucune image' }];

  return NextResponse.json({
    igAccountId,
    latest_reel: latestReel ? { id: latestReel.id, timestamp: latestReel.timestamp } : null,
    latest_image: latestImage ? { id: latestImage.id, timestamp: latestImage.timestamp } : null,
    account_level: {
      reach_follow_type_day: a1,
      reach_total_value_follow_type: a2,
      reach_follow_type_lifetime: a3,
    },
    reel_level: {
      reach_follow_type: reelTests[0],
      reach_baseline: reelTests[1],
    },
    image_level: {
      reach_follow_type: imageTests[0],
      reach_baseline: imageTests[1],
    },
  });
}
