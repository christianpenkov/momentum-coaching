import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compterLeads, fetchAllLeadsCount, fetchIgLeadsCount, type LignesLeads } from './salesCallStats.ts';

// Lancé par `npm test`. `compterLeads` est la règle PURE du comptage de leads, extraite
// le 2026-09-01 pour que la version « un élève » (fetchAllLeadsCount) et la version
// « quarante élèves » (fetchLeadsCountsBatch) appellent exactement le même code.
//
// Ce fichier décrit ce que la règle fait, et surtout les deux pièges qu'elle contourne :
// le filtre de date appliqué APRÈS la déduplication, et la déduplication par PERSONNE
// et non par call. Les deux ont causé de vrais écarts, datés dans les commentaires.

function lignes(p: Partial<LignesLeads> = {}): LignesLeads {
  return { leads: [], liens: [], callsIgDirects: [], callsYoutube: [], ...p };
}
const appel = (id: string, email: string | null = null, nom: string | null = null) =>
  ({ id, invitee_email: email, invitee_name: nom });

test('aucune ligne : zéro', () => {
  assert.equal(compterLeads(lignes(), null), 0);
});

/* ─── Déduplication par username, entre les deux sources ─────────────────── */

test('le même username dans les deux sources compte une seule fois', () => {
  const n = compterLeads(lignes({
    leads: [{ ig_username: 'alice', detected_at: '2026-07-01T00:00:00Z' }],
    liens: [{ ig_username: 'alice', created_at: '2026-08-01T00:00:00Z' }],
  }), null);
  assert.equal(n, 1);
});

test('la casse du username ne crée pas deux personnes', () => {
  const n = compterLeads(lignes({
    leads: [{ ig_username: 'Alice', detected_at: '2026-07-01T00:00:00Z' }],
    liens: [{ ig_username: 'alice', created_at: '2026-07-02T00:00:00Z' }],
  }), null);
  assert.equal(n, 1);
});

test('une ligne sans username ou sans date est ignorée', () => {
  const n = compterLeads(lignes({
    leads: [
      { ig_username: null, detected_at: '2026-07-01T00:00:00Z' },
      { ig_username: 'bob', detected_at: null },
      { ig_username: 'carole', detected_at: '2026-07-01T00:00:00Z' },
    ],
  }), null);
  assert.equal(n, 1);
});

/* ─── Le piège du filtre de date ─────────────────────────────────────────── */

test('le filtre `since` s\'applique sur la date la plus ANCIENNE, après dédup', () => {
  // Le cas réel : un prospect détecté en juillet, dont un lien est recréé en août
  // (prospect_links est recréé à chaque envoi). Filtrer chaque source séparément AVANT
  // de dédupliquer le recomptait comme « nouveau ce mois ». Il ne l'est pas.
  const alice = lignes({
    leads: [{ ig_username: 'alice', detected_at: '2026-07-01T00:00:00Z' }],
    liens: [{ ig_username: 'alice', created_at: '2026-08-15T00:00:00Z' }],
  });
  assert.equal(compterLeads(alice, '2026-08-01T00:00:00Z'), 0);
  assert.equal(compterLeads(alice, null), 1);
});

test('un prospect vraiment nouveau passe bien le filtre', () => {
  const n = compterLeads(lignes({
    leads: [{ ig_username: 'nouveau', detected_at: '2026-08-10T00:00:00Z' }],
  }), '2026-08-01T00:00:00Z');
  assert.equal(n, 1);
});

test('le filtre est inclusif à la borne', () => {
  const n = compterLeads(lignes({
    leads: [{ ig_username: 'pile', detected_at: '2026-08-01T00:00:00Z' }],
  }), '2026-08-01T00:00:00Z');
  assert.equal(n, 1);
});

/* ─── Déduplication des calls par PERSONNE, pas par call ─────────────────── */

test('deux calls du même e-mail sont une seule personne', () => {
  // Calendly crée un NOUVEL événement à chaque reprogrammation : un prospect qui
  // déplace son rendez-vous a deux lignes dans `calls`. Les compter séparément
  // affichait 18 leads là où le pipeline en montrait 17 (2026-08-19).
  const n = compterLeads(lignes({
    callsIgDirects: [appel('c1', 'bob@x.fr'), appel('c2', 'bob@x.fr')],
  }), null);
  assert.equal(n, 1);
});

test('sans e-mail, le nom sert de clé ; sans nom, l\'identifiant du call', () => {
  const n = compterLeads(lignes({
    callsIgDirects: [
      appel('c1', null, 'Bob Durand'),
      appel('c2', null, 'bob durand'), // même personne, casse différente
      appel('c3', null, null),          // aucune identité : compte pour lui-même
    ],
  }), null);
  assert.equal(n, 2);
});

test('un call YouTube et un call Instagram de la même personne comptent deux fois', () => {
  // Comportement constaté, pas corrigé ici : les deux volets ont leur propre ensemble.
  // Le figer permet qu'une future unification soit un choix explicite.
  const n = compterLeads(lignes({
    callsIgDirects: [appel('c1', 'bob@x.fr')],
    callsYoutube: [appel('c2', 'bob@x.fr')],
  }), null);
  assert.equal(n, 2);
});

/* ─── Composition des trois volets ───────────────────────────────────────── */

test('les trois volets s\'additionnent', () => {
  const n = compterLeads(lignes({
    leads: [{ ig_username: 'alice', detected_at: '2026-07-01T00:00:00Z' }],
    liens: [{ ig_username: 'zoe', created_at: '2026-07-02T00:00:00Z' }],
    callsIgDirects: [appel('c1', 'bob@x.fr')],
    callsYoutube: [appel('c2', 'carl@x.fr')],
  }), null);
  assert.equal(n, 4);
});

test('sans volet YouTube, on obtient le compte Instagram seul', () => {
  // C'est exactement ce que fait fetchIgLeadsCount : les mêmes lignes, callsYoutube vide.
  const base = {
    leads: [{ ig_username: 'alice', detected_at: '2026-07-01T00:00:00Z' }],
    callsIgDirects: [appel('c1', 'bob@x.fr')],
  };
  assert.equal(compterLeads(lignes({ ...base, callsYoutube: [] }), null), 2);
  assert.equal(compterLeads(lignes({ ...base, callsYoutube: [appel('c9', 'zoe@x.fr')] }), null), 3);
});

test('un username ne dédoublonne PAS avec un call de la même personne', () => {
  // Les deux ensembles ont des clés différentes par nature — username Instagram d'un
  // côté, e-mail Calendly de l'autre — et rien ne permet de les rapprocher. Figé pour
  // que la limite soit connue plutôt que découverte.
  const n = compterLeads(lignes({
    leads: [{ ig_username: 'bob', detected_at: '2026-07-01T00:00:00Z' }],
    callsIgDirects: [appel('c1', null, 'bob')],
  }), null);
  assert.equal(n, 2);
});

/* ─── La règle du cold DM ─────────────────────────────────────────────────────
 *
 * « Un cold DM, ce n'est pas un lead tant qu'il n'a pas répondu » (Chris, 2026-09-07).
 * Le compteur faisait l'inverse : le seul cold DM compté était le seul à n'avoir jamais
 * répondu. Ce n'est pas une règle de période mais la définition même d'un lead, donc
 * elle vit dans `compterLeads` et vaut pour les six lecteurs. */

const coldDm = (u: string, envoyeLe: string, repondudLe: string | null = null) =>
  ({ ig_username: u, detected_at: envoyeLe, source: 'cold_dm', hook_replied_at: repondudLe });
const commentaire = (u: string, le: string) =>
  ({ ig_username: u, detected_at: le, source: 'comment', hook_replied_at: null });

test('un cold DM sans réponse n\'est PAS un lead', () => {
  // Le cas réel : `dolphin.2089562`, démarchée le 5 septembre, jamais répondu, et
  // pourtant comptée. Sans cette règle le chiffre est pilotable — démarcher cinquante
  // dormants créerait cinquante leads.
  assert.equal(compterLeads(lignes({ leads: [coldDm('dolphin', '2026-09-05T00:00:00Z')] }), null), 0);
});

test('un cold DM qui répond devient un lead, à la date de sa RÉPONSE', () => {
  // Envoyé en juillet, répond en août : il appartient à août, pas à juillet. C'est sa
  // réponse qui le fait entrer, pas notre envoi.
  const l = lignes({ leads: [coldDm('zoe', '2026-07-10T00:00:00Z', '2026-08-20T00:00:00Z')] });
  assert.equal(compterLeads(l, null), 1);
  assert.equal(compterLeads(l, '2026-08-01T00:00:00Z'), 1, 'compte en août');
  assert.equal(compterLeads(l, '2026-07-01T00:00:00Z', '2026-07-31T23:59:59Z'), 0, 'pas en juillet');
});

test('la réponse peut être portée par une AUTRE fiche de la même personne', () => {
  // ⚠️ Le piège central : `instagram_leads` a plusieurs lignes par personne. Juger
  // ligne par ligne écarterait quelqu'un qui a répondu sur une fiche voisine.
  const l = lignes({
    leads: [
      coldDm('ana', '2026-07-01T00:00:00Z'),                          // sans réponse
      coldDm('ana', '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z'),  // celle-ci répond
    ],
  });
  assert.equal(compterLeads(l, null), 1);
});

test('une personne connue autrement n\'est pas écartée par une fiche cold DM', () => {
  // Elle a commenté en juin ; on l'a aussi démarchée en août sans réponse. Elle reste
  // un lead, et sa date reste celle du commentaire.
  const l = lignes({
    leads: [commentaire('bea', '2026-06-01T00:00:00Z'), coldDm('bea', '2026-08-01T00:00:00Z')],
  });
  assert.equal(compterLeads(l, null), 1);
  assert.equal(compterLeads(l, '2026-07-01T00:00:00Z'), 0, 'sa date reste celle du commentaire');
});

test('un lien ne ressuscite pas un démarché sans réponse', () => {
  // Sans cette garde, la règle fuirait par la fenêtre : lui envoyer un Calendly — encore
  // une action de notre côté — le rendrait lead.
  const l = lignes({
    leads: [coldDm('caro', '2026-08-01T00:00:00Z')],
    liens: [{ ig_username: 'caro', created_at: '2026-08-02T00:00:00Z' }],
  });
  assert.equal(compterLeads(l, null), 0);
});

test('⚠️ rétro-compatible : sans `source`, personne n\'est écarté', () => {
  // Les colonnes sont optionnelles. Un appelant qui ne les fournit pas obtient le
  // comportement d'avant le 2026-09-07 à l'octet près — c'est ce qui a permis de poser
  // la règle sans toucher aux cinq autres lecteurs le jour même.
  const n = compterLeads(lignes({
    leads: [{ ig_username: 'sans_source', detected_at: '2026-08-01T00:00:00Z' }],
  }), null);
  assert.equal(n, 1);
});

/* ─── Caractérisation des REQUÊTES ────────────────────────────────────────────
 *
 * Tout ce qui précède teste la règle PURE. Mais `requetesLeads` — les quatre lectures
 * qui alimentent cette règle — n'avait aucun test, alors qu'elle est partagée par SIX
 * lecteurs : accueil élève, fiche client coach, dashboard coach, Mes Stats, Stats
 * Clients, et le batch. Une colonne ajoutée au mauvais endroit ou un filtre déplacé y
 * change des chiffres sur des écrans qu'on ne regardait pas.
 *
 * Ces tests figent la FORME des requêtes, pas leur résultat. Ils sont volontairement
 * rigides : ils doivent rougir dès qu'une lecture change, pour que le changement soit
 * un choix et non un effet de bord.
 *
 * ⚠️ Ne pas « réparer » un de ces tests en le rendant plus permissif. S'il rougit,
 * soit la modification est voulue et on met à jour l'attendu en le disant, soit elle
 * ne l'est pas et c'est le code qu'il faut corriger. */

type Lecture = { table: string; select: string; filtres: string[] };

/** Faux client Supabase qui n'exécute rien : il enregistre la forme de chaque requête.
 *  Rend toujours zéro ligne, ce qui suffit — on teste la requête, pas la donnée. */
function supabaseEspion(journal: Lecture[]) {
  const construire = (table: string) => {
    const lecture: Lecture = { table, select: '', filtres: [] };
    const b: any = {
      select: (cols: string) => { lecture.select = cols; journal.push(lecture); return b; },
      in: (col: string) => { lecture.filtres.push(`in:${col}`); return b; },
      is: (col: string, v: unknown) => { lecture.filtres.push(`is:${col}=${v}`); return b; },
      eq: (col: string, v: unknown) => { lecture.filtres.push(`eq:${col}=${v}`); return b; },
      neq: (col: string, v: unknown) => { lecture.filtres.push(`neq:${col}=${v}`); return b; },
      like: (col: string, v: string) => { lecture.filtres.push(`like:${col}=${v}`); return b; },
      or: (expr: string) => { lecture.filtres.push(`or:${expr}`); return b; },
      order: () => b,
      range: async () => ({ data: [], error: null }),
    };
    return b;
  };
  return { from: construire } as any;
}

const SINCE = '2026-08-01T00:00:00.000Z';

test('caractérisation — `fetchAllLeadsCount` émet exactement quatre lectures', async () => {
  const journal: Lecture[] = [];
  await fetchAllLeadsCount(supabaseEspion(journal), 'p1', SINCE);
  assert.deepEqual(journal.map(l => l.table), ['instagram_leads', 'prospect_links', 'calls', 'calls']);
});

test('caractérisation — `fetchIgLeadsCount` en émet trois, sans le volet YouTube', async () => {
  // C'est ce qui distingue les deux points d'entrée. Si un jour les deux émettent le
  // même nombre de lectures, l'un des deux a changé de sens.
  const journal: Lecture[] = [];
  await fetchIgLeadsCount(supabaseEspion(journal), 'p1', SINCE);
  assert.deepEqual(journal.map(l => l.table), ['instagram_leads', 'prospect_links', 'calls']);
});

test('caractérisation — les colonnes lues ne bougent pas', async () => {
  // Ajouter une colonne ici ne coûte rien en requêtes, mais la RETIRER casse un lecteur
  // en silence : `compterLeads` ignore une ligne sans `ig_username` ou sans date, donc
  // une colonne absente se lit « aucun lead » et non « erreur ».
  const journal: Lecture[] = [];
  await fetchAllLeadsCount(supabaseEspion(journal), 'p1', SINCE);
  const [leads, liens, callsIg, callsYt] = journal;
  // `source` et `hook_replied_at` ajoutés le 2026-09-07 pour la règle du cold DM.
  // Deux colonnes de plus sur une lecture qui existait déjà : zéro requête ajoutée,
  // ce qui compte parce que cette lecture est appelée EN BOUCLE par élève.
  assert.equal(leads.select, 'profile_id, ig_username, detected_at, source, hook_replied_at');
  assert.equal(liens.select, 'profile_id, ig_username, created_at');
  assert.equal(callsIg.select, 'coach_id, id, invitee_email, invitee_name, booked_at, scheduled_at');
  assert.equal(callsYt.select, callsIg.select);
});

test('caractérisation — les filtres des leads et des liens', async () => {
  const journal: Lecture[] = [];
  await fetchAllLeadsCount(supabaseEspion(journal), 'p1', SINCE);
  const [leads, liens] = journal;
  // `not_a_lead = false` : un prospect écarté depuis le pipeline sort de TOUS les
  // compteurs. `archived_at is null` : une bascule de compte Instagram le retire aussi.
  assert.deepEqual(leads.filtres, ['in:profile_id', 'is:archived_at=null', 'eq:not_a_lead=false']);
  // ⚠️ Volontairement PAS de filtre `deleted_at` sur les liens : un lien supprimé depuis
  // « Gérer mes liens » doit rester dans les stats, sinon le prospect sort du
  // dénominateur du taux d'activation.
  assert.deepEqual(liens.filtres, ['in:profile_id', 'is:archived_at=null']);
});

test('caractérisation — le volet Instagram exclut les calls déjà rattachés à un lead', async () => {
  // `is:ig_lead_id=null` est une DÉDUPLICATION : le call d'un lead connu est déjà compté
  // par son pseudo, le recompter par son e-mail ferait deux personnes.
  const journal: Lecture[] = [];
  await fetchAllLeadsCount(supabaseEspion(journal), 'p1', SINCE);
  const callsIg = journal[2];
  assert.deepEqual(callsIg.filtres, [
    'in:coach_id', 'in:call_type', 'neq:ignored=true',
    'is:ig_lead_id=null', 'neq:lead_deleted=true',
    'like:source=ig\\_%',
    `or:booked_at.gte.${SINCE},and(booked_at.is.null,scheduled_at.gte.${SINCE})`,
  ]);
});

test('le volet YouTube déduplique comme le volet Instagram', async () => {
  // Mise à jour DÉLIBÉRÉE du 2026-09-07 : ce test figeait auparavant l'ABSENCE de
  // `is:ig_lead_id=null`, un défaut connu que `handoff-fusion-auto-email-mes-stats.md`
  // demandait de corriger. Sans ce filtre, un lead Instagram qui réserve depuis une
  // description YouTube compte deux fois — une par son pseudo, une par son e-mail.
  //
  // Mesuré avant le changement : zéro paire concernée en base, donc aucun chiffre n'a
  // bougé. La fusion automatique par e-mail en créera.
  //
  // ⚠️ Ce filtre est une DÉDUPLICATION, pas une attribution (qui se lit sur `source`).
  const journal: Lecture[] = [];
  await fetchAllLeadsCount(supabaseEspion(journal), 'p1', SINCE);
  const callsYt = journal[3];
  assert.deepEqual(callsYt.filtres, [
    'in:coach_id', 'in:call_type', 'neq:ignored=true',
    'is:ig_lead_id=null',
    'like:source=yt%',
    `or:booked_at.gte.${SINCE},and(booked_at.is.null,scheduled_at.gte.${SINCE})`,
  ]);
  // ⚠️ Mais PAS `neq:lead_deleted=true`, que le volet Instagram porte : un lead supprimé
  // depuis « Gérer mes liens » doit rester dans les stats. Les deux volets restent donc
  // volontairement différents sur ce point.
  assert.ok(!callsYt.filtres.some(f => f.startsWith('neq:lead_deleted')));
  // Les calls YouTube ANNULÉS restent comptés (règle 4 du référentiel) : aucun filtre
  // sur `status`. C'est l'inverse du dashboard coach, qui les exclut — divergence
  // connue, traitée à part.
  assert.ok(!callsYt.filtres.some(f => f.startsWith('eq:status') || f.startsWith('neq:status')));
});

test('caractérisation — sans `since`, aucune borne de date n\'est posée', async () => {
  // L'all-time passe `since = null`. Si une borne apparaissait ici, tous les chiffres
  // « depuis toujours » se mettraient à raboter le début de l'historique.
  const journal: Lecture[] = [];
  await fetchAllLeadsCount(supabaseEspion(journal), 'p1', null);
  for (const lecture of journal) {
    assert.ok(!lecture.filtres.some(f => f.startsWith('or:')), `${lecture.table} ne doit pas être borné`);
  }
});
