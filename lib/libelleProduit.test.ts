import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBELLES_PRODUIT, LIBELLE_PRODUIT_DEFAUT, estLibelleValide,
  produitDefini, produitSestArrete, produitSuitSonCours, produitArreteSansArticle,
  nomProduit, nomComplement,
} from './libelleProduit.ts';

/*
 * Ces phrases sont lues par l'élève au moment où il engage de l'argent, et deux
 * d'entre elles portent un ACCORD. Un accord faux ne casse rien, ne lève rien et
 * ne se voit que si quelqu'un choisit « Formation » — donc jamais pendant un test
 * manuel fait avec le libellé par défaut.
 */

test('chaque libellé de la liste a sa forme en phrase', () => {
  // La garde qui compte : ajouter une entrée à LIBELLES_PRODUIT sans l'ajouter à
  // la table des phrases ferait retomber ce libellé sur le défaut, en silence —
  // un consultant lirait « l'accompagnement » sur son écran de remboursement.
  for (const l of LIBELLES_PRODUIT) {
    const defini = produitDefini(l);
    assert.notEqual(defini, '', `${l} n'a pas de forme définie`);
    if (l !== LIBELLE_PRODUIT_DEFAUT) {
      assert.notEqual(
        defini, produitDefini(LIBELLE_PRODUIT_DEFAUT),
        `${l} retombe sur la forme du libellé par défaut — entrée manquante dans EN_PHRASE`,
      );
    }
  }
});

test('le participe s’accorde au genre du produit', () => {
  assert.equal(produitSestArrete('Accompagnement / Coaching'), 'L’accompagnement s’est arrêté');
  assert.equal(produitSestArrete('Formation'), 'La formation s’est arrêtée');
  assert.equal(produitSestArrete('Consulting'), 'Le consulting s’est arrêté');
  assert.equal(produitSestArrete('Prestation de service'), 'La prestation s’est arrêtée');
});

test('l’élision ne mange pas la première lettre à la mise en majuscule', () => {
  // Le piège de `capitaliser` : « l’accompagnement » commence par « l » et non
  // par « a ». Capitaliser après l'article donnerait « l’Accompagnement ».
  assert.equal(produitDefini('Accompagnement / Coaching'), 'l’accompagnement');
  assert.ok(produitSestArrete('Accompagnement / Coaching').startsWith('L’a'));
});

test('la forme sans article ne se déduit pas d’une regex sur l’article', () => {
  // « l’accompagnement » et « la formation » ne se découpent pas de la même
  // façon : un `replace(/^l./)` aurait rendu « ’accompagnement ».
  assert.equal(produitArreteSansArticle('Accompagnement / Coaching'), 'Accompagnement arrêté');
  assert.equal(produitArreteSansArticle('Formation'), 'Formation arrêtée');
  assert.equal(produitArreteSansArticle('Prestation de service'), 'Prestation arrêtée');
});

test('« suit son cours » se lit dans les quatre cas', () => {
  assert.equal(produitSuitSonCours('Formation'), 'la formation suit son cours');
  assert.equal(produitSuitSonCours('Consulting'), 'le consulting suit son cours');
});

test('un libellé inconnu retombe sur le défaut sans lever', () => {
  // La colonne peut porter n'importe quoi : modifiée à la main, ou libellé retiré
  // de la liste un jour. Un écran qui lève au rendu serait pire que le repli.
  for (const v of [null, undefined, '', 'Mentorat premium', 42 as unknown as string]) {
    assert.equal(produitDefini(v), 'l’accompagnement');
    assert.equal(produitSestArrete(v), 'L’accompagnement s’est arrêté');
  }
  assert.equal(estLibelleValide('Mentorat premium'), false);
  assert.equal(estLibelleValide('Formation'), true);
});

test('le nom envoyé à Stripe garde sa forme d’étiquette, pas de phrase', () => {
  // Les deux mondes ne doivent pas se mélanger : Stripe reçoit l'étiquette
  // complète, l'écran reçoit la phrase. Confondre les deux écrirait
  // « l'accompagnement — Marie » sur un relevé bancaire.
  assert.equal(nomProduit('Formation', 'Marie'), 'Formation — Marie');
  assert.equal(nomProduit('Formation', 'Marie', { rang: 2, total: 3 }), 'Formation — Marie — 2/3');
  assert.equal(nomProduit('Formation', 'Marie', { rang: 1, total: 1 }), 'Formation — Marie');
  assert.equal(nomComplement('Marie'), 'Complément — Marie');
});
