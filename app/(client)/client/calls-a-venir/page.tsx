import { Suspense } from 'react';
import PageClientUpcomingCalls from '@/components/pages/client/PageClientUpcomingCalls';

export default function CallsAVenirPage() {
  return (
    <Suspense>
      <PageClientUpcomingCalls />
    </Suspense>
  );
}
