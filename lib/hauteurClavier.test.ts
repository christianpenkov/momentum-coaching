import test from 'node:test';
import assert from 'node:assert/strict';
import { hauteurClavier, SEUIL_BRUIT } from './hauteurClavier.ts';

// Les valeurs sont celles relevées sur l'iPhone de Chris le 2026-09-04, par
// l'instrument posé dans la modale — pas des valeurs plausibles.
//
//     15 ms   iH797  vvH797  → clavier ferme
//   3482 ms   iH394  vvH394  → iOS ecrase innerHeight PENDANT l'animation
//   3498 ms   iH797  vvH394  → il le restaure, sans declencher d'evenement
const PLEIN = 797;
const VISIBLE_AVEC_CLAVIER = 394;

test('clavier ferme : zero', () => {
  assert.equal(hauteurClavier({ plein: PLEIN, hauteurVisible: PLEIN, ouvert: false }), 0);
});

test('clavier ouvert : ce qui manque a la hauteur pleine', () => {
  assert.equal(hauteurClavier({ plein: PLEIN, hauteurVisible: VISIBLE_AVEC_CLAVIER, ouvert: true }), 403);
});

// LE test de non-regression. L'ancien calcul faisait `innerHeight - vv.height`.
// A 3482 ms les deux valaient 394 : il rendait 0, la feuille sortait du plein
// ecran, et comme la restauration d'innerHeight n'emet aucun evenement il n'y
// avait plus jamais de nouvelle mesure. Ici `plein` est etalonne clavier FERME,
// donc l'ecrasement momentane d'innerHeight ne peut plus rien fausser.
test('l’écrasement momentané d’innerHeight par iOS ne fait plus retomber la feuille', () => {
  const pendantAnimation = hauteurClavier({ plein: PLEIN, hauteurVisible: VISIBLE_AVEC_CLAVIER, ouvert: true });
  const apresAnimation = hauteurClavier({ plein: PLEIN, hauteurVisible: VISIBLE_AVEC_CLAVIER, ouvert: true });
  assert.equal(pendantAnimation, 403);
  assert.equal(apresAnimation, 403);
  assert.equal(pendantAnimation, apresAnimation, 'la hauteur ne doit pas dependre de innerHeight');
});

test('passer d’un champ à l’autre garde le clavier ouvert', () => {
  // Aucune hauteur ne change à ce moment-là : un calcul fondé sur les pixels
  // seuls ne verrait rien. Le focus, lui, répond.
  assert.equal(hauteurClavier({ plein: PLEIN, hauteurVisible: VISIBLE_AVEC_CLAVIER, ouvert: true }), 403);
});

test('un champ focalisé sans clavier (clavier externe) ne fait pas de fausse hauteur', () => {
  assert.equal(hauteurClavier({ plein: PLEIN, hauteurVisible: PLEIN, ouvert: true }), 0);
});

test('la barre d’URL qui se rétracte ne passe pas pour un clavier', () => {
  assert.equal(hauteurClavier({ plein: PLEIN, hauteurVisible: PLEIN - SEUIL_BRUIT, ouvert: true }), 0);
});

test('le calcul ne suppose aucune taille d’écran', () => {
  // Un petit téléphone : mêmes proportions, même résultat, sans nombre en dur.
  assert.equal(hauteurClavier({ plein: 560, hauteurVisible: 280, ouvert: true }), 280);
  // Une tablette.
  assert.equal(hauteurClavier({ plein: 1180, hauteurVisible: 800, ouvert: true }), 380);
});
