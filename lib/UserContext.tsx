'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { detectBrowserTimeZone, DEFAULT_TIME_ZONE } from '@/lib/timezone';

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
  /** Fuseau du NAVIGATEUR — source d'autorité pour tout affichage d'heure de call.
   *  Disponible même quand `user` est null : sinon les écrans afficheraient
   *  brièvement l'heure de Paris avant de basculer, à chaque chargement. */
  timeZone: string;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  refreshUser: () => {},
  timeZone: DEFAULT_TIME_ZONE,
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());
  // Initialisé côté serveur à Paris (pas d'Intl fiable en SSR), corrigé au montage.
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  // Dernière valeur connue en base — évite un UPDATE à chaque bascule d'onglet.
  const dbTimeZoneRef = useRef<string | null>(null);
  // Id courant lu par le listener visibilitychange, qui ne doit pas se réabonner
  // à chaque changement d'utilisateur (une ref ne déclenche pas de re-render).
  const userIdRef = useRef<string | null>(null);

  // Détecte le fuseau du navigateur, met à jour l'affichage, et ne persiste en base
  // QUE s'il a réellement changé. Sans ce garde, chaque bascule d'onglet sur mobile
  // (très fréquente en PWA) déclencherait un UPDATE inutile.
  //
  // La colonne profiles.timezone ne sert QU'aux notifications serveur, qui n'ont
  // aucun autre moyen de connaître le fuseau du destinataire. L'affichage, lui,
  // utilise toujours la valeur navigateur, plus fraîche par construction.
  const syncTimeZone = useCallback((profileId: string | null) => {
    const detected = detectBrowserTimeZone();
    setTimeZone(prev => (prev === detected ? prev : detected));

    if (!profileId || detected === dbTimeZoneRef.current) return;
    dbTimeZoneRef.current = detected;
    // Jamais bloquant : si la RLS refuse ou le réseau tombe, l'app continue
    // normalement — seules les notifications resteront sur l'ancien fuseau.
    // On remet la ref à null en cas d'échec pour retenter au prochain passage.
    supabaseRef.current.from('profiles').update({ timezone: detected }).eq('id', profileId)
      .then(({ error }) => { if (error) dbTimeZoneRef.current = null; });
  }, []);

  const loadUser = useCallback(async (authUser: { id: string; email?: string } | null) => {
    const supabase = supabaseRef.current;
    userIdRef.current = authUser?.id ?? null;
    if (!authUser) { setUser(null); setLoading(false); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, full_name, avatar_url, onboarding_step, onboarding_data, timezone')
      .eq('id', authUser.id)
      .single();

    dbTimeZoneRef.current = (profile as { timezone?: string | null } | null)?.timezone ?? null;

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
    syncTimeZone(authUser.id);
  }, [syncTimeZone]);

  // Après un upload d'avatar dans les Réglages (pas de changement d'auth/session associé).
  const refreshUser = useCallback(() => {
    supabaseRef.current.auth.getSession().then(({ data: { session } }) => loadUser(session?.user ?? null));
  }, [loadUser]);

  useEffect(() => {
    const supabase = supabaseRef.current;

    // Première détection au montage — avant même de connaître l'utilisateur, pour
    // que l'affichage parte tout de suite sur le bon fuseau.
    syncTimeZone(null);

    // Charge l'utilisateur initial
    supabase.auth.getSession().then(({ data: { session } }) => {
      loadUser(session?.user ?? null);
    });

    // Écoute les changements d'auth (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      loadUser(session?.user ?? null);
    });

    // Refresh du token quand l'app PWA revient au premier plan — et re-détection
    // du fuseau au même moment. C'est le mécanisme qui fait qu'un utilisateur qui
    // atterrit dans un autre pays voit ses heures se corriger dès qu'il rouvre
    // l'app, sans rechargement : une PWA installée n'est jamais rechargée, elle
    // est seulement suspendue puis reprise.
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        supabase.auth.getSession();
        syncTimeZone(userIdRef.current);
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadUser, syncTimeZone]);

  return <UserContext.Provider value={{ user, loading, refreshUser, timeZone }}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}

/** Fuseau du lecteur — à utiliser pour TOUT affichage d'heure de call.
 *  Exposé depuis UserContext plutôt qu'en hook autonome : évite un appel à Intl
 *  par composant, et garantit une valeur unique sur tout l'écran. */
export function useViewerTimeZone(): string {
  return useContext(UserContext).timeZone;
}
