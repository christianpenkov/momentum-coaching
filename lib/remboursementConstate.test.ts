import test from 'node:test';
import assert from 'node:assert/strict';
import { remboursementConstate, resteARembourser, dejaRendu } from './remboursementConstate.ts';

// LE test de non-régression : la scène réelle du 2026-09-05 sur la vente RZK.
// Montant ramené de 500 à 300 €, rien remboursé. L'ancien calcul comparait
// l'encaissé au contracté et rendait 0 — l'écran affirmait « Remboursement
// constaté ». Ici l'encaissé n'a pas bougé, donc rien n'a été rendu.
test('rien remboursé : le montant a baissé, pas l’argent', () => {
  const e = { aRembourser: 200, netAuDepart: 500, netMaintenant: 500 };
  assert.equal(dejaRendu(e), 0);
  assert.equal(resteARembourser(e), 200);
  assert.equal(remboursementConstate(e), false,
    'un changement de montant n’est pas un remboursement');
});

test('remboursement partiel : le reste descend', () => {
  const e = { aRembourser: 200, netAuDepart: 500, netMaintenant: 420 };
  assert.equal(dejaRendu(e), 80);
  assert.equal(resteARembourser(e), 120);
  assert.equal(remboursementConstate(e), false);
});

test('remboursement complet : constaté', () => {
  const e = { aRembourser: 200, netAuDepart: 500, netMaintenant: 300 };
  assert.equal(dejaRendu(e), 200);
  assert.equal(remboursementConstate(e), true);
});

test('remboursé plus que demandé : constaté, et le reste ne devient pas négatif', () => {
  const e = { aRembourser: 200, netAuDepart: 500, netMaintenant: 250 };
  assert.equal(resteARembourser(e), 0);
  assert.equal(remboursementConstate(e), true);
});

// Annulation : tout l'encaissé part. Même formule, aucun cas particulier.
test('annulation : tout est à rendre, et rien ne l’est tant que rien n’est sorti', () => {
  const avant = { aRembourser: 500, netAuDepart: 500, netMaintenant: 500 };
  assert.equal(remboursementConstate(avant), false);
  const apres = { aRembourser: 500, netAuDepart: 500, netMaintenant: 0 };
  assert.equal(remboursementConstate(apres), true);
});

// Un paiement qui ARRIVE pendant l'attente ne doit pas compter comme un
// remboursement à l'envers, ni faire remonter la dette au-dessus du demandé.
test('un encaissement pendant l’attente ne fabrique pas de remboursement', () => {
  const e = { aRembourser: 200, netAuDepart: 500, netMaintenant: 700 };
  assert.equal(dejaRendu(e), 0);
  assert.equal(resteARembourser(e), 200);
  assert.equal(remboursementConstate(e), false);
});

test('les centimes d’arrondi ne bloquent pas la constatation', () => {
  const e = { aRembourser: 166.67, netAuDepart: 500, netMaintenant: 333.33 };
  assert.equal(remboursementConstate(e), true);
});
