'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [resetSent, setResetSent] = useState(false);

  const submitRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError('Email ou mot de passe incorrect.');
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();

    // Stocker la position du bouton pour l'iris wipe dans PageTransition
    const btn = submitRef.current;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      sessionStorage.setItem('iris-origin', JSON.stringify({
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      }));
    }

    router.push(profile?.role === 'coach' ? '/dashboard' : '/client');
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset`,
    });

    if (error) {
      setError("Erreur lors de l'envoi. Vérifiez l'email.");
      setLoading(false);
      return;
    }

    setResetSent(true);
    setLoading(false);
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', border: '1px solid var(--border)',
    borderRadius: 8, fontSize: 14, background: 'var(--surface-2)',
    color: 'var(--ink)', fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box' as const,
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
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Plateforme coaching</p>
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ton@email.fr" required style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>Mot de passe</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required style={inputStyle} />
            </div>
            {error && (
              <div style={{ fontSize: 13, color: 'var(--red)', padding: '8px 12px', background: 'var(--red-soft)', borderRadius: 8 }}>{error}</div>
            )}
            <button
              ref={submitRef}
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '12px', fontSize: 14, opacity: loading ? 0.7 : 1, transition: 'opacity .15s' }}
            >
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
            <button type="button" onClick={() => { setMode('reset'); setError(''); }} style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--muted)', cursor: 'pointer', textAlign: 'center', marginTop: 4 }}>
              Mot de passe oublié / Premier accès
            </button>
          </form>
        ) : resetSent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📬</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>Email envoyé !</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>Consulte ta boîte mail et clique sur le lien pour définir ton mot de passe.</div>
            <button type="button" onClick={() => { setMode('login'); setResetSent(false); }} className="btn-ghost" style={{ fontSize: 13 }}>← Retour à la connexion</button>
          </div>
        ) : (
          <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 4 }}>Entre ton email pour recevoir un lien de (ré)initialisation de mot de passe.</div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ton@email.fr" required style={inputStyle} />
            </div>
            {error && (
              <div style={{ fontSize: 13, color: 'var(--red)', padding: '8px 12px', background: 'var(--red-soft)', borderRadius: 8 }}>{error}</div>
            )}
            <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '12px', fontSize: 14, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Envoi…' : 'Envoyer le lien'}
            </button>
            <button type="button" onClick={() => { setMode('login'); setError(''); }} style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--muted)', cursor: 'pointer', textAlign: 'center' }}>← Retour à la connexion</button>
          </form>
        )}
      </div>
    </div>
  );
}
