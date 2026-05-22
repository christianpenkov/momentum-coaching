'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
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

  // null = pas d'animation, {x,y} = animation en cours
  const [iris, setIris] = useState<{ x: number; y: number } | null>(null);

  const submitRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    router.prefetch('/dashboard');
    router.prefetch('/client');
  }, [router]);

  const triggerIris = useCallback((destination: string) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      router.push(destination);
      return;
    }

    const btn = submitRef.current;
    if (!btn) { router.push(destination); return; }

    const rect = btn.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);

    // 1. Push immédiatement — le dashboard commence à charger
    router.push(destination);

    // 2. L'overlay dark part ouvert et se referme vers le bouton
    //    Le dashboard qui charge apparaît progressivement derrière
    setIris({ x, y });
  }, [router]);

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

    triggerIris(profile?.role === 'coach' ? '/dashboard' : '/client');
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
    <>
      <style>{`
        @keyframes iris-close {
          0%   { clip-path: circle(200vmax at var(--ox) var(--oy)); opacity: 1; }
          85%  { clip-path: circle(0px at var(--ox) var(--oy));    opacity: 1; }
          100% { clip-path: circle(0px at var(--ox) var(--oy));    opacity: 0; }
        }
      `}</style>

      {/*
        Overlay dark qui part ouvert (couvre tout) et se referme vers le bouton.
        Pendant que le cercle se referme, le dashboard qui charge est visible derrière.
        À la fin : opacity 0 + l'overlay est retiré du DOM par React.
      */}
      {iris && (
        <div
          aria-hidden="true"
          onAnimationEnd={() => setIris(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'var(--bg)',
            pointerEvents: 'none',
            willChange: 'clip-path, opacity',
            ['--ox' as any]: `${iris.x}px`,
            ['--oy' as any]: `${iris.y}px`,
            animation: 'iris-close 800ms cubic-bezier(0.4, 0, 0.2, 1) forwards',
          }}
        />
      )}

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
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="ton@email.fr"
                  required
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>
                  Mot de passe
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
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
                ref={submitRef}
                type="submit"
                disabled={loading}
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '12px', fontSize: 14, opacity: loading ? 0.7 : 1, transition: 'opacity .15s' }}
              >
                {loading ? 'Connexion…' : 'Se connecter'}
              </button>

              <button
                type="button"
                onClick={() => { setMode('reset'); setError(''); }}
                style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--muted)', cursor: 'pointer', textAlign: 'center', marginTop: 4 }}
              >
                Mot de passe oublié / Premier accès
              </button>
            </form>
          ) : resetSent ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📬</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>Email envoyé !</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>
                Consulte ta boîte mail et clique sur le lien pour définir ton mot de passe.
              </div>
              <button
                type="button"
                onClick={() => { setMode('login'); setResetSent(false); }}
                className="btn-ghost"
                style={{ fontSize: 13 }}
              >
                ← Retour à la connexion
              </button>
            </div>
          ) : (
            <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 4 }}>
                Entre ton email pour recevoir un lien de (ré)initialisation de mot de passe.
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="ton@email.fr"
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
                {loading ? 'Envoi…' : 'Envoyer le lien'}
              </button>

              <button
                type="button"
                onClick={() => { setMode('login'); setError(''); }}
                style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--muted)', cursor: 'pointer', textAlign: 'center' }}
              >
                ← Retour à la connexion
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
