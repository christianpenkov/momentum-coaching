'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

interface DonutSlice {
  label: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  data: DonutSlice[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  centerLabel?: string;
  centerSub?: string;
  formatter?: (value: number) => string;
}

const FALLBACK_COLORS = ['var(--accent-brand)', '#3f8a52', '#b58025', '#cd5b3f', '#6b7cde'];

const CustomTooltip = ({ active, payload, formatter }: { active?: boolean; payload?: { name: string; value: number; payload: DonutSlice }[]; formatter?: (v: number) => string }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-row">
        <strong>{p.name}: </strong>
        {formatter ? formatter(p.value) : p.value.toLocaleString('fr-FR')}
      </div>
    </div>
  );
};

export default function DonutChart({ data, height = 200, innerRadius = 55, outerRadius = 80, centerLabel, centerSub, formatter }: DonutChartProps) {
  return (
    <div className="chart-wrapper" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            animationDuration={400}
            startAngle={90}
            endAngle={-270}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip formatter={formatter} />} />
        </PieChart>
      </ResponsiveContainer>
      {(centerLabel || centerSub) && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          pointerEvents: 'none',
        }}>
          {centerLabel && <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--accent-brand)' }}>{centerLabel}</div>}
          {centerSub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{centerSub}</div>}
        </div>
      )}
    </div>
  );
}
