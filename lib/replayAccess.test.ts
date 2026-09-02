import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resoudreAccesReplay } from './replayAccess.ts';

// Lancé par `npm test`. Fonction pure : ni React, ni réseau, ni base.
// C'est ici que se verrouille la règle d'accès aux enregistrements — le jour où
// quelqu'un la modifiera, ces tests diront ce qu'elle garantissait.

const COACH = 'profil-coach';
const ELEVE = 'profil-eleve';
const AUTRE = 'profil-tiers';

// ── Call de coaching : deux participants ───────────────────────────────────

test('coaching — le coach est autorisé, son compte est essayé en premier', () => {
  const r = resoudreAccesReplay(COACH, COACH, ELEVE);
  assert.equal(r.autorise, true);
  assert.deepEqual(r.ordreDEssai, [COACH, ELEVE]);
});

test("coaching — l'élève est autorisé, son compte est essayé en premier", () => {
  const r = resoudreAccesReplay(ELEVE, COACH, ELEVE);
  assert.equal(r.autorise, true);
  assert.deepEqual(r.ordreDEssai, [ELEVE, COACH]);
});

test("coaching — c'est bien l'AUTRE participant qui sert de repli", () => {
  // Le cœur du besoin : celui dont le Fathom n'a pas enregistré doit quand même
  // pouvoir regarder, via le compte de celui qui l'a.
  assert.equal(resoudreAccesReplay(COACH, COACH, ELEVE).ordreDEssai[1], ELEVE);
  assert.equal(resoudreAccesReplay(ELEVE, COACH, ELEVE).ordreDEssai[1], COACH);
});

// ── Call de vente : un seul participant ────────────────────────────────────

test('vente — un seul participant, donc aucun emprunt possible', () => {
  // La règle se réduit d'elle-même à « son propre compte », sans cas particulier.
  const r = resoudreAccesReplay(ELEVE, ELEVE, null);
  assert.equal(r.autorise, true);
  assert.deepEqual(r.ordreDEssai, [ELEVE]);
});

// ── Refus ──────────────────────────────────────────────────────────────────

test("un tiers n'a jamais accès, et rien n'est tenté", () => {
  const r = resoudreAccesReplay(AUTRE, COACH, ELEVE);
  assert.equal(r.autorise, false);
  assert.deepEqual(r.ordreDEssai, [], 'aucun jeton ne doit être essayé');
});

test("l'élève d'un autre call n'atteint pas celui-ci", () => {
  // Élève B face à un call entre le coach et l'élève A.
  const r = resoudreAccesReplay('eleve-B', COACH, 'eleve-A');
  assert.equal(r.autorise, false);
});

test('call sans participant identifiable : personne', () => {
  assert.equal(resoudreAccesReplay(COACH, null, null).autorise, false);
  assert.equal(resoudreAccesReplay(COACH, undefined, undefined).autorise, false);
});

// ── Cas limites ────────────────────────────────────────────────────────────

test('même personne des deux côtés : un seul essai, pas de doublon', () => {
  // Arrive en test, quand le même compte joue les deux rôles.
  const r = resoudreAccesReplay(COACH, COACH, COACH);
  assert.equal(r.autorise, true);
  assert.deepEqual(r.ordreDEssai, [COACH]);
});

test('chaînes vides traitées comme absentes', () => {
  // Une colonne vide ne doit jamais valoir « participant ».
  assert.equal(resoudreAccesReplay('', '', '').autorise, false);
  assert.equal(resoudreAccesReplay(COACH, COACH, '').ordreDEssai.length, 1);
});
