import { Suspense } from 'react';
import PageClientSettings from '@/components/pages/client/PageClientSettings';

// Suspense obligatoire : la page lit `?connected=` au retour d'une connexion OAuth
// via useSearchParams, et Next.js exige une frontiere Suspense autour de tout
// composant qui l'utilise — sans quoi le pre-rendu de la page echoue au build.
//
// La page Reglages du coach etait deja construite ainsi ; celle de l'eleve exportait
// le composant directement (2026-08-22).
export default function ClientSettingsPage() {
  return (
    <Suspense>
      <PageClientSettings />
    </Suspense>
  );
}
