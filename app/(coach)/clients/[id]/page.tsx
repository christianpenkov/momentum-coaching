import PageClientDetail from '@/components/pages/coach/PageClientDetail';

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PageClientDetail id={id} />;
}
