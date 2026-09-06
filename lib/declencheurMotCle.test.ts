import test from 'node:test';
import assert from 'node:assert/strict';
import {
  choisirDeclencheur, gardeDejaRecuRequise, messageContientMotCle,
  type SequenceCandidate, type LeadMagnetPermanent,
} from './declencheurMotCle.ts';

// Mots-clés relevés en base le 2026-09-06 : les lead magnets portent LM et
// TUNNEL, les contenus portent en plus GUIDE et BEAU. Les deux niveaux
// divergent déjà, la règle doit vivre avec.
const SEQ: SequenceCandidate = {
  lm_keyword: 'GUIDE',
  dm_lm_message: 'Accroche de la séquence',
  dm_button_text: '🚀 Je veux le lien !',
  dm2_story_message: 'Relance de la séquence',
};

const PERMANENTS: LeadMagnetPermanent[] = [
  { id: 'lm-1', name: 'LM Ubizen AI', keyword: 'LM', dm_accroche: 'Accroche du LM', dm_accroche_bouton: '🚀 Go', dm_relance: 'Relance du LM' },
  { id: 'lm-2', name: 'Tunnel Closing', keyword: 'TUNNEL', dm_accroche: 'Accroche Tunnel', dm_accroche_bouton: '🚀 Go', dm_relance: null },
];

// ── La correspondance ────────────────────────────────────────────────────────

test('le mot-clé est reconnu au milieu d\'une phrase', () => {
  // Personne n'écrit le mot-clé tout seul. Exiger l'égalité stricte ferait
  // échouer la quasi-totalité des vrais messages.
  assert.equal(messageContientMotCle('je veux le GUIDE stp 🙏', 'GUIDE'), true);
  assert.equal(messageContientMotCle('GUIDE', 'GUIDE'), true);
});

test('la casse et les accents sont ignorés', () => {
  assert.equal(messageContientMotCle('guide', 'GUIDE'), true);
  assert.equal(messageContientMotCle('Réservé', 'reserve'), true);
  assert.equal(messageContientMotCle('reserve', 'RÉSERVÉ'), true);
});

test('un mot-clé vide ne correspond jamais', () => {
  // Un lead magnet sans mot-clé existe (le champ est facultatif). Sans cette
  // garde, `''` serait « contenu » dans tout message et répondrait à tout.
  assert.equal(messageContientMotCle('bonjour', ''), false);
  assert.equal(messageContientMotCle('bonjour', '   '), false);
  assert.equal(messageContientMotCle('bonjour', null), false);
});

// ── La priorité ──────────────────────────────────────────────────────────────

test('la séquence gagne quand son mot-clé correspond', () => {
  const d = choisirDeclencheur('GUIDE stp', SEQ, PERMANENTS);
  assert.equal(d?.origine, 'sequence');
  assert.equal(d?.accroche, 'Accroche de la séquence');
});

test('le mot-clé permanent répond quand la story n\'a pas de séquence', () => {
  // C'est le trou qu'on bouche : une story publiée mais pas encore rattachée.
  const d = choisirDeclencheur('je veux le LM', null, PERMANENTS);
  assert.equal(d?.origine, 'permanent');
  assert.equal(d?.leadMagnetId, 'lm-1');
  assert.equal(d?.accroche, 'Accroche du LM');
});

test('la séquence gagne MÊME si un mot-clé permanent correspond aussi', () => {
  // Le cas que Chris a soulevé : le même mot désigne un lead magnet différent
  // selon l'endroit. Le plus précis l'emporte, toujours.
  const seqAvecLm: SequenceCandidate = { ...SEQ, lm_keyword: 'LM', dm_lm_message: 'Celle de la séquence' };
  const d = choisirDeclencheur('LM', seqAvecLm, PERMANENTS);
  assert.equal(d?.origine, 'sequence');
  assert.equal(d?.accroche, 'Celle de la séquence');
});

test('le permanent répond quand le mot-clé de la séquence ne correspond PAS', () => {
  // Une story rattachée à une séquence « GUIDE », mais la personne écrit « LM ».
  // Sans ce repli, elle ne recevrait rien alors qu'un lead magnet l'attend.
  const d = choisirDeclencheur('LM', SEQ, PERMANENTS);
  assert.equal(d?.origine, 'permanent');
  assert.equal(d?.leadMagnetId, 'lm-1');
});

test('un message sans aucun mot-clé ne déclenche rien', () => {
  assert.equal(choisirDeclencheur('salut ça va ?', SEQ, PERMANENTS), null);
  assert.equal(choisirDeclencheur('salut', null, []), null);
  assert.equal(choisirDeclencheur('', SEQ, PERMANENTS), null);
});

test('aucun lead magnet permanent : le repli ne répond pas', () => {
  // `repond_partout` est un choix explicite. Un lead magnet réservé à un
  // lancement ne doit pas se mettre à répondre partout tout seul.
  assert.equal(choisirDeclencheur('LM', null, []), null);
});

// ── La garde ─────────────────────────────────────────────────────────────────

test('la garde « déjà reçu » ne vise que le mot-clé permanent', () => {
  // Une séquence garde son comportement d'avant : son verrou d'une minute
  // suffit. Étendre la garde aux séquences changerait un chemin qui marche.
  const permanent = choisirDeclencheur('LM', null, PERMANENTS)!;
  const sequence = choisirDeclencheur('GUIDE', SEQ, PERMANENTS)!;
  assert.equal(gardeDejaRecuRequise(permanent), true);
  assert.equal(gardeDejaRecuRequise(sequence), false);
});

test('la garde est par MOT-CLÉ, pas par personne', () => {
  // Quelqu'un qui a déjà reçu le guide doit pouvoir réclamer le tunnel. Deux
  // déclencheurs distincts, deux gardes distinctes.
  const a = choisirDeclencheur('LM', null, PERMANENTS)!;
  const b = choisirDeclencheur('TUNNEL', null, PERMANENTS)!;
  assert.notEqual(a.keyword, b.keyword);
  assert.notEqual(a.leadMagnetId, b.leadMagnetId);
});

// ── Le contrat avec la base ──────────────────────────────────────────────────

test("l'ordre de la liste ne change jamais la réponse", () => {
  // C'est LA propriété qui tient la promesse de zéro maintenance. ManyChat
  // départage deux mots-clés par leur rang dans une liste, qu'il faut donc
  // maintenir et re-vérifier à chaque ajout. Ici la réponse ne dépend que du
  // mot reçu — l'unicité par élève est garantie par l'index
  // `lead_magnets_mot_cle_unique`, la lecture n'a rien à arbitrer.
  const endroit = [...PERMANENTS];
  const envers = [...PERMANENTS].reverse();
  for (const mot of ['LM', 'TUNNEL', 'je veux le tunnel stp']) {
    assert.deepEqual(
      choisirDeclencheur(mot, null, endroit),
      choisirDeclencheur(mot, null, envers),
      `« ${mot} » doit donner la même réponse quel que soit l'ordre`,
    );
  }
});

test('une relance vide reste vide, elle n\'est jamais inventée', () => {
  // Même règle que partout : un champ vide est un message qui n'existe pas,
  // jamais un texte générique envoyé au nom du coach.
  const d = choisirDeclencheur('TUNNEL', null, PERMANENTS);
  assert.equal(d?.relance, null);
});
