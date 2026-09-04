import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBELLE_FORMAT, formatInstagram, laPlusRecente, formaterQuand,
} from './dernierePublication.ts';

// Lancé par `npm test`. Fonctions pures : ni React, ni réseau, ni base.

/* ═══ Le format d'un contenu Instagram ════════════════════════════════════ */

test('les valeurs réelles de la base sont classées correctement', () => {
  // Relevé le 2026-09-04 : `post_type` ne porte que ces deux valeurs.
  assert.equal(formatInstagram('REELS'), 'reel');
  assert.equal(formatInstagram('FEED'), 'post');
});

test("les anciens vocabulaires de l'API restent reconnus", () => {
  // L'API Meta a déjà changé de mots ; un contenu classé « post » à tort ferait
  // afficher un format faux, pas une absence — donc invisible.
  assert.equal(formatInstagram('REEL'), 'reel');
  assert.equal(formatInstagram('VIDEO'), 'reel');
  assert.equal(formatInstagram('reels'), 'reel', 'la casse ne doit pas décider');
  assert.equal(formatInstagram('IMAGE'), 'post');
  assert.equal(formatInstagram('CAROUSEL_ALBUM'), 'post');
});

test('un type inconnu ou absent retombe sur « post », jamais sur une erreur', () => {
  assert.equal(formatInstagram(null), 'post');
  assert.equal(formatInstagram(undefined), 'post');
  assert.equal(formatInstagram('QUELQUE_CHOSE_DE_NOUVEAU'), 'post');
});

test('les cinq formats ont un libellé lisible', () => {
  assert.deepEqual(Object.keys(LIBELLE_FORMAT).sort(), ['post', 'reel', 'short', 'story', 'video']);
  assert.equal(LIBELLE_FORMAT.short, 'Short YouTube');
});

/* ═══ Le plus récent ══════════════════════════════════════════════════════ */

test('le plus récent gagne, quelle que soit la plateforme', () => {
  // Le cas réel de Christian : une story récente masque un Instagram et un YouTube
  // endormis. C'est bien la story qui doit sortir.
  const r = laPlusRecente([
    { format: 'reel',  publieLe: '2026-02-23T10:00:00Z' },
    { format: 'short', publieLe: '2025-06-15T10:00:00Z' },
    { format: 'story', publieLe: '2026-08-22T10:00:00Z' },
  ]);
  assert.deepEqual(r, { format: 'story', publieLe: '2026-08-22T10:00:00Z' });
});

test('un contenu sans date est ÉCARTÉ, jamais daté au jugé', () => {
  // L'API Instagram se replie sur la date d'observation quand la publication n'a pas
  // de date. Prendre ce repli afficherait une date « exacte » qui est fausse.
  const r = laPlusRecente([
    { format: 'post',  publieLe: null },
    { format: 'video', publieLe: '2025-01-01T00:00:00Z' },
  ]);
  assert.equal(r?.format, 'video');
});

test('aucun candidat datable rend null — « rien publié » se dit autrement', () => {
  assert.equal(laPlusRecente([]), null);
  assert.equal(laPlusRecente([{ format: 'post', publieLe: null }]), null);
  assert.equal(laPlusRecente([{ format: 'post', publieLe: 'pas une date' }]), null);
});

test('à égalité de date, le premier candidat gagne — l’ordre ne saute pas', () => {
  const r = laPlusRecente([
    { format: 'reel', publieLe: '2026-08-22T10:00:00Z' },
    { format: 'post', publieLe: '2026-08-22T10:00:00Z' },
  ]);
  assert.equal(r?.format, 'reel');
});

/* ═══ La mise en forme ════════════════════════════════════════════════════ */

test('la date exacte ET l’écart, comme demandé', () => {
  assert.equal(formaterQuand('2026-08-22T10:00:00Z', '2026-09-04'), 'le 22/08/2026 · il y a 13 j');
  assert.equal(formaterQuand('2026-02-23T10:00:00Z', '2026-09-04'), 'le 23/02/2026 · il y a 193 j');
  assert.equal(formaterQuand('2025-06-15T10:00:00Z', '2026-09-04'), 'le 15/06/2025 · il y a 446 j');
});

test('aujourd’hui et hier se disent avec des mots, pas avec un nombre', () => {
  assert.equal(formaterQuand('2026-09-04T08:00:00Z', '2026-09-04'), "le 04/09/2026 · aujourd'hui");
  assert.equal(formaterQuand('2026-09-03T08:00:00Z', '2026-09-04'), 'le 03/09/2026 · hier');
});

test("l'écart se compte en jours CALENDAIRES, pas en heures divisées par 24", () => {
  // Une publication de 23 h hier et une de 1 h aujourd'hui sont séparées de 2 heures,
  // mais l'une est « hier » et l'autre « aujourd'hui ». Diviser des millisecondes
  // ferait dépendre le libellé de l'heure à laquelle on ouvre la page.
  assert.equal(formaterQuand('2026-09-03T21:30:00Z', '2026-09-04'), 'le 03/09/2026 · hier');
  assert.equal(formaterQuand('2026-09-03T23:30:00Z', '2026-09-04'), "le 04/09/2026 · aujourd'hui",
    '23h30 UTC un 3 septembre, c’est déjà le 4 à Paris');
});

test('une date illisible ne produit aucun libellé plutôt qu’un faux', () => {
  assert.equal(formaterQuand('n’importe quoi', '2026-09-04'), null);
});
