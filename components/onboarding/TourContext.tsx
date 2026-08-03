'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { TourStepDef } from '@/lib/onboarding/coachWizardConfig';

const SESSION_KEY = 'momentum_tour_step';

interface TourContextValue {
  tourActive: boolean;
  tourSteps: TourStepDef[];
  tourStepIndex: number;
  startTour: (steps: TourStepDef[], onComplete: () => void, fromIndex?: number) => void;
  advanceTour: () => void;
  stopTour: (completed?: boolean) => void;
}

const TourContext = createContext<TourContextValue>({
  tourActive: false,
  tourSteps: [],
  tourStepIndex: 0,
  startTour: () => {},
  advanceTour: () => {},
  stopTour: () => {},
});

export function TourProvider({ children }: { children: ReactNode }) {
  const [tourActive, setTourActive] = useState(false);
  const [tourSteps, setTourSteps] = useState<TourStepDef[]>([]);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [onCompleteCb, setOnCompleteCb] = useState<(() => void) | null>(null);

  // Ceinture-bretelles : survit à un hard-refresh en plein tour (le state React seul
  // ne survivrait pas, sessionStorage si).
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed)) setTourStepIndex(parsed);
    }
  }, []);

  const startTour = useCallback((steps: TourStepDef[], onComplete: () => void, fromIndex = 0) => {
    setTourSteps(steps);
    setTourStepIndex(fromIndex);
    setTourActive(true);
    setOnCompleteCb(() => onComplete);
  }, []);

  const advanceTour = useCallback(() => {
    setTourStepIndex(prev => {
      const next = prev + 1;
      sessionStorage.setItem(SESSION_KEY, String(next));
      return next;
    });
  }, []);

  const stopTour = useCallback((completed = false) => {
    // Ne réinitialise tourStepIndex QUE si le tour est allé jusqu'au bout — reprise
    // exacte demandée : un futur startTour() via le bouton "Guide de démarrage" doit
    // reprendre à l'étape sauvegardée s'il a été interrompu en cours de route.
    setTourActive(false);
    if (completed) {
      sessionStorage.removeItem(SESSION_KEY);
      setTourStepIndex(0);
      onCompleteCb?.();
    }
  }, [onCompleteCb]);

  return (
    <TourContext.Provider value={{ tourActive, tourSteps, tourStepIndex, startTour, advanceTour, stopTour }}>
      {children}
    </TourContext.Provider>
  );
}

export function useTour() {
  return useContext(TourContext);
}
