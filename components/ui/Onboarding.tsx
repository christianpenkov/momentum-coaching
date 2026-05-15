'use client';

import { useState, useEffect } from 'react';
import { LazyMotion, domAnimation, m, AnimatePresence, useReducedMotion } from 'framer-motion';
import Icon, { IconName } from './Icon';

interface OnboardingProps {
  open: boolean;
  onClose: () => void;
}

interface StepFeature {
  icon: IconName;
  text: string;
}

interface OnboardingStep {
  icon: IconName;
  iconColor: string;
  iconBg: string;
  label: string;
  title: string;
  subtitle: string;
  features: StepFeature[];
  ctaLabel: string;
  isFinal?: boolean;
  isConnect?: boolean;
}

interface ConnectTile {
  id: string;
  icon: IconName;
  name: string;
  tagline: string;
  color: string;
}

const CONNECT_TILES: ConnectTile[] = [
  { id: 'instagram', icon: 'instagram', name: 'Instagram',  tagline: 'Suivi followers & engagement',        color: '#E1306C' },
  { id: 'youtube',   icon: 'youtube',   name: 'YouTube',    tagline: 'Progression vues & abonnés',          color: '#FF0000' },
  { id: 'calendly',  icon: 'calendar',  name: 'Calendly',   tagline: 'Calls synchronisés automatiquement',  color: '#0069FF' },
  { id: 'stripe',    icon: 'stripe',    name: 'Stripe',     tagline: 'Revenus trackés en temps réel',       color: '#635BFF' },
];

const STEPS: OnboardingStep[] = [
  {
    icon: 'target',
    iconColor: 'var(--accent)',
    iconBg: 'rgba(42,42,40,0.07)',
    label: '01 / 07',
    title: 'Bienvenue sur ORBIT',
    subtitle: 'Votre espace de suivi coaching personnalisé. En quelques secondes, découvrez tout ce que la plateforme peut faire pour vous.',
    features: [
      { icon: 'zap',          text: 'Accès instantané à votre plan de la semaine' },
      { icon: 'trending-up',  text: 'Suivez vos progrès en temps réel' },
      { icon: 'users',        text: 'Restez connecté(e) à votre coach' },
    ],
    ctaLabel: 'Commencer la visite',
  },
  {
    icon: 'activity',
    iconColor: 'var(--green)',
    iconBg: 'rgba(63,138,82,0.1)',
    label: '02 / 07',
    title: 'Votre plan de la semaine',
    subtitle: 'Chaque lundi, votre coach dépose votre plan personnalisé. Cochez vos tâches au fil des jours pour suivre votre progression.',
    features: [
      { icon: 'check',    text: 'Tâches priorisées par votre coach' },
      { icon: 'calendar', text: 'Deadlines et rappels intégrés' },
      { icon: 'bar-chart',text: 'Taux de complétion affiché en temps réel' },
    ],
    ctaLabel: 'Suivant',
  },
  {
    icon: 'bar-chart',
    iconColor: 'var(--amber)',
    iconBg: 'rgba(181,128,37,0.1)',
    label: '03 / 07',
    title: 'Vos statistiques',
    subtitle: 'Visualisez vos métriques clés : followers, engagement, revenus. Comprenez d\'un coup d\'œil ce qui fonctionne.',
    features: [
      { icon: 'trending-up', text: 'Courbes de progression semaine par semaine' },
      { icon: 'target',      text: 'Objectifs et écarts mis en évidence' },
      { icon: 'eye',         text: 'Synthèse coach visible sur votre tableau' },
    ],
    ctaLabel: 'Suivant',
  },
  {
    icon: 'message-circle',
    iconColor: '#4a7fa5',
    iconBg: 'rgba(74,127,165,0.1)',
    label: '04 / 07',
    title: 'Échangez avec votre coach',
    subtitle: 'Posez vos questions, partagez vos victoires ou vos blocages. Votre coach répond directement dans l\'interface.',
    features: [
      { icon: 'send',       text: 'Messagerie directe coach ↔ élève' },
      { icon: 'bell',       text: 'Notifications de nouveaux messages' },
      { icon: 'phone-call', text: 'Retrouvez vos calls passés et à venir' },
    ],
    ctaLabel: 'Suivant',
  },
  {
    icon: 'folder',
    iconColor: 'var(--accent)',
    iconBg: 'rgba(42,42,40,0.07)',
    label: '05 / 07',
    title: 'Vos ressources exclusives',
    subtitle: 'Guides, templates, replays de calls — débloqués progressivement par votre coach selon votre avancement.',
    features: [
      { icon: 'lock',     text: 'Contenu débloqué étape par étape' },
      { icon: 'download', text: 'PDF, vidéos et templates téléchargeables' },
      { icon: 'sparkle',  text: 'Assistant IA disponible 24h/24' },
    ],
    ctaLabel: 'Suivant',
  },
  {
    icon: 'link',
    iconColor: '#4a7fa5',
    iconBg: 'rgba(74,127,165,0.1)',
    label: '06 / 07',
    title: 'Activez votre suivi',
    subtitle: 'Votre coach a besoin de ces données pour vous accompagner au meilleur niveau. Ces accès sont privés, sécurisés, et uniquement visibles par lui.',
    features: [],
    ctaLabel: 'C\'est parti →',
    isConnect: true,
  },
  {
    icon: 'award',
    iconColor: 'var(--green)',
    iconBg: 'rgba(63,138,82,0.1)',
    label: '07 / 07',
    title: 'Vous êtes prêt(e) !',
    subtitle: 'Tout est en place. Votre coach vous attend. Lancez-vous dès maintenant et commencez cette semaine avec élan.',
    features: [
      { icon: 'check', text: 'Profil activé et plan prêt' },
      { icon: 'zap',   text: 'Premier objectif déjà défini' },
      { icon: 'star',  text: 'Votre coach est en ligne' },
    ],
    ctaLabel: 'Commencer maintenant',
    isFinal: true,
  },
];

const CONFETTI_PIECES = [
  { top: '10%', left: '20%', color: 'var(--green)',  delay: '0s' },
  { top: '15%', left: '75%', color: 'var(--amber)',  delay: '0.1s' },
  { top: '5%',  left: '50%', color: 'var(--accent)', delay: '0.2s' },
  { top: '20%', left: '35%', color: 'var(--green)',  delay: '0.05s' },
  { top: '8%',  left: '60%', color: 'var(--amber)',  delay: '0.15s' },
  { top: '12%', left: '85%', color: 'var(--accent)', delay: '0.25s' },
  { top: '18%', left: '10%', color: 'var(--green)',  delay: '0.08s' },
  { top: '6%',  left: '90%', color: 'var(--amber)',  delay: '0.18s' },
];

const backdropVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.22, ease: 'easeOut' as const } },
  exit:    { opacity: 0, transition: { duration: 0.18, ease: 'easeIn' as const } },
};

const cardVariants = {
  hidden:  { opacity: 0, scale: 0.96, y: 20 },
  visible: { opacity: 1, scale: 1,    y: 0,   transition: { duration: 0.22, ease: 'easeOut' as const } },
  exit:    { opacity: 0, scale: 0.98, y: -20, transition: { duration: 0.16, ease: 'easeIn' as const } },
};

const staggerContainer = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const staggerChild = {
  hidden:  { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' as const } },
};

const checkVariants = {
  hidden:  { scale: 0, opacity: 0 },
  visible: { scale: 1, opacity: 1, transition: { type: 'spring' as const, stiffness: 400, damping: 20 } },
};

export default function Onboarding({ open, onClose }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [nextHovered, setNextHovered] = useState(false);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const reduced = useReducedMotion();

  useEffect(() => {
    if (open) { setStep(0); setConnected(new Set()); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const anyConnected = connected.size > 0;

  function handleNext() {
    if (isLast) { onClose(); } else { setStep(s => s + 1); }
  }

  function toggleConnect(id: string) {
    setConnected(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  if (reduced) {
    if (!open) return null;
    return (
      <div className="onboarding-backdrop" onClick={onClose}>
        <div onClick={e => e.stopPropagation()} style={{ width: 520, background: 'var(--surface)', borderRadius: 20, border: '1px solid var(--border)', padding: 48 }}>
          <button onClick={onClose} className="icon-btn" style={{ position: 'absolute', top: 20, right: 20 }} type="button">
            <Icon name="x" size={18} />
          </button>
          <h2 style={{ fontSize: 30, fontWeight: 800, color: 'var(--accent)', marginBottom: 16 }}>{current.title}</h2>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24 }}>{current.subtitle}</p>
          <button onClick={handleNext} className="btn-primary" type="button">{current.ctaLabel}</button>
        </div>
      </div>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence mode="wait">
        {open && (
          <m.div
            key="onboarding-backdrop"
            className="onboarding-backdrop"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Background orbs */}
            <div className="onboarding-orb-1" />
            <div className="onboarding-orb-2" />
            <div className="onboarding-orb-3" />

            {/* Close button */}
            <button
              onClick={onClose}
              type="button"
              className="icon-btn"
              style={{ position: 'absolute', top: 20, right: 20, zIndex: 10 }}
              aria-label="Fermer l'onboarding"
            >
              <Icon name="x" size={18} />
            </button>

            {/* Step card */}
            <AnimatePresence mode="wait">
              <m.div
                key={`step-${step}`}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                style={{
                  width: 520,
                  background: 'var(--surface)',
                  borderRadius: 20,
                  border: '1px solid var(--border)',
                  boxShadow: '0 32px 80px rgba(0,0,0,0.10), 0 4px 16px rgba(0,0,0,0.06)',
                  padding: current.isConnect ? '40px 40px 32px' : '48px 48px 40px',
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                <m.div variants={staggerContainer} initial="hidden" animate="visible">

                  {/* Step counter */}
                  <m.div variants={staggerChild} style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 24, textTransform: 'uppercase' as const }}>
                    {current.label}
                  </m.div>

                  {/* Icon */}
                  <m.div variants={staggerChild} style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
                    <m.div
                      style={{
                        width: 80, height: 80, borderRadius: 20,
                        background: current.iconBg,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        position: 'relative',
                      }}
                      animate={current.isFinal ? { scale: [1, 1.08, 1] } : {}}
                      transition={current.isFinal ? { repeat: Infinity, duration: 2.4, ease: 'easeInOut' } as object : {}}
                    >
                      <Icon name={current.icon} size={36} color={current.iconColor} />
                      {current.isFinal && CONFETTI_PIECES.map((p, i) => (
                        <span
                          key={i}
                          className="onboarding-confetti-piece"
                          style={{
                            top: p.top, left: p.left,
                            background: p.color,
                            animationDelay: p.delay,
                          }}
                        />
                      ))}
                    </m.div>
                  </m.div>

                  {/* Title */}
                  <m.div variants={staggerChild}>
                    <h2 style={{ fontSize: current.isConnect ? 24 : 30, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.5px', textAlign: 'center', margin: '0 0 8px' }}>
                      {current.title}
                    </h2>
                  </m.div>

                  {/* Subtitle */}
                  <m.div variants={staggerChild}>
                    <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', maxWidth: 400, margin: '0 auto 20px', lineHeight: 1.65 }}>
                      {current.subtitle}
                    </p>
                  </m.div>

                  {/* Connect grid (step isConnect) OR Feature rows */}
                  {current.isConnect ? (
                    <>
                      <m.div variants={staggerChild} className="onboarding-connect-grid">
                        {CONNECT_TILES.map(tile => {
                          const isConn = connected.has(tile.id);
                          return (
                            <div
                              key={tile.id}
                              className={`onboarding-connect-tile${isConn ? ' connected' : ''}`}
                            >
                              <div className="onboarding-connect-tile-header">
                                <Icon name={tile.icon} size={20} color={tile.color} />
                                {isConn && (
                                  <m.span
                                    variants={checkVariants}
                                    initial="hidden"
                                    animate="visible"
                                    style={{ color: 'var(--green)', display: 'flex' }}
                                  >
                                    <Icon name="check" size={14} />
                                  </m.span>
                                )}
                              </div>
                              <div className="onboarding-connect-tile-name">{tile.name}</div>
                              <div className="onboarding-connect-tile-tagline">{tile.tagline}</div>
                              <button
                                type="button"
                                className={`onboarding-connect-btn${isConn ? ' connected' : ''}`}
                                onClick={() => toggleConnect(tile.id)}
                              >
                                {isConn ? (
                                  <><Icon name="check" size={11} color="#fff" /> Connecté</>
                                ) : (
                                  <><Icon name="link" size={11} color="#fff" /> Connecter</>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </m.div>

                      {/* Security badge */}
                      <m.div variants={staggerChild} className="onboarding-badge-secure">
                        <Icon name="shield" size={15} color="var(--green)" style={{ flexShrink: 0 }} />
                        <span>Vos données sont privées et sécurisées. Accessibles uniquement par votre coach.</span>
                      </m.div>
                    </>
                  ) : (
                    current.features.map((f, i) => (
                      <m.div
                        key={i}
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
                          <Icon name={f.icon} size={15} />
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--ink-2, var(--accent))' }}>{f.text}</span>
                      </m.div>
                    ))
                  )}

                  {/* CTA */}
                  <m.div variants={staggerChild} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 24 }}>
                    <button
                      type="button"
                      onClick={handleNext}
                      onMouseEnter={() => setNextHovered(true)}
                      onMouseLeave={() => setNextHovered(false)}
                      disabled={current.isConnect && !anyConnected}
                      style={{
                        background: current.isConnect && !anyConnected ? 'var(--border)' : 'var(--accent)',
                        color: current.isConnect && !anyConnected ? 'var(--muted)' : '#fff',
                        border: 'none', borderRadius: 10,
                        padding: '13px 32px', fontSize: 14, fontWeight: 600,
                        cursor: current.isConnect && !anyConnected ? 'not-allowed' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        fontFamily: 'inherit',
                        transition: 'background 120ms, transform 80ms, color 120ms',
                        transform: nextHovered && !(current.isConnect && !anyConnected) ? 'translateY(-1px)' : 'translateY(0)',
                        boxShadow: nextHovered && !(current.isConnect && !anyConnected) ? '0 6px 20px rgba(42,42,40,0.18)' : '0 2px 8px rgba(42,42,40,0.10)',
                      }}
                    >
                      {current.ctaLabel}
                      <span style={{ display: 'inline-flex', transition: 'transform 120ms', transform: nextHovered ? 'translateX(3px)' : 'translateX(0)' }}>
                        <Icon name="arrowR" size={15} color={current.isConnect && !anyConnected ? 'var(--muted)' : '#fff'} />
                      </span>
                    </button>

                    {(!isLast) && (
                      <button
                        type="button"
                        onClick={current.isConnect ? handleNext : onClose}
                        style={{ fontSize: 12, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '4px 8px' }}
                      >
                        {current.isConnect ? 'Passer cette étape' : 'Passer l\'introduction'}
                      </button>
                    )}
                  </m.div>

                  {/* Progress dots */}
                  <m.div variants={staggerChild} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 7, marginTop: 20 }}>
                    {STEPS.map((_, i) => (
                      <m.div
                        key={i}
                        layout
                        transition={{ duration: 0.2, ease: 'easeOut' } as object}
                        style={{
                          borderRadius: '50%',
                          background: i === step ? 'var(--accent)' : i < step ? 'var(--green)' : 'var(--border)',
                          width:  i === step ? 10 : 7,
                          height: i === step ? 10 : 7,
                          flexShrink: 0,
                          cursor: 'pointer',
                        }}
                        onClick={() => setStep(i)}
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
