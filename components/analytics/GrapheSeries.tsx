'use client';

import { useEffect, useLayoutEffect, useRef, useState, useId } from 'react';
import { construireGraphe, type SerieGraphe } from '@/lib/grapheSvg';

/* Enveloppe React du graphe de Stats Clients.
 *
 * Elle ne possède que trois choses : la largeur mesurée, le nœud DOM, et les
 * événements de survol. Toute la géométrie vit dans lib/grapheSvg.ts, qui est pur et
 * testé.
 *
 * ⚠️ Le SVG est injecté en `innerHTML` plutôt que rendu en JSX, et c'est le point de
 * toute l'affaire : au repos le graphe trace jusqu'à 39 séries, et le survol d'une
 * ligne du tableau le redessine. En JSX, chaque survol ferait réconcilier 39 éléments
 * React ; ici c'est une seule écriture. Tout texte inséré est échappé côté lib —
 * un nom d'élève ne peut pas devenir du balisage.
 */

export interface PointSurvol {
  nom: string;
  couleur: string;
  valeur: number;
}

interface Props {
  series: SerieGraphe[];
  n: number;
  etiquettes: { i: number; t: string }[];
  unite: '' | '€' | '%';
  vedette?: string | null;
  depuisZero?: boolean;
  hauteur?: number;
  pointsCourts?: boolean;
  /** Titre du cartouche pour une abscisse donnée. */
  libelleAbscisse: (i: number) => string;
  /** Mise en forme d'une valeur dans le cartouche. */
  formater: (v: number) => string;
  /** Signalé quand le mode change, pour que l'appelant explique ce qu'on voit. */
  onDense?: (dense: boolean) => void;
}

/** Le cartouche liste le maximum de monde — passé de 8 à 16 lignes à la demande de
 *  Chris. Au-delà, la liste dépasserait la hauteur du graphe. */
const LIGNES_CARTOUCHE = 16;

export default function GrapheSeries({
  series, n, etiquettes, unite, vedette, depuisZero, hauteur = 280,
  pointsCourts, libelleAbscisse, formater, onDense,
}: Props) {
  const conteneur = useRef<HTMLDivElement>(null);
  const hote = useRef<HTMLDivElement>(null);
  /* Le constructeur déclare un `<linearGradient>` pour son aplat. Deux graphes montés
   * sur la même page — le graphe principal et celui des semaines d'accompagnement —
   * partageraient l'identifiant, et le second écraserait la couleur du premier : c'est
   * le genre de bug qui ne se voit qu'une fois les deux graphes affichés ensemble.
   * `useId` le règle sans que l'appelant ait à y penser ; les deux-points qu'il produit
   * (`:r0:`) sont retirés parce qu'ils ne passent pas partout dans un `url(#…)`. */
  const cle = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [largeur, setLargeur] = useState(0);
  const [survol, setSurvol] = useState<{ i: number; x: number; y: number } | null>(null);

  // Largeur mesurée plutôt que devinée : le viewBox est alors à l'échelle 1:1 des
  // pixels, donc la taille du texte et l'épaisseur des traits sont celles voulues,
  // quelle que soit la largeur de la fenêtre.
  useLayoutEffect(() => {
    const el = conteneur.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const maj = () => setLargeur(Math.max(360, Math.round(el.getBoundingClientRect().width)));
    maj();
    const ro = new ResizeObserver(maj);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = largeur > 0
    ? construireGraphe({ series, n, etiquettes, unite, vedette, depuisZero, largeur, hauteur, pointsCourts, cle })
    : null;

  useEffect(() => { if (geo) onDense?.(geo.dense); }, [geo?.dense, onDense]);

  useEffect(() => {
    if (hote.current && geo) hote.current.innerHTML = geo.svg;
  }, [geo?.svg]);

  function surDeplacement(ev: React.MouseEvent<HTMLDivElement>) {
    if (!geo) return;
    const svg = hote.current?.querySelector('svg');
    if (!svg) return;
    const boite = svg.getBoundingClientRect();
    // Le viewBox peut être mis à l'échelle par le CSS : on ramène le pointeur dans ses
    // unités avant de chercher l'abscisse la plus proche.
    const echelle = geo.largeur / boite.width;
    const x = (ev.clientX - boite.left) * echelle;
    let meilleur = 0;
    let ecart = Infinity;
    for (let i = 0; i < geo.n; i++) {
      const d = Math.abs(geo.xDe(i) - x);
      if (d < ecart) { ecart = d; meilleur = i; }
    }
    setSurvol({ i: meilleur, x: geo.xDe(meilleur) / echelle, y: ev.clientY - boite.top });
  }

  const points: PointSurvol[] = survol
    ? series
        .map(s => {
          const k = survol.i - (s.decalage ?? 0);
          const v = k >= 0 && k < s.valeurs.length ? s.valeurs[k] : null;
          return v === null || v === undefined ? null : { nom: s.court, couleur: s.couleur, valeur: v };
        })
        .filter((p): p is PointSurvol => p !== null)
        .sort((a, b) => b.valeur - a.valeur)
    : [];

  const visibles = points.slice(0, LIGNES_CARTOUCHE);

  return (
    <div ref={conteneur} style={{ position: 'relative' }}>
      <div
        ref={hote}
        onMouseMove={surDeplacement}
        onMouseLeave={() => setSurvol(null)}
        style={{ minHeight: hauteur }}
      />
      {/* Le trait vertical de survol, l'équivalent du curseur que Recharts dessine.
          C'est lui qui dit QUELLE abscisse le cartouche est en train de lire — sans lui,
          le cartouche affiche des chiffres sans qu'on sache de quel jour ils viennent.
          Une div positionnée plutôt qu'un élément du SVG : le survol ne redessine alors
          pas les 39 courbes, ce qui est toute la raison d'être de ce composant. */}
      {survol && visibles.length > 0 && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', pointerEvents: 'none', zIndex: 4,
            left: survol.x, top: 0, width: 1, height: hauteur - 30,
            background: 'var(--border)',
          }}
        />
      )}
      {survol && visibles.length > 0 && (
        <div
          role="tooltip"
          style={{
            position: 'absolute', pointerEvents: 'none', zIndex: 5,
            left: Math.min(Math.max(0, survol.x + 14), Math.max(0, (conteneur.current?.clientWidth ?? 0) - 200)),
            top: Math.max(0, survol.y - 40),
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-menu)',
            padding: '9px 11px', minWidth: 172, fontSize: 11.5,
          }}
        >
          <div style={{ fontSize: 10.5, fontWeight: 700, marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
            {libelleAbscisse(survol.i)}
          </div>
          {visibles.map((p, k) => (
            <div key={p.nom + k} style={{ display: 'flex', alignItems: 'center', gap: 7, lineHeight: 1.75 }}>
              {/* Pastille carrée à 2px, comme celle du cartouche de Mes Stats. Une
                  pastille ronde ici et carrée là-bas, c'est le genre d'écart qu'on ne
                  sait pas nommer mais qui fait « pas tout à fait la même app ». */}
              <i style={{ width: 8, height: 8, borderRadius: 2, background: p.couleur, flexShrink: 0, display: 'inline-block' }} />
              <span style={{ color: 'var(--muted)', flex: 1, whiteSpace: 'nowrap' }}>{p.nom}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {formater(p.valeur)}
              </span>
            </div>
          ))}
          {points.length > visibles.length && (
            <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 5, fontFamily: 'var(--font-mono)' }}>
              + {points.length - visibles.length} autres
            </div>
          )}
        </div>
      )}
    </div>
  );
}
