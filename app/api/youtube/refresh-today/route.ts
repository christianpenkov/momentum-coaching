import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { getYtToken, fetchYtDayMetrics, upsertYtSnapshot } from '@/lib/yt-fetch';
import { parisDateStr } from '@/lib/period';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/youtube/refresh-today
// Body: { profile_id: string }
// Appelé depuis le bouton Refresh du frontend (coach).
// YouTube a un délai de 48h, donc J-0 est souvent vide.
// On refresh J-0, J-1 et J-2 pour corriger les données partielles.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const profileId: string = body.profile_id || user.id;

  if (profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  const today = new Date();
  // Journee calendaire PARIS, pas UTC. Cette route ECRIT en base sur des cles de jour :
  // entre minuit et 2h du matin heure de Paris, `toISOString()` renvoyait la veille et
  // le rafraichissement ecrivait donc sur la mauvaise ligne. Regle posee dans
  // docs/fuseaux-horaires.md, helper partage dans lib/period.ts.
  const isoDate = (daysAgo: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return parisDateStr(d);
  };

  const startDate = isoDate(2);
  const endDate = isoDate(0);
  const errors: string[] = [];

  try {
    const accessToken = await getYtToken(profileId);
    if (!accessToken) {
      errors.push('no_token');
    } else {
      const rows = await fetchYtDayMetrics(accessToken, startDate, endDate);
      for (const row of rows) {
        const err = await upsertYtSnapshot(profileId, row, 'refresh_partial');
        if (err) errors.push(`upsert_${row.date}: ${err}`);
      }
    }
  } catch (e: any) {
    errors.push(`fetch_error: ${e?.message || 'unknown'}`);
  }

  return NextResponse.json({ ok: errors.length === 0, startDate, endDate, errors });
}
