/* Construction du graphe de Stats Clients, en SVG assemblé à la main.
 *
 * ⚠️ EXCEPTION ASSUMÉE : le reste de l'app trace ses courbes avec Recharts
 * (components/charts/). Cette page ne le fait pas, pour une raison mesurable — au repos
 * elle trace jusqu'à 39 séries (37 élèves en gris, la moyenne, la bande interquartile),
 * et le survol d'une ligne du tableau redessine le graphe. En Recharts, chaque survol
 * déclenche une réconciliation React sur 39 composants ; ici c'est une seule écriture
 * de chaîne, injectée en un `innerHTML`.
 *
 * NE PAS GÉNÉRALISER : toute page à moins d'une dizaine de séries continue d'utiliser
 * Recharts. L'exception se justifie par le nombre, pas par le goût.
 *
 * ⚠️ L'exception porte sur le MOTEUR, jamais sur l'APPARENCE. Un graphe qui ne
 * ressemble pas aux graphes de Mes Stats est un défaut, pas une signature : deux
 * vocabulaires visuels pour la même chose dans la même app, c'est l'un des deux qui a
 * tort. Ce fichier reproduit donc à la main ce que `components/charts/AreaChart.tsx`
 * obtient de Recharts — courbe lissée monotone, aplat dégradé, grille pointillée
 * horizontale seule, axes sans trait, point terminal qui pulse.
 *
 * Tout est PUR : ces fonctions ne connaissent ni React ni le DOM, et sont testées.
 */

export interface SerieGraphe {
  /** Identifiant stable, celui qu'on met en avant. */
  nom: string;
  /** Ce qui s'écrit à côté du point terminal quand la série est en avant. */
  court: string;
  couleur: string;
  valeurs: (number | null)[];
  /** Décalage à droite : une série plus courte que l'axe commence plus tard.
   *  Un élève arrivé récemment n'existait pas au début de la fenêtre. */
  decalage?: number;
}

export interface OptionsGraphe {
  series: SerieGraphe[];
  /** Nombre de points de l'axe des abscisses. */
  n: number;
  etiquettes: { i: number; t: string }[];
  unite: '' | '€' | '%';
  /** Série mise en avant, ou null. */
  vedette?: string | null;
  /** Force l'axe des ordonnées à inclure zéro. */
  depuisZero?: boolean;
  largeur: number;
  hauteur?: number;
  /** Au-delà de ce nombre de séries, le repos passe en moyenne + bande.
   *  Tranché à 10 : la maquette d'origine en montrait 6, et « toutes en couleur » ne
   *  tient pas au-delà d'une dizaine. */
  seuilCouleur?: number;
  /** Marque d'un point les séries trop courtes pour dessiner une ligne visible. */
  pointsCourts?: boolean;
  /** Suffixe des identifiants internes (dégradés). Deux graphes sur la même page ne
   *  doivent pas partager un `<linearGradient id>` : le second écraserait le premier. */
  cle?: string;
}

export const SEUIL_COULEUR_PAR_DEFAUT = 10;

/* Les couleurs sont des VARIABLES CSS, pas des hexadécimaux recopiés.
 *
 * Le SVG est injecté dans le document par `innerHTML` : la cascade s'y applique comme
 * partout ailleurs, donc `var(--border)` y est résolu normalement. Les recopier en dur
 * créait un second jeu de couleurs qui ne suivait aucun changement de thème — et elles
 * avaient déjà commencé à diverger (`AXE` et `GRIS` n'existent dans aucun token). */
const GRILLE = 'var(--border)';
const ENCRE_ESTOMPEE = 'var(--muted)';
const FOND = 'var(--surface)';
/** Le gris des séries en retrait. Volontairement plus clair que `--border` : ces
 *  courbes sont un contexte, elles ne doivent pas concurrencer la grille. */
const GRIS = '#d7d1c3';
/** La moyenne et la bande. Neutre chaud, pour ne pas se confondre avec la couleur
 *  d'un élève en particulier. */
const TAUPE = '#8a7350';

/** Quantile linéaire. `q` entre 0 et 1. Le tableau n'est pas muté. */
export function quantile(valeurs: number[], q: number): number {
  const t = [...valeurs].sort((a, b) => a - b);
  if (t.length === 0) return 0;
  const i = (t.length - 1) * q;
  const bas = Math.floor(i);
  const haut = Math.ceil(i);
  return bas === haut ? t[bas] : t[bas] + (t[haut] - t[bas]) * (i - bas);
}

export function moyenne(valeurs: number[]): number {
  if (valeurs.length === 0) return 0;
  return valeurs.reduce((s, v) => s + v, 0) / valeurs.length;
}

/** Les valeurs présentes à une abscisse donnée, toutes séries confondues.
 *  Les trous et les séries qui n'ont pas encore commencé sont écartés — ils ne
 *  tirent pas la moyenne vers le bas. */
export function valeursA(series: SerieGraphe[], i: number): number[] {
  const out: number[] = [];
  for (const s of series) {
    const k = i - (s.decalage ?? 0);
    if (k < 0 || k >= s.valeurs.length) continue;
    const v = s.valeurs[k];
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    out.push(v);
  }
  return out;
}

export function bornes(series: SerieGraphe[], depuisZero: boolean): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const v of s.valeurs) {
      if (v === null || v === undefined || Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return { min: 0, max: 1 };
  if (depuisZero && min > 0) min = 0;
  const amplitude = max - min;
  if (amplitude === 0) {
    // Une série parfaitement plate : on ouvre une fenêtre autour, sinon la courbe est
    // collée sur un bord et l'axe affiche cinq fois la même valeur.
    const marge = Math.abs(max) * 0.1 || 1;
    return { min: min - marge, max: max + marge };
  }
  // ⚠️ Pas de marge SOUS un minimum positif, contrairement à `AreaChart.tsx`. Recharts
  // rogne ce qui dépasse sa zone de tracé, donc il lui faut cette marge pour que le halo
  // du point terminal ne soit pas coupé ; ici rien ne rogne, et les 30 px de marge basse
  // accueillent le halo sans avoir à mentir sur l'échelle.
  return { min: min - (min < 0 ? amplitude * 0.12 : 0), max: max + amplitude * 0.12 };
}

export function formaterAxe(v: number, unite: '' | '€' | '%'): string {
  if (unite === '%') return `${Math.round(v)}%`;
  if (unite === '€') return v >= 1000 ? `${Math.round(v / 1000)}k€` : `${Math.round(v)}€`;
  if (v >= 10000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace('.', ',')}k`;
  return String(Math.round(v));
}

function echapper(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface Point { x: number; y: number }

/** Une cubique lissée qui NE DÉPASSE JAMAIS ses points (Fritsch–Carlson, 1980).
 *
 * ⚠️ Le choix de l'algorithme n'est pas cosmétique. Une spline naïve (Catmull-Rom, le
 * réflexe habituel) dépasse : sur la suite 100, 100, 150 elle creuse SOUS 100 avant de
 * remonter. Traduit à l'écran, ça dessine des abonnés qui baissent un jour où l'élève
 * n'a rien perdu. Un graphe qui invente une baisse est pire qu'un graphe anguleux.
 *
 * Fritsch–Carlson borne les tangentes pour interdire ce dépassement — c'est ce que fait
 * Recharts sous le nom `type="monotone"`, d'où l'identité de rendu avec Mes Stats.
 *
 * Rend une commande `M` suivie de cubiques. Moins de deux points : un simple `M`. */
export function lisser(pts: Point[]): string {
  if (pts.length === 0) return '';
  const r = (v: number) => v.toFixed(1);
  if (pts.length === 1) return `M${r(pts[0].x)} ${r(pts[0].y)}`;
  if (pts.length === 2) return `M${r(pts[0].x)} ${r(pts[0].y)} L${r(pts[1].x)} ${r(pts[1].y)}`;

  const n = pts.length;
  // Pentes des segments, puis tangentes en chaque point.
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    d.push(dx === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx);
  }
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1] + d[i]) / 2;

  // Le bornage proprement dit : c'est CE bloc qui empêche le dépassement.
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    // Un extremum local (tangente de signe opposé à la pente) est mis à plat.
    if (a < 0) m[i] = 0;
    if (b < 0) m[i + 1] = 0;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }

  let out = `M${r(pts[0].x)} ${r(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    out += ` C${r(pts[i].x + dx / 3)} ${r(pts[i].y + (m[i] * dx) / 3)}`
      + ` ${r(pts[i + 1].x - dx / 3)} ${r(pts[i + 1].y - (m[i + 1] * dx) / 3)}`
      + ` ${r(pts[i + 1].x)} ${r(pts[i + 1].y)}`;
  }
  return out;
}

/** Découpe une série en tronçons continus. Un trou OUVRE un nouveau tronçon au lieu
 *  d'être relié : joindre deux points de part et d'autre d'un jour manquant dessinerait
 *  une pente qui n'a pas eu lieu. */
export function tronconner(
  valeurs: (number | null)[],
  decalage: number,
  xDe: (i: number) => number,
  yDe: (v: number) => number,
): Point[][] {
  const out: Point[][] = [];
  let courant: Point[] = [];
  valeurs.forEach((v, k) => {
    if (v === null || v === undefined || Number.isNaN(v)) {
      if (courant.length) out.push(courant);
      courant = [];
      return;
    }
    courant.push({ x: xDe(k + decalage), y: yDe(v) });
  });
  if (courant.length) out.push(courant);
  return out;
}

export interface GeometrieGraphe {
  svg: string;
  /** Abscisse en unités du viewBox, pour situer le survol. */
  xDe: (i: number) => number;
  n: number;
  largeur: number;
  /** Vrai quand le graphe est en mode moyenne + bande. */
  dense: boolean;
}

export function construireGraphe(o: OptionsGraphe): GeometrieGraphe {
  const L = o.largeur;
  const H = o.hauteur ?? 280;
  /* Marge gauche 46 et non 64 : la question posée sur la maquette était « pourquoi
   * l'axe des ordonnées est-il un peu au milieu et pas tout à gauche ». Il l'était
   * parce que la colonne des graduations était deux fois trop large. `AreaChart.tsx`
   * règle le même problème avec `width={28}`. */
  const M = { haut: 18, droite: 22, bas: 30, gauche: 46 };
  const li = L - M.gauche - M.droite;
  const hi = H - M.haut - M.bas;
  const n = Math.max(1, o.n);
  const xDe = (i: number) => M.gauche + (n > 1 ? (i / (n - 1)) * li : li / 2);
  const cle = o.cle ?? 'g';

  const seuil = o.seuilCouleur ?? SEUIL_COULEUR_PAR_DEFAUT;
  const vedette = o.vedette ?? null;
  // Le mode dense ne s'applique qu'au REPOS : dès qu'un élève est mis en avant, les
  // autres passent en gris de toute façon, et la bande n'apporte plus rien.
  const dense = !vedette && o.series.length > seuil;

  const { min, max } = bornes(o.series, !!o.depuisZero);
  const yDe = (v: number) => M.haut + hi - ((v - min) / (max - min || 1)) * hi;
  const solPlan = H - M.bas;

  const serieVedette = vedette ? o.series.find(x => x.nom === vedette) : undefined;
  // Un aplat par graphe au maximum : celui de la courbe qu'on regarde. Trente-neuf
  // aplats superposés ne feraient qu'une bouillie opaque.
  const couleurAplat = serieVedette ? serieVedette.couleur : TAUPE;

  let s = `<svg viewBox="0 0 ${L} ${H}" width="${L}" height="${H}" role="img" aria-label="Graphe de séries">`;
  // Même dégradé que `AreaChart.tsx` : 0.18 en haut, transparent en bas.
  s += `<defs><linearGradient id="aplat-${echapper(cle)}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="5%" stop-color="${couleurAplat}" stop-opacity=".18"/>`
    + `<stop offset="95%" stop-color="${couleurAplat}" stop-opacity="0"/>`
    + `</linearGradient></defs>`;

  /* Grille horizontale pointillée SEULE, et aucun axe en trait plein — c'est
   * `axisLine={false} tickLine={false}` plus `CartesianGrid vertical={false}` de
   * Mes Stats. La ligne du bas de la grille tient lieu de ligne de base : un second
   * trait plein par-dessus ne ferait que l'épaissir. */
  for (let i = 0; i <= 4; i++) {
    const v = min + (max - min) * (i / 4);
    const y = M.haut + hi - (i / 4) * hi;
    s += `<line x1="${M.gauche}" y1="${y.toFixed(1)}" x2="${L - M.droite}" y2="${y.toFixed(1)}" stroke="${GRILLE}" stroke-dasharray="3 3"/>`;
    s += `<text x="${M.gauche - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${ENCRE_ESTOMPEE}" font-family="Inter, sans-serif">${echapper(formaterAxe(v, o.unite))}</text>`;
  }
  for (const e of o.etiquettes) {
    s += `<text x="${xDe(e.i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="${ENCRE_ESTOMPEE}" font-family="Inter, sans-serif">${echapper(e.t)}</text>`;
  }
  // Le zéro reste marqué quand la fenêtre traverse le négatif : c'est une frontière de
  // sens (perdre des abonnés, pas seulement en gagner moins), pas une graduation.
  if (min < 0) {
    s += `<line x1="${M.gauche}" y1="${yDe(0).toFixed(1)}" x2="${L - M.droite}" y2="${yDe(0).toFixed(1)}" stroke="${ENCRE_ESTOMPEE}" stroke-opacity=".45"/>`;
  }

  const troncons = (serie: SerieGraphe) => tronconner(serie.valeurs, serie.decalage ?? 0, xDe, yDe);
  const tracer = (segs: Point[][]) => segs.map(lisser).join(' ');
  /** L'aplat suit la courbe lissée puis redescend au sol — un aplat par tronçon, pour
   *  qu'un trou ne soit pas rempli comme s'il portait une valeur. */
  const aplat = (segs: Point[][]) => segs
    .filter(p => p.length > 1)
    .map(p => `${lisser(p)} L${p[p.length - 1].x.toFixed(1)} ${solPlan} L${p[0].x.toFixed(1)} ${solPlan} Z`)
    .join(' ');

  /** Le point terminal qui pulse, repris de `todayDotFactory` dans `AreaChart.tsx` :
   *  même halo, même animation, même rôle — dire où en est la donnée la plus récente. */
  const pointVif = (x: number, y: number, couleur: string) =>
    `<circle class="graphe-point-vif" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${couleur}" opacity=".3" style="transform-origin:${x.toFixed(1)}px ${y.toFixed(1)}px"/>`
    + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${couleur}" stroke="${FOND}" stroke-width="1.5"/>`;

  if (dense) {
    // Bande interquartile : la moitié centrale des élèves, à chaque abscisse.
    const hautP: Point[] = [];
    const basP: Point[] = [];
    const moy: Point[] = [];
    for (let i = 0; i < n; i++) {
      const vs = valeursA(o.series, i);
      // En dessous de quatre valeurs, un quartile ne veut rien dire.
      if (vs.length < 4) continue;
      hautP.push({ x: xDe(i), y: yDe(quantile(vs, 0.75)) });
      basP.push({ x: xDe(i), y: yDe(quantile(vs, 0.25)) });
      moy.push({ x: xDe(i), y: yDe(moyenne(vs)) });
    }
    if (hautP.length > 1) {
      // La bande se referme en suivant la MÊME courbe lissée à l'aller et au retour,
      // sinon son bord haut serait courbe et son bord bas anguleux.
      const haut = lisser(hautP);
      const retour = lisser([...basP].reverse()).replace(/^M/, 'L');
      s += `<path d="${haut} ${retour} Z" fill="${TAUPE}" fill-opacity=".10"/>`;
      s += `<path d="${lisser(basP)}" fill="none" stroke="${TAUPE}" stroke-opacity=".3" stroke-linecap="round"/>`;
      s += `<path d="${haut}" fill="none" stroke="${TAUPE}" stroke-opacity=".3" stroke-linecap="round"/>`;
    }
    for (const serie of o.series) {
      s += `<path d="${tracer(troncons(serie))}" fill="none" stroke="${GRIS}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" opacity=".75"/>`;
    }
    if (moy.length > 1) {
      s += `<path d="${aplat([moy])}" fill="url(#aplat-${echapper(cle)})" stroke="none"/>`;
      s += `<path d="${lisser(moy)}" fill="none" stroke="${TAUPE}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
      const dernier = moy[moy.length - 1];
      s += pointVif(dernier.x, dernier.y, TAUPE);
      s += `<text x="${(dernier.x - 10).toFixed(1)}" y="${(dernier.y - 11).toFixed(1)}" text-anchor="end" font-size="10.5" font-weight="600" fill="${TAUPE}" font-family="Inter, sans-serif">moyenne</text>`;
    }
  } else {
    /* Une seule courbe et pas de vedette : c'est exactement la situation d'un graphe de
     * Mes Stats, donc elle reçoit le même traitement complet — aplat ET point terminal.
     *
     * ⚠️ Le point terminal s'arrête à ce cas-là. Au-delà d'une courbe il faudrait en
     * poser un par élève, tous à la même abscisse : dix halos qui pulsent côte à côte
     * ne diraient plus « voici la donnée la plus récente », ils feraient du bruit. */
    const solo = !vedette && o.series.length === 1 ? troncons(o.series[0]) : null;
    if (solo) {
      s += `<path d="${aplat(solo)}" fill="url(#aplat-${echapper(cle)})" stroke="none"/>`;
    }
    for (const serie of o.series) {
      if (vedette && serie.nom === vedette) continue;
      const enGris = !!vedette;
      s += `<path d="${tracer(troncons(serie))}" fill="none" stroke="${enGris ? GRIS : serie.couleur}" stroke-width="${enGris ? 1.1 : 1.8}" stroke-linejoin="round" stroke-linecap="round" opacity="${enGris ? 1 : 0.92}"/>`;
      if (o.pointsCourts && serie.valeurs.filter(v => v !== null).length <= 2) {
        const dernier = serie.valeurs.length - 1 + (serie.decalage ?? 0);
        const v = serie.valeurs[serie.valeurs.length - 1];
        if (v !== null && v !== undefined) {
          s += `<circle cx="${xDe(dernier).toFixed(1)}" cy="${yDe(v).toFixed(1)}" r="2.6" fill="${enGris ? GRIS : serie.couleur}"/>`;
        }
      }
    }
    if (solo && solo.length) {
      const fin = solo[solo.length - 1][solo[solo.length - 1].length - 1];
      s += pointVif(fin.x, fin.y, o.series[0].couleur);
    }
  }

  if (serieVedette) {
    const segs = troncons(serieVedette);
    const d = tracer(segs);
    // Quatre canaux à la fois — aplat, liseré, épaisseur, point terminal — parce
    // qu'une seule courbe colorée au milieu de trente-six grises se perd dès que deux
    // grises se croisent au même endroit. Le liseré blanc la détache du paquet.
    s += `<path d="${aplat(segs)}" fill="url(#aplat-${echapper(cle)})" stroke="none"/>`;
    s += `<path d="${d}" fill="none" stroke="${FOND}" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/>`;
    s += `<path d="${d}" fill="none" stroke="${serieVedette.couleur}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
    const fin = segs.length ? segs[segs.length - 1][segs[segs.length - 1].length - 1] : null;
    if (fin) {
      s += pointVif(fin.x, fin.y, serieVedette.couleur);
      s += `<text x="${(fin.x - 10).toFixed(1)}" y="${(fin.y - 12).toFixed(1)}" text-anchor="end" font-size="11.5" font-weight="700" fill="${serieVedette.couleur}" font-family="Inter, sans-serif">${echapper(serieVedette.court)}</text>`;
    }
  }

  return { svg: s + '</svg>', xDe, n, largeur: L, dense };
}
