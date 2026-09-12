import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compterLeads, compterLeadsActifs, computeSalesCallStats, fetchAllLeadsCount, fetchIgLeadsCount, type DealForStats, type LignesActifs, type LignesLeads } from './salesCallStats.ts';

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

/* ─── Les ACTIFS d'une période ────────────────────────────────────────────────
 *
 * Sur une période, « Leads » compte désormais les personnes qui se sont MANIFESTÉES,
 * et le badge « +N nouveaux » celles qui apparaissent pour la première fois. Avant, les
 * deux comptaient la même chose et affichaient donc le même nombre. */

const AOUT = ['2026-08-01T00:00:00Z', '2026-08-31T23:59:59Z'] as const;
const SEPT = ['2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z'] as const;

function actifs(p: Partial<LignesActifs> = {}): LignesActifs {
  return { leads: [], liens: [], reprises: [], calls: [], ...p };
}
const reprise = (u: string, le: string) => ({ ig_username: u, detected_at: le });
const booking = (id: string, medium: string | null, le: string, email: string | null = null) =>
  ({ id, invitee_email: email, invitee_name: null, utm_medium: medium, booked_at: le, scheduled_at: null });

test('actifs — l\'exemple qui fixe la règle', () => {
  // Commente fin août (elle entre), puis répond et réserve depuis le DM début septembre.
  // Elle compte en AOÛT, pas en septembre : on n'a pas gagné un lead, on a déroulé le
  // parcours normal.
  const l = actifs({
    leads: [commentaire('ana', '2026-08-28T00:00:00Z')],
    reprises: [reprise('ana', '2026-08-28T00:00:00Z')],
    calls: [booking('c1', 'dm', '2026-09-03T00:00:00Z', 'ana@x.fr')],
  });
  assert.equal(compterLeadsActifs(l, AOUT[0], AOUT[1]), 1, 'compte en août');
  assert.equal(compterLeadsActifs(l, SEPT[0], SEPT[1]), 0, 'pas en septembre');
});

test('actifs — une reprise ne compte que pour une personne que `leads` connaît', () => {
  // `instagram_lead_lm_history` n'a pas de colonne `not_a_lead` : un prospect écarté à la
  // main y garde ses lignes. Sans cette garde il reviendrait par les reprises, alors
  // qu'il est exclu partout ailleurs — et Stats Clients, qui ne filtrait pas ces lignes
  // de son côté, aurait affiché un autre nombre que Mes Stats.
  const inconnue = actifs({ reprises: [reprise('fantome', '2026-08-10T00:00:00Z')] });
  assert.equal(compterLeadsActifs(inconnue, AOUT[0], AOUT[1]), 0);
});

test('actifs — deux reprises dans deux périodes = deux fois actif, une seule personne', () => {
  // Le cas `rdjdkzjd`, mesuré en base : reprise le 28/06 puis le 28/08.
  const l = actifs({
    leads: [commentaire('rdjdkzjd', '2026-06-28T00:00:00Z')],
    reprises: [reprise('rdjdkzjd', '2026-06-28T00:00:00Z'), reprise('rdjdkzjd', '2026-08-28T00:00:00Z')],
  });
  assert.equal(compterLeadsActifs(l, '2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z'), 1);
  assert.equal(compterLeadsActifs(l, AOUT[0], AOUT[1]), 1);
  // En all-time, c'est UNE personne — l'autre fonction, l'autre question.
  assert.equal(compterLeads({ ...actifs(), callsIgDirects: [], callsYoutube: [], leads: l.leads, liens: [] }, null), 1);
});

test('actifs — une réservation depuis un lien PARTAGÉ est une entrée', () => {
  // bio, description et story ouvrent un parcours ; `dm` le prolonge.
  for (const medium of ['bio', 'description', 'story']) {
    const l = actifs({ calls: [booking('c1', medium, '2026-08-10T00:00:00Z', 'zoe@x.fr')] });
    assert.equal(compterLeadsActifs(l, AOUT[0], AOUT[1]), 1, `${medium} doit compter`);
  }
  const dm = actifs({ calls: [booking('c1', 'dm', '2026-08-10T00:00:00Z', 'zoe@x.fr')] });
  assert.equal(compterLeadsActifs(dm, AOUT[0], AOUT[1]), 0, 'dm ne doit pas compter');
  const sansMedium = actifs({ calls: [booking('c1', null, '2026-08-10T00:00:00Z', 'zoe@x.fr')] });
  assert.equal(compterLeadsActifs(sansMedium, AOUT[0], AOUT[1]), 0, 'sans medium, on ne suppose rien');
});

test('actifs — une réservation bio compte MÊME si la personne a déjà un lead', () => {
  // C'est le cas que Chris a nommé : elle prend un lead magnet, puis réserve depuis une
  // description dans une AUTRE période. Elle est active dans les deux.
  const l = actifs({
    leads: [commentaire('bea', '2026-06-05T00:00:00Z')],
    reprises: [reprise('bea', '2026-06-05T00:00:00Z')],
    calls: [booking('c1', 'description', '2026-08-10T00:00:00Z', 'bea@x.fr')],
  });
  assert.equal(compterLeadsActifs(l, '2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z'), 1);
  assert.equal(compterLeadsActifs(l, AOUT[0], AOUT[1]), 1);
});

test('actifs — un call rattaché à un lead est recompté SUR ce lead, pas à côté', () => {
  // ⚠️ La limite des deux espaces de clés : sans `ig_lead_id`, le pseudo et l'e-mail sont
  // deux personnes. Dès que la fusion rattache le call, cette ré-attribution les unifie —
  // sans autre changement de code. Ici, une seule personne active en août.
  const l = actifs({
    leads: [{ ...commentaire('caro', '2026-06-01T00:00:00Z'), id: 'lead-1' }],
    reprises: [reprise('caro', '2026-08-05T00:00:00Z')],
    calls: [{ ...booking('c1', 'bio', '2026-08-10T00:00:00Z', 'caro@x.fr'), ig_lead_id: 'lead-1' }],
  });
  assert.equal(compterLeadsActifs(l, AOUT[0], AOUT[1]), 1);
});

test('actifs — une personne active plusieurs fois DANS la même période compte une fois', () => {
  const l = actifs({
    // La fiche `leads` est indispensable : une reprise ne compte que pour quelqu'un que
    // `leads` connaît, sinon un prospect écarté à la main reviendrait par l'historique
    // des lead magnets, qui n'a pas de colonne `not_a_lead`.
    leads: [commentaire('dan', '2026-08-02T00:00:00Z')],
    reprises: [reprise('dan', '2026-08-02T00:00:00Z'), reprise('dan', '2026-08-20T00:00:00Z')],
    calls: [booking('c1', 'bio', '2026-08-25T00:00:00Z', 'dan@x.fr')],
  });
  // Le pseudo et l'e-mail restent deux clés tant que la fusion n'a pas rattaché le call :
  // deux « personnes », donc 2. C'est la limite documentée, figée pour qu'elle se voie.
  assert.equal(compterLeadsActifs(l, AOUT[0], AOUT[1]), 2);
});

test('actifs — un cold DM sans réponse n\'est actif dans AUCUNE période', () => {
  const l = actifs({ leads: [coldDm('dolphin', '2026-08-05T00:00:00Z')] });
  assert.equal(compterLeadsActifs(l, AOUT[0], AOUT[1]), 0);
  assert.equal(compterLeadsActifs(l, SEPT[0], SEPT[1]), 0);
});

test('actifs — un cold DM qui répond est actif dans la période de sa RÉPONSE', () => {
  const l = actifs({ leads: [coldDm('eve', '2026-08-05T00:00:00Z', '2026-09-10T00:00:00Z')] });
  assert.equal(compterLeadsActifs(l, AOUT[0], AOUT[1]), 0, 'pas au moment du démarchage');
  assert.equal(compterLeadsActifs(l, SEPT[0], SEPT[1]), 1, 'actif quand elle répond');
});

test('⚠️ INVARIANT — le badge est toujours ≤ la carte', () => {
  // Le badge affiche `compterLeads(période)`, la carte `compterLeadsActifs(période)`.
  // Toute personne dont la première apparition tombe dans la fenêtre y est forcément
  // active — c'est la règle 1. Si ce test casse un jour, les deux règles ont divergé et
  // l'écran affiche un sous-ensemble plus grand que son ensemble.
  const cas: LignesActifs[] = [
    actifs({ leads: [commentaire('a', '2026-08-05T00:00:00Z')] }),
    actifs({
      leads: [commentaire('a', '2026-06-01T00:00:00Z'), commentaire('b', '2026-08-02T00:00:00Z')],
      reprises: [reprise('a', '2026-08-20T00:00:00Z')],
      calls: [booking('c1', 'bio', '2026-08-25T00:00:00Z', 'c@x.fr')],
    }),
    actifs({ leads: [coldDm('d', '2026-07-01T00:00:00Z', '2026-08-03T00:00:00Z')] }),
    actifs({ liens: [{ ig_username: 'e', created_at: '2026-08-09T00:00:00Z' }] }),
  ];
  for (const [i, l] of cas.entries()) {
    const badge = compterLeads({ leads: l.leads, liens: l.liens, callsIgDirects: [], callsYoutube: [] }, AOUT[0], AOUT[1]);
    const carte = compterLeadsActifs(l, AOUT[0], AOUT[1]);
    assert.ok(badge <= carte, `cas ${i} : badge ${badge} > carte ${carte}`);
  }
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
  assert.equal(leads.select, 'id, profile_id, ig_username, detected_at, source, hook_replied_at');
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

// ─── closingRate : une vente annulée n'est plus un closing ───────────────────
//
// Décision produit de Chris, 2026-09-12. AGENTS.md portait la question ouverte
// (« une vente annulée est-elle un closing ? ») et le code répondait « oui » par
// défaut. Ces tests fixent la réponse et, surtout, les trois cas où il faut
// continuer de compter — ce sont eux qui feraient des faux négatifs silencieux.

// `outcome` non nul est obligatoire : sans rapport rempli, `isCallHonored` répond
// non — un appel sans rapport « n'a pas encore eu lieu » (décision du 2026-07-27).
// Sans lui le dénominateur vaut 0 et le taux aussi, quel que soit le numérateur.
const APPEL_HONORE = {
  id: 'c1', status: 'active', scheduled_at: '2026-09-01T10:00:00Z',
  call_type: 'calendly', deal_closed: true, revenue: 1000,
  outcome: 'closed', no_show: false,
};
const MAINTENANT = new Date('2026-09-10T00:00:00Z');
const stats = (deals?: DealForStats[], calls: unknown[] = [APPEL_HONORE]) =>
  computeSalesCallStats(calls as never, MAINTENANT, deals);

test('closing — un appel dont la seule vente est annulée sort du numérateur', () => {
  const s = stats([{ amount_total: 1000, status: 'canceled', call_id: 'c1' }]);
  assert.equal(s.callsHonoredCount, 1, 'le dénominateur ne bouge pas : le rendez-vous a bien eu lieu');
  assert.equal(s.dealsClosedCount, 0);
  assert.equal(s.closingRate, 0);
});

test('closing — une vente vivante compte, évidemment', () => {
  const s = stats([{ amount_total: 1000, status: 'paid', call_id: 'c1' }]);
  assert.equal(s.dealsClosedCount, 1);
  assert.equal(s.closingRate, 100);
});

test('closing — un appel SANS aucun deal compte encore (rapport interrompu)', () => {
  // Le montant a été saisi, la vente n'a jamais été créée : `deal_closed` est la
  // seule trace. L'exclure ici effacerait un closing réel — même repli que le
  // garde de `client/pipeline`.
  const s = stats([{ amount_total: 500, status: 'paid', call_id: 'un-autre-appel' }]);
  assert.equal(s.dealsClosedCount, 1);
});

test('closing — une vente annulée ET une vivante sur le même appel : ça compte', () => {
  const s = stats([
    { amount_total: 1000, status: 'canceled', call_id: 'c1' },
    { amount_total: 800, status: 'paid', call_id: 'c1' },
  ]);
  assert.equal(s.dealsClosedCount, 1);
});

test('closing — un deal annulé SANS call_id (upsell) ne disqualifie aucun appel', () => {
  const s = stats([{ amount_total: 1000, status: 'canceled', call_id: null }]);
  assert.equal(s.dealsClosedCount, 1);
});

test('⚠️ rétro-compatible — sans deals, le comptage est celui d\'avant', () => {
  const s = stats(undefined);
  assert.equal(s.dealsClosedCount, 1);
  assert.equal(s.cashCollected, null, 'inconnu sans les deals, surtout pas 0');
});

test('closing — le cash contracté exclut déjà les annulées, et ne change pas', () => {
  const s = stats([
    { amount_total: 1000, status: 'canceled', call_id: 'c1' },
    { amount_total: 800, status: 'paid', call_id: 'c1' },
  ]);
  assert.equal(s.cashContracted, 800);
});
