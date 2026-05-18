'use client';

import Image from 'next/image';
import { useSearchParams } from 'next/navigation';

export default function SignupConfirmPage() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{
        width: 420,
        background: 'var(--surface)',
        borderRadius: 16,
        border: '1px solid var(--border)',
        padding: '48px 40px',
        boxShadow: 'var(--shadow-elev)',
        textAlign: 'center',
      }}>
        <Image src="/logo-momentum.png" alt="Momentum" width={52} height={52} style={{ objectFit: 'contain', marginBottom: 16 }} />
        <div style={{ fontSize: 32, marginBottom: 12 }}>📩</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', margin: '0 0 10px' }}>
          Vérifie ta boîte mail
        </h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
          On t'a envoyé un lien de confirmation à <strong style={{ color: 'var(--accent)' }}>{email}</strong>.
          <br />Clique dessus pour activer ton accès Momentum.
        </p>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 24 }}>
          Pas reçu ? Vérifie tes spams ou contacte-nous.
        </p>
      </div>
    </div>
  );
}
