// Badge "flèche + delta coloré" pour sous-texte de KPI all-time — 3 états :
// vert/flèche haut si value > 0, rouge/flèche bas si value < 0, neutre/gris
// sans flèche si value === 0 (rien ce mois-ci n'est pas une baisse).
export default function TrendBadge({ value, label, format }: {
  value: number;
  label: string;
  format?: (n: number) => string;
}) {
  const display = format ? format(value) : String(value);

  if (value === 0) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
        {display} {label}
      </span>
    );
  }

  const positive = value > 0;
  const color = positive ? 'var(--green)' : 'var(--red)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3"
           strokeLinecap="round" strokeLinejoin="round"
           style={{ transform: positive ? undefined : 'rotate(180deg)' }}>
        <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
      </svg>
      {display} {label}
    </span>
  );
}
