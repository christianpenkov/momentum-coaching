'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@/lib/UserContext';
import { createClient } from '@/lib/supabase/client';
import WizardShell from './WizardShell';
import { useOnboardingWizard } from './OnboardingWizardContext';
import { buildClientWizardConfig } from '@/lib/onboarding/clientWizardConfig';

export default function ClientOnboardingWizard() {
  const { user } = useUser();
  const { isOpen, closeWizard, locked } = useOnboardingWizard();
  const [coachName, setCoachName] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    supabase.from('clients').select('coach_id').eq('profile_id', user.id).maybeSingle()
      .then(({ data }) => {
        if (data?.coach_id) {
          supabase.from('profiles').select('full_name').eq('id', data.coach_id).maybeSingle()
            .then(({ data: p }) => { if (p?.full_name) setCoachName(p.full_name.split(' ')[0]); });
        }
      });
  }, [user?.id]);

  // Verrouillé : on ouvre directement sur l'écran de connexion. L'écran de bienvenue
  // reste accessible par les pastilles, mais ce n'est pas ce qu'on demande à l'élève.
  const initialStep = locked || user?.onboardingStep === 'in_progress' ? 'connect' : undefined;

  return (
    <WizardShell
      open={isOpen}
      onClose={closeWizard}
      config={buildClientWizardConfig(coachName)}
      initialStep={initialStep}
      locked={locked}
    />
  );
}
