import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getYtToken } from '@/lib/yt-fetch';
import { gunzipSync } from 'zlib';
import { parisDateStr } from '@/lib/period';
import { formaterDureeVideo } from '@/lib/duree';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Duree ISO 8601 de l'API (« PT3M45S ») vers l'affichage (« 3:45 »).
//
// Le formatage lui-meme vit dans lib/duree.ts, partage avec le mode historique qui
// lit des secondes stockees en base : deux implementations du meme format finissaient
// par diverger — la meme video se serait affichee « 1:05:30 » ici et « 65:30 » la-bas.
function parseDuration(iso: string): string {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '0:00';
  const sec = parseInt(m[1] || '0') * 3600 + parseInt(m[2] || '0') * 60 + parseInt(m[3] || '0');
  return formaterDureeVideo(sec) || '0:00';
}

// Journee calendaire PARIS, pas UTC.
//
// `toISOString()` donne le jour UTC : entre minuit et 2h du matin heure de Paris (en
// ete), il renvoie la VEILLE. Les fenetres demandees a l'API YouTube s'arretaient donc
// un jour trop tot pour qui consulte la nuit.
//
// docs/fuseaux-horaires.md pose la regle : « les statistiques restent calees sur les
// journees Paris ». parisDateStr existe justement pour remplacer ce motif partout ;
// les routes YouTube ne l'avaient pas suivi (constate le 2026-08-21).
function getToday() {
  return parisDateStr(new Date());
}

function getStartDate(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return parisDateStr(d);
}

// Récupère les CTR par vidéo depuis la Reporting API (channel_reach_basic_a1)
// Agrège tous les rapports disponibles (30 derniers jours max) pour avoir des données complètes
async function fetchCtrByVideo(accessToken: string): Promise<Record<string, number | null>> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  try {
    const jobsRes = await fetch('https://youtubereporting.googleapis.com/v1/jobs', { headers: auth });
    if (!jobsRes.ok) return {};
    const jobsData = await jobsRes.json();
    const reachJob = (jobsData.jobs || []).find((j: any) => j.reportTypeId === 'channel_reach_basic_a1');
    if (!reachJob) return {};

    const reportsRes = await fetch(
      `https://youtubereporting.googleapis.com/v1/jobs/${reachJob.id}/reports`,
      { headers: auth }
    );
    if (!reportsRes.ok) return {};
    const reportsData = await reportsRes.json();
    const reports: any[] = (reportsData.reports || [])
      .sort((a: any, b: any) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime())
      .slice(0, 30); // 30 derniers rapports journaliers = ~30 jours

    // Télécharger tous les rapports en parallèle
    const csvTexts = await Promise.all(reports.map(async (report: any) => {
      try {
        const dlRes = await fetch(report.downloadUrl, { headers: auth });
        if (!dlRes.ok) return '';
        const buffer = Buffer.from(await dlRes.arrayBuffer());
        try { return gunzipSync(buffer).toString('utf-8'); } catch { return buffer.toString('utf-8'); }
      } catch { return ''; }
    }));

    // Agréger impressions et CTR par video_id sur tous les rapports
    const byVideo: Record<string, { impressions: number; ctrSum: number; ctrCount: number }> = {};
    for (const csv of csvTexts) {
      if (!csv) continue;
      const lines = csv.trim().split('\n');
      if (lines.length < 2) continue;
      const headers = lines[0].split(',').map((h: string) => h.trim().replace(/^"|"$/g, ''));
      const idxVideo = headers.indexOf('video_id');
      const idxImpr = headers.indexOf('video_thumbnail_impressions');
      const idxCtr  = headers.indexOf('video_thumbnail_impressions_ctr');
      if (idxVideo === -1 || idxImpr === -1 || idxCtr === -1) continue;

      for (const line of lines.slice(1)) {
        const cols = line.split(',').map((v: string) => v.trim().replace(/^"|"$/g, ''));
        const videoId = cols[idxVideo];
        if (!videoId) continue;
        const impr = parseFloat(cols[idxImpr]) || 0;
        const ctr  = parseFloat(cols[idxCtr])  || 0;
        if (!byVideo[videoId]) byVideo[videoId] = { impressions: 0, ctrSum: 0, ctrCount: 0 };
        byVideo[videoId].impressions += impr;
        if (impr > 0) { byVideo[videoId].ctrSum += ctr; byVideo[videoId].ctrCount++; }
      }
    }

    // Convertir en CTR moyen en % par vidéo
    const result: Record<string, number | null> = {};
    for (const [videoId, s] of Object.entries(byVideo)) {
      result[videoId] = s.ctrCount > 0 ? parseFloat((s.ctrSum / s.ctrCount * 100).toFixed(2)) : null;
    }
    return result;
  } catch { return {}; }
}

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');

  // Si profileId fourni (coach consultant un client) — vérifier autorisation
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

  const accessToken = await getYtToken(targetProfileId);
  if (!accessToken) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const authHeader = { Authorization: `Bearer ${accessToken}` };

  // Étape 1 : channel + analytics 30j + sources trafic + devices + démographie — tout en parallèle
  //
  // NOTE IMPORTANTE sur le délai des likes/comments/shares ci-dessous (colonnes 5,6,7,
  // agrégées en likes30d/comments30d/shares30d, alimentent aussi le KPI en haut de
  // l'onglet YouTube et les courbes Likes/Commentaires/Partages) : cette requête utilise
  // la YouTube Analytics API (dimensions=day), dont Google documente officiellement un
  // délai de traitement de 2-3 jours — un like/commentaire tout récent n'apparaît pas
  // immédiatement dans ce rapport, même en interrogeant "jusqu'à aujourd'hui". C'est un
  // délai structurel côté Google, pas un bug de ce fichier (déjà signalé à l'utilisateur
  // via le libellé "données J-3" affiché sous les graphiques concernés).
  //
  // À NE PAS CONFONDRE avec les colonnes Likes/Commentaires du tableau des vidéos
  // individuelles (plus bas, ligne ~337 : v.statistics?.likeCount/commentCount) — celles-ci
  // viennent de la YouTube Data API v3 (compteurs publics de la vidéo), qui n'a PAS ce
  // délai et se met à jour quasi instantanément. Ce sont deux APIs Google différentes
  // avec des garanties différentes, pas la même donnée vue à deux endroits.
  const [channelRes, analyticsRes, byTypeRes, trafficRes, devicesRes, demoRes, searchTermsRes] = await Promise.all([
    fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true', {
      headers: authHeader,
    }),
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares,averageViewDuration&dimensions=day&sort=day`,
      { headers: authHeader }
    ),
    // Ventilation par format (Shorts / videos longues), jour par jour.
    //
    // Le chemin snapshot la fournit depuis le 2026-08-20, mais pas celui-ci : la modale
    // « Watch time moyen / vue », qui lit chartData.avgDurationShorts, s'ouvrait donc
    // VIDE en periode courante (constate le 2026-08-21). Meme defaut que la courbe des
    // abonnes, corrigee la veille — les deux chemins doivent porter les memes champs.
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,averageViewDuration,estimatedMinutesWatched&dimensions=day,creatorContentType&sort=day`,
      { headers: authHeader }
    ),
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,estimatedMinutesWatched&dimensions=insightTrafficSourceType&sort=-views`,
      { headers: authHeader }
    ),
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,estimatedMinutesWatched&dimensions=deviceType&sort=-views`,
      { headers: authHeader }
    ),
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=viewerPercentage&dimensions=ageGroup,gender`,
      { headers: authHeader }
    ),
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views&dimensions=insightTrafficSourceDetail&filters=insightTrafficSourceType==YT_SEARCH&sort=-views&maxResults=10`,
      { headers: authHeader }
    ),
  ]);

  const [channelData, analyticsData, byTypeData, trafficData, devicesData, demoData, searchTermsData] = await Promise.all([
    channelRes.json(), analyticsRes.json(), byTypeRes.json(), trafficRes.json(),
    devicesRes.json(), demoRes.json(), searchTermsRes.json(),
  ]);

  // day -> ventilation par format. L'API n'émet une ligne que pour les formats ayant eu
  // des vues ce jour-là : null quand le format est absent, jamais un faux 0.
  // colonnes : day, creatorContentType, views, averageViewDuration,
  // estimatedMinutesWatched — cette dernière déjà en MINUTES, pas de division.
  const byType = new Map<string, { shortsDur: number | null; longDur: number | null; shortsViews: number | null; longViews: number | null; shortsWatch: number | null; longWatch: number | null }>();
  for (const r of (byTypeData?.rows ?? []) as any[]) {
    const [day, type, views, avgDur, watchMin] = r;
    const cur = byType.get(day) ?? { shortsDur: null, longDur: null, shortsViews: null, longViews: null, shortsWatch: null, longWatch: null };
    if (type === 'shorts') { cur.shortsDur = avgDur ?? null; cur.shortsViews = views ?? null; cur.shortsWatch = watchMin ?? null; }
    else if (type === 'videoOnDemand') { cur.longDur = avgDur ?? null; cur.longViews = views ?? null; cur.longWatch = watchMin ?? null; }
    byType.set(day, cur);
  }

  const channel = channelData?.items?.[0];
  if (!channel) return NextResponse.json({ error: 'Chaîne introuvable' }, { status: 404 });

  const stats = channel.statistics;
  const rows: any[] = analyticsData?.rows || [];

  // colonnes : day(0), views(1), estMinutesWatched(2), subsGained(3), subsLost(4), likes(5), comments(6), shares(7), avgViewDuration(8)
  const views30d = rows.reduce((sum: number, r: any) => sum + (r[1] || 0), 0);
  const watchTime30d = rows.reduce((sum: number, r: any) => sum + (r[2] || 0), 0);
  const subsGained30d = rows.reduce((sum: number, r: any) => sum + (r[3] || 0), 0);
  const subsLost30d = rows.reduce((sum: number, r: any) => sum + (r[4] || 0), 0);
  const likes30d = rows.reduce((sum: number, r: any) => sum + (r[5] || 0), 0);
  const comments30d = rows.reduce((sum: number, r: any) => sum + (r[6] || 0), 0);
  const shares30d = rows.reduce((sum: number, r: any) => sum + (r[7] || 0), 0);
  // avgViewDuration : moyenne pondérée par les vues (col 8), fallback watchTime/views
  const avgViewDurationWeighted = views30d > 0
    ? Math.round(rows.reduce((sum: number, r: any) => sum + (r[8] || 0) * (r[1] || 0), 0) / views30d)
    : 0;
  const avgViewDurationSec = avgViewDurationWeighted > 0
    ? avgViewDurationWeighted
    : (views30d > 0 ? Math.round((watchTime30d * 60) / views30d) : 0);

  // Total d'abonnes JOUR PAR JOUR — l'API Analytics ne fournit que les gains et pertes,
  // jamais le total. On le reconstitue en partant du total actuel (Data API v3) et en
  // remontant le temps : total du jour = total du lendemain - gains + pertes.
  //
  // Sans ce champ, la courbe de la carte « Abonnes » etait VIDE en periode courante :
  // elle lit chartData.subscribers, que le chemin snapshot fournit mais pas celui-ci
  // (constate le 2026-08-21).
  const subscribersNow = parseInt(stats?.subscriberCount || '0') || 0;
  const subsByDay: number[] = new Array(rows.length).fill(subscribersNow);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (i === rows.length - 1) { subsByDay[i] = subscribersNow; continue; }
    const next = rows[i + 1];
    subsByDay[i] = subsByDay[i + 1] - (next[3] || 0) + (next[4] || 0);
  }

  const chartData = rows.map((r: any, i: number) => ({
    date: r[0],
    views: r[1] || 0,
    watchTime: r[2] || 0,
    subsGained: r[3] || 0,
    subsLost: r[4] || 0,
    netSubs: (r[3] || 0) - (r[4] || 0),
    likes: r[5] || 0,
    comments: r[6] || 0,
    shares: r[7] || 0,
    subscribers: subsByDay[i],
    // ?? null et non ?? 0 : un format sans vue ce jour-là n'a pas de durée moyenne, et
    // un 0 se lirait « regardé 0 seconde » au lieu de « pas de vue sur ce format ».
    avgViewDurationSec: r[8] ?? null,
    avgDurationShorts: byType.get(r[0])?.shortsDur ?? null,
    avgDurationLong:   byType.get(r[0])?.longDur ?? null,
    viewsShorts:       byType.get(r[0])?.shortsViews ?? null,
    viewsLong:         byType.get(r[0])?.longViews ?? null,
    watchTimeShorts:   byType.get(r[0])?.shortsWatch ?? null,
    watchTimeLong:     byType.get(r[0])?.longWatch ?? null,
  }));

  // Sources de trafic
  const trafficSources = (trafficData?.rows || []).map((r: any) => ({
    source: r[0] as string,
    views: r[1] || 0,
    watchMinutes: r[2] || 0,
  }));

  // Appareils
  const devices = (devicesData?.rows || []).map((r: any) => ({
    device: r[0] as string,
    views: r[1] || 0,
    watchMinutes: r[2] || 0,
  }));

  // Démographie âge/genre
  const demographics = (demoData?.rows || []).map((r: any) => ({
    ageGroup: r[0] as string,
    gender: r[1] as string,
    viewerPct: parseFloat((r[2] || 0).toFixed(1)),
  }));

  // Mots-clés de recherche top 10
  const searchKeywords = (searchTermsData?.rows || []).map((r: any) => ({
    term: r[0] as string,
    views: r[1] || 0,
  }));

  // Étape 2 : playlist "uploads" — TOUTES les vidéos, en paginant.
  //
  // ⚠️ `playlistItems` rend 50 éléments par page au maximum. Sans `pageToken`, la
  // chaîne était vue à ses 50 dernières vidéos, définitivement — et les plus
  // anciennes disparaissaient de Mes stats sans aucun signal.
  //
  // Même plafond que le cron (supabase/functions/poll-leads), pour que les deux
  // chemins voient la même chaîne. Deux plafonds différents feraient diverger le
  // tableau selon la période consultée, ce qui est exactement le genre d'écart qu'on
  // passe des heures à ne pas comprendre.
  const PLAFOND_VIDEOS = 200;
  const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
  const videoIds: string[] = [];

  if (uploadsPlaylistId) {
    let pageToken: string | undefined;
    do {
      const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails`
        + `&playlistId=${uploadsPlaylistId}&maxResults=50`
        + (pageToken ? `&pageToken=${pageToken}` : '');
      const playlistRes = await fetch(url, { headers: authHeader });
      if (!playlistRes.ok) break;
      const playlistData: any = await playlistRes.json();
      for (const item of playlistData?.items || []) {
        const id = item.contentDetails?.videoId;
        if (id) videoIds.push(id);
      }
      pageToken = playlistData?.nextPageToken;
    } while (pageToken && videoIds.length < PLAFOND_VIDEOS);
  }

  let videos: any[] = [];

  if (videoIds.length > 0) {
    // Groupage. `videos.list` accepte 50 ids par appel — c'est un maximum DUR, le
    // depasser renvoie une erreur. Les requetes Analytics sont groupees par 40, la
    // meme valeur que le cron : la doc annonce 500 ids, mais la checklist du projet
    // exige de verifier une capacite de groupage avec le vrai jeton avant de s'y fier,
    // ce qui n'a pas ete fait. 40 reste sous toutes les lectures possibles.
    const lots = <T,>(t: T[], n: number): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < t.length; i += n) out.push(t.slice(i, i + n));
      return out;
    };
    // Un lot qui echoue ne doit pas vider les autres : on concatene les lignes
    // obtenues plutot que d'abandonner le tout.
    const rowsGroupees = async (construireUrl: (ids: string) => string, taille: number) => {
      const rows: any[] = [];
      for (const lot of lots(videoIds, taille)) {
        const r = await fetch(construireUrl(lot.join(',')), { headers: authHeader });
        if (!r.ok) continue;
        const d = await r.json();
        rows.push(...(d?.rows || []));
      }
      return { rows };
    };

    const [detailsData, analyticsVideosData, views30dData, subsAllTimeRes, ctrByVideo] = await Promise.all([
      (async () => {
        const items: any[] = [];
        for (const lot of lots(videoIds, 50)) {
          const r = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${lot.join(',')}`,
            { headers: authHeader },
          );
          if (!r.ok) continue;
          const d = await r.json();
          items.push(...(d?.items || []));
        }
        return { items };
      })(),
      // Metriques contenu ALL-TIME par video (perf contenu, pas business) — sert aux
      // ratios watch time / vues, ou numerateur et denominateur viennent de la meme
      // fenetre, donc justes quelle que soit sa largeur.
      rowsGroupees(ids =>
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2020-01-01&endDate=${getToday()}&metrics=views,estimatedMinutesWatched,averageViewPercentage,likes,comments,shares,subscribersGained&dimensions=video&filters=video==${ids}&maxResults=500`, 40),
      // Vues des 30 DERNIERS JOURS par video — requete distincte, pour la colonne
      // « Vues 30j » du tableau.
      //
      // Elle affichait jusqu'ici le total all-time de la requete ci-dessus, stocke dans
      // un champ nomme views30d : une video de juin 2025 a 1 972 vues affichait « +1970
      // sur 30j », soit 99,9 % de ses vues en un mois. La vraie valeur est 12.
      // Le chemin snapshot, lui, lisait bien views_period — deux chemins, deux valeurs
      // differentes dans le meme champ (constate le 2026-08-21).
      rowsGroupees(ids =>
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views&dimensions=video&filters=video==${ids}&maxResults=500`, 40),
      // Abonnés gagnés all-time par vidéo (sans filtre pour avoir toutes les vidéos)
      fetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2020-01-01&endDate=${getToday()}&metrics=views,subscribersGained,subscribersLost&dimensions=video&maxResults=50`,
        { headers: authHeader }
      ),
      // CTR par vidéo depuis la Reporting API (channel_reach_basic_a1)
      fetchCtrByVideo(accessToken),
    ]);

    // `maxResults` passe de 50 a 500 sur les deux requetes Analytics ci-dessus : il
    // bornait le nombre de LIGNES rendues, donc au-dela de 50 videos les dernieres
    // n'avaient aucune metrique — un plafond de plus, invisible.
    // videoId -> vues des 30 derniers jours (0 si la video n'a eu aucune vue : l'API
    // n'emet pas de ligne dans ce cas, et 0 est ici la bonne valeur — la video existe,
    // elle n'a simplement pas ete vue).
    const views30dByVideo: Record<string, number> = {};
    for (const row of views30dData?.rows || []) views30dByVideo[row[0]] = row[1] || 0;
    const subsAllTimeData = await subsAllTimeRes.json();

    // Map abonnés all-time par videoId
    const subsAllTimeByVideo: Record<string, { subsGainedTotal: number; subsLostTotal: number }> = {};
    for (const row of subsAllTimeData?.rows || []) {
      subsAllTimeByVideo[row[0]] = {
        subsGainedTotal: row[2] || 0,
        subsLostTotal: row[3] || 0,
      };
    }

    // Map analytics 30j par videoId
    const analyticsByVideo: Record<string, { views30d: number; viewsAllTime: number; watchTime30d: number; avgViewPct: number; likes30d: number; comments30d: number; shares30d: number; subsGained30d: number }> = {};
    for (const row of analyticsVideosData?.rows || []) {
      analyticsByVideo[row[0]] = {
        // Vues des 30 derniers jours (requete dediee), pas le total all-time de CETTE
        // requete — c'est ce que la colonne « Vues 30j » annonce.
        views30d: views30dByVideo[row[0]] ?? 0,
        // Total all-time, conserve pour les ratios watch time / vues qui doivent
        // diviser deux valeurs de la meme fenetre.
        viewsAllTime: row[1] || 0,
        // Déjà en minutes — même correction que poll-leads/index.ts et yt-fetch.ts.
        watchTime30d: Math.round(row[2] || 0),
        avgViewPct: parseFloat(((row[3] || 0)).toFixed(1)),
        likes30d: row[4] || 0,
        comments30d: row[5] || 0,
        shares30d: row[6] || 0,
        subsGained30d: row[7] || 0,
      };
    }

    const retentionCurve: any[] = [];

    videos = (detailsData?.items || [])
      // Un direct EN COURS ou PROGRAMME n'est pas une video : ni duree finale, ni
      // retention, ni performance a analyser. Sur le profil de test, un live jamais
      // demarre remontait avec « duration: P0D » — soit 0 seconde, donc classe SHORT par
      // la regle `durSecs <= 60` ci-dessous, et affiche avec une ligne entierement vide.
      //
      // Une REDIFFUSION reste comptee : YouTube repasse liveBroadcastContent a « none »
      // une fois la diffusion terminee, elle redevient alors une video normale. La
      // distinction se fait donc seule, sans regle a maintenir.
      //
      // Verifie contre l'API le 2026-08-21 sur dWn-lq6g38k : liveBroadcastContent
      // « upcoming », duration « P0D », liveStreamingDetails sans actualStartTime.
      .filter((v: any) => v.snippet?.liveBroadcastContent !== 'live' && v.snippet?.liveBroadcastContent !== 'upcoming')
      .map((v: any) => {
      const a = analyticsByVideo[v.id] || { views30d: 0, viewsAllTime: 0, watchTime30d: 0, avgViewPct: 0, likes30d: 0, comments30d: 0, shares30d: 0, subsGained30d: 0 };
      const st = subsAllTimeByVideo[v.id] || { subsGainedTotal: 0, subsLostTotal: 0 };
      const rawDuration = v.contentDetails?.duration || 'PT0S';
      const durMatch = rawDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      const durSecs = (parseInt(durMatch?.[1] || '0') * 3600) + (parseInt(durMatch?.[2] || '0') * 60) + parseInt(durMatch?.[3] || '0');
      const isShort = durSecs <= 60;
      return {
        id: v.id,
        title: v.snippet?.title,
        thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url,
        publishedAt: v.snippet?.publishedAt,
        duration: parseDuration(rawDuration),
        isShort,
        views: parseInt(v.statistics?.viewCount || '0'),
        likes: parseInt(v.statistics?.likeCount || '0'),
        comments: parseInt(v.statistics?.commentCount || '0'),
        views30d: a.views30d,
        // Total all-time : denominateur des ratios watch time / vues, qui doivent
        // diviser deux valeurs de la MEME fenetre. Ne pas y substituer views30d.
        viewsAllTime: a.viewsAllTime,
        watchTime30d: a.watchTime30d,
        avgViewPct: a.avgViewPct,
        likes30d: a.likes30d,
        comments30d: a.comments30d,
        shares30d: a.shares30d,
        subsGained30d: a.subsGained30d,
        subsGainedTotal: st.subsGainedTotal,
        subsLostTotal: st.subsLostTotal,
        ctr: ctrByVideo[v.id] ?? null,
        url: `https://www.youtube.com/watch?v=${v.id}`,
      };
    });

    return NextResponse.json({
      channelName: channel.snippet?.title,
      channelThumbnail: channel.snippet?.thumbnails?.default?.url,
      subscribers: parseInt(stats?.subscriberCount || '0'),
      totalViews: parseInt(stats?.viewCount || '0'),
      videoCount: parseInt(stats?.videoCount || '0'),
      views30d, watchTime30d: Math.round(watchTime30d / 60), avgViewDurationSec,
      likes30d, comments30d, shares30d,
      subsGained30d, subsLost30d, netSubs30d: subsGained30d - subsLost30d,
      chartData, videos, retentionCurve,
      trafficSources, devices, demographics, searchKeywords,
    });
  }

  return NextResponse.json({
    channelName: channel.snippet?.title,
    channelThumbnail: channel.snippet?.thumbnails?.default?.url,
    subscribers: parseInt(stats?.subscriberCount || '0'),
    totalViews: parseInt(stats?.viewCount || '0'),
    videoCount: parseInt(stats?.videoCount || '0'),
    views30d, watchTime30d: Math.round(watchTime30d / 60), avgViewDurationSec,
    likes30d, comments30d, shares30d,
    subsGained30d, subsLost30d, netSubs30d: subsGained30d - subsLost30d,
    chartData, videos: [], retentionCurve: [],
    trafficSources, devices, demographics, searchKeywords,
  });
}
