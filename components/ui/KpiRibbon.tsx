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
  headerRight?: React.ReactNode;
  href?: string;
}

interface KpiRibbonProps {
  items: KpiItem[];
  columns?: number;
}

export default function KpiRibbon({ items, columns }: KpiRibbonProps) {
  return (
    <div className="kpi-ribbon" style={columns ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}>
      {items.map((item, i) => {
          const hasFooter = item.headerRight || item.delta !== undefined || item.viz;
          const content = (
            <>
              <div className="kpi-card-head">
                <div className="kpi-label" style={{ marginBottom: 0 }}>
                  {item.label}
                  {item.sub && (
                    <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 4, fontSize: 10 }}>
                      · {item.sub}
                    </span>
                  )}
                </div>
              </div>
              <div className="kpi-value" style={item.color ? { color: item.color } : undefined}>
                <AnimatedNumber value={item.value} formatter={item.formatter} />
              </div>
              {/* Espace flexible : n'apparaît que s'il y a un badge/delta/viz en dessous,
                  pour que ce contenu optionnel reste ancré en bas de carte — sans lui,
                  la valeur reste juste sous le label comme les cartes sans footer. */}
              {hasFooter && <div style={{ flex: 1 }} />}
              {item.headerRight && <div className="kpi-card-badges">{item.headerRight}</div>}
              {item.delta !== undefined && (
                <div className={`kpi-delta${item.delta >= 0 ? ' kpi-delta-up' : ' kpi-delta-down'}`}>
                  {item.delta >= 0 ? '+' : ''}{item.delta}%
                  {item.deltaLabel && <span> {item.deltaLabel}</span>}
                </div>
              )}
              {item.viz && <div style={{ marginTop: item.headerRight || item.delta !== undefined ? 6 : 0 }}>{item.viz}</div>}
            </>
          );
        return item.href ? (
          <Link key={i} href={item.href} className="kpi-card kpi-card--clickable" style={{ textDecoration: 'none' }}>
            {content}
          </Link>
        ) : (
          <div key={i} className="kpi-card">{content}</div>
        );
      })}
    </div>
  );
}
