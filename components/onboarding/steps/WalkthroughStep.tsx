'use client';

import { m } from 'framer-motion';
import Icon from '@/components/ui/Icon';
import type { WalkthroughStepDef } from '@/lib/onboarding/coachWizardConfig';

interface WalkthroughStepProps {
  step: WalkthroughStepDef;
  onVisit: (link: string) => void;
}

const staggerChild = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' as const } },
};

export default function WalkthroughStep({ step, onVisit }: WalkthroughStepProps) {
  return (
    <m.div
      variants={staggerChild}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', borderRadius: 10,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        marginBottom: 8,
      }}
    >
      <span style={{ color: 'var(--muted)', display: 'flex', flexShrink: 0 }}>
        <Icon name={step.icon} size={15} />
      </span>
      <span style={{ fontSize: 13, color: 'var(--ink-2, var(--accent))', flex: 1 }}>{step.text}</span>
      {step.link && (
        <button
          type="button"
          onClick={() => onVisit(step.link!)}
          style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', padding: '4px 6px', flexShrink: 0 }}
        >
          Voir cette page →
        </button>
      )}
    </m.div>
  );
}
