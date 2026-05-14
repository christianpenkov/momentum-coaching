import PageClientAnalytics from '@/components/pages/coach/PageClientAnalytics';

export default async function ClientAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PageClientAnalytics id={id} />;
}
