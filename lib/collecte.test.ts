import test from 'node:test';
import assert from 'node:assert/strict';
import { sommeFlux, rienDeCollecte } from './collecte.ts';

// ── La distinction qui justifie tout ce module ───────────────────────────────

test('un vrai ZERO mesure reste 0, il ne devient jamais « non mesure »', () => {
  // Le cas a ne surtout pas avaler : 6 fenetres sur 44 ont une somme reelle de zero
  // sur les vues Instagram (mesure du 2026-09-06). Les rendre `null` ferait afficher
  // « Non mesure » sur des journees parfaitement mesurees ou il ne s'est rien passe.
  const jours = [{ v: 0 }, { v: 0 }, { v: 0 }];
  assert.equal(sommeFlux(jours, 'v'), 0);
  assert.equal(rienDeCollecte(jours, 'v'), false);
});

test('aucun jour collecte rend null, pas 0', () => {
  const jours = [{ v: null }, { v: null }];
  assert.equal(sommeFlux(jours, 'v'), null);
  assert.equal(rienDeCollecte(jours, 'v'), true);
});

test('UN seul jour collecte suffit a rendre un total', () => {
  // Une fenetre partiellement trouee garde son chiffre : refuser de totaliser des
  // qu'un jour manque effacerait des semaines de donnees reelles. Ce sont les courbes
  // qui montrent ou sont les trous.
  const jours = [{ v: null }, { v: 12 }, { v: null }];
  assert.equal(sommeFlux(jours, 'v'), 12);
  assert.equal(rienDeCollecte(jours, 'v'), false);
});

test('un jour collecte a ZERO parmi des trous suffit aussi', () => {
  // Le piege du test precedent : si l'implementation testait la verite de la valeur
  // au lieu de sa presence, ce zero passerait pour une absence.
  const jours = [{ v: null }, { v: 0 }, { v: null }];
  assert.equal(sommeFlux(jours, 'v'), 0);
  assert.equal(rienDeCollecte(jours, 'v'), false);
});

// ── Absences de toutes natures ──────────────────────────────────────────────

test('`undefined` compte comme une absence, au meme titre que null', () => {
  // Une source qui ne transporte pas le champ rend `undefined`. Un test strict
  // (`!== null`) le laisserait passer et l'additionnerait comme NaN.
  assert.equal(sommeFlux([{ v: undefined }, {}], 'v'), null);
  assert.equal(sommeFlux([{ v: undefined }, { v: 5 }], 'v'), 5);
});

test('NaN ne contamine pas le total', () => {
  assert.equal(sommeFlux([{ v: Number.NaN }, { v: 3 }], 'v'), 3);
  assert.equal(sommeFlux([{ v: Number.NaN }], 'v'), null);
});

test('une valeur non numerique est ignoree, pas concatenee', () => {
  // `'10' + 5` vaudrait '105' : une somme silencieusement fausse plutot qu'une erreur.
  assert.equal(sommeFlux([{ v: '10' as any }, { v: 5 }], 'v'), 5);
});

test('liste vide, nulle ou absente rend null', () => {
  assert.equal(sommeFlux([], 'v'), null);
  assert.equal(sommeFlux(null, 'v'), null);
  assert.equal(sommeFlux(undefined, 'v'), null);
});

test('les valeurs negatives sont sommees telles quelles', () => {
  // Les abonnes NETS peuvent etre negatifs : un compte qui perd des abonnes doit
  // afficher son solde, pas le voir disparaitre.
  assert.equal(sommeFlux([{ v: -3 }, { v: 1 }], 'v'), -2);
});

test('un total negatif ne se confond pas avec une absence', () => {
  assert.equal(rienDeCollecte([{ v: -5 }], 'v'), false);
});
