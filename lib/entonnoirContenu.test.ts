import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compterLeadsDuContenu, compterConversationsDuContenu, compterCallsBookesDuContenu,
  callsBookesParContenu, SOURCES_CONTENU_DIRECT,
  type LeadEntonnoir, type CallEntonnoir, type CallBookeEntonnoir, type CallBookeParContenu,
} from './entonnoirContenu.ts';
import { SANS_CONTENU } from './attribution-roles.ts';
import { computeSalesCallStats } from './salesCallStats.ts';

// Relevé sur le profil de test le 2026-09-07 : 4 leads `comment`, 3 `cold_dm`,
// aucun `dm_entrant` encore — le cas existe dans le code, pas dans les données.
const LEADS: LeadEntonnoir[] = [
  { id: 'L1', ig_user_id: 'u1', source: 'comment',     hook_replied: true },
  { id: 'L2', ig_user_id: 'u2', source: 'comment',     hook_replied: true },
  { id: 'L3', ig_user_id: 'u3', source: 'story_reply', hook_replied: false },
  { id: 'L4', ig_user_id: 'u4', source: 'dm_entrant',  hook_replied: true },
  { id: 'L5', ig_user_id: 'u5', source: 'cold_dm',     hook_replied: true },
];

const call = (o: Partial<CallEntonnoir> & { id: string }): CallEntonnoir => ({ source: null, ...o });

// ── Ce que la marche compte ──────────────────────────────────────────────────

test('une personne compte une fois, quel que soit son nombre de demandes', () => {
  // Le défaut d'origine : la marche valait `lmHistory.length`, donc les LIGNES du
  // journal. Le compte de Rdjdkz affichait « 21 leads » pour UNE personne qui
  // avait demandé vingt-et-une fois.
  const r = compterLeadsDuContenu([LEADS[0]], []);
  assert.equal(r.total, 1);
});

test('le cold DM sortant est exclu des deux marches', () => {
  // L'entonnoir mesure ce que le CONTENU produit. Quelqu'un que le coach est allé
  // chercher n'a été produit par aucun contenu.
  const r = compterLeadsDuContenu(LEADS, []);
  assert.equal(r.personnesManifestees, 4, 'L5 (cold_dm) ne compte pas');
  assert.equal(compterConversationsDuContenu(LEADS), 3, 'L1, L2, L4 — pas L5');
});

test('le DM entrant compte, comme le commentaire', () => {
  // Il entre dans « Conversations » : il DOIT entrer dans « Leads », sinon une
  // marche contient des gens que la précédente ignore.
  const seulement = [LEADS[3]];
  assert.equal(compterLeadsDuContenu(seulement, []).total, 1);
  assert.equal(compterConversationsDuContenu(seulement), 1);
});

test('Conversations ne dépasse JAMAIS Leads', () => {
  // L'invariant de l'entonnoir. Il s'est cassé une fois dans la journée, quand le
  // DM entrant comptait dans la seconde marche et pas dans la première.
  const cas: LeadEntonnoir[][] = [
    LEADS,
    [LEADS[3]],
    [LEADS[4]],
    LEADS.filter(l => l.hook_replied),
    [],
  ];
  for (const jeu of cas) {
    const leads = compterLeadsDuContenu(jeu, []).total;
    assert.ok(compterConversationsDuContenu(jeu) <= leads, `cassé sur ${JSON.stringify(jeu.map(l => l.source))}`);
  }
});

// ── Les rendez-vous pris directement depuis un contenu ───────────────────────

test('un rendez-vous depuis une bio ou une description fait entrer son auteur', () => {
  // Des prospects réels que la première marche ignorait, alors que la dernière
  // les comptait déjà.
  const calls = [
    call({ id: 'C1', source: 'ig_bio', invitee_email: 'a@x.com' }),
    call({ id: 'C2', source: 'yt_description', invitee_email: 'b@x.com' }),
  ];
  assert.equal(compterLeadsDuContenu([], calls).total, 2);
});

test('une story compte comme les autres contenus', () => {
  // Décision de Chris, c'était la question ouverte du handoff : un rendez-vous
  // pris depuis le sticker d'une story vient d'un contenu.
  assert.ok(SOURCES_CONTENU_DIRECT.has('ig_story'));
  assert.equal(compterLeadsDuContenu([], [call({ id: 'C', source: 'ig_story', invitee_email: 'a@x.com' })]).total, 1);
});

test('un rendez-vous venu du DM ne compte pas ici', () => {
  // `ig_dm` n'est pas un contenu : cette personne est déjà comptée par sa fiche.
  assert.equal(compterLeadsDuContenu([], [call({ id: 'C', source: 'ig_dm', invitee_email: 'a@x.com' })]).total, 0);
});

test('le même prospect qui reprogramme ne compte pas deux fois', () => {
  // Calendly crée un NOUVEL événement à chaque report. Ce défaut affichait 18
  // leads là où le pipeline en montrait 17, le 2026-08-19.
  const calls = [
    call({ id: 'C1', source: 'ig_bio', invitee_email: 'Marie@X.com' }),
    call({ id: 'C2', source: 'ig_bio', invitee_email: 'marie@x.com' }),
  ];
  assert.equal(compterLeadsDuContenu([], calls).total, 1);
});

// ── Le doublon entre les deux apports ────────────────────────────────────────

test("une fiche retenue qui réserve depuis une bio ne compte pas deux fois", () => {
  // Les deux apports n'ont pas la même clé — pseudo d'un côté, e-mail de l'autre.
  // Seul `ig_lead_id`, posé par la fusion automatique, permet de les recouper.
  const calls = [call({ id: 'C', source: 'ig_bio', invitee_email: 'a@x.com', ig_lead_id: 'L1' })];
  const r = compterLeadsDuContenu(LEADS, calls);
  assert.equal(r.callsDirectsPersonnes, 0, 'L1 est déjà compté par sa fiche');
  assert.equal(r.total, 4);
});

test('un cold DM sortant qui réserve depuis une bio entre QUAND MÊME', () => {
  // La nuance qui distingue ce code de `compterLeads`, dont la requête écarte
  // tout call portant un `ig_lead_id` sans regarder lequel.
  //
  // L5 n'est pas dans les fiches retenues — le coach est allé le chercher. Mais
  // son rendez-vous, lui, vient bien d'un contenu : l'écarter le ferait
  // disparaître de l'entonnoir alors qu'une bio l'a produit.
  const calls = [call({ id: 'C', source: 'ig_bio', invitee_email: 'e@x.com', ig_lead_id: 'L5' })];
  const r = compterLeadsDuContenu(LEADS, calls);
  assert.equal(r.callsDirectsPersonnes, 1, 'le rendez-vous du cold DM compte');
  assert.equal(r.total, 5);
});

test("un ig_lead_id inconnu des fiches ne fait pas disparaître son rendez-vous", () => {
  // Fiche archivée, ou marquée « pas un lead » : elle n'est pas dans la liste
  // reçue. Le rendez-vous existe pourtant, et il vient d'un contenu.
  const calls = [call({ id: 'C', source: 'ig_bio', invitee_email: 'z@x.com', ig_lead_id: 'INCONNU' })];
  assert.equal(compterLeadsDuContenu(LEADS, calls).total, 5);
});

test('les deux apports sont rendus séparément, pour être affichés', () => {
  // « 4 ont écrit · 14 ont réservé directement » : un seul total laissait croire
  // à quatorze conversations et faisait chercher pourquoi la marche suivante
  // s'effondre.
  const calls = [call({ id: 'C', source: 'ig_bio', invitee_email: 'a@x.com' })];
  const r = compterLeadsDuContenu(LEADS, calls);
  assert.equal(r.personnesManifestees, 4);
  assert.equal(r.callsDirectsPersonnes, 1);
  assert.equal(r.total, r.personnesManifestees + r.callsDirectsPersonnes);
});

// ── La marche « Calls bookés » : des opportunités ────────────────────────────

const rdv = (o: Partial<CallBookeEntonnoir> & { id: string }): CallBookeEntonnoir =>
  ({ status: 'active', source: 'ig_bio', outcome: null, ...o });

test('un 2e call déclaré au rapport ne compte pas', () => {
  // Le défaut d'origine : la marche comptait tous les rendez-vous actifs, l'accueil
  // des opportunités — deux nombres sous le même libellé.
  const calls = [
    rdv({ id: 'C1', invitee_email: 'a@x.com', booked_at: '2026-09-01T10:00:00Z', outcome: 'second_call' }),
    rdv({ id: 'C2', invitee_email: 'a@x.com', booked_at: '2026-09-05T10:00:00Z' }),
  ];
  assert.equal(compterCallsBookesDuContenu(calls).total, 1);
});

test('un prospect qui rebooke sans « 2e call » déclaré compte deux fois', () => {
  // La déclaration relie deux rendez-vous, jamais un délai ni la seule identité.
  const calls = [
    rdv({ id: 'C1', invitee_email: 'a@x.com', booked_at: '2026-06-01T10:00:00Z', outcome: 'lost' }),
    rdv({ id: 'C2', invitee_email: 'a@x.com', booked_at: '2026-09-05T10:00:00Z' }),
  ];
  assert.equal(compterCallsBookesDuContenu(calls).total, 2);
});

test('un rendez-vous annulé ne compte pas et ne sert pas de tête de chaîne', () => {
  const calls = [
    rdv({ id: 'C1', invitee_email: 'a@x.com', booked_at: '2026-09-01T10:00:00Z', status: 'canceled', outcome: 'second_call' }),
    rdv({ id: 'C2', invitee_email: 'a@x.com', booked_at: '2026-09-05T10:00:00Z' }),
  ];
  assert.equal(compterCallsBookesDuContenu(calls).total, 1, 'C2 ouvre sa propre opportunité');
});

test('via DM + via description ou bio = total, sur des opportunités', () => {
  const calls = [
    rdv({ id: 'C1', source: 'ig_dm', invitee_email: 'a@x.com', booked_at: '2026-09-01T10:00:00Z', outcome: 'second_call' }),
    rdv({ id: 'C2', source: 'manual', invitee_email: 'a@x.com', booked_at: '2026-09-05T10:00:00Z' }),
    rdv({ id: 'C3', source: 'ig_bio', invitee_email: 'b@x.com', booked_at: '2026-09-02T10:00:00Z' }),
  ];
  const r = compterCallsBookesDuContenu(calls);
  assert.deepEqual(r, { total: 2, viaDm: 1, directs: 1 });
});

test("même nombre que l'accueil (computeSalesCallStats)", () => {
  // Deux écrans qui disent « calls bookés » doivent dire le même nombre.
  const calls = [
    rdv({ id: 'C1', invitee_email: 'a@x.com', booked_at: '2026-09-01T10:00:00Z', outcome: 'second_call' }),
    rdv({ id: 'C2', invitee_email: 'a@x.com', booked_at: '2026-09-05T10:00:00Z' }),
    rdv({ id: 'C3', invitee_email: 'b@x.com', booked_at: '2026-09-02T10:00:00Z', status: 'canceled' }),
    rdv({ id: 'C4', invitee_name: 'Paul', booked_at: '2026-09-03T10:00:00Z' }),
  ];
  const accueil = computeSalesCallStats(calls as any, new Date('2026-09-13T12:00:00Z')).callsBookedCount;
  assert.equal(compterCallsBookesDuContenu(calls).total, accueil);
});

// ── « N calls bookés depuis ce contenu » ─────────────────────────────────────

const POST = 'POST_A';
const AUTRE = 'POST_B';
const rdvC = (o: Partial<CallBookeParContenu> & { id: string }): CallBookeParContenu =>
  ({ status: 'active', source: 'ig_description', outcome: null, ...o });
const aucunJournal = new Map();
const aucunLien = new Map<string, string>();

test('par contenu : le 2e call ne recrédite pas le contenu', () => {
  // Le 2e rendez-vous hérite du utm_content de son parent.
  const calls = [
    rdvC({ id: 'C1', utm_content: POST, invitee_email: 'a@x.com', booked_at: '2026-09-01T10:00:00Z', outcome: 'second_call' }),
    rdvC({ id: 'C2', utm_content: POST, invitee_email: 'a@x.com', booked_at: '2026-09-05T10:00:00Z' }),
  ];
  assert.equal(callsBookesParContenu(calls, aucunJournal, aucunLien).get(POST), 1);
});

test('par contenu : une personne qui rebooke après un call perdu compte deux fois', () => {
  // L'ancien compteur (personnes ayant un `call_booked`) donnait 1.
  const calls = [
    rdvC({ id: 'C1', utm_content: POST, invitee_email: 'a@x.com', booked_at: '2026-06-01T10:00:00Z', outcome: 'lost' }),
    rdvC({ id: 'C2', utm_content: POST, invitee_email: 'a@x.com', booked_at: '2026-09-05T10:00:00Z' }),
  ];
  assert.equal(callsBookesParContenu(calls, aucunJournal, aucunLien).get(POST), 2);
});

test('par contenu : le lien personnel du DM est crédité au dernier lead magnet pris', () => {
  // Le lien `prendre-rdv-<pseudo>` porte le contenu du jour où il a été gravé, pas
  // celui qui a fait réserver : c'est le journal qui tranche, comme dans Mes stats.
  const journal = new Map([['L1', [
    { media_id: AUTRE, detected_at: '2026-07-05T10:00:00Z', lead_magnet_sent: true, ig_user_id: 'u1' },
    { media_id: POST, detected_at: '2026-07-06T10:00:00Z', lead_magnet_sent: true, ig_user_id: 'u1' },
  ]]]);
  const calls = [rdvC({ id: 'C1', source: 'ig_dm', utm_medium: 'dm', utm_content: AUTRE, ig_lead_id: 'L1', invitee_email: 'a@x.com', booked_at: '2026-07-08T10:00:00Z' })];
  const r = callsBookesParContenu(calls, journal, aucunLien);
  assert.equal(r.get(POST), 1);
  assert.equal(r.get(AUTRE), undefined);
});

test('par contenu : repli sur le contenu du lien prospect quand utm_content manque', () => {
  const calls = [rdvC({ id: 'C1', source: 'ig_dm', prospect_link_id: 'PL1', invitee_email: 'a@x.com', booked_at: '2026-08-15T10:00:00Z' })];
  assert.equal(callsBookesParContenu(calls, aucunJournal, new Map([['PL1', POST]])).get(POST), 1);
});

test('par contenu : un annulé ne crédite rien, un lien de bio va hors contenu', () => {
  const calls = [
    rdvC({ id: 'C1', utm_content: POST, invitee_email: 'a@x.com', status: 'canceled', booked_at: '2026-09-01T10:00:00Z' }),
    rdvC({ id: 'C2', source: 'ig_bio', invitee_email: 'b@x.com', booked_at: '2026-09-02T10:00:00Z' }),
  ];
  const r = callsBookesParContenu(calls, aucunJournal, aucunLien);
  assert.equal(r.get(POST), undefined);
  assert.equal(r.get(SANS_CONTENU), 1);
});

test("par contenu : la somme des crédits égale le total de l'entonnoir", () => {
  // L'invariant qui tient ensemble les deux compteurs de la page.
  const calls = [
    rdvC({ id: 'C1', utm_content: POST, invitee_email: 'a@x.com', booked_at: '2026-09-01T10:00:00Z', outcome: 'second_call' }),
    rdvC({ id: 'C2', utm_content: POST, invitee_email: 'a@x.com', booked_at: '2026-09-05T10:00:00Z' }),
    rdvC({ id: 'C3', utm_content: AUTRE, invitee_email: 'b@x.com', booked_at: '2026-09-02T10:00:00Z' }),
    rdvC({ id: 'C4', source: 'ig_bio', invitee_name: 'Paul', booked_at: '2026-09-03T10:00:00Z' }),
    rdvC({ id: 'C5', utm_content: AUTRE, invitee_email: 'c@x.com', booked_at: '2026-09-03T10:00:00Z', status: 'canceled' }),
  ];
  const credits = [...callsBookesParContenu(calls, aucunJournal, aucunLien).values()].reduce((s, n) => s + n, 0);
  assert.equal(credits, compterCallsBookesDuContenu(calls).total);
});
