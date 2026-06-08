import { NextRequest, NextResponse } from 'next/server';
import { getYtToken, syncYtCtr } from '@/lib/yt-fetch';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/youtube/sync-ctr-now — déclenche manuellement le sync CTR pour tous les profils YT
// Protégé par CRON_SECRET
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: integrations } = await serviceSupabase
    .from('integrations')
    .select('profile_id')
    .eq('provider', 'youtube');

  if (!integrations?.length) return NextResponse.json({ ok: true, synced: 0 });

  const results = await Promise.all(
    integrations.map(async ({ profile_id }) => {
      const token = await getYtToken(profile_id);
      if (!token) return { profile_id, synced: 0, errors: ['no_token'] };
      const r = await syncYtCtr(profile_id, token);
      return { profile_id, ...r };
    })
  );

  return NextResponse.json({ ok: true, profiles: results.length, results });
}
export const POST = GET;
