'use client';

import { m } from 'framer-motion';
import Icon from '@/components/ui/Icon';
import type { WalkthroughStepDef, WalkthroughPoint } from '@/lib/onboarding/coachWizardConfig';

interface WalkthroughStepProps {
  step: WalkthroughStepDef;
}

const staggerChild = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' as const } },
};

function PointContent({ point }: { point: WalkthroughPoint }) {
  if (typeof point === 'string') return <>{point}</>;
  return (
    <>
      {point.before ? `${point.before} ` : null}
      <span style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{point.strike}</span>{' '}
      <strong style={{ color: 'var(--accent-brand)' }}>{point.highlight}</strong>
      {point.rest ? ` ${point.rest}` : null}
    </>
  );
}

export default function WalkthroughStep({ step }: WalkthroughStepProps) {
  return (
    <m.div variants={staggerChild} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {step.points.map((point, i) => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '10px 14px', borderRadius: 10,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
        >
          <span style={{ color: 'var(--accent-brand)', display: 'flex', flexShrink: 0, marginTop: 1 }}>
            <Icon name="check" size={14} />
          </span>
          <span style={{ fontSize: 13, color: 'var(--ink-2, var(--accent))', lineHeight: 1.5 }}>
            <PointContent point={point} />
          </span>
        </div>
      ))}
    </m.div>
  );
}
