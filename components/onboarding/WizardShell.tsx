'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Image from 'next/image';
import { LazyMotion, domAnimation, m, AnimatePresence, useReducedMotion } from 'framer-motion';
import Icon from '@/components/ui/Icon';
import ConnectStep from './steps/ConnectStep';
import WalkthroughStep from './steps/WalkthroughStep';
import PwaInstallStep from './steps/PwaInstallStep';
import type { WizardConfig } from '@/lib/onboarding/coachWizardConfig';

interface WizardShellProps {
  open: boolean;
  onClose: () => void;
  config: WizardConfig;
  initialStep?: string;
  /** Verrou d'accès : le wizard ne se ferme pas et s'arrête à l'étape « connect »
   *  tant que les intégrations obligatoires ne sont pas toutes connectées. */
  locked?: boolean;
}

const CONFETTI_PIECES = [
  { top: '10%', left: '20%', color: 'var(--green)', delay: '0s' },
  { top: '15%', left: '75%', color: 'var(--amber)', delay: '0.1s' },
  { top: '5%', left: '50%', color: 'var(--accent)', delay: '0.2s' },
  { top: '20%', left: '35%', color: 'var(--green)', delay: '0.05s' },
  { top: '8%', left: '60%', color: 'var(--amber)', delay: '0.15s' },
  { top: '12%', left: '85%', color: 'var(--accent)', delay: '0.25s' },
  { top: '18%', left: '10%', color: 'var(--green)', delay: '0.08s' },
  { top: '6%', left: '90%', color: 'var(--amber)', delay: '0.18s' },
];

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.22, ease: 'easeOut' as const } },
  exit: { opacity: 0, transition: { duration: 0.18, ease: 'easeIn' as const } },
};

const cardVariants = {
  hidden: { opacity: 0, scale: 0.96, y: 20 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' as const } },
  exit: { opacity: 0, scale: 0.98, y: -20, transition: { duration: 0.16, ease: 'easeIn' as const } },
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const staggerChild = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' as const } },
};

// Étapes fixes : welcome -> connect -> walkthrough[0..n] -> pwa -> final. Le
// walkthrough reste une carte informative dans cette même modale (pas de
// navigation réelle) — l'utilisateur lit et clique Suivant sans jamais quitter
// le wizard. L'étape 'pwa' (installation sur l'écran d'accueil) est identique
// pour les deux rôles, juste avant l'écran de fin.
type PhaseStep = { key: string; kind: 'welcome' | 'connect' | 'walkthrough' | 'pwa' | 'final'; walkthroughIndex?: number };

function buildSteps(config: WizardConfig, locked = false): PhaseStep[] {
  const steps: PhaseStep[] = [
    { key: 'welcome', kind: 'welcome' },
    { key: 'connect', kind: 'connect' },
  ];
  // Verrouillé : le parcours s'arrête à « connect ». Montrer la visite guidée d'un
  // produit auquel on n'a pas encore accès n'apprend rien et brouille le seul geste
  // attendu. Les étapes réapparaissent d'elles-mêmes dès que le verrou se lève.
  if (locked) return steps;
  config.walkthroughSteps.forEach((_, i) => steps.push({ key: `walkthrough-${i}`, kind: 'walkthrough', walkthroughIndex: i }));
  steps.push({ key: 'pwa', kind: 'pwa' });
  steps.push({ key: 'final', kind: 'final' });
  return steps;
}

async function persistProgress(step: string, data?: Record<string, unknown>) {
  try {
    await fetch('/api/onboarding/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step, data }),
    });
  } catch {
    // Best-effort — la progression se recalcule de toute façon depuis onboarding_step
    // au prochain chargement ; un échec réseau ponctuel ne doit pas bloquer le wizard.
  }
}

export default function WizardShell({ open, onClose, config, initialStep, locked = false }: WizardShellProps) {
  const reduced = useReducedMotion();
  const steps = useMemo(() => buildSteps(config, locked), [config, locked]);

  const findIndex = useCallback((key?: string) => {
    const idx = steps.findIndex(s => s.key === key);
    return idx >= 0 ? idx : 0;
  }, [steps]);

  const [index, setIndex] = useState(() => findIndex(initialStep));
  const [nextHovered, setNextHovered] = useState(false);

  // Ne resynchronise l'étape que sur une vraie transition fermé -> ouvert (ex: réouverture
  // manuelle via le bouton sidebar), jamais à chaque render — sinon ce useEffect écrase
  // silencieusement la progression de handleNext() au render suivant, puisque `steps`
  // (et donc `findIndex`) est recréé à chaque render sans cette protection.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) setIndex(findIndex(initialStep));
    wasOpenRef.current = open;
  }, [open, initialStep, findIndex]);

  useEffect(() => {
    if (!open || locked) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, locked]);

  // `index` peut pointer au-delà de la liste quand le verrou se pose alors que
  // l'utilisateur était plus loin dans le parcours (il a connecté 6 outils, puis en
  // a déconnecté un). Sans ce recadrage, `steps[index]` vaut undefined et le rendu
  // casse.
  const safeIndex = Math.min(index, steps.length - 1);
  const current = steps[safeIndex];
  const isLast = safeIndex === steps.length - 1;
  // Verrouillé sur la dernière étape disponible : il n'y a nulle part où aller tant
  // que les intégrations manquent.
  const bloqueIci = locked && current.kind === 'connect';

  function goToIndex(i: number, opts?: { markInProgress?: boolean }) {
    setIndex(i);
    const target = steps[i];
    if (target.kind === 'final') {
      persistProgress('completed');
    } else if (opts?.markInProgress !== false) {
      persistProgress('in_progress');
    }
  }

  function handleNext() {
    // Verrouillé : ni avancer, ni marquer l'onboarding terminé. Le bouton est déjà
    // désactivé, cette garde couvre les autres chemins (clavier, pastilles).
    if (bloqueIci) return;
    if (isLast) {
      persistProgress('completed');
      onClose();
      return;
    }
    goToIndex(safeIndex + 1);
  }

  const libelleBouton = bloqueIci
    ? 'Connecte tes outils pour continuer'
    : isLast ? 'Terminer'
    : current.kind === 'connect' ? 'Continuer vers la visite →'
    : 'Suivant';

  if (!open) return null;

  if (reduced) {
    return (
      <div className="onboarding-backdrop" onClick={locked ? undefined : onClose}>
        <div onClick={e => e.stopPropagation()} style={{ width: 520, background: 'var(--surface)', borderRadius: 20, border: '1px solid var(--border)', padding: 48, position: 'relative' }}>
          {!locked && (
            <button onClick={onClose} className="icon-btn" style={{ position: 'absolute', top: 20, right: 20 }} type="button">
              <Icon name="x" size={18} />
            </button>
          )}
          <StepBody current={current} config={config} />
          <button onClick={handleNext} disabled={bloqueIci} className="btn-primary-brand" type="button" style={{ marginTop: 16, opacity: bloqueIci ? 0.5 : 1, cursor: bloqueIci ? 'not-allowed' : 'pointer' }}>
            {libelleBouton}
          </button>
        </div>
      </div>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence mode="wait">
        {open && (
          <m.div key="onboarding-backdrop" className="onboarding-backdrop" variants={backdropVariants} initial="hidden" animate="visible" exit="exit">
            <div className="onboarding-orb-1" />
            <div className="onboarding-orb-2" />
            <div className="onboarding-orb-3" />

            {/* Pas de croix quand l'accès est verrouillé : il n'y a rien derrière à
                atteindre tant que les intégrations obligatoires manquent. */}
            {!locked && (
              <button onClick={onClose} type="button" className="icon-btn" style={{ position: 'absolute', top: 20, right: 20, zIndex: 10 }} aria-label="Fermer le guide de démarrage">
                <Icon name="x" size={18} />
              </button>
            )}

            <AnimatePresence mode="wait">
              <m.div
                key={`step-${safeIndex}`}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                style={{
                  width: 520,
                  maxHeight: '88vh',
                  overflowY: 'auto',
                  background: 'var(--surface)',
                  borderRadius: 20,
                  border: '1px solid var(--border)',
                  boxShadow: '0 32px 80px rgba(0,0,0,0.10), 0 4px 16px rgba(0,0,0,0.06)',
                  padding: current.kind === 'connect' ? '40px 40px 32px' : '48px 48px 40px',
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                <m.div variants={staggerContainer} initial="hidden" animate="visible">
                  <m.div variants={staggerChild} className="eyebrow-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)', marginBottom: 24 }}>
                    {safeIndex + 1} / {steps.length}
                  </m.div>

                  <StepBody current={current} config={config} />

                  <m.div variants={staggerChild} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 24 }}>
                    <button
                      type="button"
                      onClick={handleNext}
                      disabled={bloqueIci}
                      onMouseEnter={() => setNextHovered(true)}
                      onMouseLeave={() => setNextHovered(false)}
                      style={{
                        background: 'var(--accent-brand)', color: '#fff',
                        border: 'none', borderRadius: 10,
                        padding: '13px 32px', fontSize: 14, fontWeight: 600,
                        cursor: bloqueIci ? 'not-allowed' : 'pointer',
                        opacity: bloqueIci ? 0.45 : 1,
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        fontFamily: 'inherit',
                        transition: 'background 120ms, transform 80ms, color 120ms',
                        transform: nextHovered && !bloqueIci ? 'translateY(-1px)' : 'translateY(0)',
                        boxShadow: nextHovered && !bloqueIci ? '0 6px 20px rgba(42,42,40,0.18)' : '0 2px 8px rgba(42,42,40,0.10)',
                      }}
                    >
                      {libelleBouton}
                      {!bloqueIci && (
                        <span style={{ display: 'inline-flex', transition: 'transform 120ms', transform: nextHovered ? 'translateX(3px)' : 'translateX(0)' }}>
                          <Icon name="arrowR" size={15} color="#fff" />
                        </span>
                      )}
                    </button>
                  </m.div>

                  <m.div variants={staggerChild} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 7, marginTop: 20, flexWrap: 'wrap', maxWidth: 400, margin: '20px auto 0' }}>
                    {steps.map((_, i) => (
                      <m.div
                        key={i}
                        layout
                        transition={{ duration: 0.2, ease: 'easeOut' } as object}
                        style={{
                          borderRadius: '50%',
                          background: i === safeIndex ? 'var(--accent-brand)' : i < safeIndex ? 'var(--green)' : 'var(--border)',
                          width: i === safeIndex ? 10 : 7,
                          height: i === safeIndex ? 10 : 7,
                          flexShrink: 0,
                          cursor: 'pointer',
                        }}
                        onClick={() => goToIndex(i)}
                      />
                    ))}
                  </m.div>
                </m.div>
              </m.div>
            </AnimatePresence>
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}

function StepBody({ current, config }: {
  current: PhaseStep;
  config: WizardConfig;
}) {
  if (current.kind === 'welcome') {
    return (
      <>
        <m.div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ position: 'absolute', inset: -18, borderRadius: '50%', background: 'radial-gradient(circle, rgba(58,106,134,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ width: 80, height: 80, borderRadius: 20, background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              <Image src="/logo-momentum.png" alt="Momentum" width={48} height={48} style={{ objectFit: 'contain' }} />
            </div>
          </span>
        </m.div>
        <Title>{config.welcomeTitle}</Title>
        <Subtitle>{config.welcomeSubtitle}</Subtitle>
      </>
    );
  }

  if (current.kind === 'connect') {
    return (
      <>
        <IconHeader icon="link" iconColor="#4a7fa5" iconBg="rgba(74,127,165,0.1)" />
        <Title small>Active tes connexions</Title>
        <Subtitle>Connecte tes outils pour activer le suivi.</Subtitle>
        <ConnectStep config={config} />
      </>
    );
  }

  if (current.kind === 'walkthrough' && current.walkthroughIndex !== undefined) {
    const step = config.walkthroughSteps[current.walkthroughIndex];
    return (
      <>
        <IconHeader icon={step.icon} iconColor="var(--accent-brand)" iconBg="rgba(58,106,134,0.1)" />
        <Title small>{step.title}</Title>
        <WalkthroughStep step={step} />
      </>
    );
  }

  if (current.kind === 'pwa') {
    return (
      <>
        <IconHeader icon="download" iconColor="var(--accent-brand)" iconBg="rgba(58,106,134,0.1)" />
        <Title small>Installe l&apos;app sur ton téléphone</Title>
        <Subtitle>Accède à Momentum en un tap, comme une vraie application.</Subtitle>
        <PwaInstallStep />
      </>
    );
  }

  // final
  return (
    <>
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
        <span style={{ position: 'absolute', inset: -18, borderRadius: '50%', background: 'radial-gradient(circle, rgba(63,138,82,0.22) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <m.div
          style={{ width: 80, height: 80, borderRadius: 20, background: 'rgba(63,138,82,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', margin: '0 auto 24px' }}
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' } as object}
        >
          <Icon name="award" size={36} color="var(--green)" />
          {CONFETTI_PIECES.map((p, i) => (
            <span key={i} className="onboarding-confetti-piece" style={{ top: p.top, left: p.left, background: p.color, animationDelay: p.delay }} />
          ))}
        </m.div>
      </span>
      <Title>Tu es prêt(e) !</Title>
      <Subtitle>Tout est en place. Lance-toi dès maintenant.</Subtitle>
    </>
  );
}

function IconHeader({ icon, iconColor, iconBg }: { icon: Parameters<typeof Icon>[0]['name']; iconColor: string; iconBg: string }) {
  return (
    <m.div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ position: 'absolute', inset: -18, borderRadius: '50%', background: `radial-gradient(circle, ${iconColor.startsWith('var') ? 'rgba(160,160,150,0.22)' : iconColor + '22'} 0%, transparent 70%)`, pointerEvents: 'none' }} />
        <div style={{ width: 80, height: 80, borderRadius: 20, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <Icon name={icon} size={36} color={iconColor} />
        </div>
      </span>
    </m.div>
  );
}

function Title({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return (
    <m.div>
      <h2 style={{ fontSize: small ? 24 : 30, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.5px', textAlign: 'center', margin: '0 0 8px' }}>
        {children}
      </h2>
    </m.div>
  );
}

function Subtitle({ children }: { children: React.ReactNode }) {
  return (
    <m.div>
      <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', maxWidth: 400, margin: '0 auto 20px', lineHeight: 1.65 }}>
        {children}
      </p>
    </m.div>
  );
}
