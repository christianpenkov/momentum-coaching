'use client';

import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';

interface OnboardingWizardContextValue {
  isOpen: boolean;
  openWizard: () => void;
  closeWizard: () => void;
}

const OnboardingWizardContext = createContext<OnboardingWizardContextValue>({
  isOpen: false,
  openWizard: () => {},
  closeWizard: () => {},
});

interface OnboardingWizardProviderProps {
  children: ReactNode;
  autoOpen: boolean;
}

export function OnboardingWizardProvider({ children, autoOpen }: OnboardingWizardProviderProps) {
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

  return (
    <OnboardingWizardContext.Provider value={{ isOpen, openWizard: () => setIsOpen(true), closeWizard: () => setIsOpen(false) }}>
      {children}
    </OnboardingWizardContext.Provider>
  );
}

export function useOnboardingWizard() {
  return useContext(OnboardingWizardContext);
}
