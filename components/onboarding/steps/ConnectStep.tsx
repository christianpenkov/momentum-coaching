'use client';

import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import Icon from '@/components/ui/Icon';
import IntegrationConnectCard from '@/components/onboarding/IntegrationConnectCard';
import { createClient } from '@/lib/supabase/client';
import type { Integration, Provider } from '@/lib/supabase/types';
import type { WizardConfig } from '@/lib/onboarding/coachWizardConfig';

interface ConnectStepProps {
  config: WizardConfig;
  onSkipInstagram: () => void;
}

const staggerChild = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' as const } },
};

export default function ConnectStep({ config, onSkipInstagram }: ConnectStepProps) {
  const [integrations, setIntegrations] = useState<Record<string, Integration | null>>({});
  const [loading, setLoading] = useState(true);

  // Auto-détection à l'ouverture : lit ce qui est déjà connecté (ex: coach ayant déjà
  // configuré Stripe depuis Réglages avant que ce wizard existe) plutôt que de tout
  // redemander — pattern "checklist intelligente" (Asana/ClickUp).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: integs } = await supabase.from('integrations')
        .select('id, profile_id, provider, account_label, connected_at')
        .eq('profile_id', user.id);

      if (cancelled) return;
      const map: Record<string, Integration | null> = {};
      config.integrations.forEach(cfg => { map[cfg.provider] = null; });
      (integs || []).forEach(i => {
        map[i.provider] = { ...i, access_token: null, refresh_token: null, api_key: null, expires_at: null } as Integration;
      });
      setIntegrations(map);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [config.integrations]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 13 }}>
        Chargement de tes connexions…
      </div>
    );
  }

  return (
    <>
      <m.div variants={staggerChild} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {config.integrations.map(cfg => (
          <IntegrationConnectCard
            key={cfg.provider}
            config={cfg}
            integration={integrations[cfg.provider] || null}
            showWizardCopy
            onSaved={(updated) => setIntegrations(prev => ({ ...prev, [cfg.provider]: updated }))}
            onDisconnected={() => setIntegrations(prev => ({ ...prev, [cfg.provider]: null }))}
            onSkip={cfg.provider === 'instagram' ? onSkipInstagram : undefined}
          />
        ))}
      </m.div>

      <m.div variants={staggerChild} className="onboarding-badge-secure" style={{ marginTop: 16 }}>
        <Icon name="shield" size={15} color="var(--green)" style={{ flexShrink: 0 }} />
        <span>Tes clés sont vérifiées puis stockées chiffrées. Tu peux passer une étape et y revenir plus tard depuis Réglages.</span>
      </m.div>
    </>
  );
}
