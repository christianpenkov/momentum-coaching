// Logique de fetch des métriques Instagram — SOURCE DE VÉRITÉ UNIQUE.
//
// Ce fichier ne contient QUE du fetch() natif et des utilitaires purs — aucun
// import npm (pas de @supabase/supabase-js) — pour rester copiable tel quel
// dans supabase/functions/poll-leads/index.ts (runtime Deno).
//
// ⚠️ Ce fichier est DUPLIQUÉ physiquement dans supabase/functions/poll-leads/index.ts
// (Deno ne peut pas importer un fichier hors de son dossier de déploiement sans
// bundler dédié, et il n'y a pas de CLI Supabase lié localement dans ce projet).
// Toute modification ici doit être recopiée manuellement dans le bloc équivalent
// du cron, puis redéployée via mcp__claude_ai_Supabase__deploy_edge_function.
// Voir docs/cron-poll-leads-dates.md pour le contexte complet.

export interface IgCredsCore {
  token: string;
  igAccountId: string;
}

export interface IgDayMetricsCore {
  ig_reach: number | null;
  ig_followers: number | null;
  ig_following: number | null;
  ig_views: number | null;
  ig_follows_unfollows: number | null;
  ig_profile_taps: number | null;
  ig_website_clicks: number | null;
  ig_accounts_engaged: number | null;
  ig_total_interactions: number | null;
  ig_lead_count: number | null;
  ig_response_rate: number | null;
  ig_reach_follower: number | null;
  ig_reach_non_follower: number | null;
}

// "Aujourd'hui"/"hier" en heure de Paris (celle de l'utilisateur), pas en UTC brut —
// sinon, entre 22h et minuit UTC (00h-02h heure d'été Paris), un calcul UTC pur
// assigne encore la veille alors que c'est déjà le jour suivant à Paris.
export function isoDateCore(daysAgo: number): string {
  const now = new Date(Date.now() - daysAgo * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now); // format en-CA = YYYY-MM-DD
}

async function safeJsonCore(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

// Fetch des métriques Instagram pour UNE journée donnée (period=day).
// Utilisé par le cron (poll-leads) ET le bouton Rafraîchir (refresh-today) —
// modifier cette fonction modifie automatiquement les deux.
export async function fetchIgDayMetricsCore(
  creds: IgCredsCore,
  date: string, // ISO YYYY-MM-DD
): Promise<IgDayMetricsCore> {
  const { token, igAccountId } = creds;

  const d = new Date(date + 'T00:00:00Z');
  const since = Math.floor(d.getTime() / 1000);
  const until = since + 86400;

  const [accountRes, insightsRes, engagedRes, reachBreakdownRes] = await Promise.all([
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}?fields=followers_count,follows_count&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach,follower_count,follows_and_unfollows,profile_links_taps,website_clicks,views&period=day&since=${since}&until=${until}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=accounts_engaged,total_interactions&metric_type=total_value&period=day&since=${since}&until=${until}&access_token=${token}`),
    // reach + breakdown follow_type ne renvoie un vrai détail (pas un agrégat collapsé)
    // que sur une fenêtre d'UN jour — confirmé en testant l'API réelle.
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach&metric_type=total_value&breakdown=follow_type&period=day&since=${since}&until=${until}&access_token=${token}`),
  ]);

  const [accountData, insightsData, engagedData, reachBreakdownData] = await Promise.all([
    safeJsonCore(accountRes), safeJsonCore(insightsRes), safeJsonCore(engagedRes), safeJsonCore(reachBreakdownRes),
  ]);

  const insightMap: Record<string, number[]> = {};
  for (const metric of insightsData?.data || []) {
    insightMap[metric.name] = (metric.values || []).map((v: any) => v.value || 0);
  }
  const sum = (arr: number[]) => (arr || []).reduce((a, b) => a + b, 0);

  // engagedData contient 2 métriques distinctes dans le même appel (accounts_engaged
  // ET total_interactions) — sommer sans distinguer m.name additionne les deux valeurs
  // ensemble et les assigne aux deux colonnes (bug trouvé le 2026-07-06).
  let accountsEngagedTotal = 0;
  let totalInteractionsTotal = 0;
  for (const m of (engagedData?.data || [])) {
    const v = m.total_value?.value || 0;
    if (m.name === 'accounts_engaged') accountsEngagedTotal += v;
    else if (m.name === 'total_interactions') totalInteractionsTotal += v;
  }

  let reachFollower: number | null = null;
  let reachNonFollower: number | null = null;
  for (const metric of reachBreakdownData?.data || []) {
    if (metric.name === 'reach' && metric.total_value?.breakdowns) {
      let follower = 0, nonFollower = 0, found = false;
      for (const bd of metric.total_value.breakdowns) {
        for (const r of bd.results || []) {
          const key = r.dimension_values?.[0];
          if (key === 'FOLLOWER') { follower += r.value || 0; found = true; }
          else if (key === 'NON_FOLLOWER') { nonFollower += r.value || 0; found = true; }
        }
      }
      if (found) { reachFollower = follower; reachNonFollower = nonFollower; }
    }
  }

  // `valeur || null` effacerait un vrai 0 (fréquent en tout début de journée) en null —
  // null doit signifier "métrique absente de la réponse Meta", pas "somme égale à zéro".
  return {
    ig_reach:              insightMap['reach'] !== undefined ? sum(insightMap['reach']) : null,
    ig_followers:          accountData.followers_count ?? null,
    ig_following:          accountData.follows_count ?? null,
    ig_views:              insightMap['views'] !== undefined ? sum(insightMap['views']) : null,
    ig_follows_unfollows:  insightMap['follows_and_unfollows'] !== undefined ? sum(insightMap['follows_and_unfollows']) : null,
    ig_profile_taps:       insightMap['profile_links_taps'] !== undefined ? sum(insightMap['profile_links_taps']) : null,
    ig_website_clicks:     insightMap['website_clicks'] !== undefined ? sum(insightMap['website_clicks']) : null,
    ig_accounts_engaged:   (engagedData?.data || []).some((m: any) => m.name === 'accounts_engaged') ? accountsEngagedTotal : null,
    ig_total_interactions: (engagedData?.data || []).some((m: any) => m.name === 'total_interactions') ? totalInteractionsTotal : null,
    ig_lead_count:         null,
    ig_response_rate:      null,
    ig_reach_follower:     reachFollower,
    ig_reach_non_follower: reachNonFollower,
  };
}
