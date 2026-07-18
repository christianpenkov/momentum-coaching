'use client';

import { useState, useEffect, useRef } from 'react';
import Icon from '@/components/ui/Icon';
import Avatar from '@/components/ui/Avatar';
import { createClient } from '@/lib/supabase/client';
import { cropImageToSquare } from '@/lib/cropImageToSquare';
import { useUser } from '@/lib/UserContext';

type Provider = 'stripe' | 'instagram' | 'youtube' | 'calendly' | 'shortio' | 'google';

const INTEGRATIONS: { provider: Provider; name: string; icon: string; desc: string; placeholder: string; oauth?: boolean; oauthPath?: string }[] = [
  {
    provider: 'google',
    name: 'Google Calendar',
    icon: 'calendar',
    desc: 'Reçois les invitations de call de ton coach directement dans Google Calendar + rappels push',
    placeholder: '',
    oauth: true,
    oauthPath: '/api/oauth/google',
  },
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
    desc: 'Connecte ton compte Instagram Business pour tes stats de followers et d\'engagement',
    placeholder: '',
    oauth: true,
  },
  {
    provider: 'youtube',
    name: 'YouTube',
    icon: 'youtube',
    desc: 'Connecte ta chaîne YouTube pour voir tes stats (vues, abonnés, watch time)',
    placeholder: '',
    oauth: true,
  },
  {
    provider: 'shortio',
    name: 'Short.io',
    icon: 'link',
    desc: 'Connecte Short.io pour tracker les clics sur tous tes liens courts (bio, DMs, stories…)',
    placeholder: 'Clé API Short.io',
  },
];

export default function PageClientSettings() {
  const supabase = createClient();
  const { refreshUser } = useUser();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [integrations, setIntegrations] = useState<Record<Provider, boolean>>({ stripe: false, instagram: false, youtube: false, calendly: false, shortio: false, google: false });
  const [editing, setEditing] = useState<Provider | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [coachName, setCoachName] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setProfileId(user.id);
      setEmail(user.email || '');

      const { data: profile } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).single();
      if (profile) { setName(profile.full_name || ''); setAvatarUrl(profile.avatar_url || null); }

      const { data: clientRow } = await supabase.from('clients').select('coach_id').eq('profile_id', user.id).maybeSingle();
      if (clientRow?.coach_id) {
        const { data: coachProfile } = await supabase.from('profiles').select('full_name').eq('id', clientRow.coach_id).maybeSingle();
        if (coachProfile?.full_name) setCoachName(coachProfile.full_name.split(' ')[0]);
      }

      const { data: integs } = await supabase.from('integrations').select('provider').eq('profile_id', user.id);
      if (integs) {
        const map = { stripe: false, instagram: false, youtube: false, calendly: false, shortio: false, google: false } as Record<Provider, boolean>;
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

    const keyToValidate = keyInput.trim();

    const validateRes = await fetch('/api/validate-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, key: keyToValidate }),
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
    const metadata = validation.meta || null;

    const { data: existing } = await supabase.from('integrations').select('id').eq('profile_id', profileId).eq('provider', provider).single();
    if (existing) {
      await supabase.from('integrations').update({ api_key: key, account_label: label, metadata, connected_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await supabase.from('integrations').insert({ profile_id: profileId, provider, api_key: key, account_label: label, metadata });
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


  async function syncCalendly() {
    setSyncing(true);
    const res = await fetch('/api/calendly/sync', { method: 'POST' });
    const data = await res.json();
    setSyncing(false);
    if (data.ok) showToast(data.synced > 0 ? `${data.synced} call${data.synced > 1 ? 's' : ''} synchronisé${data.synced > 1 ? 's' : ''} ✓` : 'Aucun nouveau call trouvé');
    else showToast(data.error || 'Erreur sync Calendly');
  }

  async function saveProfile() {
    if (!profileId) return;
    const { error } = await supabase.from('profiles')
      .upsert({ id: profileId, full_name: name }, { onConflict: 'id' });
    if (error) showToast('Erreur : ' + error.message);
    else showToast('Profil sauvegardé ✓');
  }

  async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profileId) return;
    setUploadingAvatar(true);
    try {
      const blob = await cropImageToSquare(file);
      const path = `${profileId}/avatar.jpg`;
      const { error: uploadErr } = await supabase.storage.from('avatars')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const freshUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      const { error: updateErr } = await supabase.from('profiles').update({ avatar_url: freshUrl }).eq('id', profileId);
      if (updateErr) throw updateErr;
      setAvatarUrl(freshUrl);
      refreshUser();
      showToast('Photo de profil mise à jour ✓');
    } catch (err) {
      showToast('Erreur upload photo : ' + (err instanceof Error ? err.message : 'inconnue'));
    } finally {
      setUploadingAvatar(false);
    }
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div
              onClick={() => !uploadingAvatar && avatarInputRef.current?.click()}
              className="tap-scale"
              style={{ position: 'relative', width: 72, height: 72, borderRadius: '50%', cursor: uploadingAvatar ? 'default' : 'pointer', flexShrink: 0 }}
            >
              <Avatar initials={name.slice(0, 2).toUpperCase() || '?'} avatarUrl={avatarUrl} size={72} />
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: uploadingAvatar ? 1 : 0, transition: 'opacity 150ms',
              }}
                onMouseEnter={e => { if (!uploadingAvatar) e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={e => { if (!uploadingAvatar) e.currentTarget.style.opacity = '0'; }}
              >
                <Icon name={uploadingAvatar ? 'loader' : 'camera'} size={18} color="#fff" style={uploadingAvatar ? { animation: 'spin 1s linear infinite' } : undefined} />
              </div>
            </div>
            <input ref={avatarInputRef} type="file" accept="image/*" onChange={onAvatarChange} style={{ display: 'none' }} />
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Photo de profil<br />
              <span style={{ fontSize: 11 }}>Visible par {coachName || 'ton coach'} dans la messagerie</span>
            </div>
          </div>
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
            <button className="btn-primary-brand" type="button" onClick={saveProfile}>Sauvegarder</button>
          </div>
        </div>
      </div>

      {/* Connexions */}
      <div className="settings-section" style={{ marginTop: 28 }}>
        <div className="settings-section-title">Mes connexions</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          Colle tes clés API pour que {coachName || 'ton coach'} puisse suivre tes progrès en temps réel.
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
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{cfg.desc.replace('ton coach', coachName || 'ton coach')}</div>
                  </div>
                  {connected ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className="pill pill-green" style={{ fontSize: 11 }}>Connecté</span>
                      {!cfg.oauth && <button className="btn-ghost" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(cfg.provider); setKeyInput(''); }}>Modifier</button>}
                      {cfg.oauth && <a href={cfg.oauthPath || `/api/oauth/${cfg.provider}`} className="btn-ghost" style={{ fontSize: 12 }}>Reconnecter</a>}
                      {cfg.provider === 'calendly' && (
                        <button className="btn-ghost" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }} type="button" onClick={syncCalendly} disabled={syncing}>
                          <Icon name="refresh-cw" size={12} /> {syncing ? 'Sync…' : 'Sync calls'}
                        </button>
                      )}
                      <button style={{ fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }} type="button" onClick={() => disconnect(cfg.provider)}>Déconnecter</button>
                    </div>
                  ) : cfg.oauth ? (
                    <a href={cfg.oauthPath || `/api/oauth/${cfg.provider}`} className="btn-primary-brand" style={{ fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="link" size={13} /> Connecter
                    </a>
                  ) : (
                    <button className="btn-primary-brand" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(cfg.provider); setKeyInput(''); }}>
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

                    {cfg.provider === 'shortio' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Comment connecter Short.io :</div>
                        <div>1. Va sur →{' '}
                          <a href="https://app.short.io/settings/integrations/api-key" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>app.short.io/settings/integrations/api-key</a>
                        </div>
                        <div>2. Clique <strong>"+ Créer la clé API"</strong> en haut à droite</div>
                        <div>3. Choisis <strong>Clé privée</strong>, laisse la description vide, clique <strong>"Créer"</strong></div>
                        <div>4. Copie la clé (commence par <code style={{ background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 3 }}>sk_</code>) et colle-la ci-dessous — elle ne sera plus visible après</div>
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
                      <button className="btn-primary-brand" style={{ fontSize: 12, minWidth: 110 }} type="button" disabled={validating || saving || !keyInput.trim()} onClick={() => saveKey(cfg.provider)}>
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
          <button className="logout-button" type="button" onClick={async () => {
            // scope: 'local' — le scope par défaut de signOut() est 'global' et
            // déconnecterait TOUS les appareils de ce compte, pas seulement celui-ci
            // (contrairement à ce que le texte du bouton promet).
            await supabase.auth.signOut({ scope: 'local' });
            window.location.href = '/login';
          }}>
            Se déconnecter
            <div className="icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
