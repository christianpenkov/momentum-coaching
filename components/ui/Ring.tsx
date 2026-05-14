'use client';

interface RingProps {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  sublabel?: string;
}

export default function Ring({ value, max = 100, size = 80, stroke = 6, color = 'var(--accent)', label, sublabel }: RingProps) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  const offset = circ * (1 - pct);

  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div style={{ textAlign: 'center', lineHeight: 1.2 }}>
        {label && <div style={{ fontSize: size * 0.22, fontWeight: 600, color: 'var(--accent)' }}>{label}</div>}
        {sublabel && <div style={{ fontSize: size * 0.14, color: 'var(--muted)', marginTop: 2 }}>{sublabel}</div>}
      </div>
    </div>
  );
}
