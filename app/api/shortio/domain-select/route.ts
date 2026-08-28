import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function resolveTargetProfileId(user: { id: string }, profileId: string | null): Promise<string | null> {
  if (!profileId || profileId === user.id) return user.id;
  const { data: clientRow } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('profile_id', profileId)
    .eq('coach_id', user.id)
    .single();
  return clientRow ? profileId : null;
}

interface AffectedLm { lmId: string; lmName: string; lmUrl: string; platform: 'ig' | 'yt'; currentUrl: string; }

// Liste les liens bio de lead magnets actuellement actifs — utilisés pour prévenir avant
// un changement de domaine (ces liens ne se régénèrent pas automatiquement autrement).
async function listAffectedLm(profileId: string): Promise<AffectedLm[]> {
  const { data: lms } = await serviceSupabase
    .from('lead_magnets')
    .select('id, name, url, bio_ig_url, bio_yt_url')
    .eq('profile_id', profileId);

  const affected: AffectedLm[] = [];
  for (const lm of lms || []) {
    if (lm.bio_ig_url) affected.push({ lmId: lm.id, lmName: lm.name, lmUrl: lm.url, platform: 'ig', currentUrl: lm.bio_ig_url });
    if (lm.bio_yt_url) affected.push({ lmId: lm.id, lmName: lm.name, lmUrl: lm.url, platform: 'yt', currentUrl: lm.bio_yt_url });
  }
  return affected;
}

/**
 * Autres élèves qui ont déjà ce domaine Short.io comme domaine actif.
 *
 * Le cron ramène TOUS les liens du domaine interrogé, sans distinguer à qui ils
 * appartiennent : deux élèves sur le même compte Short.io comptent donc chacun les
 * clics de l'autre. Mesuré le 2026-08-28 sur les profils de test — 65 à 76 liens
 * « empruntés » par profil.
 *
 * On avertit plutôt qu'on ne refuse : le partage est une configuration légitime en
 * test (le même compte sert à plusieurs profils fictifs), et un refus dur casserait
 * cette mise en place. En production chaque élève apporte son propre compte, donc ce
 * signal ne devrait jamais s'allumer — et s'il s'allume, c'est précisément qu'il faut
 * regarder.
 */
async function autresProfilsSurCeDomaine(profileId: string): Promise<{ domaine: string; nbAutresProfils: number } | null> {
  const { data: moi } = await serviceSupabase
    .from('integrations').select('metadata')
    .eq('profile_id', profileId).eq('provider', 'shortio').maybeSingle();
  const monDomaine = (moi?.metadata as any)?.domain_id;
  if (monDomaine == null) return null;

  const { data: autres } = await serviceSupabase
    .from('integrations').select('profile_id, metadata')
    .eq('provider', 'shortio').neq('profile_id', profileId);
  const nb = (autres ?? []).filter(a => String((a.metadata as any)?.domain_id ?? '') === String(monDomaine)).length;
  if (nb === 0) return null;
  return { domaine: String((moi?.metadata as any)?.domain ?? ''), nbAutresProfils: nb };
}

// GET — liste les liens bio LM qui seraient affectés par un changement de domaine, pour
// peupler le modal de confirmation AVANT d'écrire quoi que ce soit. Signale aussi si
// d'autres élèves utilisent déjà ce domaine.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');
  const targetProfileId = await resolveTargetProfileId(user, profileId);
  if (!targetProfileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const affected = await listAffectedLm(targetProfileId);
  return NextResponse.json({ affected, partage: await autresProfilsSurCeDomaine(targetProfileId) });
}

// PATCH — enregistre le domaine Short.io choisi par l'utilisateur parmi les domaines
// disponibles sur son compte. Ne touche jamais api_key — permet de changer de domaine
// sans reconnecter toute la clé API. Si un domaine était déjà actif (vrai changement,
// pas une première sélection), régénère aussi les liens bio des lead magnets sur le
// nouveau domaine — l'ancien lien Short.io n'est jamais touché, il continue de rediriger
// tant que l'utilisateur n'a pas remplacé le lien à la main dans sa bio Instagram/YouTube.
export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  const { profileId, domainId, hostname } = body;

  if (!domainId || !hostname) {
    return NextResponse.json({ error: 'domainId et hostname requis' }, { status: 400 });
  }

  const targetProfileId = await resolveTargetProfileId(user, profileId);
  if (!targetProfileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('id, api_key, metadata')
    .eq('profile_id', targetProfileId)
    .eq('provider', 'shortio')
    .single();

  if (!integ) return NextResponse.json({ error: 'no_integration' }, { status: 404 });

  const existingMeta = (integ.metadata as any) || {};
  const allDomains: { id: number; hostname: string }[] = existingMeta.all_domains || [];
  const known = allDomains.find((d) => String(d.id) === String(domainId));
  if (!known) {
    return NextResponse.json({ error: 'Domaine inconnu — reconnecte ta clé pour rafraîchir la liste' }, { status: 400 });
  }

  // Un domaine était déjà actif et diffère du nouveau → vrai changement, pas une première
  // sélection. Les liens bio LM déjà générés sur l'ancien domaine doivent être régénérés
  // sur le nouveau — l'ancien lien Short.io reste actif tel quel, jamais supprimé/modifié.
  const previousDomainId = existingMeta.domain_id ?? null;
  const isRealChange = previousDomainId != null && String(previousDomainId) !== String(domainId);

  const regenerated: { lmId: string; lmName: string; platform: 'ig' | 'yt'; newUrl: string }[] = [];

  if (isRealChange && integ.api_key) {
    const affected = await listAffectedLm(targetProfileId);
    for (const item of affected) {
      const path = `${slugify(item.lmName.split(/\s+/).slice(0, 3).join('-'))}-${item.platform}`;
      try {
        const res = await fetch('https://api.short.io/links', {
          method: 'POST',
          headers: { authorization: integ.api_key, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            domain: hostname,
            originalURL: item.lmUrl,
            title: item.lmName,
            utmSource: item.platform,
            utmMedium: 'bio',
            utmCampaign: `lm-bio-${item.platform}`,
            path,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error(`[domain-select] échec régénération LM ${item.lmId} (${item.platform}):`, data);
          continue;
        }
        const newUrl = data.secureShortURL || data.shortURL || data.shortUrl;
        if (!newUrl) continue;

        const column = item.platform === 'ig' ? 'bio_ig_url' : 'bio_yt_url';
        await serviceSupabase.from('lead_magnets').update({ [column]: newUrl }).eq('id', item.lmId);
        regenerated.push({ lmId: item.lmId, lmName: item.lmName, platform: item.platform, newUrl });
      } catch (e) {
        console.error(`[domain-select] exception régénération LM ${item.lmId} (${item.platform}):`, e);
      }
    }
  }

  const metadata = { ...existingMeta, domain: hostname, domain_id: domainId, domain_source: 'user_selected' };

  const { error } = await serviceSupabase
    .from('integrations')
    .update({ metadata, account_label: hostname })
    .eq('id', integ.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, domain: hostname, domain_id: domainId, regenerated });
}
