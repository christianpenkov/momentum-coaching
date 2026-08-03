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
  onboardingStep: string | null;
  onboardingData: Record<string, unknown>;
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
      .select('role, full_name, avatar_url, onboarding_step, onboarding_data')
      .eq('id', authUser.id)
      .single();

    const fullName = profile?.full_name || authUser.email || '';
    const parts = fullName.trim().split(' ');
    const initials = parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : fullName.slice(0, 2).toUpperCase();

    const role = profile?.role || 'client';
    let onboardingStep = profile?.onboarding_step ?? null;
    let onboardingData = profile?.onboarding_data ?? {};

    // Pour un élève, la progression du wizard vit sur clients (pas profiles) —
    // requête conditionnelle, une fois qu'on connaît le rôle.
    if (role === 'client') {
      const { data: clientRow } = await supabase
        .from('clients')
        .select('onboarding_step, onboarding_data')
        .eq('profile_id', authUser.id)
        .maybeSingle();
      onboardingStep = clientRow?.onboarding_step ?? null;
      onboardingData = clientRow?.onboarding_data ?? {};
    }

    setUser({
      id: authUser.id,
      email: authUser.email || '',
      role,
      full_name: profile?.full_name || null,
      avatar_url: profile?.avatar_url || null,
      initials,
      onboardingStep,
      onboardingData,
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
