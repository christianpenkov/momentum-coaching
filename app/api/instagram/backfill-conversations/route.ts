import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { interlocuteur } from '@/lib/igConversations';

/**
 * Reprise de l'historique des conversations Instagram, à l'accord de l'élève.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI CE N'EST PAS DANS poll-leads                                     │
 * │                                                                           │
 * │ poll-leads consomme déjà 112 à 144 s sur les 150 s du Edge Runtime à      │
 * │ 40 élèves (mesure du 2026-08-31 inscrite dans son propre fichier). Il n'y │
 * │ a pas de place. Et le dépassement ne produit AUCUN signal : le runtime    │
 * │ coupe, et comme l'ordre de la requête est stable, ce sont TOUJOURS LES    │
 * │ MÊMES élèves qui sont sacrifiés.                                          │
 * │                                                                           │
 * │ Argument de fond : le backfill est un événement UNIQUE par élève,         │
 * │ déclenché par un geste humain. Une chose ponctuelle n'a rien à faire dans │
 * │ une boucle qui tourne toutes les 5 minutes pour toujours.                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Le motif de réveil est copié sur `reveillerLeWorker()`
 * (app/api/webhooks/instagram/route.ts) : une page par invocation, puis la
 * route se rappelle elle-même via `after()`. poll-leads ne fait qu'UNE lecture
 * par passage pour relancer un backfill dont le réveil s'est perdu.
 */

export const maxDuration = 60;

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Borne mesurée : ~50 fils actifs sur 90 jours par élève, ~2 pages chacun. */
const FENETRE_JOURS = 90;
/** Meta plafonne à 50 par page, quoi qu'on demande. */
const CONVERSATIONS_PAR_PAGE = 50;
/** Débit autorisé : 2 appels/s par compte Instagram. On reste dessous. */
const PAUSE_MS = 600;
/** On rend la main avant la limite de la fonction, pour laisser le temps au réveil. */
const BUDGET_MS = 45_000;

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function POST(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let profileId: string | null = null;
  try { profileId = (await request.json())?.profile_id ?? null; } catch { /* corps optionnel */ }

  // Sans profil désigné, on prend le plus ancien backfill inachevé. C'est le
  // chemin qu'emprunte le filet de rattrapage de poll-leads.
  //
  // ⚠️ UN SEUL profil par invocation, jamais tous en parallèle : le jour où
  // plusieurs élèves accordent la lecture ensemble, des appels concurrents
  // franchiraient la limite de Meta sur plusieurs comptes à la fois.
  if (!profileId) {
    const { data } = await supa
      .from('ig_backfill_etat')
      .select('profile_id')
      .is('termine_le', null)
      .order('demarre_le', { ascending: true })
      .limit(1)
      .maybeSingle();
    profileId = data?.profile_id ?? null;
  }
  if (!profileId) return NextResponse.json({ ok: true, rien_a_faire: true });

  // L'accord peut avoir été retiré entre le réveil et l'exécution. On ne
  // s'appuie pas là-dessus pour la sécurité — `enregistrer_message_ig` refuse
  // d'écrire de toute façon — mais on évite des appels Meta pour rien.
  const { data: client } = await supa
    .from('clients').select('id').eq('profile_id', profileId)
    .not('ig_dm_lecture_accordee_le', 'is', null).is('archived_at', null).maybeSingle();
  if (!client) {
    await supa.from('ig_backfill_etat').delete().eq('profile_id', profileId);
    return NextResponse.json({ ok: true, accord_retire: true });
  }

  const { data: integ } = await supa
    .from('integrations').select('access_token, metadata')
    .eq('profile_id', profileId).eq('provider', 'instagram').maybeSingle();

  const token = integ?.access_token as string | undefined;
  const igAccountId = integ?.metadata?.ig_account_id ? String(integ.metadata.ig_account_id) : null;
  if (!token || !igAccountId) {
    // Pas d'Instagram connecté : le backfill n'a pas d'objet. On le clôt pour
    // ne pas faire crier `ig_dm_sante` sur un cas normal.
    await supa.from('ig_backfill_etat')
      .upsert({ profile_id: profileId, termine_le: new Date().toISOString() }, { onConflict: 'profile_id' });
    return NextResponse.json({ ok: true, sans_instagram: true });
  }

  // L'API rend le compte de l'élève sous sa forme `entry.id` dans
  // `participants` — piège mesuré le 2026-09-04. On charge la correspondance
  // pour ne pas classer l'élève comme son propre interlocuteur.
  const { data: mapping } = await supa
    .from('ig_entry_id_mapping').select('entry_id')
    .eq('ig_account_id', igAccountId).maybeSingle();
  const formes = { igAccountId, entryId: mapping?.entry_id ?? null };

  const { data: etat } = await supa
    .from('ig_backfill_etat').select('curseur, fils_traites')
    .eq('profile_id', profileId).maybeSingle();

  if (!etat) {
    await supa.from('ig_backfill_etat').insert({ profile_id: profileId });
  }

  const debut = Date.now();
  const depuis = Date.now() - FENETRE_JOURS * 24 * 60 * 60 * 1000;
  let filsTraites = etat?.fils_traites ?? 0;
  let curseur: string | null = etat?.curseur ?? null;
  let termine = false;

  try {
    const url = new URL(`https://graph.instagram.com/v23.0/${igAccountId}/conversations`);
    url.searchParams.set('platform', 'instagram');
    url.searchParams.set('fields', 'id,updated_time,participants');
    url.searchParams.set('limit', String(CONVERSATIONS_PAR_PAGE));
    url.searchParams.set('access_token', token);
    if (curseur) url.searchParams.set('after', curseur);

    const page = await (await fetch(url)).json();
    if (page?.error) throw new Error(`conversations: ${page.error.message}`);

    for (const conv of page.data ?? []) {
      if (Date.now() - debut > BUDGET_MS) break;
      // La borne des 90 jours est ce qui rend ce poste négligeable : sans elle,
      // le backfill pèserait ~500 Mo à 40 élèves au lieu de ~12 Mo.
      if (conv.updated_time && new Date(conv.updated_time).getTime() < depuis) continue;

      const autre = interlocuteur(conv.participants?.data, formes);
      if (!autre?.id) continue;

      await importerLeFil(conv.id, autre, profileId, igAccountId, token, debut);
      filsTraites++;
      await pause(PAUSE_MS);
    }

    curseur = page.paging?.cursors?.after ?? null;
    termine = !page.paging?.next;
  } catch (e: any) {
    await supa.from('cron_runs').insert({
      fonction: 'backfill-ig-conversations',
      erreurs: [{ profile_id: profileId, message: e?.message || String(e) }],
    });
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }

  await supa.from('ig_backfill_etat').upsert({
    profile_id: profileId,
    curseur,
    fils_traites: filsTraites,
    termine_le: termine ? new Date().toISOString() : null,
  }, { onConflict: 'profile_id' });

  if (!termine) reveillerLaSuite(profileId);
  return NextResponse.json({ ok: true, fils_traites: filsTraites, termine });
}

/** Toutes les pages de messages d'un fil, du plus récent au plus ancien. */
async function importerLeFil(
  conversationId: string,
  autre: { id?: string; username?: string },
  profileId: string,
  igAccountId: string,
  token: string,
  debut: number,
) {
  let suivant: string | null =
    `https://graph.instagram.com/v23.0/${conversationId}` +
    `?fields=messages{id,created_time,from,message}&access_token=${token}`;
  let premier = true;

  while (suivant && Date.now() - debut <= BUDGET_MS) {
    const rep: any = await (await fetch(suivant)).json();
    if (rep?.error) throw new Error(`messages: ${rep.error.message}`);

    const bloc = premier ? rep.messages : rep;
    const messages = bloc?.data ?? [];
    for (const m of messages) {
      if (!m?.id) continue;
      // `from.id` de l'API est déjà résolu côté Meta : pas besoin de is_echo ici,
      // il suffit de savoir si l'expéditeur est l'interlocuteur.
      const sortant = m.from?.id !== autre.id;
      await supa.rpc('enregistrer_message_ig', {
        p_profile_id: profileId,
        p_ig_account_id: igAccountId,
        p_peer_id: autre.id,
        // Le pseudo vient de `participants` : gratuit, aucun appel de plus.
        p_peer_username: autre.username ?? null,
        p_mid: m.id,
        p_sortant: sortant,
        p_texte: m.message || null,
        // L'API `messages` ne détaille pas les pièces jointes sans un appel par
        // message. Un texte vide est le seul signal disponible ici, et il vaut
        // mieux un marqueur générique qu'un appel par message.
        p_type_piece_jointe: m.message ? null : 'autre',
        p_envoye_a: m.created_time,
      });
    }
    suivant = (premier ? rep.messages?.paging?.next : rep.paging?.next) ?? null;
    premier = false;
    if (suivant) await pause(PAUSE_MS);
  }
}

/** Même motif que `reveillerLeWorker()` : silencieux, poll-leads rattrape. */
function reveillerLaSuite(profileId: string) {
  const base = process.env.NEXT_PUBLIC_PLATFORM_URL;
  if (!base || !process.env.CRON_SECRET) return;
  after(async () => {
    try {
      await fetch(`${base}/api/instagram/backfill-conversations`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.CRON_SECRET}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ profile_id: profileId }),
      });
    } catch (e: any) {
      console.error('[IG backfill] réveil suivant échoué (poll-leads rattrapera):', e?.message || e);
    }
  });
}
