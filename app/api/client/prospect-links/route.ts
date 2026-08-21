import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');

  // Si profileId fourni (vue coach), vérifier que l'élève appartient bien au coach
  let targetId = user.id;
  if (profileId) {
    const { data: clientRow } = await supa
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetId = profileId;
  }

  // Deux usages opposés de cette même route (voir docs/tracking-prospect.md) :
  //   - Gérer mes liens veut la liste des liens ACTIFS → ?activeOnly=1
  //   - Mes Stats veut l'HISTORIQUE complet, y compris les liens retirés, sinon le
  //     parcours d'un prospect disparaît de l'attribution dès qu'on supprime son lien
  // Défaut = historique complet : une lecture qui oublie le paramètre voit trop de
  // liens (visible, corrigeable) plutôt que trop peu (silencieux, fausse les stats).
  const activeOnly = searchParams.get('activeOnly') === '1';

  let query = supa
    .from('prospect_links')
    .select('*')
    .eq('profile_id', targetId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (activeOnly) query = query.is('deleted_at', null);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const links = data ?? [];

  // Clics par lien — Short.io les stocke en snapshots journaliers, il faut donc
  // sommer. On lit human_clicks (et non total_clicks) pour exclure les bots :
  // c'est la même métrique que partout ailleurs dans la plateforme.
  // Fire-and-forget : un échec ici ne doit pas priver l'écran de sa liste de
  // liens, la pastille tombe simplement à 0.
  const urls = links.map(l => l.short_url).filter(Boolean);
  const clicksByUrl = new Map<string, number>();
  if (urls.length > 0) {
    const { data: snaps } = await supa
      .from('shortio_link_daily_snapshots')
      .select('short_url, human_clicks')
      .eq('profile_id', targetId)
      .in('short_url', urls);
    for (const s of snaps ?? []) {
      clicksByUrl.set(s.short_url, (clicksByUrl.get(s.short_url) ?? 0) + (s.human_clicks ?? 0));
    }
  }

  return NextResponse.json({
    links: links.map(l => ({ ...l, clicks: clicksByUrl.get(l.short_url) ?? 0 })),
  });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const { ig_username, short_url, content_id } = body;
  if (!ig_username || !short_url) return NextResponse.json({ error: 'ig_username et short_url requis' }, { status: 400 });
  if (ig_username.length > 100) return NextResponse.json({ error: 'ig_username trop long' }, { status: 400 });

  // Résoudre ig_lead_id, keyword_matched et source depuis instagram_leads. source est
  // figée dans source_at_creation au moment de CETTE création — instagram_leads.source
  // est un état courant, écrasé à chaque nouvelle interaction du même lead (ex: un lead
  // qui a commenté un post puis répondu à une story plus tard verrait ce lien historique
  // classé à tort "story_reply" dans le breakdown business si on lisait l'état courant).
  const { data: leadRow } = await supa
    .from('instagram_leads')
    .select('id, keyword_matched, source')
    .eq('profile_id', user.id)
    .eq('ig_username', ig_username)
    .is('archived_at', null)
    .order('detected_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const ig_lead_id = leadRow?.id ?? null;
  const keyword_matched = leadRow?.keyword_matched ?? null;
  const source_at_creation = leadRow?.source ?? null;

  // Régénérer un lien pour un prospect dont le lien avait été retiré doit RÉACTIVER sa
  // ligne, pas en créer une seconde : sinon l'historique commercial (calendly_link_sent,
  // first_click_at, min_stage_reached) reste sur l'ancienne ligne masquée pendant que
  // la nouvelle repart vierge — exactement le symptôme observé sur rdjdkzjd avant la
  // suppression non destructive. Voir docs/tracking-prospect.md.
  const { data: retired } = await supa
    .from('prospect_links')
    .select('id')
    .eq('profile_id', user.id)
    .eq('ig_username', ig_username)
    .not('deleted_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = retired
    ? await supa
        .from('prospect_links')
        .update({ short_url, content_id: content_id || null, ig_lead_id, keyword_matched, source_at_creation, deleted_at: null })
        .eq('id', retired.id)
        .select()
        .single()
    : await supa
        .from('prospect_links')
        .insert({ profile_id: user.id, ig_username, short_url, content_id: content_id || null, ig_lead_id, keyword_matched, source_at_creation })
        .select()
        .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // NE PAS poser calendly_sent ici — le lien est créé mais pas encore envoyé.
  // L'override + prospect_events calendly_link_sent sont posés par le webhook IG
  // quand Meta envoie l'echo du DM contenant l'URL Short.io.

  return NextResponse.json({ link: data });
}

// Suppression NON destructive — voir docs/tracking-prospect.md
//
// Une ligne prospect_links porte l'URL du lien ET l'historique commercial du prospect
// (calendly_link_sent, calendly_link_sent_at, first_click_at, min_stage_reached). Un
// DELETE effaçait donc le parcours du prospect en même temps que son lien : le call
// tombait en « Autre / non catégorisé » et le prospect sortait du dénominateur du taux
// d'activation (cas rdjdkzjd, 2026-08-18).
//
// On marque désormais deleted_at. Le lien disparaît de Gérer mes liens (la lecture des
// liens actifs filtre deleted_at IS NULL), mais les stats, le pipeline et l'attribution
// continuent de voir le parcours complet.
export async function DELETE(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const { error } = await supa
    .from('prospect_links')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('profile_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
