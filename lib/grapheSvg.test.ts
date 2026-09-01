import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quantile, moyenne, valeursA, bornes, formaterAxe, construireGraphe,
  SEUIL_COULEUR_PAR_DEFAUT, type SerieGraphe,
} from './grapheSvg.ts';

// Lancé par `npm test`. La géométrie du graphe est pure : ni React, ni DOM.

const serie = (nom: string, valeurs: (number | null)[], decalage = 0): SerieGraphe =>
  ({ nom, court: nom, couleur: '#000', valeurs, decalage });

/* ═══ Statistiques ════════════════════════════════════════════════════════ */

test('quantile aux bornes et au milieu', () => {
  const t = [1, 2, 3, 4];
  assert.equal(quantile(t, 0), 1);
  assert.equal(quantile(t, 1), 4);
  assert.equal(quantile(t, 0.5), 2.5);
});

test('quantile ne mute pas le tableau reçu', () => {
  const t = [3, 1, 2];
  quantile(t, 0.5);
  assert.deepEqual(t, [3, 1, 2]);
});

test('quantile et moyenne sur du vide rendent 0 plutôt que NaN', () => {
  assert.equal(quantile([], 0.5), 0);
  assert.equal(moyenne([]), 0);
});

test('la moyenne est tirée par les extrêmes, la médiane non — la raison du choix', () => {
  const t = [10, 10, 10, 10, 1000];
  assert.equal(moyenne(t), 208);
  assert.equal(quantile(t, 0.5), 10);
});

/* ═══ Lecture d'une abscisse ══════════════════════════════════════════════ */

test("les trous et les séries pas encore commencées ne tirent pas la moyenne", () => {
  const s = [
    serie('a', [10, 20, 30]),
    serie('b', [null, 40, 50]),
    serie('c', [100], 2), // n'existe qu'au dernier point
  ];
  assert.deepEqual(valeursA(s, 0), [10]);
  assert.deepEqual(valeursA(s, 1), [20, 40]);
  assert.deepEqual(valeursA(s, 2), [30, 50, 100]);
});

test('une abscisse hors de toute série rend une liste vide', () => {
  assert.deepEqual(valeursA([serie('a', [1, 2])], 9), []);
});

/* ═══ Échelle ═════════════════════════════════════════════════════════════ */

test('les bornes couvrent toutes les séries, avec une marge en haut', () => {
  const { min, max } = bornes([serie('a', [10, 90])], false);
  assert.equal(min, 10);
  assert.ok(max > 90, 'le maximum doit respirer');
});

test('depuisZero abaisse le plancher à 0, mais ne remonte pas un minimum négatif', () => {
  assert.equal(bornes([serie('a', [50, 90])], true).min, 0);
  assert.ok(bornes([serie('a', [-30, 90])], true).min < -30, 'un négatif garde sa marge');
});

test('une série parfaitement plate ouvre quand même une fenêtre', () => {
  // Sans ça, la courbe est collée sur un bord et l'axe affiche cinq fois la même valeur.
  const { min, max } = bornes([serie('a', [255, 255, 255])], false);
  assert.ok(max > min, 'la fenêtre ne doit pas être de hauteur nulle');
});

test('aucune valeur connue : une échelle par défaut, jamais NaN', () => {
  assert.deepEqual(bornes([serie('a', [null, null])], false), { min: 0, max: 1 });
  assert.deepEqual(bornes([], false), { min: 0, max: 1 });
});

/* ═══ Format de l'axe ═════════════════════════════════════════════════════ */

test("l'axe abrège les milliers et porte l'unité", () => {
  assert.equal(formaterAxe(255, ''), '255');
  assert.equal(formaterAxe(1500, ''), '1,5k');
  assert.equal(formaterAxe(42000, ''), '42k');
  assert.equal(formaterAxe(1500, '€'), '2k€');
  assert.equal(formaterAxe(250, '€'), '250€');
  assert.equal(formaterAxe(-12, '%'), '-12%');
});

/* ═══ Le mode dense ═══════════════════════════════════════════════════════ */

const beaucoup = (n: number) =>
  Array.from({ length: n }, (_, i) => serie('e' + i, [10 + i, 20 + i, 30 + i, 40 + i]));

test('au repos, au-delà du seuil, le graphe passe en moyenne + bande', () => {
  const g = construireGraphe({
    series: beaucoup(SEUIL_COULEUR_PAR_DEFAUT + 1), n: 4, etiquettes: [], unite: '', largeur: 900,
  });
  assert.equal(g.dense, true);
  assert.ok(g.svg.includes('moyenne'), 'la ligne de moyenne doit être étiquetée');
});

test('au seuil exact, on reste en couleur', () => {
  const g = construireGraphe({
    series: beaucoup(SEUIL_COULEUR_PAR_DEFAUT), n: 4, etiquettes: [], unite: '', largeur: 900,
  });
  assert.equal(g.dense, false);
});

test('dès qu\'un élève est mis en avant, le mode dense s\'efface', () => {
  // Les autres passent en gris de toute façon : la bande n'apporterait plus rien et
  // masquerait la courbe qu'on vient de demander.
  const g = construireGraphe({
    series: beaucoup(30), n: 4, etiquettes: [], unite: '', largeur: 900, vedette: 'e3',
  });
  assert.equal(g.dense, false);
});

/* ═══ Assemblage ══════════════════════════════════════════════════════════ */

test('un trou coupe le trait au lieu d\'être relié', () => {
  // Relier deux points de part et d'autre d'un jour manquant dessinerait une pente qui
  // n'a pas eu lieu. Deux `M` dans le chemin = deux segments distincts.
  const g = construireGraphe({
    series: [serie('a', [10, null, 30])], n: 3, etiquettes: [], unite: '', largeur: 900,
  });
  const chemins = g.svg.match(/ d="M[^"]*"/g) ?? [];
  const celuiDeLaSerie = chemins.find(d => (d.match(/M/g) ?? []).length === 2);
  assert.ok(celuiDeLaSerie, 'le chemin doit contenir deux commandes M');
});

test("l'abscisse s'étale sur toute la largeur utile", () => {
  const g = construireGraphe({ series: [serie('a', [1, 2, 3])], n: 3, etiquettes: [], unite: '', largeur: 900 });
  assert.ok(g.xDe(0) < g.xDe(1) && g.xDe(1) < g.xDe(2));
  assert.ok(g.xDe(2) <= 900);
});

test('un seul point se place au milieu plutôt que de diviser par zéro', () => {
  const g = construireGraphe({ series: [serie('a', [42])], n: 1, etiquettes: [], unite: '', largeur: 900 });
  assert.ok(Number.isFinite(g.xDe(0)));
});

test('le nom de la série en avant est échappé — pas d\'injection par un nom d\'élève', () => {
  const g = construireGraphe({
    series: [{ nom: 'x', court: '<script>alert(1)</script>', couleur: '#000', valeurs: [1, 2] }],
    n: 2, etiquettes: [], unite: '', largeur: 900, vedette: 'x',
  });
  assert.ok(!g.svg.includes('<script>'), 'le SVG est injecté en innerHTML : tout texte doit être échappé');
  assert.ok(g.svg.includes('&lt;script&gt;'));
});

test('les étiquettes de l\'axe sont échappées aussi', () => {
  const g = construireGraphe({
    series: [serie('a', [1, 2])], n: 2, etiquettes: [{ i: 0, t: '<b>' }], unite: '', largeur: 900,
  });
  assert.ok(!g.svg.includes('<b>'));
});
