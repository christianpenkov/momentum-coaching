'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function ResetPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    // Supabase envoie le token via le fragment URL — on attend que la session soit établie
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    if (password.length < 8) {
      setError('Le mot de passe doit faire au moins 8 caractères.');
      return;
    }
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setDone(true);
    setTimeout(() => router.push('/login'), 2500);
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', border: '1px solid var(--border)',
    borderRadius: 8, fontSize: 14, background: 'var(--surface-2)',
    color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const,
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{
        width: 400,
        background: 'var(--surface)',
        borderRadius: 16,
        border: '1px solid var(--border)',
        padding: '48px 40px',
        boxShadow: 'var(--shadow-elev)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 36 }}>
          <Image src="/logo-momentum.png" alt="Momentum" width={56} height={56} style={{ objectFit: 'contain', marginBottom: 12 }} />
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>Momentum</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Définir ton mot de passe</p>
        </div>

        {done ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>Mot de passe défini !</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Redirection vers la connexion…</div>
          </div>
        ) : !ready ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Vérification du lien en cours…
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>
                Nouveau mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>
                Confirmer le mot de passe
              </label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
                style={inputStyle}
              />
            </div>

            {error && (
              <div style={{ fontSize: 13, color: 'var(--red)', padding: '8px 12px', background: 'var(--red-soft)', borderRadius: 8 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '12px', fontSize: 14, opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Enregistrement…' : 'Définir le mot de passe'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
