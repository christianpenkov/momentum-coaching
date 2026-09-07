import test from 'node:test';
import assert from 'node:assert/strict';
import { storiesARattacher, bornerArbitrage, type StoryLibre } from './rattachementStories.ts';

const s = (id: string, postedAt: string | null): StoryLibre => ({ id, postedAt });

const LUN = '2026-09-01T10:00:00.000Z';
const MAR = '2026-09-02T10:00:00.000Z';
const MER = '2026-09-03T10:00:00.000Z';
const JEU = '2026-09-04T10:00:00.000Z';

// ── Ce qui est encore proposé ────────────────────────────────────────────────

test('sans borne, tout est proposé', () => {
  // Une séquence préparée qui n'a jamais rien rattaché.
  const r = storiesARattacher([s('a', MAR), s('b', LUN)], null);
  assert.deepEqual(r.proposees.map(x => x.id), ['b', 'a'], 'et dans l’ordre de parution');
});

test('ce qui précède la borne ne revient plus', () => {
  const r = storiesARattacher([s('a', LUN), s('b', JEU)], MAR);
  assert.deepEqual(r.proposees.map(x => x.id), ['b']);
});

test('la story qui a servi de borne ne revient pas non plus', () => {
  // `>` et non `>=` : elle fait partie des arbitrées.
  assert.equal(storiesARattacher([s('a', MER)], MER).proposees.length, 0);
});

test('les croix retirent de la proposition sans quitter l’arbitrage', () => {
  // Les écartées doivent rester connues : ce sont elles qui portent la borne
  // quand le coach écarte la plus récente.
  const r = storiesARattacher([s('a', LUN), s('b', MAR)], null, new Set(['b']));
  assert.deepEqual(r.proposees.map(x => x.id), ['a']);
  assert.deepEqual(r.ecartees.map(x => x.id), ['b']);
});

test('une parution absente ou illisible reste proposée, borne ou pas', () => {
  // `posted_at` peut manquer sur une story fraîchement détectée. La traiter comme
  // une parution à l'époque zéro la ferait tomber sous n'importe quelle borne, et
  // disparaître définitivement de l'écran sans que rien ne le signale.
  //
  // Proposer à tort se rattrape d'un clic ; écarter à tort est sans retour.
  for (const parution of [null, undefined, 'pas une date']) {
    assert.equal(storiesARattacher([s('a', parution as any)], null).proposees.length, 1, `sans borne — ${parution}`);
    assert.equal(storiesARattacher([s('a', parution as any)], MER).proposees.length, 1, `avec borne — ${parution}`);
  }
});

test('une parution illisible ne contamine pas la borne', () => {
  // Le pendant du test précédent, côté écriture : `Date('pas une date')` donne
  // NaN, et un NaN dans un `Math.max` rend TOUTE la borne NaN — donc une date
  // invalide en base, donc plus aucune story écartée. Elles sont filtrées.
  assert.equal(bornerArbitrage([LUN, 'pas une date', MER], null), MER);
  assert.equal(bornerArbitrage(['pas une date'], null), null);
});

// ── La borne ────────────────────────────────────────────────────────────────

test('la borne est la parution la plus récente arbitrée', () => {
  assert.equal(bornerArbitrage([LUN, MER, MAR], null), MER);
});

test('écarter la story la plus récente la fait rester écartée', () => {
  // LE cas qui impose de passer les écartées au calcul. Le coach rattache lundi
  // et mardi, écarte mercredi. Borner sur les seules rattachées s'arrêterait à
  // mardi — et mercredi reviendrait au rechargement suivant, en boucle.
  const borne = bornerArbitrage([LUN, MAR, MER], null);
  assert.equal(storiesARattacher([s('mer', MER)], borne).proposees.length, 0);
});

test('une story publiée après l’arbitrage revient, elle', () => {
  const borne = bornerArbitrage([LUN, MAR], null);
  assert.deepEqual(storiesARattacher([s('jeu', JEU)], borne).proposees.map(x => x.id), ['jeu']);
});

test('la borne ne recule jamais', () => {
  // Un onglet resté ouvert rattache une vieille story après qu'un autre appareil
  // a tranché plus loin. Reculer rouvrirait des refus déjà prononcés.
  assert.equal(bornerArbitrage([LUN], MER), null, 'rien à écrire : la borne tient déjà');
  assert.equal(bornerArbitrage([MER], MER), null, 'égale ne bouge pas non plus');
  assert.equal(bornerArbitrage([JEU], MER), JEU);
});

test('rien d’arbitré ne remet pas la borne à zéro', () => {
  // `null` signifie « ne touche pas la colonne », jamais « efface-la ».
  assert.equal(bornerArbitrage([], MER), null);
  assert.equal(bornerArbitrage([null, undefined], MER), null);
});

// ── L’invariant qui a motivé tout ce fichier ────────────────────────────────

test('une story JAMAIS montrée n’est jamais écartée', () => {
  // Le défaut de la première version : la borne valait `now()` au moment du clic.
  // Une story publiée depuis le téléphone à 14 h 05, encore invisible à l'écran
  // parce que le cron ne l'a pas vue, était antérieure au clic de 14 h 30 — donc
  // écartée à vie, sans avoir jamais été proposée.
  //
  // Ici la borne est une PARUTION, jamais une heure de clic : ce que le coach
  // n'a pas pu voir est publié après ce qu'il a vu, donc revient.
  const vues = [LUN, MAR];
  const publieePendantQueLEcranEstOuvert = '2026-09-02T14:05:00.000Z';

  const borne = bornerArbitrage(vues, null);
  const r = storiesARattacher([s('invisible', publieePendantQueLEcranEstOuvert)], borne);
  assert.deepEqual(r.proposees.map(x => x.id), ['invisible']);
});

test('rattacher deux fois de suite ne redemande pas ce qui vient d’être fait', () => {
  // Le geste réel : le coach rattache, publie une story de plus, revient.
  const libres = [s('a', LUN), s('b', MAR)];
  const borne1 = bornerArbitrage(libres.map(x => x.postedAt), null);

  const apres = [s('c', MER)];
  assert.deepEqual(storiesARattacher(apres, borne1).proposees.map(x => x.id), ['c']);

  const borne2 = bornerArbitrage([MER], borne1);
  assert.equal(storiesARattacher(apres, borne2).proposees.length, 0);
});
