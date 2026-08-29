'use client';

import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';

interface OnboardingWizardContextValue {
  isOpen: boolean;
  /** Tant que les intégrations obligatoires manquent, le wizard ne se ferme pas. */
  locked: boolean;
  openWizard: () => void;
  closeWizard: () => void;
}

const OnboardingWizardContext = createContext<OnboardingWizardContextValue>({
  isOpen: false,
  locked: false,
  openWizard: () => {},
  closeWizard: () => {},
});

interface OnboardingWizardProviderProps {
  children: ReactNode;
  autoOpen: boolean;
  /** Verrou d'accès : vrai tant que `clients.integrations_ready_at` est null. */
  locked?: boolean;
}

export function OnboardingWizardProvider({ children, autoOpen, locked = false }: OnboardingWizardProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const autoOpenedRef = useRef(false);

  // Auto-ouverture une seule fois au montage, uniquement si onboarding_step === 'not_started'
  // (jamais pour 'completed' ni pour null — cf backfill des comptes existants).
  useEffect(() => {
    if (autoOpen && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setIsOpen(true);
    }
  }, [autoOpen]);

  // Le verrou passe AVANT l'état local : tant qu'il tient, le wizard est ouvert et
  // le rester, quel que soit ce que l'utilisateur a cliqué. Il se lève tout seul dès
  // que le contexte relit `integrations_ready_at` — la valeur que le trigger pose en
  // base à la connexion de la 7ᵉ intégration.
  const effectiveOpen = locked || isOpen;

  return (
    <OnboardingWizardContext.Provider value={{
      isOpen: effectiveOpen,
      locked,
      openWizard: () => setIsOpen(true),
      closeWizard: () => { if (!locked) setIsOpen(false); },
    }}>
      {children}
    </OnboardingWizardContext.Provider>
  );
}

export function useOnboardingWizard() {
  return useContext(OnboardingWizardContext);
}
