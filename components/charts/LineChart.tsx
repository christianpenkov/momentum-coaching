'use client';

import {
  LineChart as ReLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface LineChartProps {
  data: Record<string, unknown>[];
  lines: { key: string; label: string; color?: string }[];
  xKey: string;
  height?: number;
  formatter?: (value: number) => string;
  yLabel?: string;
}

const COLORS = ['var(--accent)', '#3f8a52', '#b58025', '#cd5b3f', '#6b7cde', '#8b5cf6'];

const CustomTooltip = ({ active, payload, label, formatter }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; formatter?: (v: number) => string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="chart-tooltip-row">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block', marginRight: 6 }} />
          <span>{p.name}: </span>
          <strong>{formatter ? formatter(p.value) : p.value.toLocaleString('fr-FR')}</strong>
        </div>
      ))}
    </div>
  );
};

export default function LineChart({ data, lines, xKey, height = 220, formatter, yLabel }: LineChartProps) {
  return (
    <div className="chart-wrapper" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ReLineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: 'var(--muted)', fontFamily: 'var(--font-inter)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)', fontFamily: 'var(--font-inter)' }} axisLine={false} tickLine={false} label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--muted)' } } : undefined} />
          <Tooltip content={<CustomTooltip formatter={formatter} />} />
          {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }} />}
          {lines.map((l, i) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.label}
              stroke={l.color || COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              animationDuration={400}
            />
          ))}
        </ReLineChart>
      </ResponsiveContainer>
    </div>
  );
}
