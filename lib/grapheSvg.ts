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
}

export const SEUIL_COULEUR_PAR_DEFAUT = 10;

const GRIS = '#d7d1c3';
const AXE = '#c9c4b8';
const TAUPE = '#8a7350';
const GRILLE = '#eeeae0';
const ENCRE_ESTOMPEE = '#797569';

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
  return { min: min - (min < 0 ? amplitude * 0.08 : 0), max: max + amplitude * 0.08 };
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
  const M = { haut: 16, droite: 20, bas: 30, gauche: 64 };
  const li = L - M.gauche - M.droite;
  const hi = H - M.haut - M.bas;
  const n = Math.max(1, o.n);
  const xDe = (i: number) => M.gauche + (n > 1 ? (i / (n - 1)) * li : li / 2);

  const seuil = o.seuilCouleur ?? SEUIL_COULEUR_PAR_DEFAUT;
  const vedette = o.vedette ?? null;
  // Le mode dense ne s'applique qu'au REPOS : dès qu'un élève est mis en avant, les
  // autres passent en gris de toute façon, et la bande n'apporte plus rien.
  const dense = !vedette && o.series.length > seuil;

  const { min, max } = bornes(o.series, !!o.depuisZero);
  const yDe = (v: number) => M.haut + hi - ((v - min) / (max - min || 1)) * hi;

  let s = `<svg viewBox="0 0 ${L} ${H}" width="${L}" height="${H}" role="img" aria-label="Graphe de séries">`;

  // Grille et graduations
  for (let i = 0; i <= 4; i++) {
    const v = min + (max - min) * (i / 4);
    const y = M.haut + hi - (i / 4) * hi;
    s += `<line x1="${M.gauche}" y1="${y.toFixed(1)}" x2="${L - M.droite}" y2="${y.toFixed(1)}" stroke="${GRILLE}" stroke-dasharray="2 4"/>`;
    s += `<text x="${M.gauche - 9}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="${ENCRE_ESTOMPEE}" font-family="IBM Plex Mono, monospace">${echapper(formaterAxe(v, o.unite))}</text>`;
  }
  // Les deux axes en trait plein. L'axe vertical à gauche répond à une question posée
  // sur la maquette : sans lui, on ne voit pas où commence le graphe.
  s += `<line x1="${M.gauche}" y1="${M.haut - 4}" x2="${M.gauche}" y2="${H - M.bas}" stroke="${AXE}"/>`;
  s += `<line x1="${M.gauche}" y1="${H - M.bas}" x2="${L - M.droite}" y2="${H - M.bas}" stroke="${AXE}"/>`;
  for (const e of o.etiquettes) {
    s += `<text x="${xDe(e.i).toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="10" fill="${ENCRE_ESTOMPEE}" font-family="IBM Plex Mono, monospace">${echapper(e.t)}</text>`;
  }
  if (min < 0) {
    s += `<line x1="${M.gauche}" y1="${yDe(0).toFixed(1)}" x2="${L - M.droite}" y2="${yDe(0).toFixed(1)}" stroke="${AXE}"/>`;
  }

  const chemin = (serie: SerieGraphe) => {
    const d: string[] = [];
    // Un trou COUPE le trait au lieu d'être relié : relier deux points de part et
    // d'autre d'un jour manquant dessinerait une pente qui n'a pas eu lieu. C'est
    // pour ça que le drapeau retombe à false sur une valeur inconnue — le point
    // suivant recommence un segment par un `M`.
    let enCours = false;
    serie.valeurs.forEach((v, k) => {
      if (v === null || v === undefined || Number.isNaN(v)) { enCours = false; return; }
      const x = xDe(k + (serie.decalage ?? 0));
      d.push(`${enCours ? 'L' : 'M'}${x.toFixed(1)} ${yDe(v).toFixed(1)}`);
      enCours = true;
    });
    return d.join(' ');
  };

  if (dense) {
    // Bande interquartile : la moitié centrale des élèves, à chaque abscisse.
    const hautP: { i: number; v: number }[] = [];
    const basP: { i: number; v: number }[] = [];
    const moy: { i: number; v: number }[] = [];
    for (let i = 0; i < n; i++) {
      const vs = valeursA(o.series, i);
      // En dessous de quatre valeurs, un quartile ne veut rien dire.
      if (vs.length < 4) continue;
      hautP.push({ i, v: quantile(vs, 0.75) });
      basP.push({ i, v: quantile(vs, 0.25) });
      moy.push({ i, v: moyenne(vs) });
    }
    if (hautP.length > 1) {
      const haut = hautP.map((p, k) => `${k ? 'L' : 'M'}${xDe(p.i).toFixed(1)} ${yDe(p.v).toFixed(1)}`).join(' ');
      const bas = [...basP].reverse().map(p => `L${xDe(p.i).toFixed(1)} ${yDe(p.v).toFixed(1)}`).join(' ');
      s += `<path d="${haut} ${bas} Z" fill="${TAUPE}" fill-opacity=".10"/>`;
      s += `<path d="${basP.map((p, k) => `${k ? 'L' : 'M'}${xDe(p.i).toFixed(1)} ${yDe(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${TAUPE}" stroke-opacity=".35"/>`;
      s += `<path d="${haut}" fill="none" stroke="${TAUPE}" stroke-opacity=".35"/>`;
    }
    for (const serie of o.series) {
      s += `<path d="${chemin(serie)}" fill="none" stroke="${GRIS}" stroke-width="1" stroke-linejoin="round" opacity=".8"/>`;
    }
    if (moy.length > 1) {
      s += `<path d="${moy.map((p, k) => `${k ? 'L' : 'M'}${xDe(p.i).toFixed(1)} ${yDe(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${TAUPE}" stroke-width="2.2"/>`;
      const dernier = moy[moy.length - 1];
      s += `<text x="${(xDe(dernier.i) - 7).toFixed(1)}" y="${(yDe(dernier.v) - 9).toFixed(1)}" text-anchor="end" font-size="10.5" font-weight="600" fill="${TAUPE}" font-family="IBM Plex Mono, monospace">moyenne</text>`;
    }
  } else {
    for (const serie of o.series) {
      if (vedette && serie.nom === vedette) continue;
      const enGris = !!vedette;
      s += `<path d="${chemin(serie)}" fill="none" stroke="${enGris ? GRIS : serie.couleur}" stroke-width="${enGris ? 1.1 : 1.6}" stroke-linejoin="round" opacity="${enGris ? 1 : 0.92}"/>`;
      if (o.pointsCourts && serie.valeurs.filter(v => v !== null).length <= 2) {
        const dernier = serie.valeurs.length - 1 + (serie.decalage ?? 0);
        const v = serie.valeurs[serie.valeurs.length - 1];
        if (v !== null && v !== undefined) {
          s += `<circle cx="${xDe(dernier).toFixed(1)}" cy="${yDe(v).toFixed(1)}" r="2.6" fill="${enGris ? GRIS : serie.couleur}"/>`;
        }
      }
    }
  }

  if (vedette) {
    const serie = o.series.find(x => x.nom === vedette);
    if (serie) {
      const d = chemin(serie);
      // Trois canaux à la fois — épaisseur, couleur pleine, point terminal cerclé —
      // parce qu'une seule courbe colorée au milieu de trente-six grises se perd dès
      // que deux grises se croisent au même endroit.
      s += `<path d="${d}" fill="none" stroke="#fff" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/>`;
      s += `<path d="${d}" fill="none" stroke="${serie.couleur}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>`;
      const iDernier = serie.valeurs.length - 1 + (serie.decalage ?? 0);
      const vDernier = [...serie.valeurs].reverse().find(v => v !== null && v !== undefined);
      if (vDernier !== undefined && vDernier !== null) {
        const x = xDe(iDernier);
        const y = yDe(vDernier);
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.4" fill="${serie.couleur}" stroke="#fff" stroke-width="2"/>`;
        s += `<text x="${(x - 9).toFixed(1)}" y="${(y - 11).toFixed(1)}" text-anchor="end" font-size="11.5" font-weight="700" fill="${serie.couleur}" font-family="Inter, sans-serif">${echapper(serie.court)}</text>`;
      }
    }
  }

  return { svg: s + '</svg>', xDe, n, largeur: L, dense };
}
