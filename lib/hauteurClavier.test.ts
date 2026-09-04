import test from 'node:test';
import assert from 'node:assert/strict';
import { hauteurClavier, SEUIL_CLAVIER } from './hauteurClavier.ts';

// Les trois moments d'un seul tap sur un champ, sur iPhone. Le viewport de mise
// en page ne bouge pas (745 px) ; seuls la hauteur visible et le décalage
// changent. C'est la séquence qui a produit le symptôme du 2026-09-04 :
// « ça flash en plein écran et revient comme avant, et quand je scroll vers le
// haut, là ça le fait en plein écran ».
const INNER = 745;
const VISIBLE_AVEC_CLAVIER = 409; // clavier + barre « Préremplir le contact »

test('1. le clavier s’ouvre : la zone visible rétrécit, rien n’est encore décalé', () => {
  const h = hauteurClavier({ innerHeight: INNER, hauteurVisible: VISIBLE_AVEC_CLAVIER, decalage: 0 });
  assert.equal(h, 336);
});

test('2. iOS décale la vue sur le champ : la hauteur du clavier NE bouge PAS', () => {
  // Le moment qui faisait retomber la feuille. L'ancien calcul retranchait le
  // décalage et tombait à 86 px, sous le seuil, donc à zéro : la feuille sortait
  // du plein écran alors que le clavier n'avait pas bougé d'un pixel.
  const h = hauteurClavier({ innerHeight: INNER, hauteurVisible: VISIBLE_AVEC_CLAVIER, decalage: 250 });
  assert.equal(h, 336, 'le décalage du viewport ne doit rien retrancher à la hauteur du clavier');
  assert.ok(h > SEUIL_CLAVIER, 'la feuille doit RESTER en plein écran pendant que iOS décale la vue');
});

test('3. on remonte le défilement : le décalage repart à zéro, toujours le même clavier', () => {
  const h = hauteurClavier({ innerHeight: INNER, hauteurVisible: VISIBLE_AVEC_CLAVIER, decalage: 0 });
  assert.equal(h, 336);
});

test('les trois moments donnent la même hauteur — c’est tout l’enjeu', () => {
  const mesures = [0, 120, 250, 310].map(decalage =>
    hauteurClavier({ innerHeight: INNER, hauteurVisible: VISIBLE_AVEC_CLAVIER, decalage })
  );
  assert.deepEqual(mesures, [336, 336, 336, 336]);
});

test('clavier fermé : zéro, quel que soit le décalage', () => {
  assert.equal(hauteurClavier({ innerHeight: INNER, hauteurVisible: INNER, decalage: 0 }), 0);
  assert.equal(hauteurClavier({ innerHeight: INNER, hauteurVisible: INNER, decalage: 40 }), 0);
});

test('la barre d’URL qui se rétracte ne passe pas pour un clavier', () => {
  // ~60 px d'écart au défilement : sous le seuil, sinon la feuille sautillerait.
  assert.equal(hauteurClavier({ innerHeight: INNER, hauteurVisible: INNER - 60, decalage: 0 }), 0);
});
