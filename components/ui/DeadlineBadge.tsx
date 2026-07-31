import Icon from '@/components/ui/Icon';
import { getDeadlineStatus } from '@/lib/clientSignals';

// Unifie les 3 copies quasi-identiques trouvées dans PageClientDetail.tsx,
// PageClientTasks.tsx et PageClientView.tsx (jour 7 design structurel, 2026-07-28).
// Reprend la version la plus complète (PageClientView.tsx), qui ajoute un fond
// visible pour l'état overdue — comportement absent des 2 autres copies mais sans
// impact visuel négatif pour elles (juste plus cohérent).
export default function DeadlineBadge({ deadline, done }: { deadline?: string | null; done: boolean }) {
  const status = getDeadlineStatus(deadline, done);
  if (!status) return null;
  return (
    <span style={{
      fontSize: 10, color: status.color,
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontWeight: status.overdue || status.urgent ? 700 : 400,
      padding: status.overdue ? '2px 7px' : '0',
      background: status.overdue ? '#ef444418' : 'transparent',
      borderRadius: 20, flexShrink: 0,
    }}>
      <Icon name="calendar" size={10} />{status.label}
    </span>
  );
}
