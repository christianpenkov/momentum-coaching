import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dureeDepuisSecondes, dureeDepuisMinutes, positionLecteur, formaterDureeVideo } from './duree.ts';

// Lancé par `npm test` (node --test, sans aucune dépendance à installer).
// Fonctions pures : ni React, ni réseau, ni base.

test('secondes — chaque palier garde son unité', () => {
  assert.equal(dureeDepuisSecondes(0), '0s');
  assert.equal(dureeDepuisSecondes(45), '45s');
  assert.equal(dureeDepuisSecondes(60), '1m00s');
  assert.equal(dureeDepuisSecondes(90), '1m30s');
  assert.equal(dureeDepuisSecondes(240), '4 min');
  assert.equal(dureeDepuisSecondes(3600), '1h');
  assert.equal(dureeDepuisSecondes(5400), '1,5h', 'virgule française, pas de point');
  assert.equal(dureeDepuisSecondes(43200), '12h', 'au-delà de 10h, heures entières');
});

test('minutes — même règle que les secondes', () => {
  assert.equal(dureeDepuisMinutes(0), '0s');
  assert.equal(dureeDepuisMinutes(0.5), '30s');
  assert.equal(dureeDepuisMinutes(1), '1m00s');
  assert.equal(dureeDepuisMinutes(16), '16 min');
  assert.equal(dureeDepuisMinutes(90), '1,5h');
});

// Le bug d'origine : un axe gradué « 1 min, 1 min, 1 min, 0 min, 0 min » parce que
// des valeurs distinctes tombaient sur le même libellé.
test('deux valeurs distinctes ne partagent jamais un libellé', () => {
  const graduations = [
    [0, 0.25, 0.5, 0.75, 1],   // plage serrée, l'ancien cas cassé
    [0, 4, 8, 12, 16],          // plage réelle de la chaîne
    [0, 30, 60, 90, 120],       // plage large
  ];
  for (const serie of graduations) {
    const libelles = serie.map(dureeDepuisMinutes);
    assert.equal(
      new Set(libelles).size,
      libelles.length,
      `doublon dans [${libelles.join(', ')}]`,
    );
  }
});

test('position lecteur — format vidéo, distinct d’une durée écoulée', () => {
  assert.equal(positionLecteur(0), '0:00');
  assert.equal(positionLecteur(225), '3:45');
  assert.equal(positionLecteur(60), '1:00');
  assert.equal(positionLecteur(3600), '60:00');
});

test('position lecteur — pas de « 3:60 » par arrondi', () => {
  assert.equal(positionLecteur(239.6), '4:00');
});

test('valeurs aberrantes ne cassent pas l’affichage', () => {
  assert.equal(dureeDepuisSecondes(NaN), '—');
  assert.equal(dureeDepuisMinutes(NaN), '—');
  assert.equal(positionLecteur(NaN), '—');
  assert.equal(dureeDepuisSecondes(-5), '0s', 'jamais de durée négative affichée');
});

// Durée totale d'une vidéo — doit reproduire à l'identique le rendu du mode direct
// (parseDuration dans app/api/youtube/stats/route.ts), sinon la même vidéo change de
// format entre la période courante et une période passée.
test('durée vidéo — même rendu que le mode direct', () => {
  assert.equal(formaterDureeVideo(45), '0:45');
  assert.equal(formaterDureeVideo(90), '1:30');
  assert.equal(formaterDureeVideo(225), '3:45');
  assert.equal(formaterDureeVideo(3930), '1:05:30', 'au-delà d’une heure, trois segments');
  assert.equal(formaterDureeVideo(3600), '1:00:00');
  assert.equal(formaterDureeVideo(3599), '59:59', 'juste sous l’heure, deux segments');
});

test('durée vidéo — absence plutôt qu’une valeur fausse', () => {
  assert.equal(formaterDureeVideo(NaN), '', 'chaîne vide : le tableau affiche une case vide');
  assert.equal(formaterDureeVideo(-1), '');
  assert.equal(formaterDureeVideo(0), '0:00', 'zéro est une durée légitime, pas une absence');
});
