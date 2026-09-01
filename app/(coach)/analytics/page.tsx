import PageStatsClients from '@/components/pages/coach/PageStatsClients';
import DesktopOnly from '@/components/ui/DesktopOnly';

// La route reste `/analytics` : le libellé de la barre latérale dit déjà « Stats
// Clients » (Sidebar.tsx), et renommer le chemin casserait les liens existants pour un
// gain purement cosmétique, invisible du coach.
export default function StatsClientsPage() {
  return <DesktopOnly><PageStatsClients /></DesktopOnly>;
}
