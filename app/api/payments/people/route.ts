import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';

/**
 * Personnes proposées à la création d'un lien de paiement.
 *
 * Quatre sources, parce qu'un prospect n'arrive pas que par Instagram :
 *   - instagram_leads : commentaires, DM, cold DM
 *   - prospects       : leads YouTube et « autres » (table dédiée aux non-IG)
 *   - calls           : quelqu'un qui a booké sans jamais être passé par un lead
 *                       (clic direct sur le lien bio, bouche-à-oreille)
 *   - prospect_links  : lien Calendly envoyé à la main, avant toute détection
 *
 * Volontairement plus large que le compteur de leads du pipeline, qui n'affiche
 * que les prospects ayant au moins un call : pour VENDRE à quelqu'un, il n'a pas
 * besoin d'avoir réservé. Un prospect enregistré sans call reste quelqu'un à qui
 * envoyer un lien de paiement.
 *
 * Sans requête, on renvoie les plus récents : chercher suppose de savoir qui on
 * cherche, alors qu'on veut souvent juste « le prospect d'hier ».
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const LIMIT = 12;

interface Person {
  id: string;
  name: string;
  subtitle: string | null;
  kind: 'lead' | 'prospect' | 'call' | 'link' | 'client';
  avatarUrl?: string | null;
  /** Sert à trier toutes les sources ensemble par fraîcheur. */
  at: string;
}

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const profileId = await resolveTargetProfile(user.id, params.get('profileId'));
  if (!profileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const q = (params.get('q') ?? '').trim();
  const kind = params.get('kind') ?? 'prospect';
  const like = `%${q}%`;

  // ── Clients existants (upsell) ──────────────────────────────────────────────
  if (kind === 'client') {
    let query = supa
      .from('clients')
      .select('id, name, email, created_at, profiles(avatar_url)')
      .eq('coach_id', profileId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    if (q) query = query.ilike('name', like);

    const { data } = await query;
    return NextResponse.json({
      people: (data ?? []).map((c: any) => ({
        id: c.id, name: c.name, subtitle: c.email ?? 'client de la plateforme',
        kind: 'client', avatarUrl: c.profiles?.avatar_url ?? null,
      })),
    });
  }

  // ── Prospects : les trois sources en parallèle ──────────────────────────────
  const igQ = supa
    .from('instagram_leads')
    .select('id, ig_username, detected_at, source, avatar_url')
    .eq('profile_id', profileId)
    .is('archived_at', null)
    .eq('not_a_lead', false)
    .order('detected_at', { ascending: false })
    .limit(LIMIT);

  const ytQ = supa
    .from('prospects')
    .select('id, name, email, platform, source, created_at')
    .eq('profile_id', profileId)
    .eq('not_a_lead', false)
    .order('created_at', { ascending: false })
    .limit(LIMIT);

  // Les calls sans lead : quelqu'un qui a réservé directement. `coach_id` porte
  // le profil de l'élève, pas celui du coach humain (piège documenté).
  // lead_deleted exclu : le coach l'a supprimé depuis le pipeline.
  const callQ = supa
    .from('calls')
    .select('id, invitee_name, invitee_email, source, scheduled_at, ig_lead_id, prospect_id')
    .eq('coach_id', profileId)
    .is('ig_lead_id', null)
    .is('prospect_id', null)
    .neq('ignored', true)
    .neq('lead_deleted', true)
    .not('invitee_name', 'is', null)
    .order('scheduled_at', { ascending: false })
    .limit(LIMIT);

  // Prospects à qui un lien Calendly personnalisé a été envoyé : ils sont dans le
  // pipeline sans forcément exister dans instagram_leads (lien créé à la main
  // depuis PageLiens avant toute détection automatique).
  const linkQ = supa
    .from('prospect_links')
    .select('id, ig_username, created_at, ig_lead_id')
    .eq('profile_id', profileId)
    .is('ig_lead_id', null)
    .order('created_at', { ascending: false })
    .limit(LIMIT);

  const [ig, yt, calls, links] = await Promise.all([
    q ? igQ.ilike('ig_username', like) : igQ,
    q ? ytQ.ilike('name', like) : ytQ,
    q ? callQ.ilike('invitee_name', like) : callQ,
    q ? linkQ.ilike('ig_username', like) : linkQ,
  ]);

  const people: Person[] = [];

  for (const l of ig.data ?? []) {
    people.push({
      id: l.id,
      name: l.ig_username,
      subtitle: `@${l.ig_username}${l.source === 'cold_dm' ? ' · cold DM' : ' · Instagram'}`,
      kind: 'lead',
      avatarUrl: l.avatar_url ?? null,
      at: l.detected_at,
    });
  }

  for (const p of yt.data ?? []) {
    if (!p.name && !p.email) continue;
    people.push({
      id: p.id,
      name: p.name || p.email!,
      subtitle: p.platform === 'yt' ? 'YouTube' : (p.source || 'autre source'),
      kind: 'prospect',
      at: p.created_at,
    });
  }

  for (const c of calls.data ?? []) {
    people.push({
      id: c.id,
      name: c.invitee_name!,
      subtitle: `Call · ${c.source || 'sans source'}`,
      kind: 'call',
      at: c.scheduled_at ?? '',
    });
  }

  // Les liens Calendly envoyés n'ont pas de table d'accueil pour un deal : on les
  // propose sous forme de nom libre, l'attribution se fera par le pseudo.
  for (const l of links.data ?? []) {
    if (!l.ig_username) continue;
    people.push({
      id: l.id,
      name: l.ig_username,
      subtitle: `@${l.ig_username} · lien Calendly envoyé`,
      kind: 'link',
      at: l.created_at,
    });
  }

  // Dédoublonnage par nom : un même prospect peut exister comme lead ET comme
  // call. La première source gagne (l'ordre ci-dessus va du plus riche au plus
  // pauvre en information).
  const seen = new Set<string>();
  const unique = people.filter(p => {
    const key = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));

  return NextResponse.json({ people: unique.slice(0, LIMIT) });
}
