import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// PST = UTC-8 (hiver) / PDT = UTC-7 (été)
// Meta renvoie les clés horaires en heure Pacifique
// On détecte l'offset PST/PDT selon la date courante
function getPSTOffset(): number {
  const now = new Date();
  // DST aux USA : 2ème dimanche de mars → 1er dimanche de novembre
  const year = now.getUTCFullYear();
  const dstStart = new Date(Date.UTC(year, 2, 1)); // 1er mars UTC
  dstStart.setUTCDate(1 + (7 - dstStart.getUTCDay() + 0) % 7 + 7); // 2ème dimanche
  const dstEnd = new Date(Date.UTC(year, 10, 1)); // 1er nov UTC
  dstEnd.setUTCDate(1 + (7 - dstEnd.getUTCDay() + 0) % 7); // 1er dimanche
  const isPDT = now >= dstStart && now < dstEnd;
  return isPDT ? 7 : 8; // heures à ajouter pour convertir PST/PDT → UTC
}

// Convertit une heure PST (0-23) en heure locale selon le fuseau du coach (Europe/Paris par défaut)
// Retourne l'heure locale 0-23
function pstHourToLocal(pstHour: number, localOffsetHours: number): number {
  const utcHour = (pstHour + getPSTOffset()) % 24;
  return (utcHour + localOffsetHours + 24) % 24;
}

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');
  // Offset local du coach en heures (Paris = +2 en été, +1 en hiver)
  // Passé en query param pour flexibilité : ?localOffset=2
  const localOffset = parseInt(searchParams.get('localOffset') || '2', 10);

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

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, metadata')
    .eq('profile_id', targetProfileId)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const token = integ.access_token;
  const igAccountId: string | null = (integ.metadata as any)?.ig_account_id || null;
  if (!igAccountId) return NextResponse.json({ error: 'no_ig_account_id' }, { status: 404 });

  // period=lifetime avec fenêtre J-33 → J-3 pour éviter le délai de traitement Meta (48h vides)
  const until = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);  // J-3
  const since = Math.floor((Date.now() - 33 * 24 * 60 * 60 * 1000) / 1000); // J-33

  const lifetimeRes = await fetch(
    `https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=online_followers&period=lifetime&since=${since}&until=${until}&access_token=${token}`
  );
  const lifetimeData = await lifetimeRes.json().catch(() => ({ error: 'parse_error' }));

  // ── Reconstruction heatmap ──
  // values[].value = { "0": n, ... "23": n } en heure PST par jour
  // values[].end_time = date ISO du jour mesuré
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const heatmapCount: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

  const lifetimeValues = lifetimeData?.data?.[0]?.values || [];
  for (const entry of lifetimeValues) {
    if (!entry.value || !entry.end_time) continue;
    const date = new Date(entry.end_time);
    const dayOfWeek = date.getUTCDay(); // 0=dim, 1=lun, ...
    for (let pstHour = 0; pstHour < 24; pstHour++) {
      const count = entry.value[String(pstHour)] ?? 0;
      const localHour = pstHourToLocal(pstHour, localOffset);
      heatmap[dayOfWeek][localHour] += count;
      heatmapCount[dayOfWeek][localHour]++;
    }
  }

  // Calcule la moyenne par case
  const heatmapAvg = heatmap.map((row, d) =>
    row.map((sum, h) => heatmapCount[d][h] > 0 ? Math.round(sum / heatmapCount[d][h]) : 0)
  );

  // Trouve le max pour la normalisation (opacité front)
  const allValues = heatmapAvg.flat();
  const maxValue = Math.max(...allValues, 1);

  return NextResponse.json({
    debug: {
      igAccountId,
      pstOffsetUsed: getPSTOffset(),
      localOffsetParam: localOffset,
      window: `${new Date(since * 1000).toISOString().split('T')[0]} → ${new Date(until * 1000).toISOString().split('T')[0]}`,
    },
    raw: {
      lifetime: lifetimeData,
    },
    heatmap: {
      days: DAYS,
      hours: Array.from({ length: 24 }, (_, i) => `${i}h`),
      // matrix[dayIndex][hourIndex] = nombre moyen d'abonnés en ligne
      matrix: heatmapAvg,
      maxValue,
      dataPointCount: lifetimeValues.length,
    },
  });
}
