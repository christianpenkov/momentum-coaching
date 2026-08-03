'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Joyride, EVENTS, STATUS, type EventData } from 'react-joyride';
import { useTour } from './TourContext';

// Piloté par TourContext : navigue lui-même entre les routes réelles à chaque étape,
// affiche un tooltip react-joyride pointé sur l'élément data-tour de la page cible.
// Rien à faire pour ajouter une future page au tour au-delà d'une ligne dans
// coachWizardConfig.ts/clientWizardConfig.ts + un attribut data-tour sur l'élément réel.
export default function TourRunner() {
  const { tourActive, tourSteps, tourStepIndex, advanceTour, stopTour } = useTour();
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  const currentStep = tourSteps[tourStepIndex];

  // Navigue vers la route de l'étape courante si on n'y est pas déjà, puis attend le
  // montage réel avant d'autoriser Joyride à chercher la cible (sinon target_not_found
  // sur une page qui n'a pas encore fini de se peindre après le router.push()).
  useEffect(() => {
    if (!tourActive || !currentStep) { setReady(false); return; }
    if (pathname !== currentStep.route) {
      setReady(false);
      router.push(currentStep.route);
      return;
    }
    const t = setTimeout(() => setReady(true), 150);
    return () => clearTimeout(t);
  }, [tourActive, currentStep, pathname, router]);

  const handleEvent = useCallback((data: EventData) => {
    const { status, type } = data;

    // SKIPPED = l'utilisateur a cliqué "Passer le tour" en cours de route — le tour
    // s'arrête sans être allé au bout, tourStepIndex reste pour une reprise ultérieure.
    if (status === STATUS.SKIPPED) {
      stopTour(false);
      return;
    }

    // step:after = l'utilisateur a cliqué Suivant sur ce step ;
    // error:target_not_found = l'élément ciblé n'existe pas (page pas montée, ou
    // refonte future qui a retiré l'attribut data-tour) — on avance quand même
    // plutôt que de bloquer sur un tooltip qui ne s'affichera jamais.
    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      if (tourStepIndex >= tourSteps.length - 1) {
        stopTour(true);
      } else {
        advanceTour();
      }
    }
  }, [tourStepIndex, tourSteps.length, advanceTour, stopTour]);

  if (!tourActive || !currentStep || !ready) return null;

  return (
    <Joyride
      run={tourActive && ready}
      continuous
      onEvent={handleEvent}
      locale={{ back: 'Précédent', close: 'Fermer', last: 'Terminer', next: 'Suivant', skip: 'Passer le tour' }}
      options={{
        primaryColor: '#3a6a86',
        showProgress: true,
        buttons: ['back', 'skip', 'primary'],
      }}
      steps={[
        {
          // Le sélecteur cible un petit marqueur dédié (TourAnchor, ~1px) posé en
          // haut de chaque page plutôt que le conteneur racine — une cible aussi
          // grande empêchait Joyride de bien positionner le tooltip et cassait le
          // découpage de l'overlay. Avec une petite cible fixe, 'auto' fonctionne
          // correctement et choisit le meilleur côté selon l'espace disponible.
          target: currentStep.selector,
          title: currentStep.title,
          content: currentStep.content,
          placement: currentStep.placement ?? 'auto',
          skipBeacon: true,
        },
      ]}
    />
  );
}
