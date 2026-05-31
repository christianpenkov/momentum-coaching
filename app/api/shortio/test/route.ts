import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  // 1. Lire les credentials Short.io depuis Supabase
  const { data: integ, error: integError } = await serviceSupabase
    .from('integrations')
    .select('api_key, metadata')
    .eq('profile_id', user.id)
    .eq('provider', 'shortio')
    .single();

  const debug: Record<string, any> = {
    userId: user.id,
    integrationFound: !!integ,
    integrationError: integError?.message || null,
    hasApiKey: !!integ?.api_key,
    metadata: integ?.metadata || null,
  };

  if (!integ?.api_key) {
    return NextResponse.json({
      ok: false,
      step: 'credentials',
      message: 'Aucune clé API Short.io trouvée dans les intégrations Supabase',
      debug,
    });
  }

  const apiKey = integ.api_key;
  const domain = (integ.metadata as any)?.domain || null;
  const domainId = (integ.metadata as any)?.domain_id || null;

  debug.domain = domain;
  debug.domainId = domainId;

  // 2. Test GET /api/domains — liste les domaines accessibles avec cette clé
  const domainsRes = await fetch('https://api.short.io/api/domains', {
    headers: { authorization: apiKey, accept: 'application/json' },
  });
  const domainsJson = await domainsRes.json().catch(() => null);

  debug.domainsStatus = domainsRes.status;
  debug.domainsCount = Array.isArray(domainsJson) ? domainsJson.length : null;
  debug.domainsError = domainsRes.ok ? null : domainsJson;
  debug.firstDomain = Array.isArray(domainsJson) ? domainsJson[0] : null;

  if (!domainsRes.ok) {
    return NextResponse.json({
      ok: false,
      step: 'domains',
      message: `Erreur API Short.io sur /domains : HTTP ${domainsRes.status}`,
      debug,
    });
  }

  // 3. Test GET /links sur le domaine configuré (si dispo)
  let linksTest: any = null;
  if (domainId) {
    const linksRes = await fetch(
      `https://api.short.io/api/links?domain_id=${domainId}&limit=5`,
      { headers: { authorization: apiKey, accept: 'application/json' } }
    );
    const linksJson = await linksRes.json().catch(() => null);
    linksTest = {
      status: linksRes.status,
      ok: linksRes.ok,
      count: linksJson?.count ?? null,
      sampleLinks: Array.isArray(linksJson?.links) ? linksJson.links.slice(0, 3).map((l: any) => ({
        id: l.id,
        path: l.path,
        shortUrl: l.shortURL,
        originalUrl: l.originalURL,
        clicks: l.clicks,
        humanClicks: l.humanClicks,
      })) : null,
      error: linksRes.ok ? null : linksJson,
    };
    debug.linksTest = linksTest;
  }

  // 4. Test GET /statistics/link sur le premier lien (si dispo)
  let statsTest: any = null;
  if (linksTest?.sampleLinks?.[0]?.id) {
    const linkId = linksTest.sampleLinks[0].id;
    const statsRes = await fetch(
      `https://api-v2.short.io/statistics/link/${linkId}?period=last30`,
      { headers: { authorization: apiKey, accept: 'application/json' } }
    );
    const statsJson = await statsRes.json().catch(() => null);
    statsTest = {
      linkId,
      status: statsRes.status,
      ok: statsRes.ok,
      sample: statsRes.ok ? {
        humanClicks: statsJson?.humanClicks,
        botClicks: statsJson?.botClicks,
        periodStart: statsJson?.periodStart,
        periodEnd: statsJson?.periodEnd,
      } : null,
      error: statsRes.ok ? null : statsJson,
    };
    debug.statsTest = statsTest;
  }

  return NextResponse.json({
    ok: true,
    message: 'Connexion Short.io opérationnelle',
    summary: {
      domainsAccessibles: debug.domainsCount,
      domainConfiguré: domain,
      domainIdConfiguré: domainId,
      liensTestés: linksTest?.count ?? 'N/A (domainId manquant)',
      statsDisponibles: !!statsTest?.ok,
    },
    debug,
  });
}
