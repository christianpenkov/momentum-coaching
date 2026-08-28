import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { getShortioLinkCreds, snapshotShortioLinks, syncLmClickStream } from '@/lib/shortio-fetch';
// Jour calendaire PARIS, comme le cron et getPeriodWindow. `toISOString()` donnait le
// jour UTC : entre minuit Paris et minuit UTC, le bouton datait ses écritures de la
// veille — la même confusion de calendrier qui a produit ~39 % de clics fantômes.
import { parisDateStr } from '@/lib/period';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/shortio/refresh-today
// Body: { profile_id?: string }
// Snapshot J-0 Short.io : agrégat domaine + granularité par lien + click stream LM.
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

  const creds = await getShortioLinkCreds(profileId);
  if (!creds) return NextResponse.json({ ok: false, error: 'no_token' });

  const today = parisDateStr(new Date());
  const errors: string[] = [];

  // 1. Snapshot granulaire par lien → shortio_link_daily_snapshots (period=today)
  const { synced, errors: linkErrors } = await snapshotShortioLinks(profileId, 'refresh_partial');
  if (linkErrors.length) errors.push(...linkErrors);

  // Le bloc « agrégat domaine » qui vivait ici remplissait
  // analytics_daily_snapshots.shortio_clicks / shortio_human_clicks /
  // shortio_top_countries / shortio_top_referrers. Vérifié le 2026-08-28 : aucun code
  // ni aucune vue SQL ne lit ces colonnes. Un appel Short.io de moins à chaque clic
  // sur « Rafraîchir », pour des données que personne ne consulte.

  // 3. Click stream — attribution lm_clicked avec timestamp précis (48h glissantes)
  // 48h couvre 2 runs consécutifs ratés du cron nuit — ignoreDuplicates évite les doublons
  const afterDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const clickStreamErrors = await syncLmClickStream(profileId, creds, afterDate);
  if (clickStreamErrors.length) errors.push(...clickStreamErrors);

  return NextResponse.json({ ok: errors.length === 0, date: today, synced_links: synced, errors });
}
