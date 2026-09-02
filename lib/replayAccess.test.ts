import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resoudreAccesReplay } from './replayAccess.ts';

// Lancé par `npm test`. Fonction pure : ni React, ni réseau, ni base.
// C'est ici que se verrouille la règle d'accès aux enregistrements — le jour où
// quelqu'un la modifiera, ces tests diront ce qu'elle garantissait.

const COACH = 'profil-coach';
const ELEVE = 'profil-eleve';
const AUTRE = 'profil-tiers';

const REC_COACH = { recordingId: 'rec-coach', profileId: COACH };
const REC_ELEVE = { recordingId: 'rec-eleve', profileId: ELEVE };
/** Ligne reprise de l'existant : on ne sait pas qui a enregistré. */
const REC_INCONNU = { recordingId: 'rec-vieux', profileId: null };

const couples = (r: { essais: { recordingId: string; profileId: string }[] }) =>
  r.essais.map(e => `${e.recordingId}/${e.profileId}`);

// ── Les DEUX bots ont enregistré — le cas qui motive la table ───────────────

test('deux enregistrements — le coach lit le sien, avec son propre jeton', () => {
  const r = resoudreAccesReplay(COACH, COACH, ELEVE, [REC_ELEVE, REC_COACH]);
  assert.equal(r.autorise, true);
  assert.deepEqual(couples(r), ['rec-coach/profil-coach', 'rec-eleve/profil-eleve']);
});

test("deux enregistrements — l'élève lit le sien, avec son propre jeton", () => {
  const r = resoudreAccesReplay(ELEVE, COACH, ELEVE, [REC_COACH, REC_ELEVE]);
  assert.deepEqual(couples(r), ['rec-eleve/profil-eleve', 'rec-coach/profil-coach']);
});

test('un enregistrement de propriétaire connu ne se demande QU\'à son propriétaire', () => {
  // Le jeton du lecteur ne peut rien contre le fichier de l'autre : l'essayer
  // serait un 403 garanti, donc un appel réseau jeté.
  const r = resoudreAccesReplay(COACH, COACH, ELEVE, [REC_ELEVE, REC_COACH]);
  assert.ok(!couples(r).includes('rec-eleve/profil-coach'));
  assert.ok(!couples(r).includes('rec-coach/profil-eleve'));
});

// ── Un seul des deux a enregistré ──────────────────────────────────────────

test("un seul a enregistré — l'autre y accède quand même, via ce compte-là", () => {
  // Le cœur du besoin : celui dont le Fathom n'était pas là doit pouvoir regarder.
  const r = resoudreAccesReplay(ELEVE, COACH, ELEVE, [REC_COACH]);
  assert.equal(r.autorise, true);
  assert.deepEqual(couples(r), ['rec-coach/profil-coach']);
});

// ── Propriétaire inconnu : comportement d'avant la table ───────────────────

test('propriétaire inconnu — on essaie les participants, le lecteur d\'abord', () => {
  const r = resoudreAccesReplay(ELEVE, COACH, ELEVE, [REC_INCONNU]);
  assert.deepEqual(couples(r), ['rec-vieux/profil-eleve', 'rec-vieux/profil-coach']);
});

test('propriétaire inconnu sur un call de vente — un seul participant, un seul essai', () => {
  const r = resoudreAccesReplay(ELEVE, ELEVE, null, [REC_INCONNU]);
  assert.deepEqual(couples(r), ['rec-vieux/profil-eleve']);
});

test('mélange connu + inconnu — le sien passe devant', () => {
  const r = resoudreAccesReplay(ELEVE, COACH, ELEVE, [REC_INCONNU, REC_ELEVE]);
  assert.equal(couples(r)[0], 'rec-eleve/profil-eleve');
});

// ── Refus ──────────────────────────────────────────────────────────────────

test("un tiers n'a jamais accès, et rien n'est tenté", () => {
  const r = resoudreAccesReplay(AUTRE, COACH, ELEVE, [REC_COACH, REC_ELEVE]);
  assert.equal(r.autorise, false);
  assert.deepEqual(r.essais, [], 'aucun jeton ne doit être essayé');
});

test("l'élève d'un autre call n'atteint pas celui-ci", () => {
  const r = resoudreAccesReplay('eleve-B', COACH, 'eleve-A', [REC_COACH]);
  assert.equal(r.autorise, false);
});

test('call sans participant identifiable : personne', () => {
  assert.equal(resoudreAccesReplay(COACH, null, null, [REC_COACH]).autorise, false);
  assert.equal(resoudreAccesReplay(COACH, undefined, undefined, [REC_COACH]).autorise, false);
});

// ── Cas limites ────────────────────────────────────────────────────────────

test('aucun enregistrement : autorisé mais rien à tenter', () => {
  // L'autorisation et la disponibilité sont deux questions distinctes. Confondre
  // les deux ferait répondre 403 là où la vraie réponse est « pas de replay ».
  const r = resoudreAccesReplay(COACH, COACH, ELEVE, []);
  assert.equal(r.autorise, true);
  assert.deepEqual(r.essais, []);
});

test('paramètre omis : équivaut à aucun enregistrement', () => {
  assert.deepEqual(resoudreAccesReplay(COACH, COACH, ELEVE).essais, []);
});

test('même personne des deux côtés : un seul essai, pas de doublon', () => {
  // Arrive en test, quand le même compte joue les deux rôles.
  const r = resoudreAccesReplay(COACH, COACH, COACH, [REC_INCONNU]);
  assert.deepEqual(couples(r), ['rec-vieux/profil-coach']);
});

test('deux lignes pour le même enregistrement : dédoublonné', () => {
  const r = resoudreAccesReplay(COACH, COACH, ELEVE, [REC_COACH, { ...REC_COACH }]);
  assert.deepEqual(couples(r), ['rec-coach/profil-coach']);
});

test('chaînes vides traitées comme absentes', () => {
  // Une colonne vide ne doit jamais valoir « participant » ni « enregistrement ».
  assert.equal(resoudreAccesReplay('', '', '', [REC_COACH]).autorise, false);
  assert.deepEqual(
    resoudreAccesReplay(COACH, COACH, '', [{ recordingId: '', profileId: COACH }]).essais,
    []
  );
});

test('le lien de partage suit son enregistrement', () => {
  // Le lecteur doit pouvoir ouvrir SA page Fathom, pas celle de l'autre.
  const r = resoudreAccesReplay(ELEVE, COACH, ELEVE, [
    { recordingId: 'rec-coach', profileId: COACH, shareUrl: 'https://f/coach' },
    { recordingId: 'rec-eleve', profileId: ELEVE, shareUrl: 'https://f/eleve' },
  ]);
  assert.equal(r.essais[0].shareUrl, 'https://f/eleve');
  assert.equal(r.essais[1].shareUrl, 'https://f/coach');
});
