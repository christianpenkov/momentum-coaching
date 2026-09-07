import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compterLeadsDuContenu, compterConversationsDuContenu, SOURCES_CONTENU_DIRECT,
  type LeadEntonnoir, type CallEntonnoir,
} from './entonnoirContenu.ts';

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
