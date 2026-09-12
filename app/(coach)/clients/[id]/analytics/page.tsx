'use client';

import { use, useMemo } from 'react';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import PageClientStats from '@/components/analytics/PageClientStats';
import DesktopOnly from '@/components/ui/DesktopOnly';
import SelecteurEleve, { type EleveSelectionnable } from '@/components/ui/SelecteurEleve';

export default function ClientAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { clients, getClient } = useSupabaseClients();
  const client = getClient(id);

  // Les archivés sortent, comme dans le portefeuille : ils restent atteignables
  // par leur URL, jamais proposés dans une liste de travail. Tri par nom — l'ordre
  // de chargement n'a aucun sens pour qui cherche quelqu'un.
  const eleves: EleveSelectionnable[] = useMemo(
    () => clients
      .filter(c => !c.archived_at)
      .map(c => ({ id: c.id, nom: c.name, niche: c.niche, photo: c.avatar_url, semaine: c.week }))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    [clients],
  );

  if (!client) return null;

  const eleveCourant: EleveSelectionnable = {
    id: client.id, nom: client.name, niche: client.niche, photo: client.avatar_url, semaine: client.week,
  };

  return (
    <DesktopOnly>
      <PageClientStats
        profileId={client.profile_id ?? undefined}
        clientName={client.name}
        enTete={
          <SelecteurEleve
            eleveCourant={eleveCourant}
            eleves={eleves}
            // La bascule emporte l'écran en cours : l'onglet et la période vivent
            // dans la query string (PageClientStats les y écrit), il suffit de la
            // recopier telle quelle. Comparer l'Instagram de deux élèves ne demande
            // donc pas de resélectionner l'onglet à chaque fois.
            hrefPour={e => `/clients/${e.id}/analytics${typeof window === 'undefined' ? '' : window.location.search}`}
          />
        }
      />
    </DesktopOnly>
  );
}
