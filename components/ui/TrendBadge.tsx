// Badge "flèche + delta coloré" pour sous-texte de KPI all-time — 2 états
// seulement (vert/haut si value > 0, rouge/bas sinon) : un KPI all-time n'a pas
// d'état "stable", seulement "il s'est passé quelque chose ce mois" ou pas.
export default function TrendBadge({ value, label, format }: {
  value: number;
  label: string;
  format?: (n: number) => string;
}) {
  const positive = value > 0;
  const color = positive ? 'var(--green)' : 'var(--red)';
  const display = format ? format(value) : String(value);
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
