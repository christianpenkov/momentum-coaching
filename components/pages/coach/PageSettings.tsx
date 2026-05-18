'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';
import type { Integration, Provider } from '@/lib/supabase/types';

type IntegrationMode = 'oauth' | 'apikey';

const INTEGRATION_CONFIG: {
  provider: Provider;
  name: string;
  icon: string;
  desc: string;
  mode: IntegrationMode;
  placeholder?: string;
  oauthPath?: string;
}[] = [
  {
    provider: 'anthropic',
    name: 'Claude IA',
    icon: 'sparkle',
    desc: "Clé API Anthropic pour l'assistant IA intégré",
    mode: 'apikey',
    placeholder: 'sk-ant-api03-...',
  },
  {
    provider: 'stripe',
    name: 'Stripe',
    icon: 'stripe',
    desc: 'Clé secrète Stripe pour recevoir les paiements et déclencher l\'onboarding clients',
    mode: 'apikey',
    placeholder: 'sk_live_... ou sk_test_...',
  },
  {
    provider: 'calendly',
    name: 'Calendly',
    icon: 'calendar',
    desc: 'Calls synchronisés, rappels automatiques',
    mode: 'oauth',
    oauthPath: '/api/oauth/calendly',
  },
  {
    provider: 'instagram',
    name: 'Instagram',
    icon: 'instagram',
    desc: 'Followers, engagement, métriques IG',
    mode: 'apikey',
    placeholder: 'Token API Instagram',
  },
  {
    provider: 'youtube',
    name: 'YouTube',
    icon: 'youtube',
    desc: 'Abonnés, vues, rétention vidéo',
    mode: 'apikey',
    placeholder: 'AIza...',
  },
  {
    provider: 'shortio',
    name: 'Short.io',
    icon: 'link',
    desc: 'CTR lien en bio',
    mode: 'apikey',
    placeholder: 'Clé API Short.io',
  },
];

export default function PageSettings() {
  const supabase = createClient();
  const searchParams = useSearchParams();

  const [integrations, setIntegrations] = useState<Record<Provider, Integration | null>>({
    anthropic: null, stripe: null, calendly: null, instagram: null, youtube: null, shortio: null,
  });
  const [editing, setEditing] = useState<Provider | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [coachName, setCoachName] = useState('');
  const [email, setEmail] = useState('');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    // Toast si retour OAuth réussi
    const connected = searchParams.get('connected');
    if (connected) {
      const name = INTEGRATION_CONFIG.find(c => c.provider === connected)?.name || connected;
      showToast(`${name} connecté avec succès ✓`);
    }
    const error = searchParams.get('error');
    if (error) showToast(`Erreur de connexion (${error})`, true);
  }, [searchParams]);

  function showToast(msg: string, isError = false) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setProfileId(user.id);
      setEmail(user.email || '');

      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
      if (profile) setCoachName(profile.full_name || '');

      const { data: integs } = await supabase.from('integrations').select('*').eq('profile_id', user.id);
      if (integs) {
        const map = { anthropic: null, stripe: null, calendly: null, instagram: null, youtube: null, shortio: null } as Record<Provider, Integration | null>;
        integs.forEach((i: Integration) => { map[i.provider] = i; });
        setIntegrations(map);
      }
    }
    load();
  }, []);

  async function saveKey(provider: Provider) {
    if (!profileId || !keyInput.trim()) return;
    setSaving(true);

    const existing = integrations[provider];
    if (existing) {
      await supabase.from('integrations').update({ api_key: keyInput.trim(), connected_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await supabase.from('integrations').insert({ profile_id: profileId, provider, api_key: keyInput.trim() });
    }

    const { data } = await supabase.from('integrations').select('*').eq('profile_id', profileId).eq('provider', provider).single();
    setIntegrations(prev => ({ ...prev, [provider]: data }));
    setEditing(null);
    setKeyInput('');
    setSaving(false);
    showToast(`${INTEGRATION_CONFIG.find(c => c.provider === provider)?.name} connecté ✓`);
  }

  async function disconnect(provider: Provider) {
    if (!profileId) return;
    await supabase.from('integrations').delete().eq('profile_id', profileId).eq('provider', provider);
    setIntegrations(prev => ({ ...prev, [provider]: null }));
  }

  async function saveProfile() {
    if (!profileId) return;
    const { error } = await supabase.from('profiles')
      .upsert({ id: profileId, full_name: coachName, role: 'coach' }, { onConflict: 'id' });
    if (error) showToast('Erreur : ' + error.message, true);
    else showToast('Profil sauvegardé ✓');
  }

  return (
    <div className="page-content">
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '12px 18px', fontSize: 13,
          color: 'var(--accent)', boxShadow: 'var(--shadow-elev)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Icon name="check" size={14} /> {toast}
        </div>
      )}

      <div className="page-header">
        <h1 className="page-title">Réglages</h1>
      </div>

      {/* Profil */}
      <div className="settings-section">
        <div className="settings-section-title">Profil coach</div>
        <div className="card">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Nom</label>
              <input value={coachName} onChange={e => setCoachName(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--accent)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Email</label>
              <input value={email} readOnly
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface-2)', color: 'var(--muted)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-primary" type="button" onClick={saveProfile}>Sauvegarder</button>
          </div>
        </div>
      </div>

      {/* Intégrations */}
      <div className="settings-section" style={{ marginTop: 28 }}>
        <div className="settings-section-title">Intégrations</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          Colle tes clés API — stockées chiffrées, jamais exposées.
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {INTEGRATION_CONFIG.map((cfg, i) => {
            const integ = integrations[cfg.provider];
            const isEditing = editing === cfg.provider;
            return (
              <div key={cfg.provider} style={{
                borderBottom: i < INTEGRATION_CONFIG.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
                  <Icon name={cfg.icon as any} size={20} color={integ ? 'var(--green)' : 'var(--muted)'} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{cfg.name}</span>
                      {cfg.mode === 'oauth' && (
                        <span style={{ fontSize: 10, padding: '2px 7px', background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 20, fontWeight: 600 }}>OAuth</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{cfg.desc}</div>
                    {integ?.account_label && (
                      <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>{integ.account_label}</div>
                    )}
                  </div>

                  {integ ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className="pill pill-green" style={{ fontSize: 11 }}>Connecté</span>
                      {cfg.mode === 'oauth' && (
                        <a href={cfg.oauthPath} className="btn-ghost" style={{ fontSize: 12 }}>
                          Reconnecter
                        </a>
                      )}
                      {cfg.mode === 'apikey' && (
                        <button className="btn-ghost" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(cfg.provider); setKeyInput(''); }}>
                          Modifier
                        </button>
                      )}
                      <button style={{ fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }} type="button" onClick={() => disconnect(cfg.provider)}>
                        Déconnecter
                      </button>
                    </div>
                  ) : cfg.mode === 'oauth' ? (
                    <a href={cfg.oauthPath} className="btn-primary" style={{ fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="link" size={13} /> Connecter
                    </a>
                  ) : (
                    <button className="btn-primary" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(cfg.provider); setKeyInput(''); }}>
                      <Icon name="link" size={13} /> Connecter
                    </button>
                  )}
                </div>

                {/* Formulaire clé API inline */}
                {isEditing && cfg.mode === 'apikey' && (
                  <div style={{ padding: '0 20px 16px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
                    {cfg.provider === 'stripe' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Comment récupérer ta clé Stripe :</div>
                        <div>1. Ouvre ton dashboard Stripe →{' '}
                          <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>dashboard.stripe.com/apikeys</a>
                        </div>
                        <div>2. Copie la <strong>Clé secrète</strong> (<code>sk_live_...</code> en prod, <code>sk_test_...</code> en test)</div>
                        <div>3. Colle-la ci-dessous</div>
                      </div>
                    )}
                    {cfg.provider === 'anthropic' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Comment récupérer ta clé Anthropic :</div>
                        <div>1. Ouvre →{' '}
                          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>console.anthropic.com/settings/keys</a>
                        </div>
                        <div>2. Clique <strong>Create Key</strong> → copie la clé (<code>sk-ant-...</code>)</div>
                        <div>3. Colle-la ci-dessous</div>
                      </div>
                    )}
                    {cfg.provider === 'calendly' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Connexion Calendly :</div>
                        <div>La connexion Calendly se fait via le bouton OAuth ci-dessus.</div>
                      </div>
                    )}
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                      Clé API {cfg.name}
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="password"
                        value={keyInput}
                        onChange={e => setKeyInput(e.target.value)}
                        placeholder={cfg.placeholder}
                        autoFocus
                        style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }}
                      />
                      <button className="btn-primary" style={{ fontSize: 12 }} type="button" disabled={saving || !keyInput.trim()} onClick={() => saveKey(cfg.provider)}>
                        {saving ? 'Sauvegarde…' : 'Sauvegarder'}
                      </button>
                      <button className="btn-ghost" style={{ fontSize: 12 }} type="button" onClick={() => setEditing(null)}>
                        Annuler
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Icon name="shield" size={12} /> Clé stockée dans la base — jamais exposée côté client
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Déconnexion */}
      <div className="settings-section" style={{ marginTop: 28 }}>
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>Se déconnecter</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Fermer la session sur cet appareil</div>
          </div>
          <button className="btn-ghost" style={{ fontSize: 12 }} type="button" onClick={async () => {
            await createClient().auth.signOut();
            window.location.href = '/login';
          }}>
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
