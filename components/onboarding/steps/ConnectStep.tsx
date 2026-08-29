'use client';

import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import Icon from '@/components/ui/Icon';
import IntegrationConnectCard from '@/components/onboarding/IntegrationConnectCard';
import { createClient } from '@/lib/supabase/client';
import { useClientSelfSafe } from '@/lib/ClientSelfContext';
import { useOnboardingWizard } from '@/components/onboarding/OnboardingWizardContext';
import type { Integration, Provider } from '@/lib/supabase/types';
import type { WizardConfig } from '@/lib/onboarding/coachWizardConfig';

interface ConnectStepProps {
  config: WizardConfig;
}

const staggerChild = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' as const } },
};

export default function ConnectStep({ config }: ConnectStepProps) {
  const [integrations, setIntegrations] = useState<Record<string, Integration | null>>({});
  const [loading, setLoading] = useState(true);
  // Espace élève uniquement (null côté coach, qui ne monte pas ce provider) : après
  // une connexion par clé API, la page ne se recharge pas, donc `integrations_ready_at`
  // resterait à sa valeur d'il y a une minute et le verrou d'accès ne se lèverait pas
  // avant un rechargement manuel. Les connexions OAuth, elles, repassent par une
  // redirection complète et n'ont pas besoin de ça.
  const selfCtx = useClientSelfSafe();
  const relireLaFiche = selfCtx?.refetch;
  const { locked } = useOnboardingWizard();
  const [verification, setVerification] = useState(false);
  const toutEstConnecteMaisVerrouille = locked && config.integrations.every(cfg => integrations[cfg.provider]);

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
        {config.integrations.filter(cfg => !integrations[cfg.provider]).map(cfg => (
          <IntegrationConnectCard
            key={cfg.provider}
            config={cfg}
            integration={integrations[cfg.provider] || null}
            showWizardCopy
            onSaved={(updated) => { setIntegrations(prev => ({ ...prev, [cfg.provider]: updated })); relireLaFiche?.(); }}
            onDisconnected={() => { setIntegrations(prev => ({ ...prev, [cfg.provider]: null })); relireLaFiche?.(); }}
          />
        ))}
        {config.integrations.every(cfg => integrations[cfg.provider]) && (
          toutEstConnecteMaisVerrouille ? (
            // Cul-de-sac : tout est connecté, et pourtant l'accès reste fermé. Ça veut
            // dire que `clients.integrations_ready_at` n'a pas suivi — soit la fiche
            // lue à l'ouverture date d'avant la dernière connexion, soit le trigger
            // n'a pas vu passer la 7ᵉ. Sans cette issue, l'élève est enfermé devant un
            // bouton désactivé, sans rien à cliquer.
            <div style={{ textAlign: 'center', padding: '18px 0 4px' }}>
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 12 }}>
                Tes outils sont tous connectés, mais ton accès n&apos;est pas encore ouvert.
                <br />Ça prend parfois quelques secondes.
              </div>
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: 13 }}
                onClick={() => { setVerification(true); relireLaFiche?.(); setTimeout(() => setVerification(false), 1500); }}
                disabled={verification}
              >
                {verification ? 'Vérification…' : 'Vérifier à nouveau'}
              </button>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 13 }}>
              Toutes tes intégrations sont déjà connectées.
            </div>
          )
        )}
      </m.div>

      <m.div variants={staggerChild} className="onboarding-badge-secure" style={{ marginTop: 16 }}>
        <Icon name="shield" size={15} color="var(--green)" style={{ flexShrink: 0 }} />
        <span>Tes clés sont vérifiées puis stockées chiffrées.</span>
      </m.div>
    </>
  );
}
