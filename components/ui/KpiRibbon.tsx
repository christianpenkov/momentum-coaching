'use client';

import AnimatedNumber from './AnimatedNumber';

export interface KpiItem {
  label: string;
  sub?: string;
  value: number;
  formatter?: (n: number) => string;
  delta?: number;
  deltaLabel?: string;
  color?: string;
}

interface KpiRibbonProps {
  items: KpiItem[];
}

export default function KpiRibbon({ items }: KpiRibbonProps) {
  return (
    <div className="kpi-ribbon">
      {items.map((item, i) => (
        <div key={i} className="kpi-card">
          <div className="kpi-label">
            {item.label}
            {item.sub && (
              <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 4, fontSize: 10 }}>
                · {item.sub}
              </span>
            )}
          </div>
          <div className="kpi-value" style={item.color ? { color: item.color } : undefined}>
            <AnimatedNumber value={item.value} formatter={item.formatter} />
          </div>
          {item.delta !== undefined && (
            <div className={`kpi-delta${item.delta >= 0 ? ' kpi-delta-up' : ' kpi-delta-down'}`}>
              {item.delta >= 0 ? '+' : ''}{item.delta}%
              {item.deltaLabel && <span> {item.deltaLabel}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
