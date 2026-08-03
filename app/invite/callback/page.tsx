'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Step = 'loading' | 'set-password' | 'saving' | 'error';

export default function InviteCallbackPage() {
  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // Id capturé une seule fois à l'établissement initial de la session (juste après
  // setSession() plus bas) — revérifié juste avant updateUser dans handleSetPassword.
  // Le cookie de session est partagé par tout le navigateur : si un autre onglet
  // (ex. un compte coach resté connecté) le réécrit entre-temps, la session active
  // à l'instant de l'update peut avoir changé sans qu'aucune erreur ne le signale.
  const [expectedUserId, setExpectedUserId] = useState<string | null>(null);
  const router = useRouter();

  // Lie le profile_id + accorde les ressources par défaut — fait une seule fois,
  // avant même que le mot de passe soit choisi, pour que l'accès aux ressources ne
  // dépende pas d'une étape ultérieure qui pourrait échouer.
  //
  // inviteUserByEmail génère toujours un lien en IMPLICIT flow (tokens dans le
  // fragment #access_token=...&refresh_token=...), quel que soit le client utilisé
  // pour l'envoyer. Mais createBrowserClient de @supabase/ssr est configuré en PKCE
  // flow par défaut (attend un ?code= en query param) — il ne traite PAS
  // automatiquement ce fragment implicite, contrairement au client legacy
  // @supabase/supabase-js. onAuthStateChange n'émettait donc jamais d'événement ici,
  // ce qui renvoyait systématiquement vers /login après le timeout. Fix : parser le
  // fragment nous-mêmes et appeler setSession() explicitement avec les tokens extraits.
  useEffect(() => {
    const supabase = createClient();

    async function run() {
      const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (!accessToken || !refreshToken) {
        router.push('/login?error=auth');
        return;
      }

      const { data, error: sessionErr } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionErr || !data.user) {
        router.push('/login?error=auth');
        return;
      }

      // Nettoie le fragment de l'URL — évite de laisser les tokens visibles dans la
      // barre d'adresse / l'historique du navigateur une fois la session établie.
      window.history.replaceState(null, '', window.location.pathname);

      setExpectedUserId(data.user.id);

      const metadata = data.user.user_metadata ?? {};
      const clientId = metadata?.client_id as string | undefined;
      if (!clientId) { setStep('set-password'); return; }

      // La policy RLS sur clients (coach_id = auth.uid() OR profile_id = auth.uid())
      // ne peut jamais autoriser cet UPDATE côté client : profile_id est justement ce
      // qu'on cherche à poser pour la première fois. Passe par une route serveur
      // (service-role) qui bypass la RLS.
      const claimRes = await fetch('/api/client/claim-invite', { method: 'POST' });
      if (claimRes.ok) {
        const { coach_id } = await claimRes.json();
        if (coach_id) {
          await fetch('/api/client/grant-default-resources', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coach_id }),
          });
        }
      }

      setStep('set-password');
    }

    run().catch(() => setError('Une erreur est survenue.'));
  }, [router]);

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Le mot de passe doit faire au moins 8 caractères.');
      return;
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    setStep('saving');
    const supabase = createClient();

    // Garde-fou : le cookie de session est partagé par tout le navigateur (pas
    // isolé à cet onglet) — si un autre onglet l'a réécrit entre-temps (ex. un
    // compte coach resté connecté qui a rafraîchi ses tokens), la session active
    // ici ne serait plus celle de l'élève invité. Sans cette vérification,
    // updateUser appliquerait le mot de passe au mauvais compte, silencieusement.
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser || currentUser.id !== expectedUserId) {
      setError('Ta session a changé entre-temps — recharge le lien d\'invitation depuis ton email pour réessayer.');
      setStep('set-password');
      return;
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setError(
        updateErr.message.includes('different from the old')
          ? 'Le nouveau mot de passe doit être différent de l\'ancien.'
          : updateErr.message
      );
      setStep('set-password');
      return;
    }

    // Marque l'onboarding "compte créé" — seul signal fiable côté coach qu'un élève
    // invité a réellement fini le flow (profile_id se pose dès l'ouverture du lien,
    // bien avant que le mot de passe soit choisi, donc ne suffit pas seul).
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('clients').update({ onboarding_completed_at: new Date().toISOString() }).eq('profile_id', user.id);
    }

    router.push('/client');
  }

  if (step === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ fontSize: 14, color: 'var(--muted)' }}>Configuration de ton espace…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{
        width: 420, background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)',
        padding: '48px 40px', boxShadow: 'var(--shadow-elev)',
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', margin: '0 0 6px' }}>Choisis ton mot de passe</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 28px' }}>
          Dernière étape avant d'accéder à ton espace.
        </p>

        <form onSubmit={handleSetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>
              Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="8 caractères minimum"
              required
              autoFocus
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>
              Confirme le mot de passe
            </label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {error && (
            <div style={{ fontSize: 13, color: 'var(--red)', padding: '8px 12px', background: 'var(--red-soft)', borderRadius: 8 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={step === 'saving'}
            className="btn-primary-brand"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '12px', fontSize: 14, opacity: step === 'saving' ? 0.7 : 1 }}
          >
            {step === 'saving' ? 'Enregistrement…' : 'Créer mon accès →'}
          </button>
        </form>
      </div>
    </div>
  );
}
