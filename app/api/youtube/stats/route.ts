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

// ─────────────────────────────────────────────────────────────────────────────────
// CTR par vidéo — Reporting API (channel_reach_basic_a1)
// ─────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ CETTE FONCTION EST LE SEUL CONSOMMATEUR D'UN QUOTA TENDU. À lire avant d'y toucher.
//
// `youtubereporting.googleapis.com` est plafonné à **60 requêtes par minute, PAR PROJET
// Google Cloud** — donc partagé entre TOUS les élèves. C'est le seul quota serré de la
// pile YouTube : la Data API (10 000/jour) et l'Analytics API (100 000/jour) sont sous
// les 1 %.
//
// Ce que coûtait un affichage de l'écran de statistiques :
//
//     1 appel   /v1/jobs
//     1 appel   /v1/jobs/{id}/reports
//    30 téléchargements EN PARALLÈLE
//   ──────────────────────────────────
//    32 requêtes Reporting
//
// Deux chargements dans la même minute = 64, au-dessus du plafond. Constaté en vrai :
// alerte Google Cloud du 2026-09-04 à 18:42 UTC, observée à 1,0667 — soit 64/min. La
// valeur tombait au chiffre près.
//
// ⚠️ Le bornage du 2026-09-02 (6 rapports par passage, 2 téléchargements simultanés)
// avait été posé sur les deux chemins d'ÉCRITURE — `poll-leads` et sa jumelle
// `lib/yt-fetch.ts` — et jamais ici. Un garde-fou posé sur les chemins d'écriture ne
// couvre pas les chemins de LECTURE, et rien ne le signalait.
//
// ── Ce qui n'a PAS changé, volontairement ────────────────────────────────────────
//
// Le calcul est intact : toujours les 30 rapports les plus récents, même agrégation,
// même valeur affichée. Appliquer ici la borne des chemins d'écriture (6 rapports)
// aurait corrigé le quota en FAUSSANT la métrique — les impressions sont sommées sur la
// fenêtre, donc moins de rapports donne moins d'impressions. On corrige le nombre
// d'appels, jamais le résultat.
//
// ── Deux protections, qui ne font pas la même chose ──────────────────────────────
//
// 1. Un cache PARTAGÉ en base (`youtube_ctr_cache`), TTL 6 h. Le cache mémoire de cette
//    route (`cacheParProfil`, plus bas) ne pouvait pas empêcher ça et son propre
//    commentaire le dit : « le cache est PAR INSTANCE serverless, il ne garantit rien ».
//    Deux chargements servis par deux instances Vercel paient chacun leurs 32 appels, et
//    un démarrage à froid aussi. Pour un quota exprimé par minute ET par projet, un cache
//    local ne borne rien.
//
//    6 h ne coûte aucune fraîcheur : les rapports sont JOURNALIERS et arrivent à ~J-2.
//    Recalculer 4 fois par jour est déjà huit fois plus fin que la donnée elle-même ; un
//    TTL plus court repaierait 32 appels pour relire le rapport de la veille.
//
// 2. Une borne de CONCURRENCE (3 au lieu de 30 en parallèle). Le cache supprime les
//    calculs RÉPÉTÉS ; il ne peut rien contre un premier calcul. La borne étale celui-ci
//    au lieu de le tirer en une rafale.
//
// ⚠️ Risque résiduel assumé : un coach qui ouvre à froid les statistiques de K élèves
// dans la même minute paie K × 32 appels. Aller plus loin supposerait un agrégat
// incrémental, qui ferait glisser la fenêtre des « 30 derniers rapports » vers « tout
// l'historique » et changerait donc la valeur affichée. Ne pas s'y lancer sans une mesure
// qui le justifie — le cas réellement observé était le rechargement répété du MÊME écran,
// que le cache supprime entièrement.
const TTL_CTR_MS = 6 * 60 * 60 * 1000;
// Au-delà, on préfère « on ne sait pas » à une valeur dont on ignore l'âge.
const PEREMPTION_CTR_MS = 7 * 24 * 60 * 60 * 1000;
const TELECHARGEMENTS_SIMULTANES = 3;

async function fetchCtrByVideo(
  profileId: string,
  accessToken: string,
): Promise<Record<string, number | null>> {
  type Ctr = Record<string, number | null>;

  // Lecture du cache partagé. Une panne de lecture ne doit rien empêcher : on recalcule.
  let enCache: { payload: Ctr; calcule_a: string } | null = null;
  try {
    const { data } = await serviceSupabase
      .from('youtube_ctr_cache')
      .select('payload, calcule_a')
      .eq('profile_id', profileId)
      .maybeSingle();
    if (data) enCache = data as { payload: Ctr; calcule_a: string };
  } catch { /* cache injoignable : on recalcule, c'est le comportement d'avant */ }

  const ageCache = enCache ? Date.now() - new Date(enCache.calcule_a).getTime() : Infinity;
  if (enCache && ageCache < TTL_CTR_MS) return enCache.payload;

  // ⚠️ Repli sur l'entrée PÉRIMÉE en cas d'échec, jamais sur `{}`.
  //
  // Rendre `{}` afficherait « aucun CTR » — une affirmation, alors qu'un appel raté ne
  // dit rien du CTR. C'est la règle du projet : un `0` affirme quelque chose, un trou dit
  // « on ne sait pas ». Une valeur de la veille est plus juste qu'un vide.
  //
  // Mais pas indéfiniment : passé une semaine, on rend le vide, parce qu'une valeur dont
  // on ignore l'âge finirait par être lue comme actuelle.
  const repli = (): Ctr => (enCache && ageCache < PEREMPTION_CTR_MS ? enCache.payload : {});

  const auth = { Authorization: `Bearer ${accessToken}` };
  try {
    const jobsRes = await fetch('https://youtubereporting.googleapis.com/v1/jobs', { headers: auth });
    if (!jobsRes.ok) return repli();
    const jobsData = await jobsRes.json();
    const reachJob = (jobsData.jobs || []).find((j: any) => j.reportTypeId === 'channel_reach_basic_a1');
    if (!reachJob) return repli();

    const reportsRes = await fetch(
      `https://youtubereporting.googleapis.com/v1/jobs/${reachJob.id}/reports`,
      { headers: auth }
    );
    if (!reportsRes.ok) return repli();
    const reportsData = await reportsRes.json();
    const reports: any[] = (reportsData.reports || [])
      .sort((a: any, b: any) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime())
      .slice(0, 30); // 30 derniers rapports journaliers = ~30 jours

    // Téléchargement par tranches — même motif que `lib/yt-fetch.ts`. Le `Promise.all`
    // sur les 30 rapports tirait 30 requêtes simultanées sur un quota exprimé PAR MINUTE.
    const csvTexts: string[] = [];
    for (let i = 0; i < reports.length; i += TELECHARGEMENTS_SIMULTANES) {
      const tranche = reports.slice(i, i + TELECHARGEMENTS_SIMULTANES);
      const textes = await Promise.all(tranche.map(async (report: any) => {
        try {
          const dlRes = await fetch(report.downloadUrl, { headers: auth });
          if (!dlRes.ok) return '';
          const buffer = Buffer.from(await dlRes.arrayBuffer());
          try { return gunzipSync(buffer).toString('utf-8'); } catch { return buffer.toString('utf-8'); }
        } catch { return ''; }
      }));
      csvTexts.push(...textes);
    }

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
    const result: Ctr = {};
    for (const [videoId, s] of Object.entries(byVideo)) {
      result[videoId] = s.ctrCount > 0 ? parseFloat((s.ctrSum / s.ctrCount * 100).toFixed(2)) : null;
    }

    // ⚠️ On ne mémorise QUE un calcul réussi ET non vide.
    //
    // Écrire un `{}` — rapports illisibles, chaîne sans vidéo, réponse tronquée — le
    // figerait pendant 6 h en le faisant passer pour une mesure, et l'écran afficherait
    // « aucun CTR » alors que la bonne réponse est « on n'a pas pu lire ». Un cache ne
    // doit jamais mémoriser une ignorance.
    if (Object.keys(result).length > 0) {
      try {
        await serviceSupabase
          .from('youtube_ctr_cache')
          .upsert(
            { profile_id: profileId, payload: result, calcule_a: new Date().toISOString() },
            { onConflict: 'profile_id' },
          );
      } catch { /* le cache est une optimisation : son échec ne prive l'écran de rien */ }
    }
    return result;
  } catch { return repli(); }
}

/**
 * Cache court, en memoire, par eleve.
 *
 * ⚠️ Le quota de la Data API v3 est de 10 000 unites/jour PAR PROJET Google Cloud,
 * partage entre tous les eleves — pas par eleve comme Instagram ou Calendly. Le mode
 * de panne est donc GLOBAL : une fois epuise, plus aucun eleve ne collecte jusqu'a
 * minuit heure du Pacifique.
 *
 * Cette route n'avait aucun cache et part a chaque affichage de page. Elle consomme
 * 1 unite pour `channels.list`, plus 1 par page de `playlistItems` et 1 par lot de
 * `videos.list` — soit 3 unites a 29 videos et 9 au plafond de 200. Les appels
 * Analytics ne comptent PAS ici : cette API a son propre quota (verifie dans la doc
 * Google le 2026-09-02).
 *
 * 5 minutes ne coute aucune fraicheur : YouTube Analytics accuse deja 2 a 3 jours de
 * retard, et les statistiques lifetime bougent lentement.
 *
 * ⚠️ Limite assumee : le cache est PAR INSTANCE serverless. Il ne garantit rien, il
 * ecrete — plusieurs instances peuvent chacune payer un appel. C'est suffisant ici
 * puisqu'on cherche a supprimer les rafales de rechargements, pas a garantir un
 * nombre d'appels. Un cache partage supposerait une table ou un Redis, pour un gain
 * marginal sur ce poste.
 *
 * Volontairement PAS un `Cache-Control` HTTP : la reponse est propre a un eleve, et
 * un cache partage en ferait fuiter le contenu d'un compte a l'autre.
 */
const TTL_CACHE_MS = 5 * 60 * 1000;
const cacheParProfil = new Map<string, { a: number; charge: any }>();

/**
 * Memorise la charge utile puis la renvoie. Les entrees perimees sont purgees au
 * passage : sans ca la Map grossit d'un profil par eleve et n'est jamais videe, ce
 * qui est sans gravite a 40 eleves mais devient une fuite si la route sert un jour
 * un parc plus large.
 */
function repondreEtMemoriser(profilId: string, charge: any) {
  const maintenant = Date.now();
  for (const [cle, v] of cacheParProfil) {
    if (maintenant - v.a >= TTL_CACHE_MS) cacheParProfil.delete(cle);
  }
  cacheParProfil.set(profilId, { a: maintenant, charge });
  return NextResponse.json(charge);
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

  // Pose APRES le controle d'autorisation ci-dessus : un cache consulte avant
  // l'authentification servirait les statistiques d'un eleve a n'importe qui.
  const enCache = cacheParProfil.get(targetProfileId);
  if (enCache && Date.now() - enCache.a < TTL_CACHE_MS) {
    return NextResponse.json(enCache.charge);
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
  // 500 et non 200 : des eleves avec des chaines de 200+ videos arrivent (Chris,
  // 2026-09-02). A 200, leurs plus anciennes videos disparaissaient de Mes Stats —
  // signale dans cron_runs depuis le meme jour, mais signale ne veut pas dire
  // acceptable pour quelqu'un qui paie.
  //
  // Cout mesure sur la Data API v3 (10 000 unites/jour, PARTAGEE entre tous les
  // eleves), a 40 eleves, les deux caches de 5 min pris en compte :
  //   29 videos  ~1 800/jour  18 %
  //   200        ~3 500/jour  35 %
  //   500        ~6 840/jour  68 %
  //
  // 68 % est tenable, pas confortable. Le filet est l'alerte Data API a 80 % posee
  // dans la console Google Cloud le meme jour.
  //
  // ⚠️ LE TERME DOMINANT EST LA ROUTE LIVE (~5 040 des 6 840), parce qu'elle pagine
  // a chaque appel alors que le cron ne le fait qu'une fois par jour. Si ce quota
  // devenait tendu, le levier n'est PAS de rabaisser ce plafond : c'est de servir la
  // liste des videos depuis `analytics_yt_videos_history`, que le cron alimente deja
  // chaque jour. Cela ramenerait le total a 18 %.
  //
  // Les deux chemins doivent garder LA MEME valeur : deux plafonds differents
  // feraient diverger le tableau selon la periode consultee.
  const PLAFOND_VIDEOS = 500;
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
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2020-01-01&endDate=${getToday()}&metrics=views,subscribersGained,subscribersLost&dimensions=video&maxResults=500`,
        { headers: authHeader }
      ),
      // CTR par vidéo depuis la Reporting API (channel_reach_basic_a1).
      // ⚠️ `targetProfileId` et non `user.id` : c'est l'élève CONSULTÉ qui porte le
      // cache. Passer l'identifiant du coach ferait servir le CTR d'un élève pour un
      // autre — une fuite entre comptes, pas une simple imprécision.
      fetchCtrByVideo(targetProfileId, accessToken),
    ]);

    // `maxResults` passe de 50 a 500 sur les TROIS requetes Analytics ci-dessus : il
    // bornait le nombre de LIGNES rendues, donc au-dela de 50 videos les dernieres
    // n'avaient aucune metrique — un plafond de plus, invisible.
    //
    // La troisieme (abonnes gagnes all-time) avait ete oubliee, et le commentaire
    // disait « les deux ». Elle est la plus exposee des trois : sans `filters=video==`,
    // elle porte sur TOUTES les videos de la chaine, donc c'est elle qui tronque en
    // premier. Trouvee le 2026-09-02 en relevant PLAFOND_VIDEOS a 500 — un plafond
    // qu'on releve met au jour ceux qu'il masquait.
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

    return repondreEtMemoriser(targetProfileId, {
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

  return repondreEtMemoriser(targetProfileId, {
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
