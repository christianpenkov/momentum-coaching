import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estUnShort,
  verdictConnu,
  dureeIsoEnSecondes,
  parametresClassification,
  DUREE_MAX_SHORT_SEC,
  MAX_RESULTS_CLASSIFICATION,
  AUCUN_VERDICT,
  type VerdictFormats,
} from './youtubeShorts.ts';

// Lancé par `npm test`. Fonction pure : ni réseau, ni base.

const verdict = (shorts: string[], longues: string[]): VerdictFormats => ({
  shorts: new Set(shorts),
  longues: new Set(longues),
});

// ── L'API l'emporte toujours sur la durée ──────────────────────────────────

test("un Short de 2 min est un Short, quoi qu'en dise la durée", () => {
  // Cas RÉEL mesuré le 2026-09-06 : uzbDb_yehI8, 145 s, classé « vidéo longue »
  // par l'ancien seuil de 60 s alors que l'API dit « shorts ».
  assert.equal(estUnShort('uzbDb_yehI8', 145, verdict(['uzbDb_yehI8'], [])), true);
});

test("une vidéo courte n'est PAS un Short si l'API dit le contraire", () => {
  // C'est ce cas qui interdit de se contenter d'un seuil corrigé : rien
  // n'empêche de publier une vidéo classique de deux minutes. Mesuré 3 fois
  // sur 32 avec un seuil à 180 s.
  assert.equal(estUnShort('v1', 90, verdict([], ['v1'])), false);
});

test("le verdict de l'API prime même sur une durée absurde", () => {
  assert.equal(estUnShort('v1', 3600, verdict(['v1'], [])), true);
  assert.equal(estUnShort('v1', 1, verdict([], ['v1'])), false);
});

// ── Le repli sur la durée, et ses bornes ───────────────────────────────────

test('sans verdict, on retombe sur la durée avec le seuil de YouTube', () => {
  assert.equal(DUREE_MAX_SHORT_SEC, 180, 'YouTube autorise 3 min depuis fin 2024');
  assert.equal(estUnShort('inconnu', 179, AUCUN_VERDICT), true);
  assert.equal(estUnShort('inconnu', 180, AUCUN_VERDICT), true, 'la borne est incluse');
  assert.equal(estUnShort('inconnu', 181, AUCUN_VERDICT), false);
});

test('60 s pile : plus de contradiction entre les deux chemins', () => {
  // LE bug d'origine. « PT1M » : la regex du cron exigeait une terminaison en
  // « S » et répondait « longue » ; la route en direct calculait 60 et répondait
  // « Short ». La même vidéo changeait d'étiquette selon la période consultée.
  // Il n'y a plus qu'un seul calcul, donc plus qu'une seule réponse.
  assert.equal(dureeIsoEnSecondes('PT1M'), 60);
  assert.equal(estUnShort('v', dureeIsoEnSecondes('PT1M'), AUCUN_VERDICT), true);
  assert.equal(estUnShort('v', dureeIsoEnSecondes('PT60S'), AUCUN_VERDICT), true);
});

test('durée inconnue : on répond « pas un Short »', () => {
  // Le choix le moins dommageable : l'inverse gonflerait les statistiques
  // Shorts d'une chaîne qui n'en publie pas.
  assert.equal(estUnShort('v', null, AUCUN_VERDICT), false);
  assert.equal(estUnShort('v', undefined, AUCUN_VERDICT), false);
});

test('le verdict par défaut est vide, pas absent', () => {
  // Appelé sans troisième argument, la fonction ne doit pas lever.
  assert.equal(estUnShort('v', 30), true);
  assert.equal(estUnShort('v', 300), false);
});

test('on sait distinguer un verdict d’un repli', () => {
  const v = verdict(['a'], ['b']);
  assert.equal(verdictConnu('a', v), true);
  assert.equal(verdictConnu('b', v), true);
  assert.equal(verdictConnu('c', v), false, 'une vidéo sans vue n’a pas de verdict');
});

// ── La durée ISO 8601 ──────────────────────────────────────────────────────

test('les formes réelles renvoyées par YouTube', () => {
  assert.equal(dureeIsoEnSecondes('PT45S'), 45);
  assert.equal(dureeIsoEnSecondes('PT1M30S'), 90);
  assert.equal(dureeIsoEnSecondes('PT2M'), 120);
  assert.equal(dureeIsoEnSecondes('PT1H2M3S'), 3723);
  assert.equal(dureeIsoEnSecondes('PT1H'), 3600);
});

test('les formes dégénérées ne rendent pas 0 mais null', () => {
  // « P0D » est ce que rend un direct PROGRAMMÉ. Le confondre avec 0 seconde en
  // ferait un Short.
  assert.equal(dureeIsoEnSecondes('P0D'), null);
  assert.equal(dureeIsoEnSecondes(''), null);
  assert.equal(dureeIsoEnSecondes(null), null);
  assert.equal(dureeIsoEnSecondes('n’importe quoi'), null);
  assert.equal(estUnShort('direct', dureeIsoEnSecondes('P0D'), AUCUN_VERDICT), false);
});

// ── La requête, identique des deux côtés ───────────────────────────────────

test('la casse du filtre est en minuscules — l’API refuse les majuscules', () => {
  // Vérifié contre l'API : `SHORTS` rend 400 « Invalid value ».
  const p = parametresClassification('shorts', '2026-01-01', '2026-09-06');
  assert.equal(p.get('filters'), 'creatorContentType==shorts');
});

test('maxResults reste sous le plafond accepté', () => {
  // Vérifié contre l'API : 500 rend 400 « query is not supported », 200 passe.
  assert.equal(MAX_RESULTS_CLASSIFICATION, 200);
  assert.equal(parametresClassification('shorts', '2026-01-01', '2026-09-06').get('maxResults'), '200');
});

test('la requête porte bien la dimension vidéo, seule', () => {
  // `dimensions=video,creatorContentType` est refusé par l'API : il faut deux
  // requêtes filtrées, une par format.
  const p = parametresClassification('videoOnDemand', '2026-01-01', '2026-09-06');
  assert.equal(p.get('dimensions'), 'video');
  assert.equal(p.get('startDate'), '2026-01-01');
  assert.equal(p.get('endDate'), '2026-09-06');
});
