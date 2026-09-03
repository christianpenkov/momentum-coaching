'use client';

import { useQuery } from '@tanstack/react-query';
import MoreSheetShell, { MoreGroupe } from './MoreSheetShell';
import { useUser } from '@/lib/UserContext';
import { getInitials } from '@/components/ui/Avatar';
import type { Task } from '@/lib/supabase/types';

/**
 * Menu « Plus » de l'élève. La mise en forme vit dans MoreSheetShell ; ce
 * fichier ne décrit que le contenu.
 *
 * Réglages ne figure PAS dans les groupes : la carte d'identité en haut y
 * mène déjà, et deux chemins vers le même écran dans un menu de sept lignes
 * font douter qu'ils mènent au même endroit.
 */

export default function ClientMoreSheet({ onClose }: { onClose: () => void }) {
  const { user } = useUser();

  // Même clé que PageClientTasks : si l'écran Tâches a déjà été ouvert, le
  // compteur est gratuit. Sinon une requête légère part une fois, et
  // `staleTime` évite qu'elle se rejoue à chaque ouverture du menu.
  const { data: taches } = useQuery({
    queryKey: ['client-tasks'],
    queryFn: async () => {
      const res = await fetch('/api/tasks');
      return res.ok ? ((await res.json()).tasks || []) as Task[] : [];
    },
    staleTime: 60_000,
  });

  // « En retard » et non « à faire » : une tâche sans échéance ou dont
  // l'échéance est à venir n'appelle aucune action aujourd'hui, et la compter
  // ferait clignoter un chiffre en permanence.
  const enRetard = (taches ?? []).filter(t => {
    if (t.done || !t.deadline) return false;
    return new Date(t.deadline) < new Date(new Date().toDateString());
  }).length;

  const groupes: MoreGroupe[] = [
    {
      titre: 'Business',
      liens: [
        { href: '/client/pipeline', icon: 'trending-up', label: 'Pipeline Leads' },
        { href: '/client/paiements', icon: 'circle-dollar-sign', label: 'Paiements' },
      ],
    },
    {
      titre: 'Organisation',
      liens: [
        { href: '/client/calendar-mobile', icon: 'calendar', label: 'Calendrier' },
        { href: '/client/taches', icon: 'task-check', label: 'Tâches', valeur: enRetard || null },
      ],
    },
    {
      titre: 'Contenus',
      liens: [
        { href: '/client/liens', icon: 'link', label: 'Liens' },
        { href: '/client/ressources', icon: 'folder', label: 'Ressources' },
      ],
    },
  ];

  return (
    <MoreSheetShell
      onClose={onClose}
      groupes={groupes}
      profil={{
        nom: user?.full_name || user?.email || '—',
        sousTitre: 'Voir mes réglages',
        avatarUrl: user?.avatar_url,
        initiales: user?.initials || getInitials(user?.full_name),
        seed: user?.id,
        href: '/client/settings',
      }}
    />
  );
}
