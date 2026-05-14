import PageBriefing from '@/components/pages/coach/PageBriefing';

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PageBriefing id={id} />;
}
