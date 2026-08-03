'use client';

import { m } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';

const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL || 'https://momentum-plateforme.vercel.app';

const staggerChild = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' as const } },
};

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
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>Sur iPhone (Safari)</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>Appuie sur le bouton Partager, puis choisis &quot;Sur l&apos;écran d&apos;accueil&quot;.</div>
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
