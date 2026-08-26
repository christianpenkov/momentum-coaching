import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getIgCreds } from '@/lib/ig-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');

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

  const creds = await getIgCreds(targetProfileId);
  if (!creds) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const { token, igAccountId } = creds;

  // ⚠️ Plafond dur pour toute requete portant un `breakdown` (voir
  // docs/instagram-reach-follow-type.md). La ventilation follow_type n'existe que
  // sur ~12 mois glissants, alors que le reach total remonte a 2 ans : au-dela,
  // Meta totalise toute la fenetre mais ne ventile que la partie recente qu'il
  // detient encore, SANS aucune erreur.
  //
  // Mesure du 2026-08-26 : a 729 jours, total 12 732 contre 973 ventiles, soit
  // 93 % d'ecart. La ventilation est strictement constante de 400 a 729 jours.
  //
  // La fenetre est aujourd'hui figee a 30 jours, donc sans risque. Cette constante
  // existe pour le jour ou elle deviendra dynamique : elle rend la faute
  // impossible plutot que de compter sur la vigilance.
  const MAX_JOURS_BREAKDOWN = 366;

  // Fenetre demandee par l'appelant. 30 jours par defaut — c'etait la seule
  // valeur possible avant le 2026-08-26, et les trois autres appelants de cette
  // route ne passent pas le parametre, donc leur comportement ne change pas.
  //
  // L'ecran Mes Stats passe 365 en mode All-Time : la ventilation abonnes /
  // non-abonnes n'existe que sur ~12 mois glissants, alors que le reach total
  // remonte a 2 ans. Au-dela, Meta totalise toute la fenetre mais ne ventile que
  // la partie recente, SANS erreur — 93 % d'ecart mesure a 729 jours.
  //
  // Le clamp n'est donc pas defensif au sens habituel : il empeche d'afficher un
  // pourcentage faux. Voir docs/instagram-reach-follow-type.md.
  const fenetreDemandee = Number(searchParams.get('fenetre'));
  const JOURS_FENETRE = Number.isFinite(fenetreDemandee) && fenetreDemandee > 0
    ? Math.min(Math.floor(fenetreDemandee), MAX_JOURS_BREAKDOWN)
    : 30;
  const since = Math.floor((Date.now() - JOURS_FENETRE * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);
  // online_followers : fenêtre J-33→J-3 pour éviter les 48h de délai Meta (objets {} vides)
  const ofUntil = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);
  const ofSince = Math.floor((Date.now() - 33 * 24 * 60 * 60 * 1000) / 1000);

  // Trace les reponses en erreur au lieu de les avaler.
  //
  // Avant, un 400 ou un 429 de Meta etait parse comme n'importe quelle reponse : le
  // corps d'erreur (qui n'a pas de cle `data`) devenait un objet vide en aval,
  // indiscernable d'un « pas de donnee pour cette periode ». Un jeton expire ou un
  // quota atteint disparaissait donc totalement, et l'ecran affichait des zeros.
  //
  // On renvoie toujours l'objet parse pour ne rien casser en aval, mais l'echec
  // apparait desormais dans les erreurs remontees au client.
  const erreursApi: string[] = [];
  const safeJson = async (res: Response) => {
    let body: any = {};
    try { body = await res.json(); } catch { body = {}; }
    if (!res.ok || body?.error) {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      erreursApi.push(String(msg).slice(0, 160));
    }
    return body;
  };

  // reach/follower_count/accounts_engaged/total_interactions/posts : lus depuis
  // analytics_daily_snapshots / analytics_ig_posts_history (même DB que la vue
  // historique S-1+, alimentée par le cron toutes les 30 min — cf. lib/ig-fetch.ts /
  // supabase/functions/poll-leads/index.ts), pas depuis l'API Meta live.
  //
  // RÈGLE (pour éviter la récidive, cf. bug du 2026-07-07) : toute métrique Meta qui
  // n'existe qu'en `metric_type=total_value` agrégé sur toute la fenêtre demandée
  // (accounts_engaged, total_interactions — jamais une vraie série `values[]` par
  // jour, contrairement à reach/follower_count) NE DOIT JAMAIS être reconstruite
  // depuis un appel live dans cette route : soit la DB a la vraie valeur quotidienne
  // (le cron interroge Meta un jour à la fois), soit rien. Un appel live "total_value"
  // pour ce genre de métrique ne peut remplir qu'un seul point (l'agrégat), jamais
  // toute une série jour par jour — l'ancien bug venait exactement de ce genre de
  // confusion (résultat fetché puis jamais utilisable proprement).
  //
  // Champs qui restent en live Meta (bio/photo/username/heatmap/démographie/views
  // breakdown/reach dédupliqué 28j) : jamais collectés par le cron aujourd'hui,
  // migrer ça est un chantier de collecte séparé (cf. TODOS.md / plan).
  const sinceDateStr = new Date(since * 1000).toISOString().split('T')[0];
  const untilDateStr = new Date(until * 1000).toISOString().split('T')[0];
  const dbSnapshotsPromise = serviceSupabase
    .from('analytics_daily_snapshots')
    .select('date, ig_reach, ig_followers, ig_accounts_engaged, ig_total_interactions, ig_views, ig_website_clicks, ig_profile_taps, ig_reach_follower, ig_reach_non_follower')
    .eq('profile_id', targetProfileId)
    .is('archived_at', null)
    .gte('date', sinceDateStr)
    .lte('date', untilDateStr)
    .order('date', { ascending: true });
  const dbPostsPromise = serviceSupabase
    .from('analytics_ig_posts_history')
    .select('*')
    .eq('profile_id', targetProfileId)
    .is('archived_at', null)
    .gte('snapshot_date', sinceDateStr)
    .lte('snapshot_date', untilDateStr)
    .order('snapshot_date', { ascending: false });

  const [accountRes, demoRes, onlineFollowersRes, viewsBreakdownRes, reachDedupRes, dbSnapshotsRes, dbPostsRes] = await Promise.all([
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}?fields=username,name,profile_picture_url,followers_count,follows_count,media_count,biography&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=follower_demographics&period=lifetime&breakdown=age,gender,country,city&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=online_followers&period=lifetime&since=${ofSince}&until=${ofUntil}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=views&metric_type=total_value&breakdown=follow_type,media_product_type&period=day&since=${since}&until=${until}&access_token=${token}`),
    // Reach RÉELLEMENT dédupliqué sur la fenêtre, ventilé abonnés/non-abonnés — pas une
    // somme de valeurs quotidiennes (qui recompte un même compte touché sur plusieurs
    // jours) : Meta calcule les comptes uniques côté serveur.
    //
    // ⚠️ `since`/`until` sont INDISPENSABLES. Le commentaire precedent affirmait qu'ils
    // n'etaient pas acceptes pour cette metrique et la requete les omettait : Meta
    // ignorait alors le `period=days_28`, repondait `period: day` et ne renvoyait
    // qu'UNE journee — la derniere. Sur le compte de test cela donnait
    // { NON_FOLLOWER: 1 } et zero FOLLOWER, donc un « Followers reach rate » affiche a
    // 0 % et un « Reach non-followers » a 100 %, soit exactement l'inverse de la
    // realite.
    //
    // Verifie contre l'API le 2026-08-22, meme requete avec les bornes :
    //   sans since/until : { NON_FOLLOWER: 1 }          -> 0 %
    //   avec since/until : { FOLLOWER: 121, NON_FOLLOWER: 14 } -> 48 %
    //
    // `period=day` et non `days_28` (corrige le 2026-08-25). La doc Meta ne liste
    // plus que `day` pour `reach` ; `days_28` etait accepte en silence et Meta
    // repondait quand meme `period: day`. Teste cote a cote le meme jour : les deux
    // formes renvoient exactement le meme resultat, donc la correction ne change
    // aucun chiffre — elle supprime seulement une dependance a une tolerance non
    // documentee, qui peut devenir une erreur dure sans preavis.
    //
    // Ce sont `since`/`until` qui font le travail, pas la periode : sans bornes,
    // Meta applique un repli documente a 24 h (« If you do not include these
    // parameters, the API will look back 24 hours »).
    //
    // Les deux autres copies de cet appel (poll-leads, lib/ig-fetch) utilisaient
    // deja `period=day` — celle-ci etait la seule divergente.
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach&period=day&metric_type=total_value&breakdown=follow_type&since=${since}&until=${until}&access_token=${token}`),
    dbSnapshotsPromise,
    dbPostsPromise,
  ]);

  const [accountData, demoData, onlineFollowersData, viewsBreakdownData, reachDedupData] = await Promise.all([
    safeJson(accountRes), safeJson(demoRes), safeJson(onlineFollowersRes), safeJson(viewsBreakdownRes), safeJson(reachDedupRes),
  ]);
  const dbSnaps = dbSnapshotsRes.data ?? [];

  if (accountData.error) {
    return NextResponse.json({
      error: accountData.error.message,
      code: accountData.error.code,
      type: accountData.error.type,
    }, { status: 400 });
  }

  const sum = (arr: (number | null)[]) => arr.reduce((a: number, b) => a + (b ?? 0), 0);

  const reach30d = sum(dbSnaps.map(r => r.ig_reach));
  // Nombre RÉEL de comptes abonnés uniques distincts touchés sur ~28j (pas un ratio
  // statistique ni une somme de reach quotidien qui recompte un même compte touché
  // plusieurs jours) — total_value + breakdown=follow_type de Meta renvoie le vrai
  // décompte de comptes uniques par catégorie sur toute la fenêtre, calculé côté
  // serveur. Utilisé pour "Followers reach rate" = abonnés uniques touchés / abonnés
  // total ; reach30d (somme quotidienne) reste utilisé pour le KPI "Reach · personnes"
  // et le graphique jour par jour, non concernés par ce biais.
  let reach28dDedupFollowers: number | null = null;
  let reach28dDedupNonFollowers: number | null = null;
  for (const metric of reachDedupData?.data || []) {
    if (metric.name === 'reach' && metric.total_value?.breakdowns) {
      // On n'initialise a 0 que si la ventilation contient VRAIMENT des lignes.
      //
      // Avant, le simple fait que `breakdowns` existe suffisait a poser 0, meme quand
      // aucune categorie n'etait renvoyee : l'ecran affichait alors « 0 % » — une
      // mesure — la ou il fallait « N/D » — une absence. Le composant gere deja le cas
      // null (« seuil Meta non atteint »), il n'etait simplement jamais atteint.
      const lignes = metric.total_value.breakdowns.flatMap((bd: any) => bd.results || []);
      if (lignes.length === 0) continue;
      reach28dDedupFollowers = 0;
      reach28dDedupNonFollowers = 0;
      for (const r of lignes) {
        const key = r.dimension_values?.[0];
        if (key === 'FOLLOWER') reach28dDedupFollowers += r.value ?? 0;
        else if (key === 'NON_FOLLOWER') reach28dDedupNonFollowers += r.value ?? 0;
      }
    }
  }
  const accountsEngaged30d = sum(dbSnaps.map(r => r.ig_accounts_engaged));
  const totalInteractions30d = sum(dbSnaps.map(r => r.ig_total_interactions));
  const profileLinksTaps30d = sum(dbSnaps.map(r => r.ig_profile_taps));
  const websiteClicks30d = sum(dbSnaps.map(r => r.ig_website_clicks));
  const views30d = sum(dbSnaps.map(r => r.ig_views));
  // follows_and_unfollows : pas de colonne dédiée fiable en DB actuellement — approximé
  // par le delta net d'abonnés sur la fenêtre (dernier - premier jour connu).
  const followsUnfollows30d = (() => {
    const withFollowers = dbSnaps.filter(r => r.ig_followers != null);
    if (withFollowers.length < 2) return 0;
    return (withFollowers[withFollowers.length - 1].ig_followers ?? 0) - (withFollowers[0].ig_followers ?? 0);
  })();

  // Views breakdown follower_type : part abonnés vs non-abonnés (viralité)
  let viewsFollowerBreakdown: { follower: number; nonFollower: number } | null = null;
  for (const metric of viewsBreakdownData?.data || []) {
    if (metric.name === 'views' && metric.total_value?.breakdowns) {
      let follower = 0, nonFollower = 0;
      for (const bd of metric.total_value.breakdowns) {
        for (const r of bd.results || []) {
          const key = r.dimension_values?.[0];
          if (key === 'FOLLOWER') follower += r.value || 0;
          else if (key === 'NON_FOLLOWER') nonFollower += r.value || 0;
        }
      }
      if (follower + nonFollower > 0) viewsFollowerBreakdown = { follower, nonFollower };
    }
  }

  // Démographie abonnés
  const demographics: Record<string, any> = {};
  for (const metric of demoData?.data || []) {
    if (metric.name === 'follower_demographics' && metric.total_value?.breakdowns) {
      for (const breakdown of metric.total_value.breakdowns) {
        const key = breakdown.dimension_keys?.[0];
        if (key) {
          demographics[key] = (breakdown.results || []).map((r: any) => ({
            label: r.dimension_values?.[0],
            value: r.value || 0,
          })).sort((a: any, b: any) => b.value - a.value).slice(0, 10);
        }
      }
    }
  }

  // Heatmap abonnés en ligne — period=lifetime, clés PST converties en heure Paris.
  // Offset Paris dérivé dynamiquement via Intl.DateTimeFormat (gère DST été/hiver
  // automatiquement, même pattern que lib/period.ts) — remplace un ancien
  // localOffset=2 figé sur l'été qui décalait la heatmap d'1h tout l'hiver.
  const now2 = new Date();
  function parisOffsetHoursAt(d: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Paris', timeZoneName: 'shortOffset',
    }).formatToParts(d);
    const tzName = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+1';
    const match = tzName.match(/GMT([+-]\d+)/);
    return match ? Number(match[1]) : 1;
  }
  const yr = now2.getUTCFullYear();
  const dstS = new Date(Date.UTC(yr, 2, 1)); dstS.setUTCDate(1 + (7 - dstS.getUTCDay()) % 7 + 7);
  const dstE = new Date(Date.UTC(yr, 10, 1)); dstE.setUTCDate(1 + (7 - dstE.getUTCDay()) % 7);
  const pstOffset = now2 >= dstS && now2 < dstE ? 7 : 8;
  const localOffset = parisOffsetHoursAt(now2);

  const heatmapMatrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const heatmapCount: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const ofValues = onlineFollowersData?.data?.[0]?.values || [];
  for (const entry of ofValues) {
    if (!entry.value || typeof entry.value !== 'object' || Object.keys(entry.value).length === 0) continue;
    const day = new Date(entry.end_time).getUTCDay();
    for (let pstHour = 0; pstHour < 24; pstHour++) {
      const count = entry.value[String(pstHour)] ?? 0;
      const localHour = (pstHour + pstOffset + localOffset) % 24;
      heatmapMatrix[day][localHour] += count;
      heatmapCount[day][localHour]++;
    }
  }
  const onlineFollowers = {
    heatmap: heatmapMatrix.map((row, d) =>
      row.map((sum, h) => heatmapCount[d][h] > 0 ? Math.round(sum / heatmapCount[d][h]) : 0)
    ),
    maxValue: Math.max(...heatmapMatrix.flat().map((sum, i) => {
      const d = Math.floor(i / 24); const h = i % 24;
      return heatmapCount[d][h] > 0 ? Math.round(sum / heatmapCount[d][h]) : 0;
    }), 1),
    dataPointCount: ofValues.filter((e: any) => e.value && Object.keys(e.value).length > 0).length,
  };

  // Chart reach + followers + vues + interactions par jour — directement depuis dbSnaps
  // (déjà trié par date croissante). ig_followers est déjà un nombre ABSOLU par jour
  // (pas un delta à reconstruire) : le cron écrit accountData.followers_count "réel" à
  // chaque passage, sur la ligne du jour concerné (hier + aujourd'hui, cf. fix cron
  // 2026-07-07) — plus besoin de reconstruire à rebours depuis un delta Meta bruité.
  const chartData = dbSnaps.map(r => ({
    date: r.date,
    reach: r.ig_reach ?? 0,
    // true seulement si la ligne existe mais que cette métrique précise n'a pas encore
    // été collectée par le cron (distinct d'un vrai 0) — permet à l'UI d'afficher "Pas
    // encore de données" plutôt qu'un 0 potentiellement trompeur pour le jour courant.
    reachPending: r.ig_reach == null,
    followerCount: r.ig_followers ?? null,
    views: r.ig_views ?? 0,
    viewsPending: r.ig_views == null,
    accountsEngaged: r.ig_accounts_engaged ?? 0,
    totalInteractions: r.ig_total_interactions ?? 0,
    websiteClicks: r.ig_website_clicks ?? 0,
    reachFollower: r.ig_reach_follower ?? null,
    reachNonFollower: r.ig_reach_non_follower ?? null,
  }));

  // Posts individuels — depuis analytics_ig_posts_history (même table que le cron
  // snapshotIgPosts alimente quotidiennement, thumbnails déjà pérennisées dans un
  // bucket Storage permanent depuis le fix du 2026-07-07). Dédupliqué par post_id, on
  // garde le snapshot le plus récent (query triée snapshot_date descendant) — même
  // pattern que latestIgPost/igPosts dans components/analytics/PageClientStats.tsx.
  const dbPostRows = dbPostsRes.data ?? [];
  const latestPostByid = new Map<string, any>();
  for (const row of dbPostRows) {
    if (!latestPostByid.has(row.post_id)) latestPostByid.set(row.post_id, row);
  }
  const posts = [...latestPostByid.values()]
    .map((row: any) => ({
      id: row.post_id,
      caption: row.caption ?? '',
      type: row.post_type ?? 'IMAGE',
      deletedAt: row.deleted_at ?? null,
      thumbnail: row.thumbnail ?? null,
      timestamp: row.published_at ?? row.snapshot_date,
      permalink: row.permalink ?? null,
      likes: row.likes ?? null,
      comments: row.comments ?? null,
      reach: row.reach ?? null,
      saved: row.saves ?? null,
      shares: row.shares ?? null,
      views: row.views ?? null,
      totalInteractions: row.total_interactions ?? null,
      follows: row.follows ?? null,
      profileVisits: row.profile_visits ?? null,
      avgWatchTimeMs: row.avg_watch_time_ms ?? null,
      totalWatchTimeMs: row.total_watch_time_ms ?? null,
      skipRate: row.skip_rate ?? null,
    }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return NextResponse.json({
    // Erreurs PARTIELLES : le compte repond, mais une ou plusieurs metriques ont
    // echoue (quota, metrique depreciee, seuil de confidentialite). Elles etaient
    // totalement avalees jusqu'ici — l'ecran affichait des zeros sans que rien
    // n'indique une panne. Non bloquant, mais desormais visible.
    ...(erreursApi.length ? { erreursPartielles: erreursApi } : {}),
    username: accountData.username,
    name: accountData.name,
    profilePicture: accountData.profile_picture_url || null,
    followers: accountData.followers_count || 0,
    following: accountData.follows_count || 0,
    mediaCount: accountData.media_count || 0,
    biography: accountData.biography || '',
    reach30d,
    reach28dDedupFollowers,
    reach28dDedupNonFollowers,
    // Fenetre reellement utilisee, en jours. L'ecran l'affiche en badge sur les
    // deux cartes de portee : elle peut differer de ce qui a ete demande (clamp a
    // 366 jours), et le badge doit dire ce qui a ete mesure, pas ce qui a ete
    // souhaite.
    fenetreJours: JOURS_FENETRE,
    accountsEngaged30d,
    totalInteractions30d,
    followsUnfollows30d,
    profileLinksTaps30d,
    websiteClicks30d,
    profileViews30d: 0,
    views30d,
    viewsFollowerBreakdown,
    chartData,
    posts,
    demographics,
    onlineFollowers,
  });
}
