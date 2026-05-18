import { Suspense } from 'react';
import PageSettings from '@/components/pages/coach/PageSettings';

export default function SettingsPage() {
  return (
    <Suspense>
      <PageSettings />
    </Suspense>
  );
}
