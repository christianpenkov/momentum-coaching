'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Client } from '@/lib/supabase/types';
import { resolveUser } from '@/lib/waitForSession';

interface ClientSelfContextValue {
  clientRow: Client | null;
  loading: boolean;
  refetch: () => void;
}

const ClientSelfContext = createContext<ClientSelfContextValue | null>(null);

// Contexte léger monté uniquement dans app/(client)/layout.tsx : porte juste la
// fiche `clients` de l'élève connecté (coach_id compris) pour éviter que chaque
// page élève refasse `clients.where(profile_id=user.id)` avant de pouvoir lancer
// sa propre requête — c'était un aller-retour réseau en série sur toutes les
// pages élève, contrairement au coach qui connaît déjà son propre id. Ne porte
// PAS les tâches/calls/stats : celles-ci restent sur le cache par page (React
// Query) déjà en place, ce contexte est complémentaire, pas un remplacement.
export function ClientSelfProvider({ children }: { children: ReactNode }) {
  const [clientRow, setClientRow] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // Attend que le SDK ait fini de restaurer la session avant de trancher :
    // au réveil d'une PWA, getUser() renvoie null le temps du rafraîchissement.
    // Sans ça, on affichait « ton coach configure ton espace » sur une session
    // pourtant valide, juste avant que le middleware ne redirige vers /login.
    const user = await resolveUser(supabase);

    // Réellement déconnecté : on garde `loading` à true pour que l'écran de
    // lancement couvre la redirection vers /login, au lieu de laisser voir un
    // état vide qui ne correspond à rien.
    if (!user) { setClientRow(null); return; }

    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('profile_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[ClientSelfContext] load:', error.message);
      setClientRow(null);
      setLoading(false);
      return;
    }

    setClientRow(data as Client | null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <ClientSelfContext.Provider value={{ clientRow, loading, refetch: load }}>
      {children}
    </ClientSelfContext.Provider>
  );
}

export function useClientSelf() {
  const ctx = useContext(ClientSelfContext);
  if (!ctx) throw new Error('useClientSelf must be used inside ClientSelfProvider');
  return ctx;
}
