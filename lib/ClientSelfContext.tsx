'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Client } from '@/lib/supabase/types';

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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setClientRow(null); setLoading(false); return; }

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
