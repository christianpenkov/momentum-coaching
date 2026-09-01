import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quantile, moyenne, valeursA, bornes, formaterAxe, construireGraphe,
  lisser, tronconner, SEUIL_COULEUR_PAR_DEFAUT, type SerieGraphe, type Point,
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

/* ═══ Lissage ═════════════════════════════════════════════════════════════
 *
 * Ces tests existent pour UNE raison : une spline naïve dessine des variations qui
 * n'ont pas eu lieu. Le graphe montre des abonnés à un coach ; inventer une baisse est
 * une faute de fond, pas un détail d'apparence.
 */

/** Les ordonnées de tous les points de contrôle, segment par segment.
 *
 * Une cubique de Bézier est contenue dans l'enveloppe convexe de ses quatre points de
 * contrôle : si les quatre restent entre deux valeurs, la courbe aussi. C'est ce qui
 * rend le dépassement vérifiable sans échantillonner la courbe. */
function segmentsBezier(d: string): number[][] {
  const nombres = (bloc: string) => bloc.trim().split(/[\s,]+/).map(Number);
  const depart = d.match(/^M([-\d.]+)\s+([-\d.]+)/);
  if (!depart) return [];
  let y = Number(depart[2]);
  const out: number[][] = [];
  for (const m of d.matchAll(/C([^MCLZ]+)/g)) {
    const v = nombres(m[1]);
    out.push([y, v[1], v[3], v[5]]);
    y = v[5];
  }
  return out;
}

test('une suite plate puis montante ne creuse JAMAIS sous son plancher', () => {
  // Le cas d'école qui piège Catmull-Rom : 100, 100, 150. En écran, l'ordonnée
  // DESCEND quand la valeur monte, donc « creuser sous 100 » se lit « dépasser y=100 ».
  const d = lisser([{ x: 0, y: 100 }, { x: 10, y: 100 }, { x: 20, y: 50 }]);
  for (const seg of segmentsBezier(d)) {
    for (const y of seg) {
      assert.ok(y <= 100.001, `un point de contrôle à ${y} fait creuser la courbe sous le plancher`);
      assert.ok(y >= 49.999, `un point de contrôle à ${y} fait dépasser la courbe au-dessus du sommet`);
    }
  }
});

test("aucun segment ne sort de l'intervalle de ses deux extrémités", () => {
  // Une dentelure sévère : c'est là qu'une spline non bornée part le plus loin.
  const pts: Point[] = [0, 90, 10, 80, 5, 95, 40].map((y, i) => ({ x: i * 10, y }));
  for (const seg of segmentsBezier(lisser(pts))) {
    const lo = Math.min(seg[0], seg[3]);
    const hi = Math.max(seg[0], seg[3]);
    for (const y of seg) {
      assert.ok(y >= lo - 0.001 && y <= hi + 0.001, `${y} sort de [${lo}, ${hi}]`);
    }
  }
});

test('une suite strictement croissante reste strictement croissante', () => {
  const pts: Point[] = [100, 90, 70, 40, 10].map((y, i) => ({ x: i * 10, y }));
  for (const seg of segmentsBezier(lisser(pts))) {
    for (let k = 1; k < seg.length; k++) {
      assert.ok(seg[k] <= seg[k - 1] + 0.001, 'la courbe doit rester monotone entre deux points');
    }
  }
});

test('deux points donnent un trait droit, un seul point ne trace rien de faux', () => {
  assert.equal(lisser([{ x: 0, y: 5 }, { x: 10, y: 15 }]), 'M0.0 5.0 L10.0 15.0');
  assert.equal(lisser([{ x: 3, y: 4 }]), 'M3.0 4.0');
  assert.equal(lisser([]), '');
});

test('un trou ouvre un tronçon, il ne relie pas deux dates éloignées', () => {
  const t = tronconner([1, 2, null, 4, 5], 0, i => i * 10, v => v);
  assert.equal(t.length, 2, 'le trou doit couper la série en deux');
  assert.deepEqual(t[0].map(p => p.x), [0, 10]);
  assert.deepEqual(t[1].map(p => p.x), [30, 40]);
});

test('le décalage place une série arrivée en cours de route au bon endroit', () => {
  const t = tronconner([7, 8], 3, i => i * 10, v => v);
  assert.deepEqual(t[0].map(p => p.x), [30, 40]);
});

test('une série entièrement vide ne produit aucun tronçon', () => {
  assert.deepEqual(tronconner([null, null], 0, i => i, v => v), []);
});

/* ═══ Vocabulaire visuel partagé avec Mes Stats ═══════════════════════════ */

test("le graphe n'emploie aucune couleur en dur là où un token existe", () => {
  const g = construireGraphe({
    series: [serie('a', [1, 5, 3])], n: 3, etiquettes: [], unite: '', largeur: 600,
  });
  assert.ok(g.svg.includes('var(--border)'), 'la grille doit suivre le token de bordure');
  assert.ok(g.svg.includes('var(--muted)'), "les graduations doivent suivre le token d'encre estompée");
});

test('deux graphes sur la même page ne partagent pas leur dégradé', () => {
  const base = { series: [serie('a', [1, 5, 3])], n: 3, etiquettes: [], unite: '' as const, largeur: 600 };
  const a = construireGraphe({ ...base, cle: 'un' });
  const b = construireGraphe({ ...base, cle: 'deux' });
  assert.ok(a.svg.includes('id="aplat-un"') && b.svg.includes('id="aplat-deux"'));
  assert.ok(!a.svg.includes('aplat-deux'), 'un identifiant partagé ferait écraser le premier dégradé');
});

test("la clé du dégradé est échappée — elle finit dans un attribut", () => {
  const g = construireGraphe({
    series: [serie('a', [1, 2])], n: 2, etiquettes: [], unite: '', largeur: 600,
    cle: '"><script>',
  });
  assert.ok(!g.svg.includes('<script>'));
});

test('une courbe seule reçoit le traitement complet de Mes Stats : aplat ET point terminal', () => {
  const g = construireGraphe({ series: [serie('a', [1, 5, 3])], n: 3, etiquettes: [], unite: '', largeur: 600, cle: 'z' });
  assert.ok(g.svg.includes('url(#aplat-z)'), "une courbe seule doit porter son aplat");
  assert.equal((g.svg.match(/graphe-point-vif/g) ?? []).length, 1);
});

test("au-delà d'une courbe, plus de point terminal — dix halos côte à côte feraient du bruit", () => {
  const g = construireGraphe({
    series: [serie('a', [1, 5, 3]), serie('b', [2, 3, 9])], n: 3, etiquettes: [], unite: '', largeur: 600,
  });
  assert.ok(!g.svg.includes('graphe-point-vif'));
});

test('le point terminal qui pulse ne paraît que sur la courbe mise en avant', () => {
  const base = { series: [serie('a', [1, 5, 3]), serie('b', [2, 3, 9])], n: 3, etiquettes: [], unite: '' as const, largeur: 600 };
  assert.ok(!construireGraphe(base).svg.includes('graphe-point-vif'), 'au repos, aucun point ne doit pulser');
  const g = construireGraphe({ ...base, vedette: 'a' });
  assert.equal((g.svg.match(/graphe-point-vif/g) ?? []).length, 1, 'un seul point vif à la fois');
});

/* Jeu de base des tests d'assemblage qui suivent. */
const BASE = { series: [serie('a', [1, 5, 3, 4])], n: 4, etiquettes: [], unite: '' as const, largeur: 600 };

/* ═══ Le raccord au-dessus d'un trou ══════════════════════════════════════ */

test('un trou est enjambé par un pointillé, et le trait plein reste coupé', () => {
  const g = construireGraphe({ ...BASE, series: [serie('a', [10, null, 30, 40])] });
  const pointilles = g.svg.match(/<path[^>]*stroke-dasharray="2 3"[^>]*>/g) ?? [];
  assert.equal(pointilles.length, 1, 'un seul raccord pour un seul trou');
  // Le trait plein doit toujours contenir deux `M` : le raccord ne le recolle pas.
  const chemins = g.svg.match(/ d="M[^"]*"/g) ?? [];
  assert.ok(chemins.some(d => (d.match(/M/g) ?? []).length === 2), 'le tracé reste en deux morceaux');
});

test('sans trou, aucun raccord', () => {
  const g = construireGraphe({ ...BASE, series: [serie('a', [10, 20, 30, 40])] });
  assert.ok(!g.svg.includes('stroke-dasharray="2 3"'));
});

test('deux trous donnent deux raccords, jamais un seul pont de bout en bout', () => {
  const g = construireGraphe({
    series: [serie('a', [10, null, 30, null, 50])], n: 5, etiquettes: [], unite: '', largeur: 600,
  });
  assert.equal((g.svg.match(/stroke-dasharray="2 3"/g) ?? []).length, 1, 'un seul élément…');
  const d = g.svg.match(/<path d="([^"]*)"[^>]*stroke-dasharray="2 3"/)?.[1] ?? '';
  assert.equal((d.match(/M/g) ?? []).length, 2, '…mais deux sous-chemins distincts');
});

test("le raccord est DROIT même si les courbes sont lissées", () => {
  // Une courbe demanderait au tracé d'inventer une forme pour un intervalle inconnu.
  const g = construireGraphe({ ...BASE, series: [serie('a', [10, null, 30, 40])] });
  const d = g.svg.match(/<path d="([^"]*)"[^>]*stroke-dasharray="2 3"/)?.[1] ?? '';
  assert.ok(d.length > 0);
  assert.ok(!d.includes('C'), 'le pont ne doit contenir aucune cubique');
});

test("l'aplat ne suit PAS le raccord — il ne remplit que sous des valeurs connues", () => {
  // Deux tronçons de DEUX points chacun : un tronçon d'un seul point n'a aucune surface
  // à remplir et n'entre pas dans l'aplat.
  const g = construireGraphe({
    series: [serie('a', [10, 20, null, 40, 50])], n: 5, etiquettes: [], unite: '', largeur: 600,
  });
  const aplat = g.svg.match(/<path d="([^"]*)" fill="url\(#aplat-[^)]*\)"/)?.[1] ?? '';
  assert.equal((aplat.match(/Z/g) ?? []).length, 2, 'un aplat par tronçon, pas un seul continu');
});

test('un jour mesuré isolé entre deux trous reste visible', () => {
  // Sans ça, la seule valeur connue de la fenêtre ne dessine RIEN — ni trait (il faut
  // deux points), ni aplat — et le graphe paraît vide alors qu'il ne l'est pas.
  const g = construireGraphe({
    series: [serie('a', [null, 42, null])], n: 3, etiquettes: [], unite: '', largeur: 600,
  });
  assert.ok((g.svg.match(/<circle/g) ?? []).length >= 1, 'le point isolé doit être marqué');
});

test('un trou sur une série en retrait est raccordé en gris, pas en couleur', () => {
  const g = construireGraphe({
    ...BASE, series: [serie('a', [10, null, 30, 40]), serie('b', [5, 6, 7, 8])], vedette: 'b',
  });
  const raccord = g.svg.match(/<path[^>]*stroke-dasharray="2 3"[^>]*>/)?.[0] ?? '';
  assert.ok(raccord.includes('#d7d1c3'), 'la série en retrait garde le gris jusque dans son raccord');
});
