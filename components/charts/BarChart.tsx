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
}

const COLORS = ['var(--accent)', '#3f8a52', '#b58025', '#cd5b3f', '#6b7cde'];

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

export default function BarChart({ data, bars, xKey, height = 220, formatter, stacked = false }: BarChartProps) {
  return (
    <div className="chart-wrapper" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ReBarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: 'var(--muted)', fontFamily: 'var(--font-inter)' }} axisLine={false} tickLine={false} />
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
