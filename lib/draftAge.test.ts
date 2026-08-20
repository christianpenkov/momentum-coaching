import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDraftAge, DRAFT_AGE_THRESHOLD_DAYS } from './draftAge.ts';

// Lancé par `npm test` (node --test, sans aucune dépendance à installer).
// Fonction pure : ni React, ni réseau, ni base.

const now = new Date(2026, 7, 20, 14, 0); // 20 août 2026, 14h — heure locale

function joursAvant(n: number, h = 14, min = 0) {
  return new Date(2026, 7, 20 - n, h, min).toISOString();
}

test('rien avant le seuil', () => {
  assert.equal(formatDraftAge(joursAvant(0), now), null, "aujourd'hui");
  assert.equal(formatDraftAge(joursAvant(1), now), null, 'hier');
});

test('affiche à partir du seuil', () => {
  assert.equal(formatDraftAge(joursAvant(2), now), 'il y a 2 jours');
  assert.equal(formatDraftAge(joursAvant(12), now), 'il y a 12 jours');
  assert.equal(formatDraftAge(joursAvant(29), now), 'il y a 29 jours');
});

test('le seuil vaut bien 2', () => {
  assert.equal(DRAFT_AGE_THRESHOLD_DAYS, 2);
  assert.equal(formatDraftAge(joursAvant(DRAFT_AGE_THRESHOLD_DAYS - 1), now), null);
  assert.notEqual(formatDraftAge(joursAvant(DRAFT_AGE_THRESHOLD_DAYS), now), null);
});

test('compté en jours calendaires, pas en tranches de 24 h', () => {
  // Avant-hier à 23h50 : moins de 48 h se sont écoulées, mais on est bien
  // deux jours calendaires plus tôt — c'est ainsi qu'on se repère.
  assert.equal(formatDraftAge(joursAvant(2, 23, 50), now), 'il y a 2 jours');
  // Hier à 00h01 : plus de 24 h dans certains cas, mais toujours « hier ».
  assert.equal(formatDraftAge(joursAvant(1, 0, 1), now), null);
});

test('entrées invalides ou futures', () => {
  assert.equal(formatDraftAge(null, now), null);
  assert.equal(formatDraftAge(undefined, now), null);
  assert.equal(formatDraftAge('', now), null);
  assert.equal(formatDraftAge('pas une date', now), null);
  // Horloge décalée : un brouillon daté de demain n'est pas ancien.
  assert.equal(formatDraftAge(joursAvant(-1), now), null);
});
