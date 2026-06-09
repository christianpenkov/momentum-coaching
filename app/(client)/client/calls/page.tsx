import { Suspense } from 'react';
import PageClientCalls from '@/components/pages/client/PageClientCalls';

export default function CallsPage() {
  return (
    <Suspense>
      <PageClientCalls />
    </Suspense>
  );
}
