'use client';

import { useIsMobile } from '@/lib/useIsMobile';

// Bloque les pages denses/techniques sur mobile plutôt que de les rendre responsive —
// décision produit : Analytics, Stats-v2/v3, api-debug, ig-live, metrics restent
// desktop-only. Utilise useIsMobile (source unique du breakpoint, lib/useIsMobile.ts).
export default function DesktopOnly({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="page-content">
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', padding: '64px 24px', gap: 12,
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>Disponible sur ordinateur</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 280 }}>
            Cette page est optimisée pour un grand écran. Ouvre Momentum sur ton ordinateur pour y accéder.
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
