'use client';

import { useState, useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';

type Provider = 'stripe' | 'instagram' | 'youtube' | 'calendly';

const INTEGRATIONS: { provider: Provider; name: string; icon: string; desc: string; placeholder: string; oauth?: boolean }[] = [
  {
    provider: 'stripe',
    name: 'Stripe',
    icon: 'dollar-sign',
    desc: 'Clé secrète Stripe pour afficher ton MRR, paiements et abonnements',
    placeholder: 'sk_live_... ou sk_test_...',
  },
  {
    provider: 'calendly',
    name: 'Calendly',
    icon: 'calendar',
    desc: 'Connecte ton Calendly pour voir tes calls en temps réel et recevoir les rappels',
    placeholder: '',
    oauth: true,
  },
  {
    provider: 'instagram',
    name: 'Instagram',
    icon: 'instagram',
    desc: 'Token API Instagram pour tes stats de followers et d\'engagement',
    placeholder: 'Token API Instagram...',
  },
  {
    provider: 'youtube',
    name: 'YouTube',
    icon: 'youtube',
    desc: 'Clé API YouTube pour tes stats de chaîne',
    placeholder: 'AIza...',
  },
];

export default function PageClientSettings() {
  const supabase = createClient();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [integrations, setIntegrations] = useState<Record<Provider, boolean>>({ stripe: false, instagram: false, youtube: false, calendly: false });
  const [editing, setEditing] = useState<Provider | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setProfileId(user.id);
      setEmail(user.email || '');

      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
      if (profile) setName(profile.full_name || '');

      const { data: integs } = await supabase.from('integrations').select('provider').eq('profile_id', user.id);
      if (integs) {
        const map = { stripe: false, instagram: false, youtube: false, calendly: false } as Record<Provider, boolean>;
        integs.forEach((i: { provider: string }) => { if (i.provider in map) map[i.provider as Provider] = true; });
        setIntegrations(map);
      }
    }
    load();
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function saveKey(provider: Provider) {
    if (!profileId || !keyInput.trim()) return;
    setKeyError(null);
    setValidating(true);

    const validateRes = await fetch('/api/validate-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, key: keyInput.trim() }),
    });
    const validation = await validateRes.json();
    setValidating(false);

    if (!validation.valid) {
      setKeyError(validation.error || 'Clé invalide');
      return;
    }

    setSaving(true);
    const key = keyInput.trim();
    const label = validation.label || null;

    const { data: existing } = await supabase.from('integrations').select('id').eq('profile_id', profileId).eq('provider', provider).single();
    if (existing) {
      await supabase.from('integrations').update({ api_key: key, account_label: label, connected_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await supabase.from('integrations').insert({ profile_id: profileId, provider, api_key: key, account_label: label });
    }

    setIntegrations(prev => ({ ...prev, [provider]: true }));
    setEditing(null);
    setKeyInput('');
    setKeyError(null);
    setSaving(false);
    showToast(`${INTEGRATIONS.find(i => i.provider === provider)?.name} connecté ✓`);
  }

  async function disconnect(provider: Provider) {
    if (!profileId) return;
    await supabase.from('integrations').delete().eq('profile_id', profileId).eq('provider', provider);
    setIntegrations(prev => ({ ...prev, [provider]: false }));
  }

  async function saveProfile() {
    if (!profileId) return;
    const { error } = await supabase.from('profiles')
      .upsert({ id: profileId, full_name: name }, { onConflict: 'id' });
    if (error) showToast('Erreur : ' + error.message);
    else showToast('Profil sauvegardé ✓');
  }

  const inputStyle = { width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--accent)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const };

  return (
    <div className="page-content">
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 18px', fontSize: 13, color: 'var(--accent)', boxShadow: 'var(--shadow-elev)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="check" size={14} /> {toast}
        </div>
      )}

      <div className="page-header">
        <h1 className="page-title">Réglages</h1>
      </div>

      {/* Profil */}
      <div className="settings-section">
        <div className="settings-section-title">Mon profil</div>
        <div className="card">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 500 }}>Prénom & Nom</label>
              <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Ton nom" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 500 }}>Email</label>
              <input style={{ ...inputStyle, background: 'var(--surface-2)', color: 'var(--muted)' }} value={email} readOnly />
            </div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-primary" type="button" onClick={saveProfile}>Sauvegarder</button>
          </div>
        </div>
      </div>

      {/* Connexions */}
      <div className="settings-section" style={{ marginTop: 28 }}>
        <div className="settings-section-title">Mes connexions</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          Colle tes clés API pour que ton coach puisse suivre tes progrès en temps réel.
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {INTEGRATIONS.map((cfg, i) => {
            const connected = integrations[cfg.provider];
            const isEditing = editing === cfg.provider;
            return (
              <div key={cfg.provider} style={{ borderBottom: i < INTEGRATIONS.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
                  <Icon name={cfg.icon as any} size={20} color={connected ? 'var(--green)' : 'var(--muted)'} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{cfg.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{cfg.desc}</div>
                  </div>
                  {connected ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className="pill pill-green" style={{ fontSize: 11 }}>Connecté</span>
                      {!cfg.oauth && <button className="btn-ghost" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(cfg.provider); setKeyInput(''); }}>Modifier</button>}
                      {cfg.oauth && <a href="/api/oauth/calendly" className="btn-ghost" style={{ fontSize: 12 }}>Reconnecter</a>}
                      <button style={{ fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }} type="button" onClick={() => disconnect(cfg.provider)}>Déconnecter</button>
                    </div>
                  ) : cfg.oauth ? (
                    <a href="/api/oauth/calendly" className="btn-primary" style={{ fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="link" size={13} /> Connecter
                    </a>
                  ) : (
                    <button className="btn-primary" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(cfg.provider); setKeyInput(''); }}>
                      <Icon name="link" size={13} /> Connecter
                    </button>
                  )}
                </div>

                {isEditing && (
                  <div style={{ padding: '0 20px 16px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
                    {/* Instructions par provider */}
                    {cfg.provider === 'stripe' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Comment obtenir ta clé Stripe :</div>
                        <div>1. Va sur →{' '}
                          <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>dashboard.stripe.com/apikeys</a>
                        </div>
                        <div>2. Copie ta <strong>Clé secrète</strong> (<code>sk_live_...</code> en prod, <code>sk_test_...</code> en test)</div>
                        <div>3. Colle-la ci-dessous</div>
                      </div>
                    )}
                    {cfg.provider === 'calendly' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Comment obtenir ton token Calendly :</div>
                        <div>1. Va sur →{' '}
                          <a href="https://calendly.com/integrations/api_webhooks" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>calendly.com/integrations/api_webhooks</a>
                        </div>
                        <div>2. Clique <strong>"Generate New Token"</strong></div>
                        <div>3. Copie le token et colle-le ci-dessous</div>
                      </div>
                    )}
                    {cfg.provider === 'instagram' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Comment obtenir ton token Instagram :</div>
                        <div>1. Va sur →{' '}
                          <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>developers.facebook.com/tools/explorer</a>
                        </div>
                        <div>2. Sélectionne ton app → génère un token avec les permissions <strong>instagram_basic</strong></div>
                        <div>3. Colle le token ci-dessous</div>
                      </div>
                    )}
                    {cfg.provider === 'youtube' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Comment obtenir ta clé YouTube :</div>
                        <div>1. Va sur →{' '}
                          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>console.cloud.google.com/apis/credentials</a>
                        </div>
                        <div>2. Crée une clé API → active l'API YouTube Data v3</div>
                        <div>3. Colle la clé (<code>AIza...</code>) ci-dessous</div>
                      </div>
                    )}

                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                      {cfg.provider === 'stripe' ? 'Clé secrète Stripe' : `Clé API ${cfg.name}`}
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="password"
                        value={keyInput}
                        onChange={e => { setKeyInput(e.target.value); setKeyError(null); }}
                        placeholder={cfg.placeholder}
                        autoFocus
                        style={{ flex: 1, padding: '8px 12px', border: `1px solid ${keyError ? '#fca5a5' : 'var(--border)'}`, borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }}
                      />
                      <button className="btn-primary" style={{ fontSize: 12, minWidth: 110 }} type="button" disabled={validating || saving || !keyInput.trim()} onClick={() => saveKey(cfg.provider)}>
                        {validating ? '⏳ Vérification…' : saving ? 'Sauvegarde…' : 'Connecter'}
                      </button>
                      <button className="btn-ghost" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(null); setKeyError(null); }}>Annuler</button>
                    </div>
                    {keyError && (
                      <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5' }}>
                        ✗ {keyError}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Icon name="shield" size={12} /> Clé vérifiée puis stockée chiffrée — jamais exposée
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
            await supabase.auth.signOut();
            window.location.href = '/login';
          }}>
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
