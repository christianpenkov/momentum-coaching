import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type TopEntry = { label: string; value: number };

// Réponse propre à UN élève, dérivée d'une session authentifiée : jamais `public`
// (un cache partagé pourrait la resservir à quelqu'un d'autre), et jamais 24 h — le
// bouton « Rafraîchir » écrit en base puis relit cette route, et une réponse gardée
// une journée par le navigateur rendait le rafraîchissement invisible. 60 s de cache
// privé suffisent à absorber les remontages de composant sans figer les chiffres.
const CACHE_CONTROL = 'private, max-age=60, must-revalidate';

// Noms des champs de sortie : `clicsAvecBots` et `clicsHumains`, jamais `clicks30d` /
// `humanClicks30d`.
//
// Les anciens noms mentaient deux fois. Le suffixe « 30d » d'abord : la fenêtre est
// celle demandée par l'appelant, qui vaut aussi bien une semaine que tout l'historique.
// Et surtout `clicks30d` incluait les BOTS sans le dire, à côté d'un `humanClicks30d`
// qui, lui, les excluait — sur le profil de test, 499 contre 169, soit trois fois plus.
// Un nom qui ment survit à la correction de son symptôme et reproduit le bug ailleurs :
// c'est exactement ce mécanisme qui a produit les 39 % de clics fantômes.

/** Une ligne par lien, agrégée côté base par get_shortio_links_agreges. */
interface LigneAgregee {
  link_id: string;
  path: string;
  short_url: string;
  original_url: string;
  link_type: string | null;
  link_category: string | null;
  human_clicks: number;
  total_clicks: number;
  chart_data: { date: string; clicks: number }[] | null;
}

const EMPTY_STATS = {
  domain: '', totalLinks: 0, clicsAvecBots: 0, clicsHumains: 0,
  clicksChange: null as number | null, clicsHumainsParLien: 0,
  chartData: [] as { date: string; clicks: number }[],
  topCountries: [] as TopEntry[], topReferrers: [] as TopEntry[],
  topBrowsers: [] as TopEntry[], topOs: [] as TopEntry[],
  topSocial: [] as TopEntry[], topCities: [] as TopEntry[],
  links: [] as any[],
};

function construireReponse(
  lignes: LigneAgregee[],
  domain: string,
  metaMap: Map<string, { title: string | null; created_at: string | null }>,
) {
  if (!lignes.length) return { ...EMPTY_STATS, domain };

  // Courbe du domaine : somme des courbes par lien. `chart_data` ne contient que les
  // journées avec au moins un clic, donc cette boucle reste courte quelle que soit la
  // profondeur de l'historique.
  const parDate = new Map<string, number>();
  let totalHumain = 0;
  let totalAvecBots = 0;

  const links = lignes.map(l => {
    totalHumain += Number(l.human_clicks) || 0;
    totalAvecBots += Number(l.total_clicks) || 0;
    for (const p of l.chart_data ?? []) {
      parDate.set(p.date, (parDate.get(p.date) ?? 0) + (Number(p.clicks) || 0));
    }

    // Repli `link_type` : la colonne d'abord, sinon l'`utm_medium` de l'URL de
    // destination — un lien créé avant l'introduction de la colonne n'en a pas.
    let linkType = l.link_type ?? null;
    if (!linkType) {
      try { linkType = new URL(l.original_url).searchParams.get('utm_medium') || null; } catch { /* URL absente ou invalide */ }
    }
    const utmSourceVal = (() => {
      try { return new URL(l.original_url).searchParams.get('utm_source') || null; } catch { return null; }
    })();

    return {
      id: l.link_id,
      path: l.path,
      shortUrl: l.short_url,
      originalUrl: l.original_url,
      title: metaMap.get(l.link_id)?.title || l.path,
      createdAt: metaMap.get(l.link_id)?.created_at || null,
      linkType,
      linkCategory: l.link_category ?? null,
      postPlatform: utmSourceVal === 'yt' ? 'YT' : utmSourceVal === 'ig' ? 'IG' : null,
      clicsAvecBots: Number(l.total_clicks) || 0,
      clicsHumains: Number(l.human_clicks) || 0,
      clicksChange: null as number | null,
      chartData: l.chart_data ?? [],
      // Ventilations (pays, villes, navigateurs, OS, réseaux, référents, UTM) :
      // conservées dans la forme de la réponse mais vides.
      //
      // Elles étaient calculées en fusionnant les colonnes JSONB de CHAQUE ligne
      // journalière — c'est précisément ce rapatriement qui faisait croître le coût de
      // lecture avec l'historique. Vérifié dans tout le code : aucun écran ne les lit,
      // ni par lien ni au niveau du domaine. Elles restent disponibles en base pour un
      // usage futur, via une requête dédiée.
      countries: [] as TopEntry[], referrers: [] as TopEntry[], browsers: [] as TopEntry[],
      os: [] as TopEntry[], social: [] as TopEntry[], cities: [] as TopEntry[],
      utmSource: [] as TopEntry[], utmMedium: [] as TopEntry[],
    };
  });

  const chartData = [...parDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, clicks]) => ({ date, clicks }));

  return {
    domain,
    totalLinks: links.length,
    clicsAvecBots: totalAvecBots,
    clicsHumains: totalHumain,
    clicksChange: null,
    clicsHumainsParLien: links.length > 0 ? Math.round(totalHumain / links.length) : 0,
    chartData,
    topCountries: [] as TopEntry[], topReferrers: [] as TopEntry[],
    topBrowsers: [] as TopEntry[], topOs: [] as TopEntry[],
    topSocial: [] as TopEntry[], topCities: [] as TopEntry[],
    links,
  };
}

// GET /api/shortio/snapshots?profileId=xxx&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');
  const startDate = searchParams.get('startDate') ?? '';
  const endDate   = searchParams.get('endDate')   ?? '';

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(startDate) || !dateRe.test(endDate)) {
    return NextResponse.json({ error: 'invalid_date' }, { status: 400 });
  }

  // Auth guard IDOR
  let targetProfileId = user.id;
  if (profileId && profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients').select('id')
      .eq('profile_id', profileId).eq('coach_id', user.id).single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetProfileId = profileId;
  }

  try {
    // Agrégation EN BASE — une ligne par lien.
    //
    // Cette route rapatriait auparavant les lignes brutes (une par lien ET par jour) en
    // paginant par 1000. Le coût croissait donc avec la profondeur de l'historique : à
    // 40 élèves et 3 ans, un All-Time représente ~110 000 lignes, soit ~110 allers-
    // retours PostgREST. Avec la RPC, la réponse fait une ligne par lien — une centaine
    // — que la période couvre trois mois ou cinq ans.
    //
    // Même motif que get_shortio_clicks_by_day et get_shortio_clicks_by_url, qui
    // avaient déjà réglé ce problème pour les deux autres lectures de cette table.
    const [lignesRes, integRes, metaRes] = await Promise.all([
      serviceSupabase.rpc('get_shortio_links_agreges', {
        p_profile_id: targetProfileId,
        p_start_date: startDate,
        p_end_date: endDate,
      }),
      serviceSupabase
        .from('integrations').select('metadata')
        .eq('profile_id', targetProfileId).eq('provider', 'shortio').maybeSingle(),
      serviceSupabase
        .from('shortio_links_metadata').select('link_id,title,created_at')
        .eq('profile_id', targetProfileId),
    ]);

    if (lignesRes.error) throw lignesRes.error;
    if (integRes.error) console.warn('[shortio/snapshots] integrations_error:', integRes.error.message, { targetProfileId });

    const domain = (integRes.data?.metadata as any)?.domain || '';
    const metaMap = new Map(
      (metaRes.data || []).map((m: any) => [m.link_id, { title: m.title, created_at: m.created_at }])
    );

    const lignes = (lignesRes.data ?? []) as LigneAgregee[];
    if (!lignes.length) {
      console.warn('[shortio/snapshots] NO_DATA profileId=%s start=%s end=%s', targetProfileId, startDate, endDate);
      return NextResponse.json({ ...EMPTY_STATS, domain }, { headers: { 'Cache-Control': CACHE_CONTROL } });
    }

    return NextResponse.json(construireReponse(lignes, domain, metaMap), {
      headers: { 'Cache-Control': CACHE_CONTROL },
    });

  } catch (e: any) {
    // 503 et non 200 + EMPTY_STATS : renvoyer des zéros sur une panne de base affirme
    // « aucun clic » alors que la vérité est « on ne sait pas ». L'appelant
    // (fetchSnapshot / fetchSupabaseStats) fait déjà `r.ok ? r.json() : null`, donc
    // l'écran retombe sur son état « pas de données » au lieu d'afficher des zéros.
    console.error('[shortio/snapshots] DB_ERROR', e?.message, { profileId: targetProfileId });
    return NextResponse.json({ error: 'db_unavailable' }, { status: 503 });
  }
}
