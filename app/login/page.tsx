'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

// Couleur beige de la transition — correspond au fond clair de la destination
const IRIS_COLOR = '#F5F0E8';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [resetSent, setResetSent] = useState(false);
  const [irisState, setIrisState] = useState<'idle' | 'expanding' | 'done'>('idle');
  const [irisOrigin, setIrisOrigin] = useState({ x: 0, y: 0 });
  const destinationRef = useRef<string>('');
  const submitRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const supabase = createClient();

  // Prefetch les deux destinations dès le mount
  useEffect(() => {
    router.prefetch('/dashboard');
    router.prefetch('/client');
  }, [router]);

  const triggerIris = useCallback((destination: string) => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      router.push(destination);
      return;
    }

    const btn = submitRef.current;
    if (!btn) { router.push(destination); return; }

    const rect = btn.getBoundingClientRect();
    destinationRef.current = destination;
    setIrisOrigin({
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    });
    setIrisState('expanding');
  }, [router]);

  // Lance router.push quand l'animation est bien engagée
  useEffect(() => {
    if (irisState !== 'expanding') return;
    // On pousse la route à 550ms — le cercle est déjà large, le dashboard
    // se charge pendant les derniers 150ms de l'animation
    const t = setTimeout(() => {
      router.push(destinationRef.current);
    }, 550);
    return () => clearTimeout(t);
  }, [irisState, router]);

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
      setError('Erreur lors de l\'envoi. Vérifiez l\'email.');
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

  const isAnimating = irisState === 'expanding';

  return (
    <>
      {/* Keyframes injectés une seule fois, origin mis via CSS custom props sur l'élément */}
      <style>{`
        @keyframes iris-expand {
          0%   { clip-path: circle(0px at var(--ox) var(--oy)); }
          100% { clip-path: circle(200vmax at var(--ox) var(--oy)); }
        }
      `}</style>

      {/* Fond beige plein — visible dès que l'animation commence, AVANT le cercle
          Ça élimine le flash dark entre la fin du cercle et le chargement de la page */}
      {isAnimating && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9997,
            background: IRIS_COLOR,
          }}
        />
      )}

      {/* Cercle iris — s'ouvre depuis le bouton, couleur beige identique au fond */}
      {isAnimating && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9998,
            background: IRIS_COLOR,
            // Le cercle part du fond dark et révèle le beige dessous
            // En réalité : le cercle beige s'ouvre sur le fond dark, puis
            // le fond beige derrière assure la continuité visuelle
            ['--ox' as any]: `${irisOrigin.x}px`,
            ['--oy' as any]: `${irisOrigin.y}px`,
            animation: 'iris-expand 700ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
            willChange: 'clip-path',
            pointerEvents: 'none',
          }}
        />
      )}

      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        // Pendant l'animation on cache la page login pour ne pas voir
        // le formulaire derrière le cercle qui s'ouvre
        opacity: isAnimating ? 0 : 1,
        transition: isAnimating ? 'none' : 'opacity 0s',
      }}>
        <div style={{
          width: 400,
          background: 'var(--surface)',
          borderRadius: 16,
          border: '1px solid var(--border)',
          padding: '48px 40px',
          boxShadow: 'var(--shadow-elev)',
        }}>
          {/* Logo + titre */}
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
