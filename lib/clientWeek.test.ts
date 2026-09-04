import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClientWeek } from './clientWeek.ts';

// Lancé par `npm test`. Fonction pure : ni React, ni réseau, ni base.

test('sans date d’arrivée, on ne sait pas — et on le dit', () => {
  // Elle rendait 1. Un élève sans date s'affichait donc « Semaine 1 » sur sept écrans,
  // c'est-à-dire un chiffre inventé présenté comme une mesure.
  assert.equal(getClientWeek(null), null);
  assert.equal(getClientWeek(undefined), null);
  assert.equal(getClientWeek(''), null);
});

test('une date illisible rend null, jamais un nombre au hasard', () => {
  assert.equal(getClientWeek('pas une date'), null);
});

test('S1 dès le premier jour, S2 au septième', () => {
  const jours = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  assert.equal(getClientWeek(jours(0)), 1);
  assert.equal(getClientWeek(jours(6)), 1);
  assert.equal(getClientWeek(jours(7)), 2);
  assert.equal(getClientWeek(jours(13)), 2);
  assert.equal(getClientWeek(jours(14)), 3);
});

test('une arrivée dans le futur rend S1, pas une semaine négative', () => {
  const demain = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(getClientWeek(demain), 1);
});
