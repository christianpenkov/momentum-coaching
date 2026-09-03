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
  /**
   * Le dernier rendez-vous PASSÉ de cette personne, s'il en existe un.
   *
   * Transmis à la création : sans lui, la vente est datée de la saisie au lieu du
   * rendez-vous, et sort des statistiques par contenu — qui rattachent l'argent
   * par `call_id`. Nul quand la personne n'a jamais réservé.
   */
  callId?: string | null;
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

  // ── Le rendez-vous d'un lead ou d'un prospect ────────────────────────────
  // La liste des « calls » ci-dessus exclut volontairement ceux qui appartiennent
  // à un lead ou à un prospect (`.is('ig_lead_id', null).is('prospect_id', null)`),
  // pour ne pas faire apparaître la même personne deux fois. Conséquence : pour ces
  // deux populations, on ne pouvait choisir QUE la personne, jamais son rendez-vous.
  //
  // Une vente créée ainsi part sans `call_id`. Elle est alors datée de l'instant de
  // saisie au lieu du rendez-vous, et sort des statistiques par contenu, qui
  // rattachent l'argent par `call_id`. Trois personnes dans ce cas sur le profil de
  // test.
  //
  // On ne rajoute PAS une seconde ligne : on attache le rendez-vous à la personne.
  // Choisir entre « Marc » et « le call de Marc » est une question d'implémentation,
  // pas une décision que l'élève a à prendre — et c'était la raison d'être du filtre.
  //
  // Le plus RÉCENT et PASSÉ, comme le rapport d'appel et le pipeline : un rendez-vous
  // à venir n'a encore rien produit, et le dater d'une vente serait faux.
  const idsLeads = (ig.data ?? []).map(l => l.id);
  const idsProspects = (yt.data ?? []).map(p => p.id);
  const rdvParLead = new Map<string, string>();
  const rdvParProspect = new Map<string, string>();

  if (idsLeads.length || idsProspects.length) {
    const { data: rdv } = await supa
      .from('calls')
      .select('id, ig_lead_id, prospect_id, scheduled_at')
      .eq('coach_id', profileId)
      .neq('ignored', true)
      .neq('lead_deleted', true)
      .lte('scheduled_at', new Date().toISOString())
      .or([
        idsLeads.length ? `ig_lead_id.in.(${idsLeads.join(',')})` : null,
        idsProspects.length ? `prospect_id.in.(${idsProspects.join(',')})` : null,
      ].filter(Boolean).join(','))
      .order('scheduled_at', { ascending: false });

    // Ordre décroissant + premier gagnant : le plus récent l'emporte.
    for (const c of rdv ?? []) {
      if (c.ig_lead_id && !rdvParLead.has(c.ig_lead_id)) rdvParLead.set(c.ig_lead_id, c.id);
      if (c.prospect_id && !rdvParProspect.has(c.prospect_id)) rdvParProspect.set(c.prospect_id, c.id);
    }
  }

  const people: Person[] = [];

  for (const l of ig.data ?? []) {
    people.push({
      id: l.id,
      name: l.ig_username,
      subtitle: `@${l.ig_username}${l.source === 'cold_dm' ? ' · cold DM' : ' · Instagram'}`,
      kind: 'lead',
      avatarUrl: l.avatar_url ?? null,
      at: l.detected_at,
      callId: rdvParLead.get(l.id) ?? null,
    });
  }

  // Un prospect dont TOUS les calls ont été ignorés a été supprimé du pipeline —
  // la ligne `prospects` survit au nettoyage, mais la personne ne doit pas
  // réapparaître ici. Cas constaté : « CR7 Penkov », 21 calls ignorés sur 22.
  // Pas de filtre sur l'existence d'un call : supprimer un lead efface désormais
  // toutes ses données, donc une ligne `prospects` présente est une ligne valide.
  // (Deux orphelins de l'ancien soft-delete ont été purgés le 19/08/2026.)
  for (const p of yt.data ?? []) {
    if (!p.name && !p.email) continue;
    people.push({
      id: p.id,
      name: p.name || p.email!,
      subtitle: p.platform === 'yt' ? 'YouTube' : (p.source || 'autre source'),
      kind: 'prospect',
      at: p.created_at,
      callId: rdvParProspect.get(p.id) ?? null,
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

  // Tri par fraîcheur d'abord ; le classement par deal se fait plus bas, une fois
  // les deals connus. On garde une marge sur LIMIT pour que le reclassement ait
  // de quoi travailler : sans elle, un prospect avec deal impayé mais ancien
  // serait coupé avant d'avoir pu remonter.
  unique.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  const top = unique.slice(0, LIMIT * 2);

  // Deal existant : savoir qu'on a déjà vendu 3 000 € à cette personne le mois
  // dernier change ce qu'on lui propose — c'est un upsell, pas une première vente.
  // Recherché par identifiant ET par nom, parce qu'un deal créé « hors pipeline »
  // ne porte aucun des identifiants ci-dessus.
  const ids = top.map(p => p.id);
  const names = top.map(p => p.name);

  const byKey = new Map<string, { amount: number; signedAt: string; status: string }>();

  // `.in.()` avec une liste vide produit du SQL invalide — on sort avant.
  const deals = ids.length ? (await supa
    .from('deals')
    .select('id, buyer_name, amount_total, signed_at, status, ig_lead_id, prospect_id, call_id, client_id')
    .eq('profile_id', profileId)
    .neq('status', 'canceled')
    .or(
      `ig_lead_id.in.(${ids.join(',')}),prospect_id.in.(${ids.join(',')}),` +
      `call_id.in.(${ids.join(',')}),client_id.in.(${ids.join(',')})`
    )
    .order('signed_at', { ascending: false })).data : [];

  for (const d of deals ?? []) {
    const entry = { amount: Number(d.amount_total), signedAt: d.signed_at, status: d.status };
    // Le plus récent gagne : la requête est déjà triée par date décroissante.
    for (const key of [d.ig_lead_id, d.prospect_id, d.call_id, d.client_id]) {
      if (key && !byKey.has(key)) byKey.set(key, entry);
    }
  }

  // Repli par nom pour les deals sans identifiant (créés « hors pipeline »).
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byName = new Map<string, { amount: number; signedAt: string; status: string }>();
  if (names.length) {
    const { data: nameDeals } = await supa
      .from('deals')
      .select('buyer_name, amount_total, signed_at, status')
      .eq('profile_id', profileId)
      .neq('status', 'canceled')
      .in('buyer_name', names)
      .order('signed_at', { ascending: false });
    for (const d of nameDeals ?? []) {
      const k = norm(d.buyer_name);
      if (!byName.has(k)) byName.set(k, { amount: Number(d.amount_total), signedAt: d.signed_at, status: d.status });
    }
  }

  const withDeals = top.map(p => ({
    ...p,
    lastDeal: byKey.get(p.id) ?? byName.get(norm(p.name)) ?? null,
  }));

  // Ordre d'affichage : d'abord les deals impayés (il reste de l'argent à aller
  // chercher, c'est l'action la plus probable), puis les deals soldés (un upsell
  // se propose à quelqu'un qui a déjà payé), puis les prospects sans deal.
  // Au sein de chaque groupe, du plus récent au plus ancien.
  const rank = (p: typeof withDeals[number]) =>
    !p.lastDeal ? 2 : p.lastDeal.status === 'paid' ? 1 : 0;

  withDeals.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    // Un deal date la relation mieux que la détection du lead : c'est lui qu'on
    // compare quand il existe.
    const da = a.lastDeal?.signedAt ?? a.at ?? '';
    const db = b.lastDeal?.signedAt ?? b.at ?? '';
    return db.localeCompare(da);
  });

  return NextResponse.json({ people: withDeals.slice(0, LIMIT) });
}
