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
 * │ Le backfill est en plus un événement UNIQUE par élève, déclenché par un   │
 * │ geste humain : il n'a rien à faire dans une boucle qui tourne toutes les  │
 * │ 5 minutes pour toujours.                                                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ON N'IMPORTE QUE LES FILS DE LEADS — corrigé le 2026-09-04                │
 * │                                                                           │
 * │ Le premier jet importait 90 jours de TOUTES les conversations. Mesuré en  │
 * │ réel : 122 messages importés, dont 82 que la purge de quarantaine (30 j)  │
 * │ aurait supprimés la nuit même. Deux règles se contredisaient.             │
 * │                                                                           │
 * │ La fenêtre du backfill est donc désormais celle de la RÉTENTION du fil    │
 * │ qu'il importe : 12 mois, et seulement pour les interlocuteurs qui sont    │
 * │ des leads non exclus — les seuls que le coach voit. Une même règle des    │
 * │ deux côtés, plus rien à faire concorder.                                  │
 * │                                                                           │
 * │ Effet mesuré : ~12 % des conversations sont des fils de leads. Le         │
 * │ backfill passe de 164 fils à ~6 sur le compte de test.                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ PAS DE CURSEUR — corrigé le 2026-09-04                                    │
 * │                                                                           │
 * │ Le premier jet mémorisait le curseur de page de Meta. Quand le budget de  │
 * │ temps expirait au MILIEU d'une page, il avançait quand même le curseur :  │
 * │ le reste de la page était perdu définitivement, et le backfill se         │
 * │ déclarait terminé. Observé en réel : 3 fils importés sur 164, puis        │
 * │ `termine_le` posé.                                                        │
 * │                                                                           │
 * │ À la place, chaque passage rebalaye la liste depuis le début et SAUTE les │
 * │ fils déjà importés. Auto-réparateur : ce qui a été manqué est repris au   │
 * │ passage suivant, quoi qu'il se soit passé. Rebalayer coûte un appel Meta  │
 * │ par tranche de 50 conversations — négligeable devant l'import lui-même.   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Le motif de réveil est copié sur `reveillerLeWorker()`
 * (app/api/webhooks/instagram/route.ts).
 */

export const maxDuration = 60;

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** La fenêtre du backfill EST celle de la rétention des fils de leads. */
const FENETRE_MOIS = 12;
/** Meta plafonne à 50 par page, quoi qu'on demande. */
const CONVERSATIONS_PAR_PAGE = 50;
/** Débit autorisé : 2 appels/s par compte Instagram. On reste dessous. */
const PAUSE_MS = 600;
/** On rend la main avant la limite de la fonction, pour laisser le temps au réveil. */
const BUDGET_MS = 45_000;
/** Garde-fou : un compte à 10 000 conversations ne doit pas boucler sans fin. */
const PAGES_MAX = 20;

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function POST(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let profileId: string | null = null;
  try { profileId = (await request.json())?.profile_id ?? null; } catch { /* corps optionnel */ }

  // ⚠️ UN SEUL profil par invocation, jamais tous en parallèle : le jour où
  // plusieurs élèves accordent la lecture ensemble, des appels concurrents
  // franchiraient la limite de Meta sur plusieurs comptes à la fois.
  if (!profileId) {
    const { data } = await supa
      .from('ig_backfill_etat').select('profile_id').is('termine_le', null)
      .order('demarre_le', { ascending: true }).limit(1).maybeSingle();
    profileId = data?.profile_id ?? null;
  }
  if (!profileId) return NextResponse.json({ ok: true, rien_a_faire: true });

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

  // ⚠️ L'API rend le compte de l'élève sous sa forme `entry.id` dans
  // `participants` — mesuré le 2026-09-04. Sans cette correspondance, l'élève
  // serait classé comme son propre interlocuteur dans chaque fil.
  const { data: mapping } = await supa
    .from('ig_entry_id_mapping').select('entry_id').eq('ig_account_id', igAccountId).maybeSingle();
  const formes = { igAccountId, entryId: mapping?.entry_id ?? null };

  // Les seuls interlocuteurs qui nous intéressent. Une lecture, pas une par fil.
  const { data: leads } = await supa
    .from('instagram_leads').select('ig_user_id, ig_username')
    .eq('profile_id', profileId).eq('not_a_lead', false).is('archived_at', null);
  const leadsParId = new Map((leads ?? []).map(l => [String(l.ig_user_id), l.ig_username as string]));

  // Les fils déjà importés : c'est ce qui remplace le curseur. Un fil connu est
  // sauté, donc rebalayer depuis le début ne refait pas le travail.
  const { data: dejaLa } = await supa
    .from('ig_conversations').select('peer_id').eq('profile_id', profileId);
  const importes = new Set((dejaLa ?? []).map(c => String(c.peer_id)));

  await supa.from('ig_backfill_etat')
    .upsert({ profile_id: profileId }, { onConflict: 'profile_id', ignoreDuplicates: true });

  const debut = Date.now();
  const depuis = Date.now() - FENETRE_MOIS * 30 * 24 * 60 * 60 * 1000;
  let filsTraites = 0;
  let balayageComplet = true;

  try {
    let url: string | null =
      `https://graph.instagram.com/v23.0/${igAccountId}/conversations` +
      `?platform=instagram&fields=id,updated_time,participants` +
      `&limit=${CONVERSATIONS_PAR_PAGE}&access_token=${token}`;

    for (let page = 0; url && page < PAGES_MAX; page++) {
      if (Date.now() - debut > BUDGET_MS) { balayageComplet = false; break; }

      const rep: any = await (await fetch(url)).json();
      if (rep?.error) throw new Error(`conversations: ${rep.error.message}`);

      for (const conv of rep.data ?? []) {
        if (Date.now() - debut > BUDGET_MS) { balayageComplet = false; break; }
        if (conv.updated_time && new Date(conv.updated_time).getTime() < depuis) continue;

        const autre = interlocuteur(conv.participants?.data, formes);
        if (!autre?.id) continue;
        if (importes.has(String(autre.id))) continue;      // déjà fait
        if (!leadsParId.has(String(autre.id))) continue;   // pas un lead : quarantaine, pas de reprise

        await importerLeFil(conv.id, autre, profileId, igAccountId, token, debut);
        importes.add(String(autre.id));
        filsTraites++;
        await pause(PAUSE_MS);
      }

      if (!balayageComplet) break;
      url = rep.paging?.next ?? null;
      if (url) await pause(PAUSE_MS);
    }
  } catch (e: any) {
    await supa.from('cron_runs').insert({
      fonction: 'backfill-ig-conversations',
      erreurs: [{ profile_id: profileId, message: e?.message || String(e) }],
    });
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }

  // `termine_le` n'est posé que sur un balayage ENTIER. Sinon on garde la ligne
  // ouverte, et le passage suivant reprend — en sautant ce qui est déjà là.
  await supa.from('ig_backfill_etat').upsert({
    profile_id: profileId,
    curseur: null,
    fils_traites: importes.size,
    termine_le: balayageComplet ? new Date().toISOString() : null,
  }, { onConflict: 'profile_id' });

  if (!balayageComplet) reveillerLaSuite(profileId);
  return NextResponse.json({ ok: true, fils_traites: filsTraites, termine: balayageComplet });
}

/**
 * Toutes les pages de messages d'un fil, insérées PAR LOT.
 *
 * ⚠️ Une page = UN appel à la base, pas un par message. Le premier jet faisait
 * 122 requêtes pour 122 messages — le N+1 que la RPC unitaire existe justement
 * pour éviter côté webhook.
 */
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
    const lot = (bloc?.data ?? [])
      .filter((m: any) => m?.id)
      .map((m: any) => ({
        mid: m.id,
        // `from.id` est déjà résolu côté Meta : il suffit de savoir si
        // l'expéditeur est l'interlocuteur.
        sortant: m.from?.id !== autre.id,
        texte: m.message || null,
        // L'endpoint `messages` ne détaille pas les pièces jointes sans un appel
        // PAR message. Un texte vide est le seul signal disponible, et un
        // marqueur générique vaut mieux qu'un appel par message.
        type_piece_jointe: m.message ? null : 'autre',
        envoye_a: m.created_time,
      }));

    if (lot.length) {
      await supa.rpc('enregistrer_messages_ig_lot', {
        p_profile_id: profileId,
        p_ig_account_id: igAccountId,
        p_peer_id: autre.id,
        // Le pseudo vient de `participants` : gratuit, aucun appel de plus.
        p_peer_username: autre.username ?? null,
        p_messages: lot,
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
