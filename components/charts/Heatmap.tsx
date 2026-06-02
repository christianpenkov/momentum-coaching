'use client';

interface HeatmapCell {
  label: string;
  value: number;
}

interface HeatmapRow {
  name: string;
  cells: HeatmapCell[];
}

interface HeatmapProps {
  rows: HeatmapRow[];
  maxValue?: number;
  colLabels?: string[];
}

function getLevel(value: number, max: number): number {
  if (value === 0) return 0;
  const pct = value / max;
  if (pct < 0.25) return 1;
  if (pct < 0.5) return 2;
  if (pct < 0.75) return 3;
  return 4;
}

export default function Heatmap({ rows, maxValue, colLabels }: HeatmapProps) {
  const max = maxValue ?? Math.max(...rows.flatMap(r => r.cells.map(c => c.value)), 1);

  return (
    <div className="heatmap-wrapper" style={{ overflowX: 'auto' }}>
      <table className="heatmap" style={{ borderCollapse: 'separate', borderSpacing: 3 }}>
        <thead>
          {colLabels && (
            <tr>
              <th style={{ width: 36, minWidth: 36 }} />
              {colLabels.map((l, i) => (
                <th key={i} style={{ fontSize: 10, fontWeight: 500, color: 'var(--muted)', textAlign: 'center', padding: 0, width: 26, minWidth: 26 }}>
                  {l}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              <td style={{ fontSize: 11, color: 'var(--muted)', paddingRight: 6, whiteSpace: 'nowrap', width: 36, minWidth: 36, textAlign: 'right' }}>
                {row.name}
              </td>
              {row.cells.map((cell, ci) => {
                const level = getLevel(cell.value, max);
                return (
                  <td key={ci} title={`${cell.label}: ${cell.value}`} style={{ padding: 0, width: 26, minWidth: 26 }}>
                    <div
                      className={`heatmap-cell${level > 0 ? ` l${level}` : ''}`}
                      style={{ width: 20, height: 20, borderRadius: 3, margin: '0 auto' }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
