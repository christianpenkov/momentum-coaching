'use client';

import Link from 'next/link';
import AnimatedNumber from './AnimatedNumber';

export interface KpiItem {
  label: string;
  sub?: string;
  value: number;
  formatter?: (n: number) => string;
  delta?: number;
  deltaLabel?: string;
  color?: string;
  viz?: React.ReactNode;
  href?: string;
}

interface KpiRibbonProps {
  items: KpiItem[];
}

export default function KpiRibbon({ items }: KpiRibbonProps) {
  return (
    <div className="kpi-ribbon">
      {items.map((item, i) => {
        const content = (
          <>
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
            {item.viz && <div style={{ marginTop: 12 }}>{item.viz}</div>}
          </>
        );
        return item.href ? (
          <Link key={i} href={item.href} className="kpi-card" style={{ textDecoration: 'none', cursor: 'pointer' }}>
            {content}
          </Link>
        ) : (
          <div key={i} className="kpi-card">{content}</div>
        );
      })}
    </div>
  );
}
