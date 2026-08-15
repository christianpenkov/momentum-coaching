'use client';
import PageClientStats from '@/components/analytics/PageClientStats';
import DesktopOnly from '@/components/ui/DesktopOnly';
export default function MesStatsPage() {
  return <DesktopOnly><PageClientStats title="Mes Stats" /></DesktopOnly>;
}
