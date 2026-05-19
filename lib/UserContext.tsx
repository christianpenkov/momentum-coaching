'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';

interface UserProfile {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  initials: string;
}

interface UserContextValue {
  user: UserProfile | null;
  loading: boolean;
}

const UserContext = createContext<UserContextValue>({ user: null, loading: true });

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) { setLoading(false); return; }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
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
        initials,
      });
      setLoading(false);
    }
    load();
  }, []);

  return <UserContext.Provider value={{ user, loading }}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}
