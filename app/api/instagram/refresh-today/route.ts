import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { getIgCreds, fetchIgDayMetrics, upsertIgSnapshot, pollIgComments, pollIgHookReplied } from '@/lib/ig-fetch';
import { isoDateCore } from '@/lib/ig-metrics-core';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const CRON_SECRET = process.env.CRON_SECRET!;

// POST /api/instagram/refresh-today
// Body: { profile_id: string }
// Appelé depuis le bouton Refresh du frontend (coach).
// Cooldown géré côté client (localStorage). Côté serveur : aucune restriction de fréquence.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const profileId: string = body.profile_id || user.id;

  // Vérifier que le coach a accès à ce profil
  if (profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  const today = isoDateCore(0);
  const errors: string[] = [];

  let leadsFound = 0;
  try {
    const creds = await getIgCreds(profileId);
    if (!creds) {
      errors.push('no_token');
    } else {
      // Snapshot métriques J-0
      const metrics = await fetchIgDayMetrics(creds, today);
      const err = await upsertIgSnapshot(profileId, { date: today, ...metrics }, 'refresh_partial');
      if (err) errors.push(`upsert: ${err}`);

      // Poll backup commentaires (nouveaux leads) + hook_replied (réponses DM) + snapshot
      // des posts individuels (reach/saves/skip_rate/etc. par post — refresh-ig-posts,
      // skipGuard=true côté Edge Function, donc toujours forcé même si un snapshot du
      // jour existe déjà). Sans cet appel, le bouton "Rafraîchir" ne mettait à jour que
      // les métriques compte, jamais les stats par post individuel.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [commentsResult, hookResult, postsResult] = await Promise.all([
        pollIgComments(profileId, creds.token, creds.igAccountId, since),
        pollIgHookReplied(profileId, creds.token, creds.igAccountId),
        fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/refresh-ig-posts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
          body: JSON.stringify({ profile_id: profileId }),
        }).then(r => r.json()).catch((e: any) => ({ error: e?.message || 'fetch_failed' })),
      ]);
      leadsFound = commentsResult.leadsFound;
      if (commentsResult.error) errors.push(`comment_poll: ${commentsResult.error}`);
      if (hookResult.error) errors.push(`hook_poll: ${hookResult.error}`);
      if (postsResult?.error) errors.push(`posts_refresh: ${postsResult.error}`);
      else if (postsResult?.errors?.length) errors.push(`posts_refresh: ${postsResult.errors.join(', ')}`);
    }
  } catch (e: any) {
    errors.push(`fetch_error: ${e?.message || 'unknown'}`);
  }

  return NextResponse.json({ ok: errors.length === 0, date: today, leadsFound, errors });
}
