import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getIgCreds, fetchIgDayMetrics, upsertIgSnapshot } from '@/lib/ig-fetch';
import { getYtToken, fetchYtDayMetrics, upsertYtSnapshot, syncYtCtr } from '@/lib/yt-fetch';
import { sendPushToProfile } from '@/lib/googleCalendarService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Poll DMs ──────────────────────────────────────────────────────────────────
async function pollDMs(profileId: string, token: string, igAccountId: string, keywords: string[], since: Date) {
  const threadsRes = await fetch(
    `https://graph.instagram.com/v21.0/${igAccountId}/conversations?fields=id,updated_time,participants,message_count&limit=50&access_token=${token}`
  );
  const threadsData = await threadsRes.json();
  if (threadsData.error) return [];

  const threads = (threadsData.data || []).filter(
    (t: any) => new Date(t.updated_time).getTime() > since.getTime()
  );

  const leads: any[] = [];

  await Promise.all(threads.map(async (thread: any) => {
    const msgRes = await fetch(
      `https://graph.instagram.com/v21.0/${thread.id}/messages?fields=id,message,from,created_time&limit=20&access_token=${token}`
    );
    const msgData = await msgRes.json();
    const messages: any[] = msgData?.data || [];

    for (const msg of messages) {
      if (!msg.message || msg.from?.id === igAccountId) continue;
      const text = msg.message.toLowerCase();
      for (const kw of keywords) {
        if (text.includes(kw)) {
          const participant = thread.participants?.data?.find((p: any) => p.id !== igAccountId);
          leads.push({
            profile_id: profileId,
            source: 'dm',
            ig_username: participant?.username || participant?.name || null,
            ig_user_id: msg.from?.id ? String(msg.from.id) : null,
            message: msg.message.slice(0, 500),
            media_id: thread.id,
            media_permalink: null,
            keyword_matched: kw,
            detected_at: new Date(msg.created_time).toISOString(),
          });
          break;
        }
      }
    }
  }));

  return leads;
}

// ── Poll commentaires ─────────────────────────────────────────────────────────
async function pollComments(profileId: string, token: string, igAccountId: string, keywords: string[], since: Date) {
  const mediaRes = await fetch(
    `https://graph.instagram.com/v21.0/${igAccountId}/media?fields=id,permalink,timestamp&limit=20&access_token=${token}`
  );
  const mediaData = await mediaRes.json();
  if (mediaData.error) return [];

  const recentMedia = (mediaData.data || []).filter(
    (m: any) => new Date(m.timestamp).getTime() > since.getTime() - 90 * 24 * 60 * 60 * 1000
  );

  const leads: any[] = [];

  await Promise.all(recentMedia.map(async (media: any) => {
    const commRes = await fetch(
      `https://graph.instagram.com/v21.0/${media.id}/comments?fields=id,text,timestamp,from,username&limit=50&access_token=${token}`
    );
    const commData = await commRes.json();
    if (commData.error) return;

    for (const comment of commData.data || []) {
      if (!comment.text) continue;
      if (new Date(comment.timestamp).getTime() < since.getTime()) continue;
      const text = comment.text.toLowerCase();
      for (const kw of keywords) {
        if (text.includes(kw)) {
          leads.push({
            profile_id: profileId,
            source: 'comment',
            ig_username: comment.from?.username || comment.username || null,
            ig_user_id: comment.from?.id ? String(comment.from.id) : null,
            message: comment.text.slice(0, 500),
            media_id: media.id,
            media_permalink: media.permalink || null,
            keyword_matched: kw,
            detected_at: new Date(comment.timestamp).toISOString(),
          });
          break;
        }
      }
    }
  }));

  return leads;
}

// ── Snapshot métriques J-1 ────────────────────────────────────────────────────
// Appels directs via lib/ig-fetch + lib/yt-fetch — plus d'HTTP interne.
// IG + Short.io : J-1 uniquement.
// YouTube : J-1, J-2, J-3 (délai Google 48h de finalisation).
async function snapshotProfile(profileId: string): Promise<string[]> {
  const errors: string[] = [];
  const today = new Date();

  const isoDate = (daysAgo: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().split('T')[0];
  };

  const yesterday = isoDate(1);

  // ── IG J-1 ──
  const igCreds = await getIgCreds(profileId);
  if (igCreds) {
    try {
      const metrics = await fetchIgDayMetrics(igCreds, yesterday);
      const err = await upsertIgSnapshot(profileId, { date: yesterday, ...metrics }, 'cron');
      if (err) errors.push(`ig_upsert: ${err}`);
    } catch (e: any) {
      errors.push(`ig_fetch: ${e?.message || 'unknown'}`);
    }
  }

  // ── Short.io J-1 ──
  try {
    const base = process.env.NEXT_PUBLIC_PLATFORM_URL || 'https://momentum-plateforme.vercel.app';
    const shortioRes = await fetch(`${base}/api/shortio/stats?profile_id=${profileId}`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    if (shortioRes.ok) {
      const shortio = await shortioRes.json();
      if (shortio) {
        await supabase.from('analytics_daily_snapshots').upsert({
          profile_id: profileId,
          date: yesterday,
          shortio_clicks:        shortio.clicks30d ?? null,
          shortio_human_clicks:  shortio.humanClicks30d ?? null,
          shortio_links:         shortio.links ?? null,
          shortio_top_countries: shortio.topCountries ?? null,
          shortio_top_referrers: shortio.topReferrers ?? null,
        }, { onConflict: 'profile_id,date', ignoreDuplicates: false });
      }
    }
  } catch (e: any) {
    errors.push(`shortio_fetch: ${e?.message || 'unknown'}`);
  }

  // ── YouTube J-1, J-2, J-3 + sync CTR vidéos ──
  const ytToken = await getYtToken(profileId);
  if (ytToken) {
    try {
      const ytRows = await fetchYtDayMetrics(ytToken, isoDate(3), yesterday);
      for (const row of ytRows) {
        const err = await upsertYtSnapshot(profileId, row, 'cron');
        if (err) errors.push(`yt_upsert_${row.date}: ${err}`);
      }
    } catch (e: any) {
      errors.push(`yt_fetch: ${e?.message || 'unknown'}`);
    }

    // Sync CTR par vidéo depuis l'API Reporting (incrémental — nouveaux rapports seulement)
    try {
      const { errors: ctrErrors } = await syncYtCtr(profileId, ytToken);
      if (ctrErrors.length) errors.push(...ctrErrors.map(e => `yt_ctr: ${e}`));
    } catch (e: any) {
      errors.push(`yt_ctr: ${e?.message || 'unknown'}`);
    }
  }

  // ── Calls depuis Supabase ──
  // coach_id = profileId de l'élève pour les calls Calendly (l'élève est l'hôte)
  const { data: callsData } = await supabase
    .from('calls')
    .select('status, scheduled_at, no_show, deal_closed, revenue')
    .eq('coach_id', profileId)
    .not('calendly_event_uuid', 'is', null);

  const calls = callsData || [];
  const now = new Date();
  const callsBooked   = calls.filter(c => c.status === 'active').length;
  const callsHonored  = calls.filter(c => c.status === 'active' && new Date(c.scheduled_at) < now && !c.no_show).length;
  const callsCanceled = calls.filter(c => c.status === 'canceled').length;
  const callsNoShow   = calls.filter(c => c.no_show).length;
  const dealsClosed   = calls.filter(c => c.deal_closed).length;
  const revenue       = calls.reduce((s: number, c: any) => s + (c.revenue || 0), 0);

  await supabase.from('analytics_daily_snapshots').upsert({
    profile_id: profileId,
    date: yesterday,
    calls_booked:  callsBooked,
    calls_honored: callsHonored,
    calls_canceled: callsCanceled,
    calls_no_show: callsNoShow,
    deals_closed:  dealsClosed,
    revenue,
  }, { onConflict: 'profile_id,date', ignoreDuplicates: false });

  // ── Stripe J-1 ──
  try {
    const base = process.env.NEXT_PUBLIC_PLATFORM_URL || 'https://momentum-plateforme.vercel.app';
    const stripeRes = await fetch(`${base}/api/stripe/client-data?profile_id=${profileId}`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    if (stripeRes.ok) {
      const stripe = await stripeRes.json();
      if (stripe?.recentPayments?.length) {
        const stripeRows = stripe.recentPayments
          .filter((p: any) => p.status === 'succeeded')
          .map((p: any) => ({
            profile_id: profileId,
            payment_id: p.id,
            amount: p.amount,
            currency: p.currency ?? 'eur',
            description: p.description || null,
            date: p.date,
            status: p.status,
          }));
        if (stripeRows.length) {
          const { error: stripeErr } = await supabase
            .from('stripe_payments')
            .upsert(stripeRows, { onConflict: 'profile_id,payment_id' });
          if (stripeErr) errors.push(`stripe_payments_upsert: ${stripeErr.message}`);
        }
      }
      if (stripe) {
        await supabase.from('analytics_daily_snapshots').upsert({
          profile_id: profileId,
          date: yesterday,
          mrr: stripe.mrr ?? null,
          stripe_active_subs: stripe.activeSubscriptions ?? null,
        }, { onConflict: 'profile_id,date', ignoreDuplicates: false });
      }
    }
  } catch (e: any) {
    errors.push(`stripe_fetch: ${e?.message || 'unknown'}`);
  }

  // Mise à jour du statut snapshot dans integrations
  const status = errors.length === 0 ? 'ok' : 'partial';
  const errMsg = errors.length > 0 ? errors.join(', ') : null;
  await supabase.from('integrations')
    .update({ last_snapshot_status: status, last_snapshot_error: errMsg })
    .eq('profile_id', profileId)
    .in('provider', ['instagram', 'youtube']);

  return errors;
}

// ── Cron Vercel — GET /api/instagram/poll-leads ───────────────────────────────
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  // Profils avec IG OU YT connectés (plus de restriction IG only)
  const { data: integrations } = await supabase
    .from('integrations')
    .select('profile_id, provider, last_ig_poll')
    .in('provider', ['instagram', 'youtube']);

  if (!integrations?.length) return NextResponse.json({ polled: 0, snapshots: 0 });

  // Déduplique les profile_ids
  const profileMap = new Map<string, { profile_id: string; last_ig_poll: string | null; hasIg: boolean }>();
  for (const row of integrations) {
    if (!profileMap.has(row.profile_id)) {
      profileMap.set(row.profile_id, { profile_id: row.profile_id, last_ig_poll: row.last_ig_poll, hasIg: false });
    }
    if (row.provider === 'instagram') {
      profileMap.get(row.profile_id)!.hasIg = true;
      profileMap.get(row.profile_id)!.last_ig_poll = row.last_ig_poll;
    }
  }
  const profiles = Array.from(profileMap.values());

  const profileIds = profiles.map(p => p.profile_id);

  // Mots-clés par profil
  const { data: keywordRows } = await supabase
    .from('lead_magnet_keywords')
    .select('profile_id, keyword')
    .in('profile_id', profileIds);

  const keywordsByProfile: Record<string, string[]> = {};
  for (const row of keywordRows || []) {
    if (!keywordsByProfile[row.profile_id]) keywordsByProfile[row.profile_id] = [];
    keywordsByProfile[row.profile_id].push(row.keyword);
  }

  let polled = 0;
  let leadsFound = 0;
  let snapshots = 0;
  const allErrors: Record<string, string[]> = {};

  for (const profile of profiles) {
    const profileErrors: string[] = [];

    // ── 1. Poll leads IG (si mots-clés configurés et IG connecté) ──
    if (profile.hasIg) {
      const keywords = keywordsByProfile[profile.profile_id] || [];
      if (keywords.length > 0) {
        try {
          const creds = await getIgCreds(profile.profile_id);
          if (creds) {
            const { token, igAccountId } = creds;
            const since = profile.last_ig_poll
              ? new Date(profile.last_ig_poll)
              : new Date(Date.now() - 24 * 60 * 60 * 1000);

            const [dmLeads, commentLeads] = await Promise.all([
              pollDMs(profile.profile_id, token, igAccountId, keywords, since),
              pollComments(profile.profile_id, token, igAccountId, keywords, since),
            ]);

            const allLeads = [...dmLeads, ...commentLeads];
            if (allLeads.length > 0) {
              await supabase.from('instagram_leads').upsert(allLeads, {
                onConflict: 'profile_id,source,ig_user_id,keyword_matched,media_id',
                ignoreDuplicates: true,
              });
              leadsFound += allLeads.length;
            }

            await supabase.from('integrations')
              .update({ last_ig_poll: new Date().toISOString() })
              .eq('profile_id', profile.profile_id)
              .eq('provider', 'instagram');

            polled++;
          }
        } catch {
          profileErrors.push('lead_poll_failed');
        }
      }
    }

    // ── 2. Snapshot métriques J-1 ──
    try {
      const snapErrors = await snapshotProfile(profile.profile_id);
      if (snapErrors.length === 0) snapshots++;
      else profileErrors.push(...snapErrors);
    } catch {
      profileErrors.push('snapshot_failed');
    }

    if (profileErrors.length) allErrors[profile.profile_id] = profileErrors;
  }

  // ── 3. Notifications rapport post-call ────────────────────────────────────────
  // Détecte tous les calls Calendly actifs terminés depuis > 15 min sans rapport rempli.
  let rapportNotified = 0;
  try {
    const now = new Date();
    const { data: pendingCalls } = await supabase
      .from('calls')
      .select('id, coach_id, invitee_name, scheduled_at, duration')
      .eq('status', 'active')
      .is('no_show', null)
      .eq('rapport_notif_sent', false)
      .not('calendly_event_uuid', 'is', null)
      .not('scheduled_at', 'is', null)
      .not('duration', 'is', null)
      .lt('scheduled_at', now.toISOString());

    for (const call of pendingCalls || []) {
      const match = (call.duration as string).match(/(\d+)/);
      if (!match) continue;
      const durationMs = parseInt(match[1]) * 60 * 1000;
      const triggerTime = new Date(call.scheduled_at).getTime() + durationMs + 15 * 60 * 1000;
      if (now.getTime() < triggerTime) continue;

      try {
        await sendPushToProfile(
          call.coach_id,
          'Rapport de call',
          `Comment s'est passé ton appel${call.invitee_name ? ` avec ${call.invitee_name}` : ''} ? Remplis ton rapport.`,
          `/client/calls?rapport=${call.id}`
        );
        await supabase.from('calls').update({ rapport_notif_sent: true }).eq('id', call.id);
        rapportNotified++;
      } catch {
        // Non bloquant — on réessaie au prochain cron
      }
    }
  } catch {
    // Non bloquant
  }

  return NextResponse.json({ polled, leadsFound, snapshots, rapportNotified, errors: allErrors });
}
