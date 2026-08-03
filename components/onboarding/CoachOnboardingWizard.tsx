'use client';

import { useUser } from '@/lib/UserContext';
import WizardShell from './WizardShell';
import { useOnboardingWizard } from './OnboardingWizardContext';
import { COACH_WIZARD_CONFIG } from '@/lib/onboarding/coachWizardConfig';

export default function CoachOnboardingWizard() {
  const { user } = useUser();
  const { isOpen, closeWizard } = useOnboardingWizard();

  // Si le wizard était en cours (ex: retour d'un OAuth lancé depuis l'étape connexions),
  // on rouvre directement sur l'étape connexions plutôt que de relancer l'intro.
  const initialStep = user?.onboardingStep === 'in_progress' ? 'connect' : undefined;

  return (
    <WizardShell
      open={isOpen}
      onClose={closeWizard}
      config={COACH_WIZARD_CONFIG}
      initialStep={initialStep}
    />
  );
}
