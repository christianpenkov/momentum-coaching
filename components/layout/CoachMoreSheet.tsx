'use client';

import { useQuery } from '@tanstack/react-query';
import MoreSheetShell, { MoreGroupe } from './MoreSheetShell';
import { useUser } from '@/lib/UserContext';
import { getInitials } from '@/components/ui/Avatar';
import { useClients } from '@/lib/ClientsContext';
import type { Task } from '@/lib/supabase/types';

/**
 * Menu « Plus » du coach. La mise en forme vit dans MoreSheetShell ; ce
 * fichier ne décrit que le contenu.
 *
 * Réglages ne figure PAS dans les groupes : la carte d'identité en haut y
 * mène déjà.
 */

export default function CoachMoreSheet({ onClose }: { onClose: () => void }) {
  const { user } = useUser();
  const { clients } = useClients();

  // Même clé que PageTasks : si l'écran Tâches a déjà été ouvert, le compteur
  // est gratuit. Sinon une requête légère part une fois.
  const { data: taches } = useQuery({
    queryKey: ['coach-tasks'],
    queryFn: async () => {
      const res = await fetch('/api/tasks');
      return res.ok ? ((await res.json()).tasks || []) as Task[] : [];
    },
    staleTime: 60_000,
  });

  // « En retard » et non « à faire » : une tâche sans échéance ou dont
  // l'échéance est à venir n'appelle aucune action aujourd'hui.
  const enRetard = (taches ?? []).filter(t => {
    if (t.done || !t.deadline) return false;
    return new Date(t.deadline) < new Date(new Date().toDateString());
  }).length;

  const groupes: MoreGroupe[] = [
    {
      titre: 'Business',
      liens: [
        { href: '/pipeline', icon: 'trending-up', label: 'Pipeline Leads' },
        { href: '/paiements', icon: 'circle-dollar-sign', label: 'Paiements' },
      ],
    },
    {
      titre: 'Organisation',
      liens: [
        { href: '/calendar', icon: 'calendar', label: 'Calendrier' },
        { href: '/tasks', icon: 'task-check', label: 'Tâches', valeur: enRetard || null },
      ],
    },
    {
      titre: 'Contenus',
      liens: [
        { href: '/liens', icon: 'link', label: 'Gérer mes liens' },
        { href: '/ressources', icon: 'folder', label: 'Ressources' },
      ],
    },
  ];

  const nb = clients?.length ?? 0;

  return (
    <MoreSheetShell
      onClose={onClose}
      groupes={groupes}
      profil={{
        nom: user?.full_name || user?.email || '—',
        sousTitre: `Coach · ${nb} élève${nb !== 1 ? 's' : ''}`,
        avatarUrl: user?.avatar_url,
        initiales: user?.initials || getInitials(user?.full_name),
        seed: user?.id,
        href: '/settings',
      }}
    />
  );
}
