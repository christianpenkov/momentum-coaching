'use client';

import { m } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';

const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL || 'https://momentum-plateforme.vercel.app';

const staggerChild = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' as const } },
};

// Icône "..." iOS — trois points, bouton menu en bas à droite de Safari.
function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent-brand)" style={{ flexShrink: 0 }}>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

// Icône "Partager" iOS — carré avec flèche vers le haut, telle qu'affichée dans la barre Safari.
function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M12 3v13" />
      <polyline points="8 7 12 3 16 7" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

// Icône "Sur l'écran d'accueil" iOS — cadre carré avec un +, telle qu'affichée dans le menu de partage.
function AddToHomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

export default function PwaInstallStep() {
  return (
    <m.div variants={staggerChild} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ padding: 12, background: '#fff', borderRadius: 12, border: '1px solid var(--border)' }}>
          <QRCodeSVG value={PLATFORM_URL} size={120} />
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', margin: 0 }}>
        Scanne ce QR code avec ton téléphone pour ouvrir Momentum, puis installe l&apos;app sur ton écran d&apos;accueil.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Sur iPhone (Safari)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>
              <MoreIcon />
              <span>Appuie sur les <strong style={{ color: 'var(--ink)' }}>···</strong> en bas à droite de l&apos;écran.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>
              <ShareIcon />
              <span>Appuie sur l&apos;icône <strong style={{ color: 'var(--ink)' }}>Partager</strong>.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>
              <AddToHomeIcon />
              <span>Descends dans la liste jusqu&apos;à <strong style={{ color: 'var(--ink)' }}>&quot;Sur l&apos;écran d&apos;accueil&quot;</strong>.</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4, paddingLeft: 26 }}>
              Appuie ensuite sur <strong style={{ color: 'var(--accent-brand)' }}>Ajouter</strong> en haut à droite.
            </div>
          </div>
        </div>
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>Sur Android (Chrome)</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>Ouvre le menu ⋮ puis choisis &quot;Ajouter à l&apos;écran d&apos;accueil&quot; (ou accepte la bannière d&apos;installation qui apparaît automatiquement).</div>
        </div>
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            Reconnecte-toi ensuite depuis l&apos;app installée avec ton email et ton mot de passe — la session reste ouverte, tu n&apos;auras plus besoin de te reconnecter.
          </div>
        </div>
      </div>
    </m.div>
  );
}
