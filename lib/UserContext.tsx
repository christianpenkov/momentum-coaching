'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';

interface UserProfile {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  avatar_url: string | null;
  initials: string;
}

interface UserContextValue {
  user: UserProfile | null;
  loading: boolean;
  refreshUser: () => void;
}

const UserContext = createContext<UserContextValue>({ user: null, loading: true, refreshUser: () => {} });

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());

  const loadUser = useCallback(async (authUser: { id: string; email?: string } | null) => {
    const supabase = supabaseRef.current;
    if (!authUser) { setUser(null); setLoading(false); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, full_name, avatar_url')
      .eq('id', authUser.id)
      .single();

    const fullName = profile?.full_name || authUser.email || '';
    const parts = fullName.trim().split(' ');
    const initials = parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : fullName.slice(0, 2).toUpperCase();

    setUser({
      id: authUser.id,
      email: authUser.email || '',
      role: profile?.role || 'client',
      full_name: profile?.full_name || null,
      avatar_url: profile?.avatar_url || null,
      initials,
    });
    setLoading(false);
  }, []);

  // Après un upload d'avatar dans les Réglages (pas de changement d'auth/session associé).
  const refreshUser = useCallback(() => {
    supabaseRef.current.auth.getSession().then(({ data: { session } }) => loadUser(session?.user ?? null));
  }, [loadUser]);

  useEffect(() => {
    const supabase = supabaseRef.current;

    // Charge l'utilisateur initial
    supabase.auth.getSession().then(({ data: { session } }) => {
      loadUser(session?.user ?? null);
    });

    // Écoute les changements d'auth (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      loadUser(session?.user ?? null);
    });

    // Refresh du token quand l'app PWA revient au premier plan
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        supabase.auth.getSession();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadUser]);

  return <UserContext.Provider value={{ user, loading, refreshUser }}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}
