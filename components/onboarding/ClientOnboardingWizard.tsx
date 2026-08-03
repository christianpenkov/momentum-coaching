'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@/lib/UserContext';
import { createClient } from '@/lib/supabase/client';
import WizardShell from './WizardShell';
import { useOnboardingWizard } from './OnboardingWizardContext';
import { buildClientWizardConfig } from '@/lib/onboarding/clientWizardConfig';

export default function ClientOnboardingWizard() {
  const { user } = useUser();
  const { isOpen, closeWizard } = useOnboardingWizard();
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

  const initialStep = user?.onboardingStep === 'in_progress' ? 'connect' : undefined;

  return (
    <WizardShell
      open={isOpen}
      onClose={closeWizard}
      config={buildClientWizardConfig(coachName)}
      initialStep={initialStep}
    />
  );
}
