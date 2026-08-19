'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Icon, { IconName } from '../ui/Icon';

const MORE_NAV: { href: string; icon: IconName; label: string }[] = [
  // En tête : écran consulté quotidiennement, contrairement aux réglages.
  { href: '/client/paiements', icon: 'circle-dollar-sign', label: 'Paiements' },
  { href: '/client/calendar-mobile', icon: 'calendar', label: 'Calendrier' },
  { href: '/client/liens', icon: 'link', label: 'Liens' },
  { href: '/client/taches', icon: 'task-check', label: 'Tâches' },
  { href: '/client/ressources', icon: 'folder', label: 'Ressources' },
  { href: '/client/settings', icon: 'settings', label: 'Réglages' },
];

// Doit rester aligné sur la transition CSS ci-dessous : le composant reste monté
// le temps de l'animation de sortie, sinon React le démonte instantanément et
// le panneau saute au lieu de redescendre.
//
// Volontairement court : au-delà, la descente se fait sentir comme un délai
// avant l'écran suivant. Une sortie est toujours plus rapide qu'une entrée —
// l'utilisateur a déjà décidé, on ne le fait pas patienter.
const EXIT_MS = 160;

export default function ClientMoreSheet({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const sheetRef = useRef<HTMLDivElement>(null);
  // 'entering' le temps d'un frame pour que la transition CSS ait un état de
  // départ à animer ; 'open' ensuite ; 'closing' pendant la sortie.
  const [phase, setPhase] = useState<'entering' | 'open' | 'closing'>('entering');

  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Ferme en jouant l'animation de sortie, puis prévient le parent qui démonte.
  const close = useCallback(() => {
    setPhase('closing');
    setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  // Navigation lancée TOUT DE SUITE, panneau qui redescend par-dessus : la page
  // charge pendant l'animation au lieu d'attendre sa fin. Attendre rendait le
  // menu perceptiblement plus lent que la navigation directe.
  //
  // Le démontage reste différé (onClose après l'animation) pour que la descente
  // ait le temps de se jouer : c'est le re-rendu du layout par la navigation
  // qui, sinon, retirerait le panneau instantanément.
  const closeThen = useCallback((href: string) => {
    setPhase('closing');
    router.push(href);
    setTimeout(onClose, EXIT_MS);
  }, [onClose, router]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [close]);

  // Échap ferme aussi : le panneau est une couche modale, elle doit se comporter
  // comme telle au clavier.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  const shown = phase === 'open';

  return createPortal(
    <>
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 1999,
          background: 'rgba(0,0,0,0.25)',
          opacity: shown ? 1 : 0,
          transition: `opacity ${EXIT_MS}ms ease-out`,
        }}
        onClick={close}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        style={{
          position: 'fixed',
          left: 0, right: 0, bottom: 0,
          zIndex: 2000,
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
          // Glisse depuis le bas : une bottom sheet native monte, elle
          // n'apparaît jamais d'un coup. Sortie plus rapide que l'entrée —
          // l'utilisateur a déjà décidé, inutile de le faire attendre.
          transform: shown ? 'translateY(0)' : 'translateY(100%)',
          transition: shown
            ? 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)'
            : `transform ${EXIT_MS}ms cubic-bezier(0.4, 0, 1, 1)`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>
        <div style={{ padding: '4px 8px 8px' }}>
          {MORE_NAV.map(({ href, icon, label }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                // preventDefault + closeThen : la navigation part tout de
                // suite, mais le démontage du panneau est différé pour qu'il ait
                // le temps de redescendre. Laisser le Link agir seul ferait
                // démonter le panneau par le re-rendu, sans aucune animation.
                onClick={(e) => { e.preventDefault(); closeThen(href); }}
                className={`nav-item${active ? ' active' : ''}`}
                style={{ padding: '14px 12px', fontSize: 15 }}
              >
                <Icon name={icon} size={18} />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </>,
    document.body
  );
}
