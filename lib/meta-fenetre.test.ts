import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fenetreMesurable, ecartEnJours,
  META_RETENTION_JOURS, META_RETENTION_MARGE_JOURS,
} from './meta-fenetre.ts';

// Ces tests figent une MESURE, pas une intuition. Chaque cas correspond à un appel
// réellement passé à l'API Instagram le 2026-09-07. Si l'un devient gênant, c'est que
// le comportement de Meta a changé : le rejouer contre l'API avant de le modifier.

const AUJ = '2026-09-07';
const jour = 86400000;
const ilYA = (n: number) => new Date(Date.parse(`${AUJ}T00:00:00Z`) - n * jour).toISOString().slice(0, 10);

test('la rétention est une borne franche, mesurée jour par jour', () => {
  // Mesuré : J-726 à J-729 acceptés, J-730 à J-732 refusés (HTTP 400, code 100,
  // « Metrics data is available for the last 2 years »).
  assert.deepEqual(fenetreMesurable(ilYA(META_RETENTION_MARGE_JOURS), AUJ), { mesurable: true });

  const trop = fenetreMesurable(ilYA(META_RETENTION_MARGE_JOURS + 1), AUJ);
  assert.equal(trop.mesurable, false);
  assert.equal(trop.mesurable === false && trop.raison, 'anterieure_a_la_retention');
});

test('la marge reste EN DEÇÀ de ce que l\'API accepte, jamais au-delà', () => {
  // Une marge plus large que la borne mesurée ferait demander une fenêtre que Meta
  // refuse — exactement la boucle de relance qu'on ferme.
  assert.ok(META_RETENTION_MARGE_JOURS < META_RETENTION_JOURS);
});

test('les fenêtres du quotidien sont toutes acceptables', () => {
  // Les quatre formes que le cron produit réellement : jour isolé, semaine, mois,
  // et l'historique complet plafonné à 12 mois.
  assert.deepEqual(fenetreMesurable(ilYA(1), AUJ), { mesurable: true });
  assert.deepEqual(fenetreMesurable(ilYA(7), AUJ), { mesurable: true });
  assert.deepEqual(fenetreMesurable(ilYA(31), AUJ), { mesurable: true });
  assert.deepEqual(fenetreMesurable(ilYA(366), AUJ), { mesurable: true });
});

test('⚠️ une fenêtre qui commence AUJOURD\'HUI reste acceptable', () => {
  // Le test qui verrouille la correction d'une erreur de raisonnement.
  //
  // Une première mesure du matin (trois comptes, [auj → auj] rendant un jeu vide)
  // avait fait conclure « une fenêtre sans journée terminée ne rend rien ». Le même
  // appel, quelques heures plus tard, rend `valeur = 0` : c'est l'heure qui décide,
  // pas la composition de la fenêtre.
  //
  // Refuser d'appeler ici retarderait d'un jour entier la mesure de la semaine en
  // cours, chaque lundi, pour un appel qui aboutit dans la journée.
  assert.deepEqual(fenetreMesurable(AUJ, AUJ), { mesurable: true });
});

test('une date illisible ne passe jamais pour acceptable', () => {
  // Sans la garde `Number.isFinite`, `ecartEnJours` rendrait NaN et `NaN > 728` étant
  // faux, la fenêtre serait déclarée acceptable — une panne silencieuse.
  assert.equal(fenetreMesurable('pas-une-date', AUJ).mesurable, false);
  assert.equal(fenetreMesurable('', AUJ).mesurable, false);
});

test('ecartEnJours compte des jours entiers, sans dérive', () => {
  assert.equal(ecartEnJours('2026-09-06', '2026-09-07'), 1);
  assert.equal(ecartEnJours('2026-09-07', '2026-09-07'), 0);
  // Traverse un changement d'heure (dernier dimanche d'octobre) : les dates sont
  // traitées en UTC de bout en bout, donc aucun jour ne se perd ni ne se dédouble.
  assert.equal(ecartEnJours('2026-10-24', '2026-11-01'), 8);
  assert.equal(ecartEnJours('2025-09-07', '2026-09-07'), 365);
});
