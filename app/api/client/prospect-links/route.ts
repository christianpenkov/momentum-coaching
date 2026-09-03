import { NextResponse } from 'next/server';
import { CALL_TYPES_VENTE } from '@/lib/callTypes';
import { sourceDeclareeValide } from '@/lib/canalDm';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Chemin d'un lien court, sans son domaine : « prendre-rdv-pseudo ».
 *
 * C'est la partie qui survit à un changement de domaine Short.io, donc la clé
 * de rattachement des clics collectés avant la bascule. Le champ `path` des
 * snapshots est stocké sans slash de tête, on s'aligne dessus.
 */
function pathDeLien(shortUrl: string | null | undefined): string | null {
  if (!shortUrl) return null;
  try {
    return new URL(shortUrl).pathname.replace(/^\/+/, '') || null;
  } catch {
    // Une valeur qui n'est pas une URL absolue : on prend le dernier segment
    // plutôt que d'abandonner le lien.
    const seg = shortUrl.split('/').filter(Boolean).pop();
    return seg || null;
  }
}

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
  //
  // On somme par PATH, pas par short_url : lors d'un changement de domaine
  // Short.io, le lien est regénéré sur le nouvel hôte et sa ligne
  // prospect_links pointe vers la nouvelle URL, tandis que les clics déjà
  // collectés restent attachés à l'ancienne. Sommer par short_url affichait
  // alors 0 sur un prospect qui avait bien cliqué (et parfois booké) avant la
  // bascule. Le path (« prendre-rdv-pseudo ») est identique d'un domaine à
  // l'autre et reste propre à un prospect : vérifié en base, les 6 chemins
  // présents sur deux domaines sont chacun le même lien migré, jamais deux
  // prospects distincts.
  const paths = links
    .map(l => pathDeLien(l.short_url))
    .filter((p): p is string => !!p);
  const clicksByPath = new Map<string, number>();
  if (paths.length > 0) {
    const { data: snaps } = await supa
      .from('shortio_link_daily_snapshots')
      .select('path, human_clicks')
      .eq('profile_id', targetId)
      .in('path', paths);
    for (const s of snaps ?? []) {
      if (!s.path) continue;
      clicksByPath.set(s.path, (clicksByPath.get(s.path) ?? 0) + (s.human_clicks ?? 0));
    }
  }

  return NextResponse.json({
    links: links.map(l => {
      const p = pathDeLien(l.short_url);
      return { ...l, clicks: (p && clicksByPath.get(p)) ?? 0 };
    }),
  });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const { ig_username, short_url, content_id, source_declaree } = body;
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

  // ── QUAND ON NE SAIT PAS, ON DEMANDE — ON NE SUPPOSE PAS ───────────────────
  //
  // Sans source, le Breakdown rangeait le lien en « Cold DM », c'est-à-dire en
  // « le coach est allé chercher cette personne ». Trois situations très
  // différentes y tombaient : tu es allé la chercher, elle t'a écrit, ou elle
  // vient d'ailleurs.
  //
  // La création du lien est le SEUL moment où l'information existe : le coach
  // seul sait, en le créant, d'où vient cette personne. On la lui demande alors,
  // et sa réponse est figée ici.
  //
  // La réponse du client ne sert QUE de repli : une source déjà connue en base
  // (un commentaire, une réponse de story) fait toujours autorité. Redemander
  // puis écraser exposerait à contredire un geste réel par un souvenir.
  //
  // Et seulement deux valeurs sont acceptées : `source_at_creation` décide d'un
  // bac de statistiques, un appel ne doit pas pouvoir y écrire `comment` — ce
  // qui reviendrait à s'inventer un commentaire qui n'a pas eu lieu.
  const source_at_creation = leadRow?.source
    ?? (sourceDeclareeValide(source_declaree) ? source_declaree : null);

  // ── Rattachement d'un lien de suivi à une personne déjà connue ──────────────
  //
  // Quelqu'un qui a réservé depuis une bio ou une description n'a PAS de ligne
  // dans instagram_leads : sa seule trace est le call. Sans rattachement, le
  // call réservé via ce nouveau lien formerait une fiche distincte de la
  // sienne, et ses résultats seraient comptés à part.
  //
  // On s'appuie sur `calls.prospect_id`, la clé de regroupement que le pipeline
  // honore déjà. Trois temps : retrouver la personne parmi ses calls, lui
  // garantir une ligne `prospects`, puis marquer TOUS ses calls passés avec cet
  // identifiant pour que l'ancien et le nouveau se rejoignent.
  //
  // Ne s'applique qu'aux prospects hors Instagram : un lead Instagram se
  // rattache par ig_lead_id, mécanisme déjà en place et prioritaire.
  let prospect_id: string | null = null;
  if (!ig_lead_id) {
    // L'e-mail est la clé la plus sûre — un nom peut être porté par deux
    // personnes, et Calendly le fournit à chaque réservation. On le récupère
    // depuis les calls passés de cette personne.
    const { data: callsDeLaPersonne } = await supa
      .from('calls')
      .select('id, invitee_email, prospect_id, source')
      .eq('coach_id', user.id)
      .in('call_type', CALL_TYPES_VENTE)
      .eq('invitee_name', ig_username)
      .order('scheduled_at', { ascending: false });

    const connus = callsDeLaPersonne ?? [];
    if (connus.length > 0) {
      // Un prospect_id déjà posé sur l'un de ses calls fait autorité : le
      // réutiliser évite de scinder une fiche que le coach voit déjà groupée.
      prospect_id = connus.find(c => c.prospect_id)?.prospect_id ?? null;
      const email = connus.find(c => c.invitee_email)?.invitee_email ?? null;

      if (!prospect_id && email) {
        const { data: dejaLa } = await supa
          .from('prospects')
          .select('id')
          .eq('profile_id', user.id)
          .eq('email', email)
          .maybeSingle();
        prospect_id = dejaLa?.id ?? null;
      }

      if (!prospect_id) {
        const { data: cree } = await supa
          .from('prospects')
          .insert({
            profile_id: user.id,
            name: ig_username,
            email,
            // `platform` vaut 'other' pour tout ce qui n'est pas un lead
            // Instagram, comme les lignes déjà en base ; `source` garde
            // l'origine réelle du premier call, qui est l'information utile.
            platform: 'other',
            source: connus.find(c => c.source)?.source ?? null,
            not_a_lead: false,
          })
          .select('id')
          .maybeSingle();
        prospect_id = cree?.id ?? null;
      }

      // Marquer les calls passés : sans ça, l'ancien resterait sur sa propre
      // fiche et seul le nouveau porterait l'identité.
      if (prospect_id) {
        const aMarquer = connus.filter(c => !c.prospect_id).map(c => c.id);
        if (aMarquer.length > 0) {
          await supa.from('calls').update({ prospect_id }).in('id', aMarquer);
        }
      }
    }
  }

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
        .update({ short_url, content_id: content_id || null, ig_lead_id, prospect_id, keyword_matched, source_at_creation, deleted_at: null })
        .eq('id', retired.id)
        .select()
        .single()
    : await supa
        .from('prospect_links')
        .insert({ profile_id: user.id, ig_username, short_url, content_id: content_id || null, ig_lead_id, prospect_id, keyword_matched, source_at_creation })
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
