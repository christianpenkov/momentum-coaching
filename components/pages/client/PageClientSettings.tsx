'use client';

import { useState, useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';

type Provider = 'stripe' | 'instagram' | 'youtube' | 'calendly';

const INTEGRATIONS: { provider: Provider; name: string; icon: string; desc: string; placeholder: string }[] = [
  {
    provider: 'stripe',
    name: 'Stripe',
    icon: 'dollar-sign',
    desc: 'Clé restreinte (lecture seule) pour afficher ton MRR et tes paiements',
    placeholder: 'rk_live_... ou rk_test_...',
  },
  {
    provider: 'calendly',
    name: 'Calendly',
    icon: 'calendar',
    desc: 'Token API Calendly pour synchroniser tes calls',
    placeholder: 'Token Calendly...',
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
    setSaving(true);

    const { data: existing } = await supabase.from('integrations').select('id').eq('profile_id', profileId).eq('provider', provider).single();
    if (existing) {
      await supabase.from('integrations').update({ api_key: keyInput.trim(), connected_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await supabase.from('integrations').insert({ profile_id: profileId, provider, api_key: keyInput.trim() });
    }

    setIntegrations(prev => ({ ...prev, [provider]: true }));
    setEditing(null);
    setKeyInput('');
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
    await supabase.from('profiles').update({ full_name: name }).eq('id', profileId);
    showToast('Profil sauvegardé ✓');
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
                      <button className="btn-ghost" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(cfg.provider); setKeyInput(''); }}>Modifier</button>
                      <button style={{ fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }} type="button" onClick={() => disconnect(cfg.provider)}>Déconnecter</button>
                    </div>
                  ) : (
                    <button className="btn-primary" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(cfg.provider); setKeyInput(''); }}>
                      <Icon name="link" size={13} /> Connecter
                    </button>
                  )}
                </div>

                {isEditing && (
                  <div style={{ padding: '0 20px 16px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', margin: '12px 0 6px' }}>
                      {cfg.provider === 'stripe' ? 'Clé restreinte Stripe (lecture seule)' : `Clé API ${cfg.name}`}
                    </label>
                    {cfg.provider === 'stripe' && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.5 }}>
                        Dans ton dashboard Stripe → Développeurs → Clés API → Créer une clé restreinte → coche uniquement les droits lecture.
                      </div>
                    )}
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
                      <button className="btn-ghost" style={{ fontSize: 12 }} type="button" onClick={() => setEditing(null)}>Annuler</button>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Icon name="shield" size={12} /> Clé stockée chiffrée — jamais exposée côté client
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
