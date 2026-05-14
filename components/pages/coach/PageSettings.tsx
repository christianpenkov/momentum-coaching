'use client';

import { useState } from 'react';
import Icon from '@/components/ui/Icon';

const INTEGRATIONS = [
  { name: 'Instagram', icon: 'instagram', connected: true, account: '@marclaurent.coach' },
  { name: 'TikTok', icon: 'tiktok', connected: false, account: null },
  { name: 'YouTube', icon: 'youtube', connected: true, account: 'Marc Laurent Coaching' },
  { name: 'LinkedIn', icon: 'linkedin', connected: false, account: null },
  { name: 'Stripe', icon: 'dollar-sign', connected: true, account: 'marc@coaching.fr' },
  { name: 'Calendly', icon: 'calendar', connected: true, account: 'marclaurent.com/rdv' },
];

export default function PageSettings() {
  const [coachName, setCoachName] = useState('Marc Laurent');
  const [email, setEmail] = useState('marc@coaching.fr');
  const [domain, setDomain] = useState('marclaurent.com');

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Réglages</h1>
      </div>

      {/* Profil coach */}
      <div className="settings-section">
        <div className="settings-section-title">Profil coach</div>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
            <div className="avatar" style={{ width: 64, height: 64, fontSize: 22 }}>ML</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>{coachName}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{email}</div>
              <button className="btn-ghost" style={{ marginTop: 8, fontSize: 12 }} type="button">Changer la photo</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Nom</label>
              <input
                className="settings-input"
                value={coachName}
                onChange={e => setCoachName(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--accent)', outline: 'none', fontFamily: 'inherit' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Email</label>
              <input
                className="settings-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--accent)', outline: 'none', fontFamily: 'inherit' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Domaine</label>
              <input
                className="settings-input"
                value={domain}
                onChange={e => setDomain(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--accent)', outline: 'none', fontFamily: 'inherit' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Fuseau horaire</label>
              <select style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--accent)', outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}>
                <option>Europe/Paris (UTC+1)</option>
                <option>Europe/London (UTC+0)</option>
                <option>America/New_York (UTC-5)</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-primary" type="button">Sauvegarder</button>
          </div>
        </div>
      </div>

      {/* Intégrations */}
      <div className="settings-section" style={{ marginTop: 28 }}>
        <div className="settings-section-title">Intégrations</div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {INTEGRATIONS.map((integ, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '16px 20px',
                borderBottom: i < INTEGRATIONS.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <Icon name={integ.icon as any} size={20} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{integ.name}</div>
                {integ.connected && integ.account && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{integ.account}</div>
                )}
              </div>
              {integ.connected ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="pill pill-green" style={{ fontSize: 11 }}>Connecté</span>
                  <button className="btn-ghost" style={{ fontSize: 12 }} type="button">Déconnecter</button>
                </div>
              ) : (
                <button className="btn-primary" style={{ fontSize: 12 }} type="button">
                  <Icon name="link" size={13} /> Connecter
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Plateforme */}
      <div className="settings-section" style={{ marginTop: 28 }}>
        <div className="settings-section-title">Plateforme</div>
        <div className="card">
          {[
            { label: 'Notifications email', desc: 'Recevoir un résumé quotidien par email', enabled: true },
            { label: 'Brief IA automatique', desc: 'Générer le brief 1h avant chaque call', enabled: true },
            { label: 'Alertes momentum', desc: 'Notifier si un élève passe en rouge', enabled: false },
            { label: 'Rapport hebdomadaire', desc: 'Résumé analytique chaque lundi matin', enabled: true },
          ].map(({ label, desc, enabled }, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: i < 3 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{label}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{desc}</div>
              </div>
              <div
                role="switch"
                aria-checked={enabled}
                style={{
                  width: 40,
                  height: 22,
                  borderRadius: 11,
                  background: enabled ? 'var(--accent)' : 'var(--border)',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                  flexShrink: 0,
                }}
              >
                <div style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: 'white',
                  position: 'absolute',
                  top: 3,
                  left: enabled ? 20 : 3,
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Danger zone */}
      <div className="settings-section" style={{ marginTop: 28 }}>
        <div className="settings-section-title" style={{ color: 'var(--red)' }}>Zone dangereuse</div>
        <div className="card" style={{ borderColor: '#f5d5cf' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>Supprimer le compte</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Action irréversible. Toutes les données seront effacées.</div>
            </div>
            <button style={{ padding: '8px 16px', border: '1px solid var(--red)', borderRadius: 8, background: 'transparent', color: 'var(--red)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }} type="button">
              Supprimer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
