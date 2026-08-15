import PageClientStats from '@/components/analytics/PageClientStats';
import DesktopOnly from '@/components/ui/DesktopOnly';
export default function ClientStatsPage() {
  return <DesktopOnly><PageClientStats /></DesktopOnly>;
}
