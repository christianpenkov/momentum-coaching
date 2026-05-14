'use client';

interface SparkbarsProps {
  data: number[];
  height?: number;
  width?: number;
  color?: string;
}

export default function Sparkbars({ data, height = 28, width = 80, color = 'var(--accent)' }: SparkbarsProps) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const last = data[data.length - 1];
  const prev = data[data.length - 2] ?? last;
  const delta = last - prev;
  const pctH = (v: number) => Math.max(0.08, (v - min) / range);

  // SVG polyline sparkline
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - pctH(v) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const lastX = width;
  const lastY = height - pctH(last) * height;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <svg width={width} height={height} style={{ overflow: 'visible' }}>
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.5}
        />
        <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
      </svg>
      <span style={{
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        color: delta >= 0 ? 'var(--green)' : 'var(--red)',
        fontWeight: 600,
        minWidth: 28,
      }}>
        {delta >= 0 ? '+' : ''}{delta > 999 ? `${(delta / 1000).toFixed(1)}k` : delta < -999 ? `${(delta / 1000).toFixed(1)}k` : delta}
      </span>
    </div>
  );
}
