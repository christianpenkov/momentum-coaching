import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDraftAge } from './draftAge.ts';

// Lancé par `npm test` (node --test, sans aucune dépendance à installer).
// Fonction pure : ni React, ni réseau, ni base.

const now = new Date(2026, 7, 20, 14, 0); // 20 août 2026, 14h — heure locale

function joursAvant(n: number, h = 14, min = 0) {
  return new Date(2026, 7, 20 - n, h, min).toISOString();
}
function minutesAvant(n: number) {
  return new Date(now.getTime() - n * 60_000).toISOString();
}

test('même journée : heures puis minutes', () => {
  assert.equal(formatDraftAge(minutesAvant(0), now), "à l'instant");
  assert.equal(formatDraftAge(minutesAvant(1), now), 'il y a 1 min');
  assert.equal(formatDraftAge(minutesAvant(45), now), 'il y a 45 min');
  assert.equal(formatDraftAge(minutesAvant(60), now), 'il y a 1 h');
  assert.equal(formatDraftAge(minutesAvant(200), now), 'il y a 3 h');
});

test('plus rien n\'est masqué : hier s\'affiche', () => {
  assert.equal(formatDraftAge(joursAvant(1), now), 'il y a 1 jour');
});

test('au-delà, en jours', () => {
  assert.equal(formatDraftAge(joursAvant(2), now), 'il y a 2 jours');
  assert.equal(formatDraftAge(joursAvant(12), now), 'il y a 12 jours');
  assert.equal(formatDraftAge(joursAvant(29), now), 'il y a 29 jours');
});

test('compté en jours calendaires, pas en tranches de 24 h', () => {
  // Avant-hier à 23h50 : moins de 48 h se sont écoulées, mais on est bien
  // deux jours calendaires plus tôt — c'est ainsi qu'on se repère.
  assert.equal(formatDraftAge(joursAvant(2, 23, 50), now), 'il y a 2 jours');
  // Hier à 00h01 : plus de 24 h, et toujours « hier » — donc 1 jour.
  assert.equal(formatDraftAge(joursAvant(1, 0, 1), now), 'il y a 1 jour');
});

test('une même journée ne bascule jamais en jours', () => {
  // Ce matin 8h : 6 h écoulées, même jour calendaire → heures, pas « 0 jour ».
  assert.equal(formatDraftAge(new Date(2026, 7, 20, 8, 0).toISOString(), now), 'il y a 6 h');
});

test('entrées invalides ou futures', () => {
  assert.equal(formatDraftAge(null, now), null);
  assert.equal(formatDraftAge(undefined, now), null);
  assert.equal(formatDraftAge('', now), null);
  assert.equal(formatDraftAge('pas une date', now), null);
  // Horloge décalée : une date future n'est pas une ancienneté.
  assert.equal(formatDraftAge(joursAvant(-1), now), null);
  assert.equal(formatDraftAge(minutesAvant(-5), now), null);
});
