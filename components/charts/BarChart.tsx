'use client';

import {
  BarChart as ReBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface BarChartProps {
  data: Record<string, unknown>[];
  bars: { key: string; label: string; color?: string }[];
  xKey: string;
  height?: number;
  formatter?: (value: number) => string;
  stacked?: boolean;
  xInterval?: number | 'preserveStartEnd';
}

const COLORS = ['var(--accent-brand)', '#3f8a52', '#b58025', '#cd5b3f', '#6b7cde'];

const CustomTooltip = ({ active, payload, label, formatter }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; formatter?: (v: number) => string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="chart-tooltip-row">
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: 'inline-block', marginRight: 6 }} />
          <span>{p.name}: </span>
          <strong>{formatter ? formatter(p.value) : p.value.toLocaleString('fr-FR')}</strong>
        </div>
      ))}
    </div>
  );
};

export default function BarChart({ data, bars, xKey, height = 220, formatter, stacked = false, xInterval }: BarChartProps) {
  return (
    <div className="chart-wrapper" style={{ height }}>
      {/* `initialDimension` : au tout premier rendu, ResponsiveContainer mesure son
          parent AVANT que le ResizeObserver n'ait livré ses dimensions, et rend donc
          une fois en -1 x -1 — d'où l'avertissement « The width(-1) and height(-1) of
          chart should be greater than 0 » dans la console, observé à chaque changement
          de période sur l'onglet Revenus. Le graphique s'affichait correctement à la
          frame suivante, mais un bruit permanent en console masque celui du jour où
          quelque chose casse vraiment. Même correction que AreaChart. */}
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
        {/* Écartement adaptatif. Recharts calcule la largeur d'une barre ainsi :
            (bande − 2 × écartement_catégorie − (n−1) × écartement_barres) / n. Avec
            « 30 % » et l'écartement par défaut de 4 px, deux séries et une bande
            devenue étroite, le numérateur tombe sous le pixel : les barres sont
            rendues à 0,02 px de large — mesuré à l'écran sur 82 points — et le
            graphique paraît VIDE alors que ses valeurs sont justes. Aucune erreur,
            aucun avertissement.
            En dessous de 40 points on garde exactement les valeurs d'avant, pour ne
            changer l'aspect d'aucun graphique existant. */}
        <ReBarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap={data.length > 40 ? '10%' : '30%'} barGap={data.length > 40 ? 1 : 4}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          {/* Plancher à 0 : un appelant qui calcule son intervalle (typiquement
              `Math.floor(n / 7) - 1`) passe une valeur NÉGATIVE dès que la série est
              courte. Recharts traduit −1 en « un point sur 0 » et sa fonction
              getEveryNth renvoie alors un tableau VIDE — l'axe des dates disparaît
              sans aucune erreur. La règle est posée ici, au plus bas, pour valoir
              pour tous les appelants et pas seulement celui qu'on vient de corriger. */}
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: 'var(--muted)', fontFamily: 'var(--font-inter)' }} axisLine={false} tickLine={false} interval={typeof xInterval === 'number' ? Math.max(0, xInterval) : (xInterval ?? 'preserveStartEnd')} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)', fontFamily: 'var(--font-inter)' }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip formatter={formatter} />} />
          {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }} />}
          {bars.map((b, i) => (
            <Bar
              key={b.key}
              dataKey={b.key}
              name={b.label}
              fill={b.color || COLORS[i % COLORS.length]}
              radius={[2, 2, 0, 0]}
              stackId={stacked ? 'stack' : undefined}
              animationDuration={400}
            />
          ))}
        </ReBarChart>
      </ResponsiveContainer>
    </div>
  );
}
