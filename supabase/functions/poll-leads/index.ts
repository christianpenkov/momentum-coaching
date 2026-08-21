// Edge Function Supabase — poll-leads
// Remplace la route Vercel /api/instagram/poll-leads pour tenir 20 élèves+
// Timeout 150s (vs 30s Vercel Hobby). Logique identique, imports Deno-native.
// Appelée par cron-job.org avec Authorization: Bearer CRON_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { snapshotIgPosts } from '../_shared/ig-posts.ts';
import { formatTimeIn, safeZone } from '../_shared/timezone.ts';
import { createShortioLimiter, mapWithConcurrency, sleep } from '../_shared/rate-limit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const YOUTUBE_CLIENT_ID = Deno.env.get('YOUTUBE_CLIENT_ID')!;
const YOUTUBE_CLIENT_SECRET = Deno.env.get('YOUTUBE_CLIENT_SECRET')!;
const PLATFORM_URL = Deno.env.get('NEXT_PUBLIC_PLATFORM_URL') || 'https://momentum-plateforme.vercel.app';

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Limiteur Short.io PARTAGÉ par tout le run — c'est le point essentiel : le quota
// (~60 req/fenêtre) est global à la clé/domaine, et plusieurs profils partagent le
// même domaine. Un limiteur par profil ne protégerait de rien, puisqu'ils se
// cannibalisent mutuellement (constaté en prod à 4 élèves, cf. snapshotOldDomainLinks).
const shortio = createShortioLimiter();

// ─────────────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────────────

// Offset Paris (+1h hiver / +2h été) — règle UE : dernier dimanche de mars 1h UTC
// (passage à +2h) → dernier dimanche d'octobre 1h UTC (retour à +1h). Dupliqué ici
// (pas d'import cross-runtime possible entre l'Edge Function Deno et lib/timezone.ts
// côté Next.js) pour que les dates écrites dans analytics_daily_snapshots restent
// calées sur le même calendrier Paris que getPeriodWindow (lib/period.ts, frontend).
function lastSundayOfMonth(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lastDate = new Date(Date.UTC(year, month, lastDay));
  return lastDay - lastDate.getUTCDay();
}

function parisOffsetHours(utcDate: Date): number {
  const year = utcDate.getUTCFullYear();
  const dstStart = Date.UTC(year, 2, lastSundayOfMonth(year, 2), 1, 0, 0);
  const dstEnd = Date.UTC(year, 9, lastSundayOfMonth(year, 9), 1, 0, 0);
  const t = utcDate.getTime();
  return t >= dstStart && t < dstEnd ? 2 : 1;
}

// Date calendrier Paris (pas UTC) — "aujourd'hui moins daysAgo jours", en heure de Paris.
function isoDate(daysAgo: number): string {
  const now = new Date();
  const parisNow = new Date(now.getTime() + parisOffsetHours(now) * 3600_000);
  parisNow.setUTCDate(parisNow.getUTCDate() - daysAgo);
  return parisNow.toISOString().split('T')[0];
}

// Date calendrier Paris d'un instant ISO quelconque (ex. timestamp brut d'un clic Short.io) —
// même logique que isoDate() mais pour un instant arbitraire plutôt que "maintenant - N jours".
function isoDateFromInstant(iso: string): string {
  const d = new Date(iso);
  const parisD = new Date(d.getTime() + parisOffsetHours(d) * 3600_000);
  return parisD.toISOString().split('T')[0];
}

async function safeJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

// Deno-native gunzip (remplace Node zlib.gunzipSync)
async function gunzip(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  // Vérifier le magic number gzip (0x1f 0x8b) avant de tenter la décompression
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return new TextDecoder().decode(buf);
  }
  try {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const chunks: Uint8Array[] = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return new TextDecoder().decode(out);
  } catch {
    return new TextDecoder().decode(buf);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IG
// ─────────────────────────────────────────────────────────────────────────────

async function getIgCreds(profileId: string): Promise<{ token: string; igAccountId: string } | null> {
  const { data: integ } = await supa
    .from('integrations')
    .select('access_token, expires_at, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) return null;

  // `expires_at` NULL veut dire « on ne sait pas quand ce jeton expire », pas « il
  // n'expire jamais » : les jetons Instagram longue duree valent 60 jours.
  //
  // La condition testait `integ.expires_at &&`, donc un NULL la rendait toujours
  // fausse : le jeton n'etait jamais rafraichi et finissait par expirer en silence.
  // Constate le 2026-08-22 sur un profil dont la collecte s'etait arretee depuis
  // 5 jours, avec un last_snapshot_status toujours a « ok » et aucune erreur tracee.
  //
  // Sans date connue, on tente le rafraichissement : l'appel est sans risque (Meta
  // renvoie simplement une erreur si le jeton est trop recent ou deja invalide) et il
  // restaure la date d'expiration au passage.
  const needsRefresh = !integ.expires_at ||
    new Date(integ.expires_at).getTime() < Date.now() + 5 * 24 * 60 * 60 * 1000;

  let token = integ.access_token;
  if (needsRefresh) {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`);
    const d = await safeJson(r);
    if (d.access_token) {
      token = d.access_token;
      const expiresAt = d.expires_in ? new Date(Date.now() + d.expires_in * 1000).toISOString() : null;
      await supa.from('integrations').update({ access_token: token, expires_at: expiresAt, status: 'ok', last_snapshot_error: null })
        .eq('profile_id', profileId).eq('provider', 'instagram');
    } else {
      // Un refus de rafraichissement signifie presque toujours un jeton revoque ou
      // expire : l'utilisateur doit reconnecter son compte. Sans cette trace, l'echec
      // etait totalement invisible — le statut restait « ok » et la collecte s'arretait
      // sans que rien ne l'indique nulle part.
      const msg = d?.error?.message || 'refresh refuse';
      console.error(`[poll-leads] ig_token_refresh_failed profile=${profileId}: ${msg}`);
      await supa.from('integrations')
        // status vaut 'ok' ou 'failed' — une contrainte CHECK l'impose, toute autre
        // valeur ferait echouer l'ecriture en silence. Le detail va dans
        // last_snapshot_error.
        .update({ status: 'failed', last_snapshot_status: 'error', last_snapshot_error: `ig_token: ${String(msg).slice(0, 200)}` })
        .eq('profile_id', profileId).eq('provider', 'instagram');
    }
  }

  const igAccountId: string | null = (integ.metadata as any)?.ig_account_id || null;
  if (!igAccountId) return null;
  return { token, igAccountId };
}

async function fetchIgDayMetrics(token: string, igAccountId: string, date: string) {
  const d = new Date(date + 'T00:00:00Z');
  const since = Math.floor(d.getTime() / 1000);
  const until = since + 86400;

  // ⚠️ Deux formes de requete, et Meta n'accepte pas les memes metriques dans chacune.
  //
  // `views`, `profile_links_taps` et `website_clicks` etaient demandes SANS
  // `metric_type=total_value` : Meta acceptait la requete, ne renvoyait simplement
  // aucune serie pour eux, et le code n'y voyait que du feu. Resultat, ig_views etait
  // vide sur les 107 jours du profil de test alors que l'API en renvoie 271 sur 7 jours
  // (verifie le 2026-08-22).
  //
  // A l'inverse `follower_count` ne fonctionne QUE sans total_value — avec, la reponse
  // est vide. D'ou la separation en deux appels plutot qu'un seul.
  //
  // La ventilation abonnes / non-abonnes du reach (breakdown=follow_type) n'etait
  // collectee QUE par lib/ig-fetch.ts, cote Node, qui ne tourne qu'au backfill de
  // premiere connexion : les colonnes s'arretaient donc au 27 juillet sur le profil de
  // test. Elle est ajoutee ici.
  const [accountRes, insightsRes, insightsTvRes, engagedRes, reachBdRes] = await Promise.all([
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}?fields=followers_count,follows_count&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach,follower_count&period=day&since=${since}&until=${until}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=views,profile_links_taps,website_clicks&metric_type=total_value&period=day&since=${since}&until=${until}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=accounts_engaged,total_interactions&metric_type=total_value&period=day&since=${since}&until=${until}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach&metric_type=total_value&breakdown=follow_type&period=day&since=${since}&until=${until}&access_token=${token}`),
  ]);

  const [accountData, insightsData, insightsTvData, engagedData, reachBdData] = await Promise.all([
    safeJson(accountRes), safeJson(insightsRes), safeJson(insightsTvRes),
    safeJson(engagedRes), safeJson(reachBdRes),
  ]);

  const insightMap: Record<string, number[]> = {};
  for (const metric of insightsData?.data || []) {
    insightMap[metric.name] = (metric.values || []).map((v: any) => v.value || 0);
  }
  const sum = (arr: number[]) => (arr || []).reduce((a: number, b: number) => a + b, 0);

  // Metriques du second appel (metric_type=total_value) : la valeur est dans
  // `total_value.value`, pas dans une serie `values`. Meme convention que engagedData
  // juste en dessous.
  const tvMap: Record<string, number> = {};
  for (const m of (insightsTvData?.data || [])) {
    if (m.total_value?.value != null) tvMap[m.name] = m.total_value.value;
  }

  // Ventilation du reach par type d'audience. Absente du cron jusqu'au 2026-08-22 :
  // seul le backfill Node la collectait, d'ou des colonnes qui s'arretaient a la date
  // de la premiere connexion.
  //
  // null (pas 0) quand Meta ne renvoie aucune ligne : un 0 se lirait « aucun abonne
  // touche », alors que la realite est « Meta n'a pas fourni la ventilation » — c'est
  // exactement ce qui affichait un « Followers reach rate » de 0 % a l'ecran.
  let reachFollower: number | null = null;
  let reachNonFollower: number | null = null;
  for (const m of (reachBdData?.data || [])) {
    const lignes = (m.total_value?.breakdowns || []).flatMap((bd: any) => bd.results || []);
    if (lignes.length === 0) continue;
    reachFollower = 0; reachNonFollower = 0;
    for (const r of lignes) {
      const cle = r.dimension_values?.[0];
      if (cle === 'FOLLOWER') reachFollower += r.value ?? 0;
      else if (cle === 'NON_FOLLOWER') reachNonFollower += r.value ?? 0;
    }
  }
  // engagedData contient 2 métriques distinctes (accounts_engaged ET total_interactions)
  // dans le même appel — un .reduce() sur tout le tableau sans distinguer m.name
  // additionnait les deux valeurs ensemble et assignait cette somme aux deux colonnes
  // (même bug déjà corrigé dans lib/ig-fetch.ts le 2026-07-06 — cette Edge Function
  // a sa propre copie dupliquée de la logique, jamais mise à jour à ce moment-là).
  let accountsEngagedTotal = 0;
  let totalInteractionsTotal = 0;
  for (const m of (engagedData?.data || [])) {
    const v = m.total_value?.value || 0;
    if (m.name === 'accounts_engaged') accountsEngagedTotal += v;
    else if (m.name === 'total_interactions') totalInteractionsTotal += v;
  }

  // BUG "|| null efface un vrai 0" (trouvé 2026-08-02) : `sum(...) || null` transformait
  // silencieusement un reach/views/engagement à 0 (fréquent en tout début de journée,
  // avant que Meta agrège plus d'activité) en null, alors que l'API avait bel et bien
  // répondu avec la vraie valeur 0. Résultat observé : ig_reach restait null en base des
  // journées entières malgré un cron qui tournait normalement toutes les 5 min (vérifié
  // via appel direct à l'API Meta insights, qui renvoyait bien reach=0, pas d'erreur).
  // Symptôme trompeur qui ressemblait à "le cron n'écrit qu'une fois par jour" — non, il
  // écrivait à chaque passage, juste toujours la même valeur effacée.
  // Fix : null doit signifier "métrique absente de la réponse Meta" (insightMap[x]
  // undefined), jamais "somme égale à zéro" (sum() renvoie 0, une vraie valeur à garder).
  // Même bug dupliqué et corrigé en même temps dans lib/ig-fetch.ts, lib/ig-metrics-core.ts
  // (copies quasi identiques de cette fonction, voir commentaire ig-metrics-core.ts:6-12),
  // lib/yt-fetch.ts (yt_views etc.), et les upserts shortio_clicks/shortio_human_clicks
  // de ce fichier + app/api/instagram/poll-leads/route.ts + app/api/shortio/refresh-today/route.ts.
  return {
    ig_reach:              insightMap['reach'] !== undefined ? sum(insightMap['reach']) : null,
    ig_followers:          accountData.followers_count ?? null,
    ig_following:          accountData.follows_count ?? null,
    ig_views:              tvMap['views'] ?? null,
    ig_follows_unfollows:  insightMap['follows_and_unfollows'] !== undefined ? sum(insightMap['follows_and_unfollows']) : null,
    ig_profile_taps:       tvMap['profile_links_taps'] ?? null,
    ig_website_clicks:     tvMap['website_clicks'] ?? null,
    ig_accounts_engaged:   (engagedData?.data || []).some((m: any) => m.name === 'accounts_engaged') ? accountsEngagedTotal : null,
    ig_total_interactions: (engagedData?.data || []).some((m: any) => m.name === 'total_interactions') ? totalInteractionsTotal : null,
    ig_reach_follower:     reachFollower,
    ig_reach_non_follower: reachNonFollower,
    ig_lead_count:         null,
    ig_response_rate:      null,
  };
}

async function pollIgComments(profileId: string, token: string, igAccountId: string, since: Date): Promise<{ leadsFound: number; error?: string }> {
  const { data: contentLinks } = await supa
    .from('content_links')
    .select('content_id, lm_keyword, lm_short_url, dm_opener_message, dm_lm_message')
    .eq('profile_id', profileId)
    .not('lm_keyword', 'is', null)
    .not('lm_short_url', 'is', null);

  if (!contentLinks?.length) return { leadsFound: 0 };

  const clByMedia = new Map<string, typeof contentLinks[0]>();
  for (const cl of contentLinks) if (cl.content_id) clByMedia.set(cl.content_id, cl);

  const sinceMs = Math.max(since.getTime(), Date.now() - 48 * 60 * 60 * 1000);
  const sinceDate = new Date(sinceMs);
  let leadsFound = 0;

  try {
    const mediaRes = await fetch(`https://graph.instagram.com/v21.0/${igAccountId}/media?fields=id,permalink,timestamp&limit=30&access_token=${token}`);
    const mediaData = await safeJson(mediaRes);
    const recentMedia = (mediaData.data || []).filter((m: any) => new Date(m.timestamp).getTime() > Date.now() - 90 * 24 * 60 * 60 * 1000);

    for (const media of recentMedia) {
      const cl = clByMedia.get(media.id);
      if (!cl) continue;

      const commRes = await fetch(`https://graph.instagram.com/v21.0/${media.id}/comments?fields=id,text,timestamp,from,username&limit=50&access_token=${token}`);
      const commData = await safeJson(commRes);
      if (commData.error) continue;

      for (const comment of commData.data || []) {
        if (!comment.text) continue;
        if (new Date(comment.timestamp).getTime() < sinceDate.getTime()) continue;
        const text = comment.text.toLowerCase().trim();
        if (!text.includes(cl.lm_keyword!.toLowerCase())) continue;

        const commenterId = comment.from?.id ? String(comment.from.id) : null;
        if (!commenterId) continue;
        const commenterUsername = comment.from?.username || comment.username || '';
        const detectedAt = new Date(comment.timestamp).toISOString();

        // BUG "doublon lm_history" (trouvé 2026-08-13) : ce même commentaire peut aussi
        // être traité par le webhook temps réel, avec un detected_at légèrement différent
        // (le sien vient de value.timestamp, souvent absent → new Date() au moment du
        // traitement). comment.id est l'identifiant Meta stable, identique des deux côtés
        // — clé de dédup fiable, contrairement à detected_at. upsert (pas insert) avec
        // ignoreDuplicates:true : si le webhook a déjà écrit cette ligne, on ne l'écrase
        // pas (onConflict sans update), on détecte juste "déjà vu" via count === 0.
        const { count } = await supa.from('instagram_lead_lm_history').upsert({
          profile_id: profileId, ig_username: commenterUsername || '',
          ig_user_id: commenterId, keyword_matched: cl.lm_keyword,
          media_id: media.id, lm_url: cl.lm_short_url || null,
          lead_magnet_sent: false, detected_at: detectedAt,
          comment_id: comment.id ? String(comment.id) : null,
          ig_account_id: igAccountId,
        }, { onConflict: 'profile_id,ig_user_id,media_id,comment_id', ignoreDuplicates: true, count: 'exact' }).select();
        if (!count || count === 0) continue;

        leadsFound++;

        // Le webhook temps réel (Vercel, app/api/webhooks/instagram/route.ts) traite
        // normalement ce commentaire en quelques secondes et pose lead_magnet_sent=true.
        // Cette Edge Function tourne sur un cron indépendant — si elle retrouve un
        // commentaire déjà traité par le webhook, elle ne doit JAMAIS renvoyer de DM1
        // (un 2e envoi rapproché vers la même personne perd son bouton côté Instagram).
        const { data: existingLead } = await supa
          .from('instagram_leads')
          .select('lead_magnet_sent')
          .eq('profile_id', profileId)
          .eq('ig_user_id', commenterId)
          .eq('media_id', media.id)
          .maybeSingle();

        // BUG "cron écrase lead_magnet_sent" (trouvé 2026-08-13) : upserter lead_magnet_sent
        // en dur à false écrasait en base la vraie valeur true déjà posée par le webhook —
        // le check juste en dessous utilisait la variable existingLead lue AVANT cet
        // écrasement, donc sautait bien le renvoi cette fois-ci, mais remettait le terrain
        // à zéro pour le PROCHAIN passage du cron (5 min après), qui renvoyait alors un vrai
        // 2e DM1. Symptôme observé : DM1 reçu deux fois par la même personne sur le même
        // commentaire, le 2e envoi survenant plusieurs minutes après le premier (pas un
        // doublon rapproché, donc pas couvert par le cooldown/verrou du webhook).
        // Fix : ne poser lead_magnet_sent que si la ligne n'existait pas encore (première
        // détection par CE cron, avant tout traitement webhook) — jamais écraser une valeur
        // déjà présente.
        await supa.from('instagram_leads').upsert({
          profile_id: profileId, source: 'comment',
          ig_username: commenterUsername || null, ig_user_id: commenterId,
          message: comment.text.slice(0, 500), media_id: media.id,
          media_permalink: media.permalink || null, keyword_matched: cl.lm_keyword,
          detected_at: detectedAt, tracking_link: cl.lm_short_url || null,
          ig_account_id: igAccountId,
          ...(existingLead ? {} : { lead_magnet_sent: false }),
        }, { onConflict: 'profile_id,ig_user_id', ignoreDuplicates: false });

        if (existingLead?.lead_magnet_sent) continue;

        if (cl.lm_short_url && cl.dm_lm_message) {
          const buttonText = '🚀 Je veux le lien !';
          const dm1Text = (cl.dm_lm_message || 'Clique sur le bouton pour recevoir le lien !')
            .replace(/\{\{lien_lm\}\}/gi, '')
            .replace(/{{username}}/gi, `@${commenterUsername || 'toi'}`)
            .replace(/\s{2,}/g, ' ')
            .trim();
          try {
            await fetch(`https://graph.instagram.com/v21.0/${igAccountId}/messages`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recipient: { comment_id: comment.id },
                messaging_type: 'RESPONSE',
                message: {
                  attachment: {
                    type: 'template',
                    payload: {
                      template_type: 'generic',
                      elements: [{
                        title: dm1Text.slice(0, 80),
                        buttons: [{ type: 'postback', title: buttonText.slice(0, 20), payload: 'LM_LINK_CLICKED' }],
                      }],
                    },
                  },
                },
                access_token: token,
              }),
            });
            // lead_magnet_sent: true impératif ici — sans lui, le prochain passage du cron
            // (5 min après) relit lead_magnet_sent toujours falsy et renvoie un 3e DM1
            // (même bug que le fix ci-dessus, côté écriture cette fois plutôt que côté
            // écrasement de la valeur webhook).
            await supa.from('instagram_leads')
              .update({ lead_magnet_sent: true, pending_dm2: cl.lm_short_url, pending_dm3: cl.dm_opener_message || null })
              .eq('profile_id', profileId)
              .eq('ig_user_id', commenterId);
          } catch { /* non bloquant */ }
        }
      }
    }
  } catch (e: any) {
    return { leadsFound, error: e?.message };
  }

  if (leadsFound > 0) {
    await supa.from('integrations').update({ last_ig_poll: new Date().toISOString() })
      .eq('profile_id', profileId).eq('provider', 'instagram');
  }
  return { leadsFound };
}

async function pollIgHookReplied(profileId: string, token: string, igAccountId: string): Promise<{ updated: number; error?: string }> {
  let updated = 0;
  try {
    const threadsRes = await fetch(`https://graph.instagram.com/v21.0/${igAccountId}/conversations?fields=id,updated_time,participants,message_count&limit=50&access_token=${token}`);
    const threadsData = await safeJson(threadsRes);
    const since48h = Date.now() - 48 * 60 * 60 * 1000;
    const recentThreads = (threadsData.data || []).filter((t: any) => new Date(t.updated_time).getTime() > since48h);

    await Promise.all(recentThreads.map(async (thread: any) => {
      const participant = thread.participants?.data?.find((p: any) => p.id !== igAccountId);
      if (!participant?.id) return;
      const participantId = String(participant.id);

      const { data: leadToUpdate } = await supa.from('instagram_leads')
        .select('id, hook_replied, hook_replied_at')
        .eq('profile_id', profileId).eq('ig_user_id', participantId)
        .eq('lead_magnet_sent', true).eq('hook_replied', false).maybeSingle();
      if (!leadToUpdate || leadToUpdate.hook_replied_at) return;

      const msgRes = await fetch(`https://graph.instagram.com/v21.0/${thread.id}/messages?fields=id,message,from,created_time&limit=20&access_token=${token}`);
      const msgData = await safeJson(msgRes);
      const leadMessages = (msgData?.data || [])
        .filter((m: any) => m.from?.id && String(m.from.id) !== igAccountId && m.message)
        .sort((a: any, b: any) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime());
      if (!leadMessages.length) return;

      const firstReply = leadMessages[0];
      // .eq('hook_replied', false) ici aussi (pas seulement dans le SELECT plus haut) :
      // ferme la fenêtre de course avec le webhook temps réel (route.ts:683-704), qui
      // écrit à chaque message reçu (pas seulement le premier) et peut poser
      // hook_replied=true entre le SELECT et cet UPDATE. Sans cette clause, le cron
      // écraserait le texte déjà posé par le webhook avec leadMessages[0] (toujours le
      // message le plus ancien, potentiellement différent de ce que le webhook a choisi
      // si plusieurs messages sont arrivés en rafale) — check-then-act non atomique sinon.
      await supa.from('instagram_leads').update({
        hook_replied: true,
        hook_reply_text: firstReply.message?.slice(0, 500) ?? null,
        hook_replied_at: new Date(firstReply.created_time).toISOString(),
      }).eq('id', leadToUpdate.id).eq('hook_replied', false);
      updated++;
    }));
  } catch (e: any) {
    return { updated, error: e?.message };
  }
  return { updated };
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube
// ─────────────────────────────────────────────────────────────────────────────

async function getYtToken(profileId: string): Promise<string | null> {
  const { data: integ } = await supa.from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', profileId).eq('provider', 'youtube').single();
  if (!integ?.access_token) return null;

  const expired = integ.expires_at && new Date(integ.expires_at).getTime() < Date.now() + 5 * 60 * 1000;
  if (!expired) return integ.access_token;
  if (!integ.refresh_token) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: integ.refresh_token, client_id: YOUTUBE_CLIENT_ID, client_secret: YOUTUBE_CLIENT_SECRET }),
  });
  const data = await safeJson(res);
  if (!data.access_token) return null;

  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;
  await supa.from('integrations').update({ access_token: data.access_token, expires_at: expiresAt })
    .eq('profile_id', profileId).eq('provider', 'youtube');
  return data.access_token;
}

/**
 * @param avecRepartitions false pour ne demander que les metriques journalieres.
 *
 * Les quatre repartitions (sources de trafic, appareils, demographie, mots-cles)
 * portent sur une fenetre FIXE de 30 jours glissants : une journee de plus ou de moins
 * ne deplace quasiment rien dans un cumul mensuel. Les redemander a chaque
 * synchronisation coutait 4 des 7 appels pour une donnee qui bouge lentement.
 *
 * Elles ne sont donc rafraichies qu'une fois par jour, contre une fois par heure pour
 * les metriques journalieres. Le cout par profil passe de 7 a 3 appels sur 23 des
 * 24 synchronisations quotidiennes.
 */
async function fetchYtDayMetrics(accessToken: string, startDate: string, endDate: string, avecRepartitions = true) {
  const auth = { Authorization: `Bearer ${accessToken}` };
  // 30 jours glissants avant endDate — fenetre des repartitions (voir plus bas).
  const repartitionStart = new Date(new Date(endDate).getTime() - 30 * 86400_000)
    .toISOString().split('T')[0];
  // Reponse neutre pour les appels omis : le code en aval lit `.rows`, une reponse
  // vide produit donc des tableaux vides, et les colonnes JSONB correspondantes ne
  // sont pas ecrites (le mapping les conditionne deja a leur presence).
  const sauteAppel = () => Promise.resolve(new Response('{}', { status: 200 }));
  const [channelRes, analyticsRes, byTypeRes, trafficRes, devicesRes, demoRes, keywordsRes] = await Promise.all([
    fetch('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', { headers: auth }),
    fetch(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate}&endDate=${endDate}&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares,averageViewDuration&dimensions=day&sort=day`, { headers: auth }),
    // ⚠️ Équivalent Deno de la requête ventilée de lib/yt-fetch.ts — même fenêtre,
    // découpée par format (creatorContentType). Toute modification ici doit y être
    // répercutée. Sert la courbe « Watch time moyen », qui distingue Shorts et vidéos
    // longues — distinction que yt_avg_view_duration_sec (tous formats confondus) ne
    // permet pas, et qui était donc simulée jusqu'au 2026-08-20.
    fetch(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate}&endDate=${endDate}&metrics=views,averageViewDuration,estimatedMinutesWatched&dimensions=day,creatorContentType&sort=day`, { headers: auth }),
    // Sources de trafic, appareils et demographie : repartitions CUMULEES, pas des
    // series journalieres. Stockees en JSONB sur la ligne du dernier jour, que
    // l'affichage lit en mode historique.
    //
    // ⚠️ Fenetre de 30 JOURS, pas celle passee en parametre : le cron n'interroge que
    // les 3 derniers jours pour les metriques journalieres (suffisant, elles sont
    // reecrites chaque jour), mais une repartition sur 3 jours ne veut rien dire —
    // l'affichage attend « les sources de trafic des 30 derniers jours ». Constate le
    // 2026-08-21 : la base ne contenait qu'une source (YT_SEARCH, 1 vue) la ou l'API
    // sur 30 jours en renvoie sept.
    //
    // Ces trois colonnes existaient et etaient LUES par PageClientStats, mais aucun code
    // ne les ecrivait : 266 lignes en base, 0 remplie.
    avecRepartitions ? fetch(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${repartitionStart}&endDate=${endDate}&metrics=views,estimatedMinutesWatched&dimensions=insightTrafficSourceType&sort=-views`, { headers: auth }) : sauteAppel(),
    avecRepartitions ? fetch(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${repartitionStart}&endDate=${endDate}&metrics=views,estimatedMinutesWatched&dimensions=deviceType&sort=-views`, { headers: auth }) : sauteAppel(),
    avecRepartitions ? fetch(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${repartitionStart}&endDate=${endDate}&metrics=viewerPercentage&dimensions=ageGroup,gender`, { headers: auth }) : sauteAppel(),
    // Top 10 des termes de recherche. Meme fenetre de 30 jours que les autres
    // repartitions : un « top des termes du 15 aout » n'aurait pas de sens.
    avecRepartitions ? fetch(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${repartitionStart}&endDate=${endDate}&metrics=views&dimensions=insightTrafficSourceDetail&filters=insightTrafficSourceType==YT_SEARCH&sort=-views&maxResults=10`, { headers: auth }) : sauteAppel(),
  ]);
  // D1 : un statut HTTP non-2xx sur l'Analytics API (429 rate limit, 5xx...) doit
  // être une vraie erreur, pas silencieusement traité comme "pas encore de données".
  // safeJson() absorbe tout, donc sans ce check un corps d'erreur Google (sans clé
  // rows) redevient rows=[] indistinguable d'un délai de traitement normal.
  if (!analyticsRes.ok) {
    const errBody = await analyticsRes.text().catch(() => '');
    throw new Error(`yt_analytics_http_${analyticsRes.status}: ${errBody.slice(0, 300)}`);
  }
  const [channelData, analyticsData, byTypeData, trafficData, devicesData, demoData, keywordsData] = await Promise.all([
    safeJson(channelRes), safeJson(analyticsRes), safeJson(byTypeRes),
    safeJson(trafficRes), safeJson(devicesRes), safeJson(demoRes), safeJson(keywordsRes),
  ]);
  // Mis en forme au format attendu par PageClientStats (cf. types YTStats). Pas de throw
  // si l'une echoue : ces repartitions sont un complement, leur absence ne doit pas faire
  // perdre les metriques principales du jour.
  // null (pas []) quand l'appel a ete saute : le mapping conditionne l'ecriture de ces
  // colonnes a une valeur truthy, or un tableau VIDE est truthy en JavaScript. Sans ce
  // null, sauter les repartitions les ECRASERAIT par des tableaux vides et les quatre
  // cartes se videraient a la premiere synchronisation horaire de la journee.
  //
  // Le HTTP est verifie avant de mapper : une reponse d'erreur Google ne porte pas de
  // cle « rows », et le repli sur un tableau vide la rendait indistinguable d'un vrai
  // « aucune source de trafic » — puis l'ecrivait par-dessus des donnees valides. Un
  // echec laisse desormais la colonne intacte, comme un appel saute.
  const repOk = (res: Response, data: any) => avecRepartitions && res.ok && Array.isArray(data?.rows);
  const ytTrafficSources = repOk(trafficRes, trafficData) ? (trafficData.rows as any[]).map(r => ({ source: r[0], views: r[1] ?? 0, watchMinutes: r[2] ?? 0 })) : null;
  const ytDevices        = repOk(devicesRes, devicesData) ? (devicesData.rows as any[]).map(r => ({ device: r[0], views: r[1] ?? 0, watchMinutes: r[2] ?? 0 })) : null;
  const ytDemographics   = repOk(demoRes, demoData) ? (demoData.rows as any[]).map(r => ({ ageGroup: r[0], gender: r[1], viewerPct: r[2] ?? 0 })) : null;
  const ytSearchKeywords = repOk(keywordsRes, keywordsData) ? (keywordsData.rows as any[]).map(r => ({ term: r[0], views: r[1] ?? 0 })) : null;

  // day -> ventilation par format. L'API n'émet une ligne que pour les formats ayant eu
  // des vues ce jour-là : null quand le format est absent, jamais un faux 0.
  // Pas de throw si cette requête échoue : la ventilation est un complément, son absence
  // ne doit pas faire perdre les métriques principales du jour.
  const byType = new Map<string, { shortsDur: number | null; longDur: number | null; shortsViews: number | null; longViews: number | null; shortsWatch: number | null; longWatch: number | null }>();
  for (const br of (byTypeData?.rows ?? []) as any[]) {
    // colonnes : day(0), creatorContentType(1), views(2), averageViewDuration(3),
    // estimatedMinutesWatched(4) — deja en MINUTES, pas de division (cf. le bug du
    // 2026-08-20 sur yt_watch_time_min).
    const [bday, btype, bviews, bavg, bwatch] = br;
    const cur = byType.get(bday) ?? { shortsDur: null, longDur: null, shortsViews: null, longViews: null, shortsWatch: null, longWatch: null };
    if (btype === 'shorts') { cur.shortsDur = bavg ?? null; cur.shortsViews = bviews ?? null; cur.shortsWatch = bwatch ?? null; }
    else if (btype === 'videoOnDemand') { cur.longDur = bavg ?? null; cur.longViews = bviews ?? null; cur.longWatch = bwatch ?? null; }
    byType.set(bday, cur);
  }
  // ?? plutôt que || : un vrai 0 (0 vue, 0 like, 0 commentaire...) est une donnée
  // légitime, pas une absence de donnée — || le convertissait à tort en null.
  const subscribers = parseInt(channelData?.items?.[0]?.statistics?.subscriberCount ?? '0') ?? null;
  // Total d'abonnes : Data API v3, connu EN TEMPS REEL, sans le delai de 2-3 jours de
  // l'Analytics API. Il n'etait ecrit que sur les lignes renvoyees par l'Analytics —
  // donc jamais sur les jours recents, ou le compteur restait vide alors que sa valeur
  // etait disponible (constate le 2026-08-21 : rien du 19 au 21 aout).
  // Expose separement pour pouvoir l'ecrire sur le jour courant.
  const subscribersNow = subscribers;
  const rows: any[] = analyticsData?.rows || [];
  // D2 : signaler seulement si le jour le PLUS ANCIEN de la fenêtre demandée (startDate)
  // est absent — Google a largement eu le temps de le traiter. Si seul endDate (le plus
  // récent) manque, c'est le délai normal de 2-3 jours documenté par Google, pas suspect.
  if (!rows.some((r: any) => r[0] === startDate)) {
    console.error(`[poll-leads] yt_missing_oldest_day: startDate=${startDate} endDate=${endDate} reçu=${rows.length} jour(s), startDate absent de la réponse Analytics API`);
  }
  return { subscribersNow, rows: rows.map((r: any, i: number) => ({
    date: r[0], yt_views: r[1] ?? null,
    // `estimatedMinutesWatched` est DÉJÀ en minutes (le nom de la métrique le dit).
    // Le /60 qui était ici la traitait comme des secondes : tout jour sous 30 minutes
    // de visionnage était arrondi à 0. Sur le profil de test, 45 jours avec des vues
    // affichaient 0 min pour ~82 min réelles. Corrigé le 2026-08-20 ; deux autres
    // chemins traitaient déjà cette valeur sans diviser (poll-leads:1045 par vidéo,
    // app/api/youtube/stats:177).
    // Pas d'arrondi : la colonne est numeric(12,2). Arrondir à l'entier reperdrait
    // toute journée sous 1 minute — le défaut même qu'on corrige.
    yt_watch_time_min: r[2] ?? null,
    yt_subscribers: subscribers, yt_subs_gained: r[3] ?? null, yt_subs_lost: r[4] ?? null,
    // Le `?? null` en fin d'expression etait mort : une soustraction de deux nombres
    // n'est jamais nullish, et Deno le signalait (TS2869). Il masquait un vrai defaut —
    // quand les DEUX termes manquent, la donnee est inconnue, et le calcul ecrivait
    // quand meme 0, c'est-a-dire « aucun mouvement d'abonnes ce jour-la ». Un faux zero
    // la ou il faut un trou. Corrige le 2026-08-21.
    yt_net_subs: (r[3] == null && r[4] == null) ? null : ((r[3] ?? 0) - (r[4] ?? 0)),
    yt_likes: r[5] ?? null,
    yt_comments: r[6] ?? null, yt_shares: r[7] ?? null, yt_avg_view_duration_sec: r[8] ?? null,
    yt_avg_duration_shorts_sec: byType.get(r[0])?.shortsDur ?? null,
    yt_avg_duration_long_sec:   byType.get(r[0])?.longDur ?? null,
    yt_views_shorts:            byType.get(r[0])?.shortsViews ?? null,
    yt_views_long:              byType.get(r[0])?.longViews ?? null,
    yt_watch_time_shorts_min:   byType.get(r[0])?.shortsWatch ?? null,
    yt_watch_time_long_min:     byType.get(r[0])?.longWatch ?? null,
    // Agregats de fenetre : portes UNIQUEMENT par la derniere ligne. Les repartir sur
    // chaque jour serait faux (ce sont des cumuls sur toute la periode), et l'affichage
    // lit justement le dernier snapshot (lastSnap?.yt_traffic_sources).
    yt_traffic_sources: i === rows.length - 1 ? ytTrafficSources : null,
    yt_devices:         i === rows.length - 1 ? ytDevices        : null,
    yt_demographics:    i === rows.length - 1 ? ytDemographics   : null,
    yt_search_keywords: i === rows.length - 1 ? ytSearchKeywords  : null,
  })) };
}

function parseReachCsv(text: string): { video_id: string; impressions: number; clicks: number }[] {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const vidIdx = headers.indexOf('video_id');
  const impIdx = headers.indexOf('video_thumbnail_impressions');
  const ctrIdx = headers.indexOf('video_thumbnail_impressions_ctr');
  if (vidIdx < 0 || impIdx < 0 || ctrIdx < 0) return [];
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const impressions = parseFloat(vals[impIdx] || '0') || 0;
    const ctr = parseFloat(vals[ctrIdx] || '0') || 0;
    return { video_id: vals[vidIdx], impressions, clicks: impressions * ctr };
  }).filter(r => r.video_id);
}

async function syncYtCtr(profileId: string, accessToken: string): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  const auth = { Authorization: `Bearer ${accessToken}` };

  const jobsRes = await fetch('https://youtubereporting.googleapis.com/v1/jobs', { headers: auth });
  const jobsData = await safeJson(jobsRes);
  const reachJob = (jobsData.jobs || []).find((j: any) => j.reportTypeId === 'channel_reach_basic_a1');
  if (!reachJob) return { synced: 0, errors: [] };

  const { data: syncState } = await supa.from('youtube_ctr_sync_state')
    .select('last_report_id, reports_processed, job_created_at').eq('profile_id', profileId).single();

  if (!syncState?.job_created_at && reachJob.createTime) {
    await supa.from('youtube_ctr_sync_state').upsert({ profile_id: profileId, job_created_at: reachJob.createTime }, { onConflict: 'profile_id', ignoreDuplicates: false });
  }

  const reportsRes = await fetch(`https://youtubereporting.googleapis.com/v1/jobs/${reachJob.id}/reports`, { headers: auth });
  const reportsData = await safeJson(reportsRes);
  const allReports: any[] = (reportsData.reports || []).sort((a: any, b: any) => new Date(a.endTime).getTime() - new Date(b.endTime).getTime());

  const lastReportId = syncState?.last_report_id ?? null;
  const lastIdx = lastReportId ? allReports.findIndex(r => r.id === lastReportId) : -1;
  const newReports = lastIdx >= 0 ? allReports.slice(lastIdx + 1) : allReports;
  if (newReports.length === 0) return { synced: 0, errors: [] };

  const perVideoMap: Record<string, { impressions: number; clicks: number }> = {};
  await Promise.all(newReports.map(async (report: any) => {
    try {
      const dlRes = await fetch(report.downloadUrl, { headers: auth });
      if (!dlRes.ok) { errors.push(`dl_${report.id}: HTTP ${dlRes.status}`); return; }
      const buf = await dlRes.arrayBuffer();
      const csv = await gunzip(buf);
      const rows = parseReachCsv(csv);
      for (const r of rows) {
        if (!perVideoMap[r.video_id]) perVideoMap[r.video_id] = { impressions: 0, clicks: 0 };
        perVideoMap[r.video_id].impressions += r.impressions;
        perVideoMap[r.video_id].clicks += r.clicks;
      }
    } catch (e: any) { errors.push(`parse_${report.id}: ${e?.message || 'unknown'}`); }
  }));

  const latestReport = newReports[newReports.length - 1];

  if (Object.keys(perVideoMap).length > 0) {
    const upsertRows = Object.entries(perVideoMap).map(([video_id, s]) => ({
      profile_id: profileId, video_id,
      impressions: Math.round(s.impressions),
      clicks: parseFloat(s.clicks.toFixed(4)),
      updated_at: new Date().toISOString(),
    }));
    const BATCH = 50;
    for (let i = 0; i < upsertRows.length; i += BATCH) {
      const batch = upsertRows.slice(i, i + BATCH);
      const { error } = await supa.rpc('upsert_yt_ctr', { rows: batch });
      if (error) {
        const { error: upsertErr } = await supa.from('youtube_video_ctr').upsert(batch, { onConflict: 'profile_id,video_id', ignoreDuplicates: false });
        if (upsertErr) errors.push(`upsert_batch_${i}: ${upsertErr.message}`);
      }
    }
  }

  await supa.from('youtube_ctr_sync_state').upsert({
    profile_id: profileId, last_report_id: latestReport.id,
    last_synced_at: new Date().toISOString(),
    reports_processed: (syncState?.reports_processed ?? 0) + newReports.length,
  }, { onConflict: 'profile_id' });

  return { synced: Object.keys(perVideoMap).length, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Short.io
// ─────────────────────────────────────────────────────────────────────────────

async function getShortioLinkCreds(profileId: string): Promise<{ apiKey: string; domain: string; domainId: string; allDomains: { id: number | string; hostname: string }[] } | null> {
  const { data: integ } = await supa.from('integrations')
    .select('api_key, metadata').eq('profile_id', profileId).eq('provider', 'shortio').single();
  if (!integ?.api_key) return null;
  const domain = (integ.metadata as any)?.domain || null;
  const domainId = (integ.metadata as any)?.domain_id || null;
  if (!domain || !domainId) return null;
  const allDomains = (integ.metadata as any)?.all_domains || [];
  return { apiKey: integ.api_key, domain, domainId: String(domainId), allDomains };
}

async function fetchShortioLinks(creds: { apiKey: string; domainId: string }) {
  const allLinks: any[] = [];
  let beforeId: string | null = null;
  const limit = 150;
  while (true) {
    const url = new URL('https://api.short.io/api/links');
    url.searchParams.set('domain_id', creds.domainId);
    url.searchParams.set('limit', String(limit));
    if (beforeId) url.searchParams.set('beforeId', beforeId);
    const res = await shortio.run(() => fetch(url.toString(), { headers: { authorization: creds.apiKey, accept: 'application/json' } }));
    if (!res.ok) throw new Error(`Short.io links ${res.status}`);
    const data = await safeJson(res);
    const page: any[] = data?.links || [];
    allLinks.push(...page);
    if (page.length < limit) break;
    beforeId = String(page[page.length - 1].id);
  }
  return allLinks;
}

async function snapshotShortioLinks(profileId: string, creds: { apiKey: string; domain: string; domainId: string }): Promise<{
  errors: string[];
  rawClicks: { path: string; dt: string; human: boolean }[];
  resolveLinkCategory: (path: string, shortUrl: string, linkType: string | null) => string | null;
  dateToday: string;
}> {
  const errors: string[] = [];
  const dateToday = isoDate(0);
  const dateYesterday = isoDate(1);
  const noopCategory = () => null;
  let links: any[];
  try { links = await fetchShortioLinks(creds); } catch (e: any) { return { errors: [`fetch_links: ${e?.message}`], rawClicks: [], resolveLinkCategory: noopCategory, dateToday }; }
  if (!links.length) return { errors: [], rawClicks: [], resolveLinkCategory: noopCategory, dateToday };

  // Préchargement des tables de référence pour le calcul de link_category
  const [{ data: contentLinksRows }, { data: prospectLinksRows }] = await Promise.all([
    supa.from('content_links').select('platform, desc_calendly_short_url, desc_lm_short_url, lm_short_url').eq('profile_id', profileId),
    supa.from('prospect_links').select('short_url').eq('profile_id', profileId),
  ]);

  // Maps url → catégorie pour lookup O(1)
  const descCalendlyIg = new Set<string>();
  const descCalendlyYt = new Set<string>();
  const descLmIg = new Set<string>();
  const descLmYt = new Set<string>();
  const lmDmAutoUrls = new Set<string>();
  for (const cl of contentLinksRows ?? []) {
    const platform = (cl.platform || '').toUpperCase();
    if (cl.desc_calendly_short_url) (platform === 'YT' ? descCalendlyYt : descCalendlyIg).add(cl.desc_calendly_short_url.toLowerCase());
    if (cl.desc_lm_short_url) (platform === 'YT' ? descLmYt : descLmIg).add(cl.desc_lm_short_url.toLowerCase());
    if (cl.lm_short_url) lmDmAutoUrls.add(cl.lm_short_url.toLowerCase());
  }
  const prospectUrls = new Set<string>((prospectLinksRows ?? []).map((pl: any) => (pl.short_url || '').toLowerCase()));

  // Détermine link_category à partir du path, link_type et des maps de référence
  const resolveLinkCategory = (path: string, shortUrl: string, linkType: string | null): string | null => {
    const p = path.toLowerCase();
    const u = shortUrl.toLowerCase();
    if (linkType === 'bio') {
      const hasIg = p.includes('ig') || p.includes('-ig');
      const hasYt = p.includes('yt') || p.includes('-yt');
      const isCalendly = p.includes('calendly') || p.startsWith('bio-calendly');
      const isLm = p.startsWith('lm-bio') || p.startsWith('lm-');
      if (isCalendly && hasIg) return 'calendly_bio_ig';
      if (isCalendly && hasYt) return 'calendly_bio_yt';
      if (isLm && hasYt) return 'lm_bio_yt';
      if (isLm && hasIg) return 'lm_bio_ig';
      if (hasIg) return 'calendly_bio_ig';
      if (hasYt) return 'calendly_bio_yt';
    }
    if (linkType === 'description') {
      if (descCalendlyIg.has(u)) return 'calendly_desc_ig';
      if (descCalendlyYt.has(u)) return 'calendly_desc_yt';
      if (descLmIg.has(u)) return 'lm_desc_ig';
      if (descLmYt.has(u)) return 'lm_desc_yt';
    }
    if (linkType === 'leadmagnet' || (linkType === null && (p.startsWith('lm-') || p.startsWith('guide-') || p.startsWith('beau-')))) {
      if (lmDmAutoUrls.has(u)) return 'lm_dm_auto';
      // leadmagnet orphelin (lien LM DM auto sans content_link correspondant)
      return 'lm_dm_auto';
    }
    if (linkType === 'dm' || (linkType === null && (p.includes('prendre-rdv') || p.includes('christian') || p.includes('incogniton')))) {
      if (prospectUrls.has(u)) return 'calendly_dm_prospect';
      if (p.startsWith('lm-')) return 'lm_dm_auto';
      return 'calendly_dm_prospect';
    }
    // Lien Calendly d'une séquence story — généré par POST /api/client/story-sequences
    // avec utm_medium=story et path=story-calendly-{slug}. Le CTA Lead Magnet d'une
    // séquence n'a pas de lien Short.io propre (mot-clé en reply, pas de clic à tracker
    // ici) — seule la catégorie Calendly a besoin d'exister côté link_category.
    if (linkType === 'story') return 'calendly_story';
    return null;
  };

  // Récupérer last_clicks une seule fois pour J-0 — stable vs API stats (eventually consistent).
  // rawClicks est aussi retourné à l'appelant (voir fin de fonction) pour que
  // syncLmClickStream réutilise ce même appel au lieu de refaire une requête identique
  // (même afterDate 48h, même endpoint) juste après — la duplication provoquait un
  // rate limit 429 Short.io sur le second appel (découvert via les logs D3 du 2026-07-26).
  const todayClicksByPath = new Map<string, number>();
  let rawClicks: { path: string; dt: string; human: boolean }[] = [];
  try {
    const afterDate48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const lcRes = await shortio.run(() => fetch(`https://api-v2.short.io/statistics/domain/${creds.domainId}/last_clicks`, {
      method: 'POST',
      headers: { authorization: creds.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ limit: 500, afterDate: afterDate48h }),
    }));
    if (lcRes.ok) {
      const lcData = await safeJson(lcRes);
      rawClicks = lcData?.clicks ?? lcData ?? [];
      for (const click of rawClicks) {
        if (!click.human || !click.path) continue;
        const clickDate = click.dt ? isoDateFromInstant(click.dt) : dateToday;
        if (clickDate !== dateToday) continue;
        const p = click.path.replace(/^\//, '');
        todayClicksByPath.set(p, (todayClicksByPath.get(p) ?? 0) + 1);
      }
    }
  } catch { /* non bloquant — fallback sur API stats si last_clicks échoue */ }

  // Construit un index path → link_id pour mapper last_clicks vers les liens
  const pathToLinkId = new Map<string, string>();
  for (const l of links) if (l.path) pathToLinkId.set(l.path, String(l.id));

  // Helper : snapshot un lien pour une période donnée
  const snapshotLink = async (l: any, period: string, date: string) => {
    const linkId = String(l.id);
    const path = l.path || '';
    const shortUrl = l.secureShortURL || l.shortURL || `https://${creds.domain}/${path}`;
    const originalUrl = l.originalURL || '';
    let link_type: string | null = null;
    try { link_type = new URL(originalUrl).searchParams.get('utm_medium') || null; } catch {}
    const link_category = resolveLinkCategory(path, shortUrl, link_type);

    // Pour J-0 : utiliser last_clicks (stable) plutôt que l'API stats (eventually consistent)
    // Pour J-1 : API stats (données finalisées = fiables)
    let human_clicks: number;
    let total_clicks: number;
    let stats: any = {};

    if (period === 'today') {
      human_clicks = todayClicksByPath.get(path) ?? 0;
      total_clicks = human_clicks; // last_clicks ne retourne que les clics humains
    } else {
      const statsRes = await shortio.run(() => fetch(`https://api-v2.short.io/statistics/link/${linkId}?period=${period}`, { headers: { authorization: creds.apiKey, accept: 'application/json' } }));
      stats = statsRes.ok ? await safeJson(statsRes) : {};
      human_clicks = Number(stats.humanClicks ?? 0);
      total_clicks = Number(stats.totalClicks ?? 0);
    }

    // Passe par la RPC upsert_shortio_link_snapshot (déjà utilisée côté refresh-today/
    // lib/shortio-fetch.ts) au lieu d'un upsert direct de table — son ON CONFLICT fait
    // GREATEST(existant, nouveau) sur human_clicks/total_clicks, ce qu'un upsert direct
    // ne fait pas. Sans ça, un run 'today' dont last_clicks n'a pas encore indexé un clic
    // très récent (délai de propagation Short.io) écrasait un compteur déjà correct à 0 —
    // reproduit et confirmé le 2026-08-14 (human_clicks 1 → 0 entre deux runs cron).
    await supa.rpc('upsert_shortio_link_snapshot', {
      p_profile_id: profileId, p_link_id: linkId, p_path: path, p_short_url: shortUrl,
      p_original_url: originalUrl, p_date: date, p_human_clicks: human_clicks, p_total_clicks: total_clicks,
      p_link_type: link_type,
      p_top_countries: (stats.country || []).filter((c: any) => c.score > 0).slice(0, 8).map((c: any) => ({ label: c.countryName || c.country || 'Inconnu', code: c.country || '', value: Number(c.score) })),
      p_top_referrers: (stats.referer || []).filter((r: any) => r.score > 0).slice(0, 8).map((r: any) => ({ label: r.refhost || 'Direct', value: Number(r.score) })),
      p_top_browsers: (stats.browser || []).filter((b: any) => b.score > 0).slice(0, 8).map((b: any) => ({ label: b.browser || 'Inconnu', value: Number(b.score) })),
      p_top_os: (stats.os || []).filter((o: any) => o.score > 0).slice(0, 8).map((o: any) => ({ label: o.os || 'Inconnu', value: Number(o.score) })),
      p_top_social: (stats.social || []).filter((s: any) => s.score > 0).slice(0, 8).map((s: any) => ({ label: s.social || 'Direct', value: Number(s.score) })),
      p_top_cities: (stats.city || []).filter((c: any) => c.score > 0).slice(0, 8).map((c: any) => ({ label: `${c.name || '?'} (${c.countryCode || '?'})`, value: Number(c.score) })),
      p_utm_sources: (stats.utm_source || []).filter((u: any) => u.score > 0 && u.utm_source).slice(0, 8).map((u: any) => ({ label: u.utm_source, value: Number(u.score) })),
      p_utm_mediums: (stats.utm_medium || []).filter((u: any) => u.score > 0 && u.utm_medium).slice(0, 8).map((u: any) => ({ label: u.utm_medium, value: Number(u.score) })),
      p_backfill_source: 'cron',
      p_link_category: link_category,
    });
  };

  // Snapshot agrégat domaine J-1 + J-0 en parallèle
  await Promise.allSettled([
    shortio.run(() => fetch(`https://api-v2.short.io/statistics/domain/${creds.domainId}?period=yesterday`, { headers: { authorization: creds.apiKey, accept: 'application/json' } }))
      .then(r => r.ok ? safeJson(r) : null)
      .then(domainStats => domainStats && supa.from('analytics_daily_snapshots').upsert({
        profile_id: profileId, date: dateYesterday,
        shortio_clicks: Number(domainStats.clicks ?? 0),
        shortio_human_clicks: Number(domainStats.humanClicks ?? 0),
        shortio_top_countries: (domainStats.country || []).filter((c: any) => c.score > 0).slice(0, 8).map((c: any) => ({ label: c.countryName || c.country, code: c.country, value: c.score })),
        shortio_top_referrers: (domainStats.referer || []).filter((r: any) => r.score > 0).slice(0, 8).map((r: any) => ({ label: r.refhost || 'Direct', value: r.score })),
      }, { onConflict: 'profile_id,date', ignoreDuplicates: false })),
    shortio.run(() => fetch(`https://api-v2.short.io/statistics/domain/${creds.domainId}?period=today`, { headers: { authorization: creds.apiKey, accept: 'application/json' } }))
      .then(r => r.ok ? safeJson(r) : null)
      .then(domainStats => domainStats && supa.from('analytics_daily_snapshots').upsert({
        profile_id: profileId, date: dateToday,
        shortio_clicks: Number(domainStats.clicks ?? 0),
        shortio_human_clicks: Number(domainStats.humanClicks ?? 0),
        shortio_top_countries: (domainStats.country || []).filter((c: any) => c.score > 0).slice(0, 8).map((c: any) => ({ label: c.countryName || c.country, code: c.country, value: c.score })),
        shortio_top_referrers: (domainStats.referer || []).filter((r: any) => r.score > 0).slice(0, 8).map((r: any) => ({ label: r.refhost || 'Direct', value: r.score })),
      }, { onConflict: 'profile_id,date', ignoreDuplicates: false })),
  ]);

  // Snapshot par lien : J-1 + J-0 en parallèle
  const settled = await Promise.allSettled(links.flatMap((l: any) => [
    snapshotLink(l, 'yesterday', dateYesterday),
    snapshotLink(l, 'today', dateToday),
  ]));

  for (const s of settled) if (s.status === 'rejected') errors.push(String(s.reason?.message || 'link_snapshot_failed'));
  return { errors, rawClicks, resolveLinkCategory, dateToday };
}

// Tracke les clics des liens Momentum restés sur d'anciens domaines (après un changement
// de domaine actif — voir integrations.metadata.all_domains). Le domaine actif est déjà
// couvert par snapshotShortioLinks ci-dessus ; cette fonction complète pour les autres.
// Séquentiel (pas Promise.all) par précaution rate-limit — le volume réel est faible
// (1 appel liste + 1 appel last_clicks par ancien domaine, zéro pour les profils n'ayant
// jamais changé de domaine), mais un incident 429 est déjà survenu en prod (2026-07-26,
// cf. commentaire plus haut) pour un doublon d'appel similaire — mieux vaut rester prudent.
// Ne couvre QUE les liens Momentum reconnus (resolveLinkCategory non-null) — un lien créé
// manuellement par l'utilisateur hors app sur ce domaine est hors scope, jamais tracké.
// Ne maintient que human_clicks/total_clicks du jour (via last_clicks) — pas les stats
// détaillées (top_countries, etc.) ni J-1, qui n'ont plus d'intérêt pratique pour un
// domaine que l'utilisateur est en train d'abandonner.
async function snapshotOldDomainLinks(
  profileId: string,
  apiKey: string,
  activeDomainId: string,
  allDomains: { id: number | string; hostname: string }[],
  resolveLinkCategory: (path: string, shortUrl: string, linkType: string | null) => string | null,
  dateToday: string,
): Promise<string[]> {
  const errors: string[] = [];
  const oldDomains = allDomains.filter(d => String(d.id) !== String(activeDomainId));
  if (!oldDomains.length) return errors;

  // Cause confirmée en prod le 2026-08-14 via instrumentation des headers de réponse :
  // Short.io renvoie x-ratelimit-limit=60, x-ratelimit-remaining=0, x-ratelimit-reset=48
  // sur cet endpoint précis. Le quota (60 req/fenêtre) était déjà épuisé au moment de
  // l'appel, avec ~48s avant réinitialisation — largement au-delà des pauses fixes
  // testées avant (1.5s puis 5s, toutes deux sans effet, cf. git blame). Cause probable :
  // ce domaine "ancien" pour ce profil est le domaine ACTIF d'autres profils du même
  // run cron (vérifié en base : 2 autres profils ont ubizenai.s.gy comme domaine actif),
  // dont les propres appels last_clicks/statistics consomment le même quota avant que
  // ce profil-ci ne tente le sien.
  //
  // Fix initial (2026-08-14) : lire x-ratelimit-reset et attendre ce délai exact avant
  // un unique retry, sur CE seul appel. Fix généralisé (2026-08-19) : le limiteur
  // partagé `shortio` applique désormais sémaphore + token bucket + backoff à TOUS
  // les appels Short.io du run, ce qui traite la cause (rafale au-delà du quota)
  // plutôt que le seul symptôme observé ici.

  for (const oldDomain of oldDomains) {
    try {
      const links = await fetchShortioLinks({ apiKey, domainId: String(oldDomain.id) });
      if (!links.length) continue;

      const momentumLinks = links.filter((l: any) => {
        let linkType: string | null = null;
        try { linkType = new URL(l.originalURL || '').searchParams.get('utm_medium') || null; } catch {}
        const shortUrl = l.secureShortURL || l.shortURL || `https://${oldDomain.hostname}/${l.path || ''}`;
        return resolveLinkCategory(l.path || '', shortUrl, linkType) !== null;
      });
      if (!momentumLinks.length) continue;

      const afterDate48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const callLastClicks = () => fetch(`https://api-v2.short.io/statistics/domain/${oldDomain.id}/last_clicks`, {
        method: 'POST',
        headers: { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ limit: 500, afterDate: afterDate48h }),
      });

      // Le retry 429 manuel qui était ici est désormais assuré par le limiteur
      // partagé (backoff exponentiel + jitter + lecture de x-ratelimit-reset),
      // qui couvre en plus TOUS les autres appels Short.io — pas seulement
      // celui-ci. MAX_RATE_LIMIT_WAIT_MS est conservé côté limiteur.
      const lcRes = await shortio.run(callLastClicks);
      if (!lcRes.ok) { errors.push(`old_domain_${oldDomain.id}_last_clicks: HTTP ${lcRes.status}`); continue; }

      const lcData = await safeJson(lcRes);
      const rawClicks: { path: string; dt: string; human: boolean }[] = lcData?.clicks ?? lcData ?? [];
      const clicksByPath = new Map<string, number>();
      for (const click of rawClicks) {
        if (!click.human || !click.path) continue;
        const clickDate = click.dt ? isoDateFromInstant(click.dt) : dateToday;
        if (clickDate !== dateToday) continue;
        const p = click.path.replace(/^\//, '');
        clicksByPath.set(p, (clicksByPath.get(p) ?? 0) + 1);
      }

      for (const l of momentumLinks) {
        const linkId = String(l.id);
        const path = l.path || '';
        const shortUrl = l.secureShortURL || l.shortURL || `https://${oldDomain.hostname}/${path}`;
        let linkType: string | null = null;
        try { linkType = new URL(l.originalURL || '').searchParams.get('utm_medium') || null; } catch {}
        const humanClicks = clicksByPath.get(path) ?? 0;

        // top_*/utm_* à null (pas []) : la RPC fait COALESCE(EXCLUDED.x, existant.x) — null
        // laisse les stats détaillées d'un run précédent intactes, [] les écraserait à vide.
        await supa.rpc('upsert_shortio_link_snapshot', {
          p_profile_id: profileId, p_link_id: linkId, p_path: path, p_short_url: shortUrl,
          p_original_url: l.originalURL || '', p_date: dateToday, p_human_clicks: humanClicks, p_total_clicks: humanClicks,
          p_link_type: linkType,
          p_top_countries: null, p_top_referrers: null, p_top_browsers: null, p_top_os: null, p_top_social: null, p_top_cities: null,
          p_utm_sources: null, p_utm_mediums: null,
          p_backfill_source: 'cron',
          p_link_category: resolveLinkCategory(path, shortUrl, linkType),
        });
      }
    } catch (e: any) {
      errors.push(`old_domain_${oldDomain.id}: ${e?.message || 'unknown'}`);
    }
    // Pause entre chaque ancien domaine — conservée en complément du token bucket :
    // elle lisse les rafales de requêtes Supabase (RPC upsert par lien), que le
    // limiteur Short.io ne couvre pas.
    await sleep(100);
  }

  return errors;
}

// rawClicks vient désormais de snapshotShortioLinks (même fenêtre afterDate 48h, même
// endpoint Short.io) — ne refait plus l'appel réseau, qui provoquait un rate limit 429
// en se déclenchant juste après le premier appel identique dans le même run.
async function syncLmClickStream(profileId: string, rawClicks: { path: string; dt: string; human: boolean }[]): Promise<string[]> {
  const errors: string[] = [];
  try {
    const humanClicks = rawClicks.filter(c => c.human === true && c.path);

    // Mise à jour du compteur human_clicks dans shortio_link_daily_snapshots pour aujourd'hui
    // On agrège par path (un clic = +1) et on upsert via increment SQL
    const today = isoDate(0);
    const clickCountByPath = new Map<string, number>();
    for (const click of humanClicks) {
      const clickDate = click.dt ? isoDateFromInstant(click.dt) : today;
      if (clickDate === today) {
        const p = click.path.replace(/^\//, '');
        clickCountByPath.set(p, (clickCountByPath.get(p) ?? 0) + 1);
      }
    }
    // Pour chaque path cliqué aujourd'hui, upsert le snapshot du jour avec le bon compteur
    await Promise.allSettled([...clickCountByPath.entries()].map(async ([path, count]) => {
      const { data: existing } = await supa.from('shortio_link_daily_snapshots')
        .select('link_id, short_url, original_url, link_type, human_clicks')
        .eq('profile_id', profileId).eq('path', path).eq('date', today)
        .maybeSingle();
      if (existing) {
        await supa.from('shortio_link_daily_snapshots')
          .update({ human_clicks: Math.max(existing.human_clicks ?? 0, count), updated_at: new Date().toISOString() })
          .eq('profile_id', profileId).eq('path', path).eq('date', today);
      }
      // Si pas de ligne today, elle sera créée par snapshotShortioLinks (period=today) au prochain cron
    }));

    // LM clicks
    for (const click of humanClicks.filter(c => c.path.replace(/^\//, '').startsWith('lm-'))) {
      const clickedAt = click.dt ? new Date(click.dt).toISOString() : new Date().toISOString();
      const cleanPath = click.path.replace(/^\//, '');
      const { data: igLead } = await supa.from('instagram_leads').select('id, ig_username, detected_at').eq('profile_id', profileId).filter('tracking_link', 'like', `%/${cleanPath}`).maybeSingle();
      if (!igLead) continue;
      if (new Date(clickedAt) < new Date(igLead.detected_at)) continue;
      const { data: existing } = await supa.from('prospect_events').select('id, occurred_at').eq('ig_lead_id', igLead.id).eq('event_type', 'lm_clicked').maybeSingle();
      if (!existing) {
        const { error: evtErr } = await supa.from('prospect_events').insert({ profile_id: profileId, prospect_key: igLead.ig_username.toLowerCase(), platform: 'ig', event_type: 'lm_clicked', occurred_at: clickedAt, ig_lead_id: igLead.id });
        if (evtErr) errors.push(`lm_clicked_${cleanPath}: ${evtErr.message}`);
      } else if (existing.occurred_at?.includes('T12:00:00')) {
        await supa.from('prospect_events').update({ occurred_at: clickedAt }).eq('id', existing.id);
      }
    }

    // Calendly link clicks
    for (const click of humanClicks.filter(c => !c.path.replace(/^\//, '').startsWith('lm-'))) {
      const clickedAt = click.dt ? new Date(click.dt).toISOString() : new Date().toISOString();
      const cleanPath = click.path.replace(/^\//, '');
      const { data: pl } = await supa.from('prospect_links').select('id, ig_username, ig_lead_id, calendly_link_sent, calendly_link_sent_at, last_calendly_link_sent_at, first_click_at').eq('profile_id', profileId).filter('short_url', 'like', `%/${cleanPath}`).maybeSingle();
      if (!pl) continue;
      const sentRefAt = pl.last_calendly_link_sent_at ?? pl.calendly_link_sent_at;
      if (!pl.calendly_link_sent || !sentRefAt) continue;
      if (new Date(clickedAt) <= new Date(sentRefAt)) continue;
      if (!pl.first_click_at) await supa.from('prospect_links').update({ first_click_at: clickedAt }).eq('id', pl.id);
      const { data: existingEvt } = await supa.from('prospect_events').select('id').eq('prospect_link_id', pl.id).eq('event_type', 'link_clicked').maybeSingle();
      if (!existingEvt) {
        const { error: evtErr } = await supa.from('prospect_events').insert({ profile_id: profileId, prospect_key: pl.ig_username.toLowerCase(), platform: 'ig', event_type: 'link_clicked', occurred_at: clickedAt, ig_lead_id: pl.ig_lead_id, prospect_link_id: pl.id });
        if (evtErr) errors.push(`link_clicked_${cleanPath}: ${evtErr.message}`);
      }
    }
  } catch (e: any) {
    errors.push(`click_stream: ${e?.message || 'unknown'}`);
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Posts IG individuels — snapshot quotidien
// snapshotIgPosts vit désormais dans ../_shared/ig-posts.ts (importé en haut de ce
// fichier), partagé avec refresh-ig-posts (bouton "Actualiser" du frontend) — ne
// jamais dupliquer cette fonction ici à nouveau.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Vidéos YT individuelles — snapshot quotidien
// ─────────────────────────────────────────────────────────────────────────────

async function snapshotYtVideos(profileId: string, accessToken: string, yesterday: string): Promise<string[]> {
  const errors: string[] = [];
  try {
    // Guard : si des snapshots existent déjà pour hier, on ne refetch pas
    const { count } = await supa.from('analytics_yt_videos_history')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      .eq('snapshot_date', yesterday);
    if (count && count > 0) return [];

    const auth = { Authorization: `Bearer ${accessToken}` };

    // Récupère uploads playlist id
    const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet,statistics&mine=true', { headers: auth });
    if (!channelRes.ok) return [`yt_videos_channel: HTTP ${channelRes.status}`];
    const channelData = await safeJson(channelRes);
    const uploadsPlaylistId = channelData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return ['yt_videos_no_uploads_playlist'];

    // Récupère les 30 dernières vidéos
    const playlistRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?playlistId=${uploadsPlaylistId}&maxResults=30&part=snippet&fields=items(snippet(resourceId,title,publishedAt,thumbnails))`,
      { headers: auth }
    );
    if (!playlistRes.ok) return [`yt_videos_playlist: HTTP ${playlistRes.status}`];
    const playlistData = await safeJson(playlistRes);
    const items: any[] = playlistData.items || [];
    if (!items.length) return [];

    const videoIds = items.map((i: any) => i.snippet?.resourceId?.videoId).filter(Boolean);

    // Détails vidéo (durée, statistiques lifetime)
    //
    // 50 ids par appel, le maximum accepte par videos.list. C'etait 10 : sur une chaine
    // de 30 videos cela faisait 3 appels au lieu d'un seul. Le cout d'un appel ne depend
    // pas du nombre d'ids qu'il porte.
    const BATCH = 50;
    const videoDetailsMap: Record<string, any> = {};
    for (let i = 0; i < videoIds.length; i += BATCH) {
      const batch = videoIds.slice(i, i + BATCH);
      const detailsRes = await fetch(
        // liveBroadcastContent distingue un direct EN COURS (« live ») ou PROGRAMME
        // (« upcoming ») d'une video normale (« none »). Une rediffusion terminee vaut
        // « none » : elle redevient une video et doit etre comptee comme telle.
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${batch.join(',')}&fields=items(id,snippet(title,publishedAt,thumbnails,liveBroadcastContent),statistics,contentDetails(duration))`,
        { headers: auth }
      );
      if (detailsRes.ok) {
        const detailsData = await safeJson(detailsRes);
        for (const v of detailsData.items || []) videoDetailsMap[v.id] = v;
      } else {
        // Un echec ici etait ignore en SILENCE : la boucle continuait et le snapshot
        // s'ecrivait avec des titres et des vues vides. Pire, le garde-fou d'entree
        // (« le snapshot d'hier existe deja ») empechait ensuite tout rattrapage — la
        // journee restait definitivement amputee sans que rien ne le signale.
        //
        // On interrompt plutot que d'ecrire une journee incomplete : sans ligne pour
        // hier, le prochain passage refera le travail de lui-meme. Un trou temporaire
        // se rattrape, une ligne fausse reste.
        return [`yt_videos_details: HTTP ${detailsRes.status}`];
      }
    }

    // Analytics vidéo (30 jours glissants).
    //
    // Lot plus petit que videos.list : le filtre `video==` de l'Analytics API est borne
    // a 500 CARACTERES, pas a un nombre d'ids. A 11 caracteres par id plus le separateur,
    // 40 ids font 479 caracteres — sous la limite avec une marge, sans dependre d'une
    // longueur d'id qui pourrait changer. Depasser renverrait un 400 sur TOUT le lot,
    // donc aucune metrique par video pour le profil.
    const BATCH_ANALYTICS = 40;
    const startDate = isoDate(30);
    const analyticsMap: Record<string, any> = {};
    for (let i = 0; i < videoIds.length; i += BATCH_ANALYTICS) {
      const batch = videoIds.slice(i, i + BATCH_ANALYTICS);
      const analyticsRes = await fetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&dimensions=video&filters=video==${batch.join(',')}&metrics=views,estimatedMinutesWatched,likes,comments,shares,averageViewPercentage,subscribersGained&startDate=${startDate}&endDate=${yesterday}`,
        { headers: auth }
      );
      if (analyticsRes.ok) {
        const analyticsData = await safeJson(analyticsRes);
        for (const row of analyticsData.rows || []) {
          analyticsMap[row[0]] = { views: row[1], watchMin: row[2], likes: row[3], comments: row[4], shares: row[5], avgViewPct: row[6], subsGained: row[7] };
        }
      } else {
        // Contrairement aux details ci-dessus, on n'interrompt PAS : les metriques par
        // video (vues 30j, retention) sont un complement, alors que titre / miniature /
        // vues lifetime viennent de videos.list et suffisent a une ligne exploitable.
        // Les colonnes concernees restent simplement null — un trou, pas un faux zero.
        //
        // Mais l'echec doit se voir : il etait ignore en silence, donc une chaine entiere
        // pouvait perdre ses metriques par video sans que rien ne l'indique nulle part.
        errors.push(`yt_videos_analytics: HTTP ${analyticsRes.status}`);
        console.error(`[poll-leads] profile=${profileId} yt_videos_analytics: HTTP ${analyticsRes.status}`);
      }
    }

    // CTR depuis youtube_video_ctr
    const { data: ctrRows } = await supa.from('youtube_video_ctr')
      .select('video_id, impressions, clicks')
      .eq('profile_id', profileId)
      .in('video_id', videoIds);
    const ctrMap: Record<string, number | null> = {};
    for (const r of ctrRows || []) {
      ctrMap[r.video_id] = r.impressions > 0 ? r.clicks / r.impressions : null;
    }

    const snapshotAt = new Date().toISOString();

    // Upsert chaque vidéo
    for (const videoId of videoIds) {
      try {
        const detail = videoDetailsMap[videoId];
        const analytics = analyticsMap[videoId] || {};
        // Un direct EN COURS ou PROGRAMME n'est pas une video : il n'a ni duree finale,
        // ni retention, ni performance a analyser. Il encombrait le tableau avec une
        // ligne entierement vide (« 0:00 », « — » partout).
        //
        // Une REDIFFUSION, elle, est une video a part entiere : YouTube repasse
        // liveBroadcastContent a « none » une fois la diffusion terminee, et la ligne
        // est alors conservee normalement. La distinction se fait donc toute seule,
        // sans regle a maintenir (choix de Chris, 2026-08-21).
        const diffusionEnCours = detail?.snippet?.liveBroadcastContent === 'live'
          || detail?.snippet?.liveBroadcastContent === 'upcoming';
        if (diffusionEnCours) continue;
        const isShort = detail?.contentDetails?.duration
          ? /^PT(?:\d+S|[0-5]?\dS|[0-5]?\d[Ss])$/.test(detail.contentDetails.duration) ||
            /^PT0?[0-5]?\d[Ss]$/.test(detail.contentDetails.duration)
          : false;
        // Duree en secondes, depuis le meme champ ISO 8601 qui sert deja a detecter les
        // Shorts juste au-dessus.
        //
        // Elle etait ecrite `null` alors que la donnee etait la : les 2010 lignes du
        // profil de test avaient duration_sec vide. En mode historique (toute periode
        // passee, et l'All-Time), l'UI n'avait donc aucune duree, avec deux effets :
        // la colonne « Duree » du tableau restait vide, et surtout l'axe des temps de la
        // courbe de retention basculait silencieusement en pourcentage au lieu
        // d'afficher « 0:45 », « 1:30 » — la meme courbe changeait d'unite selon la
        // periode consultee (constate le 2026-08-21).
        const durIso: string | undefined = detail?.contentDetails?.duration;
        const durMatch = durIso ? durIso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) : null;
        const durationSec = durMatch
          ? parseInt(durMatch[1] || '0') * 3600 + parseInt(durMatch[2] || '0') * 60 + parseInt(durMatch[3] || '0')
          : null;

        const row: Record<string, any> = {
          profile_id: profileId,
          video_id: videoId,
          title: detail?.snippet?.title || null,
          thumbnail: detail?.snippet?.thumbnails?.medium?.url || detail?.snippet?.thumbnails?.default?.url || null,
          published_at: detail?.snippet?.publishedAt ? new Date(detail.snippet.publishedAt).toISOString() : null,
          duration_sec: durationSec,
          is_short: isShort,
          // ?? plutôt que || : un vrai 0 (0 vue/like/commentaire) est une donnée
          // légitime qui ne doit pas être écrasée en null.
          views: parseInt(detail?.statistics?.viewCount ?? '0') ?? null,
          views_period: analytics.views ?? null,
          watch_time_min: analytics.watchMin ?? null,
          // likes/comments : lifetime uniquement (Data API v3), pas de colonne
          // "_period" — contrairement à views/views_period. analytics.likes/comments
          // (30j, calculés juste au-dessus dans analyticsMap) ne sont volontairement
          // pas stockés ici faute d'usage actuel ; si un futur graphique "likes par
          // jour" est construit sur cette table, ajouter likes_period/comments_period
          // plutôt que de réutiliser ces colonnes lifetime par erreur.
          likes: parseInt(detail?.statistics?.likeCount ?? '0') ?? null,
          comments: parseInt(detail?.statistics?.commentCount ?? '0') ?? null,
          shares: analytics.shares ?? null,
          avg_view_pct: analytics.avgViewPct ?? null,
          subs_gained: analytics.subsGained ?? null,
          ctr: ctrMap[videoId] ?? null,
          url: `https://youtube.com/watch?v=${videoId}`,
          snapshot_date: yesterday,
          snapshot_at: snapshotAt,
        };

        const { error } = await supa.from('analytics_yt_videos_history').upsert(row, { onConflict: 'profile_id,video_id,snapshot_date', ignoreDuplicates: false });
        if (error) errors.push(`yt_video_upsert_${videoId}: ${error.message}`);
      } catch (e: any) { errors.push(`yt_video_${videoId}: ${e?.message || 'unknown'}`); }
    }
  } catch (e: any) { errors.push(`yt_videos_snapshot: ${e?.message || 'unknown'}`); }
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot complet d'un profil
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rattrape les journees YouTube manquantes, quelle que soit leur anciennete.
 *
 * La fenetre normale du cron (J-3 -> hier) ne rattrape que trois jours : au-dela, une
 * interruption laissait un trou definitif — c'est ce qui s'etait produit du 9 au 14 juin
 * sur un profil, et 38 journees etaient encore vides le 2026-08-21.
 *
 * Or l'Analytics API accepte n'importe quelle date de debut (verifie contre l'API :
 * une requete sur le 1-10 juin renvoie bien ses 10 jours). Les donnees ne sont donc
 * jamais perdues, elles n'etaient simplement plus demandees.
 *
 * Strategie : une seule requete par execution, sur la plage qui couvre les trous, et
 * seulement quand il y en a. Sur une base saine, cette fonction ne coute RIEN — elle
 * sort avant le moindre appel reseau.
 *
 * Tourne une fois par jour (meme cadence que les repartitions) pour ne pas peser sur
 * le quota : un trou vieux de trois semaines peut attendre quelques heures de plus.
 */
/**
 * Rattrape les journees Instagram manquantes.
 *
 * Meme principe que rattraperTrousYt, mais l'API Instagram impose une contrainte de
 * plus : elle ne renvoie qu'une fenetre limitee par appel, et surtout ses metriques
 * `total_value` ne se decoupent pas par jour sur une longue plage. On rattrape donc
 * JOUR PAR JOUR, avec un plafond par execution pour ne pas exploser le budget de
 * temps de la fonction.
 *
 * Verifie contre l'API le 2026-08-22 : les dates anciennes sont acceptees (J-60
 * renvoie une vraie valeur), avec une retention de 2 ANS — au-dela, l'API repond
 * « Metrics data is available for the last 2 years ».
 *
 * 43 journees de reach manquaient sur trois profils avant cette fonction, sans aucun
 * mecanisme pour les recuperer.
 */
async function rattraperTrousIg(profileId: string, token: string, igAccountId: string): Promise<string[]> {
  const errors: string[] = [];
  // 3 et non 5 : le rattrapage est SEQUENTIEL (5 appels par journee) et tourne pour
  // chaque profil. A 40 eleves ayant tous des trous le meme jour, 5 journees mettaient
  // le passage a ~112 s sur un budget de 150 — marge trop mince. A 3, on redescend a
  // ~75 s dans ce meme pire cas, et les trous se comblent en quelques jours au lieu de
  // quelques heures, ce qui est sans consequence sur des donnees anciennes.
  const MAX_JOURS_PAR_PASSAGE = 3;
  try {
    const { data: premier } = await supa
      .from('analytics_daily_snapshots')
      .select('date')
      .eq('profile_id', profileId)
      .not('ig_reach', 'is', null)
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!premier?.date) return [];

    // Retention Meta : 2 ans. Inutile de demander au-dela, l'API repond 400.
    const limiteRetention = isoDate(720);
    const debutUtile = premier.date > limiteRetention ? premier.date : limiteRetention;

    // Deux cas a rattraper, pas un seul :
    //   - ig_reach NULL : la journee n'a jamais ete collectee ;
    //   - ig_views NULL alors que la journee EXISTE : elle vient du backfill de
    //     premiere connexion, qui remplit 30 jours d'un coup mais ne peut pas
    //     recuperer views / profile_links_taps / website_clicks — ces metriques
    //     n'existent que via `metric_type=total_value`, une forme qui renvoie un
    //     total unique sans serie datee (verifie contre l'API le 2026-08-22).
    //
    // Sans ce second cas, les journees backfillees gardaient des colonnes vides pour
    // toujours : le rattrapage ne les voyait pas puisque ig_reach y etait rempli.
    const { data: trous } = await supa
      .from('analytics_daily_snapshots')
      .select('date')
      .eq('profile_id', profileId)
      .or('ig_reach.is.null,ig_views.is.null')
      .gt('date', debutUtile)
      .lte('date', isoDate(1))
      .order('date', { ascending: false })   // les plus recents d'abord
      .limit(MAX_JOURS_PAR_PASSAGE);
    if (!trous?.length) return [];

    for (const t of trous) {
      try {
        const metrics = await fetchIgDayMetrics(token, igAccountId, t.date);
        // Ne pas ecrire une ligne vide : si Meta ne renvoie rien pour ce jour, mieux
        // vaut laisser le trou que d'y poser des null qui empecheraient un nouvel essai
        // de se distinguer d'un echec.
        if (metrics.ig_reach == null) { errors.push(`ig_rattrapage_vide_${t.date}`); continue; }
        const { error } = await supa.from('analytics_daily_snapshots').upsert(
          { profile_id: profileId, date: t.date, ...metrics, backfill_source: 'rattrapage' },
          { onConflict: 'profile_id,date', ignoreDuplicates: false },
        );
        if (error) errors.push(`ig_rattrapage_${t.date}: ${error.message}`);
      } catch (e: any) {
        errors.push(`ig_rattrapage_${t.date}: ${e?.message || 'unknown'}`);
      }
    }
    console.log(`[poll-leads] ig_rattrapage profile=${profileId}: ${trous.length} journee(s) traitee(s)`);
  } catch (e: any) {
    errors.push(`ig_rattrapage: ${e?.message || 'unknown'}`);
  }
  return errors;
}

async function rattraperTrousYt(profileId: string, accessToken: string): Promise<string[]> {
  const errors: string[] = [];
  try {
    // Debut de la collecte : avant cette date, l'absence est normale (le compte
    // n'etait pas connecte), il n'y a rien a rattraper.
    const { data: premier } = await supa
      .from('analytics_daily_snapshots')
      .select('date')
      .eq('profile_id', profileId)
      .not('yt_views', 'is', null)
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!premier?.date) return [];

    // Jours vides APRES ce debut et hors delai de traitement Google (J-4 et plus
    // anciens) : un jour recent sans donnee n'est pas un trou, c'est de l'attente.
    const limite = isoDate(4);
    const { data: trous } = await supa
      .from('analytics_daily_snapshots')
      .select('date')
      .eq('profile_id', profileId)
      .is('yt_views', null)
      .gt('date', premier.date)
      .lte('date', limite)
      .order('date', { ascending: true });
    if (!trous?.length) return [];

    // Une seule requete couvrant du plus ancien au plus recent trou. Les jours deja
    // remplis dans l'intervalle sont simplement reecrits a l'identique.
    const debut = trous[0].date;
    const fin = trous[trous.length - 1].date;
    const { rows } = await fetchYtDayMetrics(accessToken, debut, fin, false);
    if (!rows.length) return [`yt_rattrapage_vide_${debut}_${fin}`];

    const aRemplir = new Set(trous.map((t: any) => t.date));
    let comblees = 0;
    for (const row of rows) {
      if (!aRemplir.has(row.date)) continue;
      const { error } = await supa.from('analytics_daily_snapshots').upsert({
        profile_id: profileId, date: row.date,
        yt_views: row.yt_views, yt_watch_time_min: row.yt_watch_time_min,
        yt_subs_gained: row.yt_subs_gained, yt_subs_lost: row.yt_subs_lost,
        yt_net_subs: row.yt_net_subs, yt_likes: row.yt_likes,
        yt_comments: row.yt_comments, yt_shares: row.yt_shares,
        yt_avg_view_duration_sec: row.yt_avg_view_duration_sec,
        yt_avg_duration_shorts_sec: row.yt_avg_duration_shorts_sec,
        yt_avg_duration_long_sec: row.yt_avg_duration_long_sec,
        yt_views_shorts: row.yt_views_shorts, yt_views_long: row.yt_views_long,
        yt_watch_time_shorts_min: row.yt_watch_time_shorts_min,
        yt_watch_time_long_min: row.yt_watch_time_long_min,
        backfill_source: 'rattrapage',
      }, { onConflict: 'profile_id,date', ignoreDuplicates: false });
      if (error) errors.push(`yt_rattrapage_${row.date}: ${error.message}`);
      else comblees++;
    }
    if (comblees) console.log(`[poll-leads] yt_rattrapage profile=${profileId}: ${comblees} journee(s) comblee(s) sur ${trous.length} trou(s)`);
  } catch (e: any) {
    errors.push(`yt_rattrapage: ${e?.message || 'unknown'}`);
  }
  return errors;
}

async function snapshotProfile(profileId: string): Promise<string[]> {
  const errors: string[] = [];
  const yesterday = isoDate(1);
  const todayStr = isoDate(0);

  // IG J-1 + posts individuels (en parallèle)
  //
  // ─── Cadence : une synchronisation par heure ────────────────────────────────────
  //
  // Meme raisonnement que YouTube (voir plus bas) : ce cron tourne toutes les 5
  // minutes pour capter les leads vite, mais les metriques d'un compte Instagram ne
  // changent pas 288 fois par jour. Sans garde-fou, fetchIgDayMetrics emettait ses
  // appels a chaque passage — 864 par profil et par jour pour des chiffres identiques.
  //
  // Le quota Instagram n'est pas structure comme celui de YouTube : il vaut
  // 4800 x impressions sur 24 h et il est PROPRE A CHAQUE UTILISATEUR, il ne se
  // partage donc pas entre eleves. Le risque de saturation est faible sur un compte
  // actif, mais il devient reel sur une journee a tres faible audience — et emettre
  // 864 appels pour rien reste du gaspillage qui rapproche du plafond sans aucun
  // benefice de fraicheur (mesure du 2026-08-22, en-tete x-app-usage a 0 %).
  //
  // Le collecteur de leads et de DM, lui, n'est PAS ralenti : il reste a chaque
  // passage, c'est lui qui doit reagir vite.
  const IG_INTERVALLE_MS = 60 * 60 * 1000;
  const { data: igIntegration } = await supa
    .from('integrations')
    .select('last_synced_at')
    .eq('profile_id', profileId)
    .eq('provider', 'instagram')
    .maybeSingle();
  const igDernierSync = igIntegration?.last_synced_at ? new Date(igIntegration.last_synced_at).getTime() : 0;
  const igDoitSync = Date.now() - igDernierSync >= IG_INTERVALLE_MS;
  // Le rattrapage des trous ne tourne qu'une fois par JOUR : un trou vieux de deux
  // semaines peut attendre quelques heures. Meme regle que les repartitions YouTube.
  const igRattrapageAFaire = igDernierSync === 0
    || new Date(igDernierSync).toISOString().split('T')[0] !== new Date().toISOString().split('T')[0];

  const igCreds = igDoitSync ? await getIgCreds(profileId) : null;
  if (igCreds) {
    const [igMetricsResult, igPostsResult, igRattrapageResult] = await Promise.allSettled([
      (async () => {
        const metrics = await fetchIgDayMetrics(igCreds.token, igCreds.igAccountId, yesterday);
        const { error } = await supa.from('analytics_daily_snapshots').upsert({ profile_id: profileId, date: yesterday, ...metrics, backfill_source: 'cron' }, { onConflict: 'profile_id,date', ignoreDuplicates: false });
        if (error) throw new Error(error.message);
        // ig_followers/ig_following viennent de accountData.followers_count/follows_count
        // (état ACTUEL du compte, pas une vraie métrique period=day datée) — le cron
        // n'écrivant que la ligne "hier", le nombre
        // d'abonnés du jour COURANT restait à null jusqu'au lendemain matin (décalage
        // d'un jour entre le vrai changement et la date où il apparaît). Écrit aussi ces
        // deux colonnes (seulement elles, sans écraser reach/engagement/interactions qui
        // nécessiteraient un vrai appel daté sur aujourd'hui) sur la ligne du jour même.
        if (metrics.ig_followers != null || metrics.ig_following != null) {
          await supa.from('analytics_daily_snapshots').upsert({
            profile_id: profileId, date: todayStr,
            ig_followers: metrics.ig_followers, ig_following: metrics.ig_following,
            backfill_source: 'cron',
          }, { onConflict: 'profile_id,date', ignoreDuplicates: false });
        }
        // Toutes les métriques day=period (reach, views, accounts_engaged,
        // total_interactions, etc.) : même besoin que ig_followers ci-dessus, mais elles
        // nécessitent un vrai appel Meta daté sur todayStr (period=day), pas un simple
        // recopiage de l'état actuel du compte — la route stats/route.ts passe en lecture
        // 100%-DB (2026-07-07), donc le cron doit les actualiser aussi sur "aujourd'hui"
        // (pas seulement "hier"), sinon elles restent à 0/null pour le jour même jusqu'au
        // lendemain matin. todayMetrics contenait déjà reach/views/impressions depuis le
        // même appel API, mais seuls accounts_engaged/total_interactions étaient persistés
        // — le reste était calculé puis jeté sans raison (oubli, pas une limite Meta).
        try {
          const todayMetrics = await fetchIgDayMetrics(igCreds.token, igCreds.igAccountId, todayStr);
          const { ig_followers: _tf, ig_following: _tg, ...todayMetricsNoAccount } = todayMetrics;
          await supa.from('analytics_daily_snapshots').upsert({
            profile_id: profileId, date: todayStr,
            ...todayMetricsNoAccount,
            backfill_source: 'cron',
          }, { onConflict: 'profile_id,date', ignoreDuplicates: false });
        } catch (e) { console.error(`[poll-leads] todayMetrics IG (${profileId}):`, (e as Error).message); }
      })(),
      snapshotIgPosts(supa, profileId, igCreds.token, igCreds.igAccountId, yesterday, false, { platformUrl: PLATFORM_URL, cronSecret: CRON_SECRET }),
      // Rattrapage des journees anciennes manquantes — une fois par jour, comme cote
      // YouTube. Ajoute EN DERNIER pour ne pas decaler les deux resultats deja
      // destructures. Sur une base sans trou, la fonction sort avant tout appel reseau.
      igRattrapageAFaire ? rattraperTrousIg(profileId, igCreds.token, igCreds.igAccountId) : Promise.resolve([] as string[]),
    ]);
    if (igMetricsResult.status === 'rejected') errors.push(`ig_fetch: ${igMetricsResult.reason?.message || 'unknown'}`);
    if (igPostsResult.status === 'fulfilled') errors.push(...igPostsResult.value);
    else errors.push(`ig_posts: ${igPostsResult.reason?.message || 'unknown'}`);
    if (igRattrapageResult.status === 'fulfilled') errors.push(...igRattrapageResult.value);
    else errors.push(`ig_rattrapage: ${igRattrapageResult.reason?.message || 'unknown'}`);

    // Horodate la synchronisation pour que la cadence horaire se rearme.
    //
    // Ecrit meme en cas d'erreur, volontairement : sans ca, un compte dont le jeton est
    // expire relancerait ses appels toutes les 5 minutes indefiniment. L'erreur reste
    // tracee dans last_snapshot_error et dans cron_runs.
    await supa.from('integrations')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('profile_id', profileId)
      .eq('provider', 'instagram');
  }

  // Short.io J-1 + click stream
  const shioCreds = await getShortioLinkCreds(profileId);
  if (shioCreds) {
    try {
      const { errors: shioErrors, rawClicks, resolveLinkCategory, dateToday } = await snapshotShortioLinks(profileId, shioCreds);
      if (shioErrors.length) errors.push(...shioErrors.map(e => `shortio_link: ${e}`));
      const csErrors = await syncLmClickStream(profileId, rawClicks);
      if (csErrors.length) errors.push(...csErrors.map(e => `shortio_click_stream: ${e}`));
      // Anciens domaines (changement de domaine actif) — liens Momentum uniquement, voir doc fonction.
      // Best-effort, jamais remonté dans `errors` (qui pilote last_snapshot_status/error
      // affiché à l'utilisateur) — un échec ici (ex: 429 Short.io) porte sur un domaine
      // déjà abandonné, sans impact sur le domaine actif ni sur le reste du snapshot. Se
      // rattrape naturellement au prochain run ; pas une vraie panne à signaler comme telle.
      const oldDomainErrors = await snapshotOldDomainLinks(profileId, shioCreds.apiKey, shioCreds.domainId, shioCreds.allDomains, resolveLinkCategory, dateToday);
      if (oldDomainErrors.length) console.error(`[poll-leads] shortio_old_domain (${profileId}):`, oldDomainErrors.join(', '));
      // Invalider le cache Short.io pour que le prochain chargement re-fetche les données fraîches
      await supa.from('shortio_stats_cache').delete().eq('profile_id', profileId);
    } catch (e: any) { errors.push(`shortio_snapshot: ${e?.message || 'unknown'}`); }
  }

  // YouTube J-1, J-2, J-3 + CTR + vidéos individuelles (en parallèle)
  //
  // ─── Cadence : une synchronisation par heure, pas une par passage ───────────────
  //
  // Ce cron tourne toutes les 5 minutes (288 passages/jour) pour les leads Instagram,
  // qui doivent etre captes vite. YouTube n'a pas ce besoin : ses metriques ont 2 a 3
  // jours de retard cote Google, et le total d'abonnes bouge de quelques unites par
  // jour. Resynchroniser toutes les 5 minutes ne rend donc AUCUNE donnee plus fraiche.
  //
  // Sans garde-fou, fetchYtDayMetrics emettait ses 7 appels a chaque passage :
  //   1 profil  = 2 016 appels/jour
  //   20 eleves = 40 540 appels/jour, soit 4x le quota YouTube (10 000 unites/jour)
  // La plateforme cassait donc entre 4 et 5 eleves, avec des 403 quota exceeded et des
  // journees entieres sans donnee — exactement le genre de panne qui demande une
  // intervention (mesure du 2026-08-21).
  //
  // Une sync par heure suffit largement et divise le cout par 12 :
  //   20 eleves = 3 400 appels/jour, 34 % du quota
  //   30 eleves = 5 100 appels/jour, 51 % du quota
  //
  // Les deux autres blocs YouTube (videos, CTR) ont deja leur propre garde-fou et ne
  // repartaient pas a chaque passage.
  //
  // Le premier passage apres connexion n'est jamais retarde : last_synced_at est null,
  // donc la condition laisse passer. La recuperation initiale complete reste intacte.
  const YT_INTERVALLE_MS = 60 * 60 * 1000;
  const { data: ytIntegration } = await supa
    .from('integrations')
    .select('last_synced_at')
    .eq('profile_id', profileId)
    .eq('provider', 'youtube')
    .maybeSingle();
  const ytDernierSync = ytIntegration?.last_synced_at ? new Date(ytIntegration.last_synced_at).getTime() : 0;
  const ytDoitSync = Date.now() - ytDernierSync >= YT_INTERVALLE_MS;
  // Les quatre repartitions (sources de trafic, appareils, demographie, mots-cles)
  // portent sur 30 jours glissants : une seule mise a jour par jour suffit largement,
  // et elles representent 4 des 7 appels. On les rafraichit quand la derniere sync
  // date d'un autre JOUR calendaire — ou au tout premier passage (last_synced_at nul),
  // pour que la carte ne soit jamais vide apres une connexion.
  const ytRepartitionsAFaire = ytDernierSync === 0
    || new Date(ytDernierSync).toISOString().split('T')[0] !== new Date().toISOString().split('T')[0];

  const ytToken = ytDoitSync ? await getYtToken(profileId) : null;
  if (ytToken) {
    const [ytMetricsResult, ytCtrResult, ytVideosResult, ytRattrapageResult] = await Promise.allSettled([
      (async () => {
        const { subscribersNow: ytSubsNow, rows: ytRows } = await fetchYtDayMetrics(ytToken, isoDate(3), yesterday, ytRepartitionsAFaire);

        // Total d'abonnes sur le JOUR COURANT, ecrit independamment de l'Analytics API.
        //
        // Ce total vient de la Data API v3, disponible en temps reel. L'Analytics ayant
        // 2-3 jours de retard, ses lignes s'arretent au 18 alors qu'on est le 21 : le
        // compteur d'abonnes restait donc vide sur les jours recents, alors que sa
        // valeur etait parfaitement connue. La courbe s'arretait 3 jours avant
        // aujourd'hui sans raison.
        //
        // Ecrit sur toute la fenetre que l'Analytics ne couvre pas encore, pas seulement
        // aujourd'hui et hier.
        //
        // La version precedente ecrivait sur [aujourd'hui, hier]. Sur le profil de test,
        // le 19 aout etait pourtant vide entre un 18 et un 20 tous deux a 49 — un trou au
        // milieu d'une courbe parfaitement plate (constate le 2026-08-21).
        //
        // Une fenetre de 2 jours ne laisse aucune marge : il suffit d'une interruption
        // du cron, d'un echec de l'appel YouTube (le try/catch avale l'erreur et le
        // profil est saute), ou d'un decalage de date pour qu'un jour passe entre les
        // mailles et ne soit jamais rattrape — la Data API v3 ne renvoyant que la valeur
        // COURANTE, un jour manque le reste a jamais.
        //
        // La fenetre couvre les memes jours que la requete Analytics (isoDate(3) a
        // hier), plus aujourd'hui. Un jour deja rempli par l'Analytics est simplement
        // reecrit avec la meme valeur : l'upsert ne touche que cette colonne.
        if (ytSubsNow != null) {
          // J-0 (= todayStr) a J-3, la meme fenetre que la requete Analytics ci-dessus.
          const joursAbonnes = [0, 1, 2, 3].map(isoDate);
          for (const d of joursAbonnes) {
            const { error: subErr } = await supa.from('analytics_daily_snapshots')
              .upsert({ profile_id: profileId, date: d, yt_subscribers: ytSubsNow, backfill_source: 'cron' },
                       { onConflict: 'profile_id,date', ignoreDuplicates: false });
            if (subErr) console.error(`[poll-leads] yt_subscribers_${d}: ${subErr.message}`);
          }
        }

        for (const row of ytRows) {
          const { error } = await supa.from('analytics_daily_snapshots').upsert({ profile_id: profileId, date: row.date, yt_views: row.yt_views, yt_watch_time_min: row.yt_watch_time_min, yt_subscribers: row.yt_subscribers, yt_subs_gained: row.yt_subs_gained, yt_subs_lost: row.yt_subs_lost, yt_net_subs: row.yt_net_subs, yt_likes: row.yt_likes, yt_comments: row.yt_comments, yt_shares: row.yt_shares, yt_avg_view_duration_sec: row.yt_avg_view_duration_sec, yt_avg_duration_shorts_sec: row.yt_avg_duration_shorts_sec, yt_avg_duration_long_sec: row.yt_avg_duration_long_sec, yt_views_shorts: row.yt_views_shorts, yt_views_long: row.yt_views_long, yt_watch_time_shorts_min: row.yt_watch_time_shorts_min, yt_watch_time_long_min: row.yt_watch_time_long_min, ...(row.yt_traffic_sources ? { yt_traffic_sources: row.yt_traffic_sources } : {}), ...(row.yt_devices ? { yt_devices: row.yt_devices } : {}), ...(row.yt_demographics ? { yt_demographics: row.yt_demographics } : {}), ...(row.yt_search_keywords ? { yt_search_keywords: row.yt_search_keywords } : {}), backfill_source: 'cron' }, { onConflict: 'profile_id,date', ignoreDuplicates: false });
          if (error) throw new Error(`yt_upsert_${row.date}: ${error.message}`);
        }
      })(),
      syncYtCtr(profileId, ytToken),
      snapshotYtVideos(profileId, ytToken, yesterday),
      // Rattrapage des journees anciennes manquantes — ajoute EN DERNIER pour ne pas
      // decaler les trois resultats deja destructures au-dessus.
      //
      // Une fois par jour, meme cadence que les repartitions : un trou vieux de trois
      // semaines peut attendre quelques heures de plus. Sur une base sans trou, la
      // fonction sort avant tout appel reseau — elle ne coute rien.
      ytRepartitionsAFaire ? rattraperTrousYt(profileId, ytToken) : Promise.resolve([] as string[]),
    ]);
    if (ytMetricsResult.status === 'rejected') {
      const msg = `yt_fetch: ${ytMetricsResult.reason?.message || 'unknown'}`;
      errors.push(msg);
      // D3 : ce cas existait déjà via errors.push mais n'était jamais imprimé — rendait
      // les échecs YouTube (429, 5xx...) invisibles même en consultant get_logs.
      console.error(`[poll-leads] profile=${profileId} ${msg}`);
    }
    if (ytCtrResult.status === 'fulfilled') { if (ytCtrResult.value.errors.length) errors.push(...ytCtrResult.value.errors.map(e => `yt_ctr: ${e}`)); }
    else errors.push(`yt_ctr: ${ytCtrResult.reason?.message || 'unknown'}`);
    if (ytRattrapageResult.status === 'fulfilled') errors.push(...ytRattrapageResult.value);
    else errors.push(`yt_rattrapage: ${ytRattrapageResult.reason?.message || 'unknown'}`);
    if (ytVideosResult.status === 'fulfilled') errors.push(...ytVideosResult.value);
    else errors.push(`yt_videos: ${ytVideosResult.reason?.message || 'unknown'}`);

    // Horodate la synchronisation pour que la cadence horaire ci-dessus se rearme.
    //
    // Ecrit meme en cas d'erreur, et c'est VOULU : sans ca, un profil dont le token
    // YouTube est revoque relancerait ses 7 appels toutes les 5 minutes indefiniment,
    // brulant le quota pour rien et empechant les autres profils de se synchroniser.
    // Une heure de retard sur un profil en panne est preferable a un quota epuise pour
    // tout le monde. L'erreur reste tracee dans last_snapshot_error.
    await supa.from('integrations')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('profile_id', profileId)
      .eq('provider', 'youtube');
  }

  // Calls stats J-1 — exclut les calls réservés avant que toutes les intégrations
  // obligatoires soient connectées pour la 1ère fois, pas générés par le pipeline
  // Momentum (même règle que partout ailleurs, voir integrations_ready_at). Ces
  // colonnes ne sont lues par aucun écran aujourd'hui, mais restent correctes pour le
  // jour où un historique sera affiché.
  const { data: callsClientRow } = await supa.from('clients').select('integrations_ready_at').eq('profile_id', profileId).maybeSingle();
  const callsFirstConnectedAt: string | null = callsClientRow?.integrations_ready_at ?? null;
  let callsQuery = supa.from('calls').select('status, scheduled_at, booked_at, no_show, deal_closed, revenue, outcome').eq('coach_id', profileId).eq('call_type', 'calendly').neq('ignored', true);
  if (callsFirstConnectedAt) {
    callsQuery = callsQuery.or(`booked_at.gte.${callsFirstConnectedAt},and(booked_at.is.null,scheduled_at.gte.${callsFirstConnectedAt})`);
  }
  const { data: callsData } = await callsQuery;
  const calls = callsData || [];
  const now = new Date();
  await supa.from('analytics_daily_snapshots').upsert({
    profile_id: profileId, date: yesterday,
    calls_booked:   calls.filter((c: any) => c.status === 'active').length,
    calls_honored:  calls.filter((c: any) => c.status === 'active' && new Date(c.scheduled_at) < now && c.outcome != null && !c.no_show).length,
    calls_canceled: calls.filter((c: any) => ['canceled', 'cancelled'].includes(c.status)).length,
    calls_no_show:  calls.filter((c: any) => c.no_show).length,
    deals_closed:   calls.filter((c: any) => c.deal_closed).length,
    revenue:        calls.reduce((s: number, c: any) => s + (c.revenue || 0), 0),
  }, { onConflict: 'profile_id,date', ignoreDuplicates: false });

  // Stripe J-1 (appel vers l'API Vercel — non bloquant, avec timeout)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const stripeRes = await fetch(`${PLATFORM_URL}/api/stripe/client-data?profile_id=${profileId}`, { headers: { authorization: `Bearer ${CRON_SECRET}` }, signal: controller.signal });
    clearTimeout(timeout);
    if (stripeRes.ok) {
      const stripe = await safeJson(stripeRes);
      if (stripe?.recentPayments?.length) {
        const stripeRows = stripe.recentPayments.filter((p: any) => p.status === 'succeeded').map((p: any) => ({ profile_id: profileId, payment_id: p.id, amount: p.amount, currency: p.currency ?? 'eur', description: p.description || null, date: p.date, status: p.status }));
        if (stripeRows.length) await supa.from('stripe_payments').upsert(stripeRows, { onConflict: 'profile_id,payment_id' });
      }
      if (stripe) await supa.from('analytics_daily_snapshots').upsert({ profile_id: profileId, date: yesterday, mrr: stripe.mrr ?? null, stripe_active_subs: stripe.activeSubscriptions ?? null }, { onConflict: 'profile_id,date', ignoreDuplicates: false });
    }
  } catch (e: any) { errors.push(`stripe_fetch: ${e?.message || 'unknown'}`); }

  const status = errors.length === 0 ? 'ok' : 'partial';
  await supa.from('integrations').update({ last_snapshot_status: status, last_snapshot_error: errors.length ? errors.join(', ') : null }).eq('profile_id', profileId).in('provider', ['instagram', 'youtube']);

  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler principal
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const { data: integrations } = await supa.from('integrations').select('profile_id, provider, last_ig_poll').in('provider', ['instagram', 'youtube', 'shortio']);
  if (!integrations?.length) return new Response(JSON.stringify({ polled: 0, snapshots: 0 }), { headers: { 'Content-Type': 'application/json' } });

  // Répondre immédiatement 202 pour éviter le timeout 30s de cron-job.org
  // Le traitement continue via EdgeRuntime.waitUntil (jusqu'à 150s)
  const runMain = async () => {

  const profileMap = new Map<string, { profile_id: string; last_ig_poll: string | null; hasIg: boolean }>();
  for (const row of integrations) {
    if (!profileMap.has(row.profile_id)) profileMap.set(row.profile_id, { profile_id: row.profile_id, last_ig_poll: row.last_ig_poll, hasIg: false });
    if (row.provider === 'instagram') {
      profileMap.get(row.profile_id)!.hasIg = true;
      profileMap.get(row.profile_id)!.last_ig_poll = row.last_ig_poll;
    }
  }
  const profiles = Array.from(profileMap.values());

  let polled = 0, leadsFound = 0, snapshots = 0;
  const allErrors: Record<string, string[]> = {};

  // Concurrence BORNÉE à 5 profils simultanés.
  //
  // Avant : Promise.all sur tous les profils, sans limite. Le budget de 150s n'était
  // pas le problème — la concurrence l'était : à 30 élèves, 30 profils émettaient
  // ensemble leurs appels Short.io/Meta/YouTube, saturant des quotas partagés
  // (Short.io : ~60 req/fenêtre pour la clé/domaine, déjà atteint en prod à 4 élèves).
  //
  // Ironie corrigée ici : la version Vercel abandonnée batchait par 3
  // (app/api/instagram/poll-leads/route.ts), et c'est l'Edge Function censée « tenir
  // 20 élèves+ » qui avait supprimé ce garde-fou.
  //
  // 5 plutôt que 3 : les appels sont majoritairement en attente réseau, et le
  // limiteur Short.io régule déjà finement le débit en aval.
  await mapWithConcurrency(profiles, 5, async (profile) => {
    const profileErrors: string[] = [];

    if (profile.hasIg) {
      try {
        const creds = await getIgCreds(profile.profile_id);
        if (creds) {
          const since = profile.last_ig_poll ? new Date(profile.last_ig_poll) : new Date(Date.now() - 24 * 60 * 60 * 1000);
          const [commentsResult, hookResult] = await Promise.all([
            pollIgComments(profile.profile_id, creds.token, creds.igAccountId, since),
            pollIgHookReplied(profile.profile_id, creds.token, creds.igAccountId),
          ]);
          if (commentsResult.error) profileErrors.push(`comment_poll: ${commentsResult.error}`);
          if (hookResult.error) profileErrors.push(`hook_poll: ${hookResult.error}`);
          leadsFound += commentsResult.leadsFound;
          polled++;
        }
      } catch { profileErrors.push('lead_poll_failed'); }
    }

    try {
      const snapErrors = await snapshotProfile(profile.profile_id);
      if (snapErrors.length === 0) snapshots++;
      else profileErrors.push(...snapErrors);
    } catch { profileErrors.push('snapshot_failed'); }

    if (profileErrors.length) allErrors[profile.profile_id] = profileErrors;
  });

  // Rappels invitation call Google Meet non répondue (24h puis 2h avant le call) —
  // seulement si toujours pending_acceptance à ce moment-là (pas annulé/refusé/accepté).
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 3600_000);
    const in2h = new Date(now.getTime() + 2 * 3600_000);

    const { data: pendingInvites } = await supa.from('calls')
      .select('id, client_id, scheduled_at, invite_reminder_24h_sent, invite_reminder_2h_sent')
      .eq('status', 'pending_acceptance')
      .eq('call_type', 'google')
      .not('scheduled_at', 'is', null)
      .gt('scheduled_at', now.toISOString());

    await Promise.all((pendingInvites || []).map(async (call: any) => {
      if (!call.client_id) return;
      const scheduledAt = new Date(call.scheduled_at);

      const due24h = !call.invite_reminder_24h_sent && scheduledAt.getTime() <= in24h.getTime();
      const due2h = !call.invite_reminder_2h_sent && scheduledAt.getTime() <= in2h.getTime();
      if (!due24h && !due2h) return;

      const { data: clientRow } = await supa.from('clients').select('profile_id, coach_id').eq('id', call.client_id).single();
      if (!clientRow?.profile_id) return;

      // Prénom du coach dans la notification : "Quennel t'a proposé un call" est
      // nettement plus clair que "Ton coach t'a proposé un call" sur un écran
      // verrouillé, où l'élève ne voit que cette ligne.
      let coachFirstName: string | null = null;
      if (clientRow.coach_id) {
        const { data: coachProfile } = await supa.from('profiles').select('full_name').eq('id', clientRow.coach_id).single();
        coachFirstName = coachProfile?.full_name ? String(coachProfile.full_name).split(' ')[0] : null;
      }

      // Fuseau du DESTINATAIRE (l'élève), pas celui du coach qui envoie : la
      // notification s'affiche sur SON téléphone, elle doit donner SON heure.
      const { data: recipient } = await supa
        .from('profiles')
        .select('timezone')
        .eq('id', clientRow.profile_id)
        .single();
      const timeStr = formatTimeIn(scheduledAt, safeZone(recipient?.timezone));
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`${PLATFORM_URL}/api/push/send`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${CRON_SECRET}` },
          body: JSON.stringify({
            profileId: clientRow.profile_id,
            title: 'Invitation de call en attente',
            body: `${coachFirstName || 'Ton coach'} t'a proposé un call à ${timeStr} — n'oublie pas d'accepter ou refuser l'invitation.`,
            url: '/client/calls',
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          await supa.from('calls').update(
            due2h ? { invite_reminder_2h_sent: true, invite_reminder_24h_sent: true } : { invite_reminder_24h_sent: true }
          ).eq('id', call.id);
        }
      } catch { /* non bloquant — retry au prochain cron */ }
    }));
  } catch { /* non bloquant */ }

  // Notifications rapport post-call : gérées exclusivement par l'Edge Function
  // notify-rapport (source de vérité unique, avec marge 24h + écriture
  // client_notifications) — ne pas dupliquer cette logique ici. Un doublon présent
  // jusqu'au 2026-08-02 posait rapport_notif_sent=true en course avec notify-rapport,
  // ce qui empêchait silencieusement la création de l'historique client_notifications
  // pour les calls traités en premier par ce bloc.

  // D3 : allErrors était calculé puis jamais relu — un run avec des échecs sur
  // plusieurs profils "réussissait" en apparence (202 déjà envoyé), sans jamais
  // apparaître dans get_logs. Un seul récapitulatif suffit ici (pas de détail par
  // profil dans un log séparé — errors.push/console.error dans snapshotProfile
  // couvrent déjà le détail par profil).
  if (Object.keys(allErrors).length) {
    console.error(`[poll-leads] run terminé avec des erreurs sur ${Object.keys(allErrors).length} profil(s):`, JSON.stringify(allErrors));
    // Trace EN BASE, pas seulement dans les logs.
    //
    // Un console.error ne se voit que si quelqu'un ouvre les logs Supabase — ce que
    // personne ne fait, et que la regle du projet deconseille explicitement pour
    // investiguer. La plateforme pouvait donc casser en silence pendant des jours.
    //
    // Une ligne seulement quand il y a une erreur : ce cron tourne toutes les 5
    // minutes, journaliser les passages reussis ferait 288 lignes/jour pour rien.
    // La table se purge seule a 30 jours (trigger), donc rien a entretenir.
    //
    // Pour savoir si tout va bien :  select * from cron_runs order by ran_at desc;
    // Table vide = aucun incident depuis 30 jours.
    try {
      await supa.from('cron_runs').insert({
        fonction: 'poll-leads',
        profils_en_erreur: Object.keys(allErrors).length,
        erreurs: allErrors,
      });
    } catch (e) {
      // Ne jamais faire echouer un run a cause de sa propre journalisation.
      console.error('[poll-leads] cron_runs insert failed', e);
    }
  }

  };

  // Lancer le traitement en arrière-plan — la réponse 202 est envoyée immédiatement
  // pour éviter le timeout 30s de cron-job.org. Le Edge Runtime continue jusqu'à 150s.
  // D4 : runMain() n'était jamais catché — une exception précoce (avant même
  // d'atteindre le bloc YouTube) devenait une rejection non gérée totalement
  // invisible, la réponse 202 étant déjà partie. Sans ce filet, un run qui plante
  // au démarrage rendrait tous les logs D1-D3 inopérants sans que personne ne le sache.
  (globalThis as any).EdgeRuntime?.waitUntil(runMain().catch((e: any) => console.error('[poll-leads] runMain_fatal:', e?.message || e)));

  return new Response(JSON.stringify({ status: 'accepted' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
});
