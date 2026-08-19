'use client';

import { useState, useEffect, useRef } from 'react';
import Icon from '@/components/ui/Icon';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import { createClient } from '@/lib/supabase/client';
import { cropImageToSquare } from '@/lib/cropImageToSquare';
import { useUser } from '@/lib/UserContext';
import LegalFooter from '@/components/ui/LegalFooter';
import ShortioDomainPicker from '@/components/settings/ShortioDomainPicker';
import type { Provider } from '@/lib/supabase/types';
import { CLIENT_WIZARD_INTEGRATIONS } from '@/lib/onboarding/integrationConfig';

// Source unique des libellés, partagée avec le wizard d'onboarding et la page
// Réglages coach (lib/onboarding/integrationConfig.ts). Avant, cette page avait
// sa propre copie des textes : l'élève lisait un libellé à l'onboarding et un
// autre dans ses Réglages pour la même intégration.
//
// mode : 'oauth' (OAuth seul) | 'apikey' (clé seule) | 'both' (OAuth + clé en
// repli). Stripe est en 'both' — OAuth Connect ne peut pas atteindre un compte
// déjà relié à une autre plateforme (Kajabi, Systeme.io…).
const INTEGRATIONS = CLIENT_WIZARD_INTEGRATIONS;

// Points de chargement — remplace le bouton "Connecter" / statut le temps de savoir
// si l'intégration est déjà connectée, pour ne pas afficher "Connecter" à tort.
function LoadingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '6px 4px' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--faint)', animation: 'typing-dot 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
      ))}
    </div>
  );
}

export default function PageClientSettings() {
  const supabase = createClient();
  const { refreshUser } = useUser();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // Cast partiel : Provider (lib/supabase/types) couvre aussi 'anthropic' et
  // 'stripe_webhook', absents de cette page. Même pattern que la page coach.
  const [integrations, setIntegrations] = useState<Record<Provider, boolean>>({ stripe: false, instagram: false, youtube: false, calendly: false, shortio: false, google: false, fathom: false } as Record<Provider, boolean>);
  const [integrationLabels, setIntegrationLabels] = useState<Partial<Record<Provider, string>>>({});
  const [shortioMeta, setShortioMeta] = useState<{ domain: string | null; domain_id: number | string | null; all_domains: { id: number | string; hostname: string }[] } | null>(null);
  const [domainPickerOpen, setDomainPickerOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [coachName, setCoachName] = useState<string | null>(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);

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

      const { data: integs } = await supabase.from('integrations').select('provider, account_label, metadata').eq('profile_id', user.id);
      setIntegrationsLoading(false);
      if (integs) {
        const map = { stripe: false, instagram: false, youtube: false, calendly: false, shortio: false, google: false, fathom: false } as Record<Provider, boolean>;
        const labels: Partial<Record<Provider, string>> = {};
        integs.forEach((i: { provider: string; account_label: string | null; metadata: any }) => {
          if (i.provider in map) map[i.provider as Provider] = true;
          if (i.account_label) labels[i.provider as Provider] = i.account_label;
          if (i.provider === 'shortio') setShortioMeta(i.metadata || null);
        });
        setIntegrations(map);
        setIntegrationLabels(labels);
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

    // Poser une clé sur un provider à repli (Stripe) remplace une éventuelle connexion
    // OAuth : on efface le token, sinon deux identifiants concurrents cohabitent et
    // l'appelant ne sait plus lequel fait foi. Symétrique du callback OAuth.
    const clearOauth = INTEGRATIONS.find(i => i.provider === provider)?.mode === 'both'
      ? { access_token: null, refresh_token: null } : {};

    const { data: existing } = await supabase.from('integrations').select('id, first_connected_at').eq('profile_id', profileId).eq('provider', provider).single();
    const connectedNow = new Date().toISOString();
    if (existing) {
      await supabase.from('integrations').update({
        api_key: key, account_label: label, metadata, connected_at: connectedNow,
        first_connected_at: existing.first_connected_at || connectedNow,
        ...clearOauth,
      }).eq('id', existing.id);
    } else {
      await supabase.from('integrations').insert({ profile_id: profileId, provider, api_key: key, account_label: label, metadata, first_connected_at: connectedNow });
    }

    setIntegrations(prev => ({ ...prev, [provider]: true }));
    setEditing(null);
    setKeyInput('');
    setKeyError(null);
    setSaving(false);

    if (provider === 'shortio') {
      setShortioMeta(metadata);
      if (label) setIntegrationLabels(prev => ({ ...prev, shortio: label }));
    }

    if (validation.needsDomainSelection) {
      showToast('Clé Short.io valide — choisis ton domaine');
      setDomainPickerOpen(true);
    } else {
      showToast(`${INTEGRATIONS.find(i => i.provider === provider)?.name} connecté ✓`);
    }
  }

  async function disconnect(provider: Provider) {
    if (!profileId) return;
    // Instagram passe par une route serveur qui archive les données actives avant de
    // supprimer integrations — sinon la prochaine reconnexion ne détecte plus de
    // compte précédent et ne peut jamais archiver correctement (voir route API).
    if (provider === 'instagram') {
      await fetch('/api/oauth/instagram/disconnect', { method: 'POST' });
    } else {
      await supabase.from('integrations').delete().eq('profile_id', profileId).eq('provider', provider);
    }
    setIntegrations(prev => ({ ...prev, [provider]: false }));
    setIntegrationLabels(prev => { const next = { ...prev }; delete next[provider]; return next; });
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
        <div className="settings-toast" style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 18px', fontSize: 13, color: 'var(--accent)', boxShadow: 'var(--shadow-elev)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="check" size={14} /> {toast}
        </div>
      )}

      <div className="page-header">
        <h1 className="page-title">Réglages</h1>
      </div>

      {/* Profil */}
      <div className="settings-section" style={{ padding: 20 }}>
        <div className="settings-section-title">Mon profil</div>
        <div className="card" style={{ border: 'none', boxShadow: 'none', padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div
              onClick={() => !uploadingAvatar && avatarInputRef.current?.click()}
              className="tap-scale"
              style={{ position: 'relative', width: 72, height: 72, borderRadius: '50%', cursor: uploadingAvatar ? 'default' : 'pointer', flexShrink: 0 }}
            >
              {integrationsLoading ? (
                <div style={{ width: 72, height: 72, borderRadius: '50%', border: '1px solid var(--border)', overflow: 'hidden' }}>
                  <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'var(--surface-2)', animation: 'pulse 1.4s ease-in-out infinite' }} />
                </div>
              ) : (
                <>
                  <Avatar initials={getInitials(name)} avatarUrl={avatarUrl} size={72} seed={profileId || undefined} />
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
                </>
              )}
            </div>
            <input ref={avatarInputRef} type="file" accept="image/*" onChange={onAvatarChange} style={{ display: 'none' }} />
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Photo de profil<br />
              <span style={{ fontSize: 11 }}>Visible par {coachName || 'ton coach'} dans la messagerie</span>
            </div>
          </div>
          <div className="settings-profile-grid" style={{ display: 'grid', gap: 16 }}>
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
      <div className="settings-section" style={{ marginTop: 28, padding: '20px 20px 0' }}>
        <div className="settings-section-title">Mes connexions</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Colle tes clés API pour que {coachName || 'ton coach'} puisse suivre tes progrès en temps réel.
        </div>
        <div className="card" style={{ margin: '0 -20px', padding: 0, overflow: 'hidden', border: 'none', borderRadius: '0 0 var(--r-xl) var(--r-xl)', borderTop: '1px solid var(--border-soft)', boxShadow: 'none' }}>
          {INTEGRATIONS.map((cfg, i) => {
            const connected = integrations[cfg.provider];
            const isEditing = editing === cfg.provider;
            return (
              <div key={cfg.provider} style={{ borderBottom: i < INTEGRATIONS.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div className="settings-row" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
                  <Icon name={cfg.icon as any} size={20} color={connected ? 'var(--green)' : 'var(--muted)'} />
                  <div className="settings-row-main" style={{ flex: 1, minWidth: 140 }}>
                    <div className="settings-row-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{cfg.name}</span>
                      {/* Statut remonté près du nom sur mobile (voir .settings-row-status
                          dans globals.css) : c'est l'info qu'on vient chercher, elle ne
                          doit pas être noyée dans la rangée de boutons après le wrap. */}
                      {!integrationsLoading && connected && (
                        cfg.provider === 'shortio' && !shortioMeta?.domain_id ? (
                          <span className="pill settings-row-status" style={{ fontSize: 11, flexShrink: 0, background: 'var(--surface-2)', color: 'var(--muted)' }}>Configuration requise</span>
                        ) : (
                          <span className="pill pill-green settings-row-status" style={{ fontSize: 11, flexShrink: 0 }}>Connecté</span>
                        )
                      )}
                    </div>
                    <div className="settings-row-desc" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{cfg.desc}</div>
                    {integrationLabels[cfg.provider] && (
                      <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>{integrationLabels[cfg.provider]}</div>
                    )}
                    {cfg.provider === 'fathom' && integrations.fathom && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                        Vérifie que l'auto-join est activé sur ton compte Fathom →{' '}
                        <a href="https://fathom.video/calendar" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>fathom.video/calendar</a>
                      </div>
                    )}
                  </div>
                  {integrationsLoading ? (
                    <LoadingDots />
                  ) : connected ? (
                    <div className="settings-row-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {/* Doublon volontaire du statut affiché près du nom : celui-ci
                          sert sur desktop, l'autre sur mobile. Un seul des deux est
                          visible à la fois (.settings-row-status* dans globals.css). */}
                      {cfg.provider === 'shortio' && !shortioMeta?.domain_id ? (
                        <span className="pill settings-row-status-inline" style={{ fontSize: 11, flexShrink: 0, background: 'var(--surface-2)', color: 'var(--muted)' }}>Configuration requise</span>
                      ) : (
                        <span className="pill pill-green settings-row-status-inline" style={{ fontSize: 11, flexShrink: 0 }}>Connecté</span>
                      )}
                      {cfg.provider === 'shortio' && (
                        <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }} type="button" onClick={() => setDomainPickerOpen(true)}>
                          {shortioMeta?.domain_id ? 'Changer de domaine' : 'Choisir un domaine'}
                        </button>
                      )}
                      {cfg.mode !== 'oauth' && (
                        <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }} type="button" onClick={() => { setEditing(cfg.provider); setKeyInput(''); }}>
                          {cfg.mode === 'both' ? 'Utiliser une clé' : 'Modifier'}
                        </button>
                      )}
                      {cfg.mode !== 'apikey' && (
                        <a href={cfg.oauthPath || `/api/oauth/${cfg.provider}`} className="btn-ghost" style={{ fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }}>Reconnecter</a>
                      )}
                      {cfg.provider === 'calendly' && (
                        <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }} type="button" onClick={syncCalendly} disabled={syncing}>
                          <Icon name="refresh-cw" size={12} /> {syncing ? 'Sync…' : 'Sync calls'}
                        </button>
                      )}
                      <button style={{ fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap', padding: '6px 4px' }} type="button" onClick={() => disconnect(cfg.provider)}>Déconnecter</button>
                    </div>
                  ) : cfg.mode !== 'apikey' ? (
                    <div className="settings-row-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <a href={cfg.oauthPath || `/api/oauth/${cfg.provider}`} className="btn-primary-brand" style={{ fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Icon name="link" size={13} /> Connecter
                      </a>
                      {cfg.mode === 'both' && (
                        <button style={{ fontSize: 12, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap', padding: '6px 4px', textDecoration: 'underline' }} type="button" onClick={() => { setEditing(cfg.provider); setKeyInput(''); }}>
                          ou une clé
                        </button>
                      )}
                    </div>
                  ) : (
                    <button className="btn-primary-brand" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(cfg.provider); setKeyInput(''); }}>
                      <Icon name="link" size={13} /> Connecter
                    </button>
                  )}
                </div>

                {cfg.provider === 'instagram' && (
                  <div style={{ padding: '0 20px 14px', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                    Votre compte Instagram est connecté via la technologie sécurisée UbizenAI. Vous pouvez révoquer cet accès ou demander la suppression de vos données à tout moment conformément à notre{' '}
                    <a href="https://ubizenai.com/data-deletion.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--muted)', textDecoration: 'underline' }}>Politique de suppression</a>.
                  </div>
                )}

                {/* mode !== 'oauth' : un provider OAuth pur n'a pas de champ clé
                    à proposer. Garde identique à la page coach. */}
                {isEditing && cfg.mode !== 'oauth' && (
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
                    <div className="settings-key-form" style={{ display: 'flex', gap: 8 }}>
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
        <div className="card settings-logout-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
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
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      <div style={{ marginTop: 28, padding: '0 20px' }}>
        <LegalFooter />
      </div>

      {domainPickerOpen && profileId && (
        <ShortioDomainPicker
          open={domainPickerOpen}
          onClose={() => setDomainPickerOpen(false)}
          profileId={profileId}
          currentDomainId={shortioMeta?.domain_id ?? null}
          onSelected={(domain) => {
            setShortioMeta(prev => ({ ...(prev || { all_domains: [] }), domain: domain.hostname, domain_id: domain.id }));
            setIntegrationLabels(prev => ({ ...prev, shortio: domain.hostname }));
            showToast(`Domaine Short.io : ${domain.hostname} ✓`);
          }}
        />
      )}
    </div>
  );
}
