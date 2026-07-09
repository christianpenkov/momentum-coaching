'use client';

import {
  AreaChart as ReAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface AreaChartProps {
  data: Record<string, unknown>[];
  areas: { key: string; label: string; color?: string }[];
  xKey: string;
  height?: number;
  formatter?: (value: number) => string;
  // Affiche le jour de semaine ("lun. 7") au lieu du format compact ("7 juil.") —
  // à activer seulement quand le graphique montre 7 points ou moins (vue semaine),
  // sinon les ticks se chevauchent sur une vue mois (jusqu'à 31 points).
  showWeekday?: boolean;
}

const COLORS = ['var(--accent)', '#3f8a52', '#b58025'];

// Trouve la date du dernier point ayant une vraie valeur (non null/undefined) dans une
// série — c'est ce point-là qui pulse, pas forcément "aujourd'hui" au sens calendaire.
// Certaines sources (ex: API YouTube Analytics) ont un délai de traitement de quelques
// jours : la dernière donnée disponible n'est pas toujours celle du jour courant, et
// faire pulser une date sans vraie donnée serait trompeur.
export function lastRealPointKey(data: Record<string, unknown>[], xKey: string, dataKey: string): string | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const v = data[i][dataKey];
    if (v !== null && v !== undefined) return String(data[i][xKey]);
  }
  return null;
}

// Point le plus récent avec une vraie donnée, mis en évidence par une pulsation — pour
// le repérer immédiatement quand il n'y a par exemple qu'un seul point réel visible
// (début de semaine/mois calendaire, ex: lundi ou le 1er du mois).
export function todayDotFactory(color: string, xKey: string, lastKey?: string | null) {
  const targetStr = lastKey ?? new Date().toISOString().split('T')[0];
  return (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return <g key={props.key} />;
    const isToday = payload?.[xKey] === targetStr;
    if (!isToday) {
      return <circle key={props.key} cx={cx} cy={cy} r={3} fill={color} stroke="none" />;
    }
    return (
      <g key={props.key}>
        <circle cx={cx} cy={cy} r={6} fill={color} opacity={0.35} style={{ animation: 'today-dot-pulse 1.6s ease-in-out infinite', transformOrigin: `${cx}px ${cy}px` }} />
        <circle cx={cx} cy={cy} r={3.5} fill={color} stroke="none" />
      </g>
    );
  };
}

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

export default function AreaChart({ data, areas, xKey, height = 220, formatter, showWeekday }: AreaChartProps) {
  // Coupe la ligne aux jours futurs (date > aujourd'hui) — sans ça, une source de
  // données qui pose 0 plutôt que null pour les jours sans ligne (ex: igDays) trace la
  // courbe à plat jusqu'à la fin du mois/semaine calendaire au lieu de s'arrêter à
  // aujourd'hui, comme déjà géré ailleurs via isFutureDay/v:null.
  const todayStr = new Date().toISOString().split('T')[0];
  const safeData = data.map(d => {
    const dateVal = d[xKey];
    if (typeof dateVal === 'string' && dateVal > todayStr) {
      const cut = { ...d };
      for (const a of areas) cut[a.key] = null;
      return cut;
    }
    return d;
  });
  return (
    <div className="chart-wrapper" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ReAreaChart data={safeData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {areas.map((a, i) => {
              const color = a.color || COLORS[i % COLORS.length];
              return (
                <linearGradient key={a.key} id={`grad-${a.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={(v: string) => {
            const d = new Date(v);
            if (isNaN(d.getTime())) return v;
            return showWeekday
              ? d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })
              : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '');
          }} interval={showWeekday ? 0 : 'preserveStartEnd'} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)', fontFamily: 'var(--font-inter)' }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip formatter={formatter} />} />
          {areas.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }} />}
          {areas.map((a, i) => {
            const color = a.color || COLORS[i % COLORS.length];
            const lastKey = lastRealPointKey(safeData, xKey, a.key);
            return (
              <Area
                key={a.key}
                type="monotone"
                dataKey={a.key}
                name={a.label}
                stroke={color}
                strokeWidth={2}
                fill={`url(#grad-${a.key})`}
                // Point visible sur chaque valeur réelle (pas juste au survol) — sans ça,
                // un seul point de donnée (ex: uniquement "aujourd'hui" en début de
                // semaine/mois calendaire) ne trace aucun segment et reste invisible.
                // Le dernier point réel pulse pour être repéré immédiatement (pas
                // forcément "aujourd'hui" — certaines sources ont un délai de quelques
                // jours avant que la donnée la plus récente soit disponible).
                dot={todayDotFactory(color, xKey, lastKey)}
                activeDot={{ r: 4, strokeWidth: 0 }}
                animationDuration={400}
              />
            );
          })}
        </ReAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
