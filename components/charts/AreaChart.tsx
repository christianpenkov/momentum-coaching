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
}

const COLORS = ['var(--accent)', '#3f8a52', '#b58025'];

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

export default function AreaChart({ data, areas, xKey, height = 220, formatter }: AreaChartProps) {
  return (
    <div className="chart-wrapper" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ReAreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
          <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={(v: string) => { const d = new Date(v); return isNaN(d.getTime()) ? v : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', ''); }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)', fontFamily: 'var(--font-inter)' }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip formatter={formatter} />} />
          {areas.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }} />}
          {areas.map((a, i) => {
            const color = a.color || COLORS[i % COLORS.length];
            return (
              <Area
                key={a.key}
                type="monotone"
                dataKey={a.key}
                name={a.label}
                stroke={color}
                strokeWidth={2}
                fill={`url(#grad-${a.key})`}
                dot={false}
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
