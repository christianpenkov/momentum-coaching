'use client';

import Icon from '@/components/ui/Icon';
import { resources } from '@/lib/data';

const TYPE_ICONS: Record<string, 'play' | 'folder' | 'list' | 'mic'> = {
  Vidéo: 'play',
  PDF: 'folder',
  Notion: 'list',
  Template: 'list',
  Checklist: 'list',
};

// Thomas est semaine 8, donc il a accès aux ressources jusqu'à la semaine 8
const THOMAS_WEEK = 8;

export default function PageClientResources() {
  const unlocked = resources.filter(r => (r.week || 1) <= THOMAS_WEEK);
  const locked = resources.filter(r => (r.week || 1) > THOMAS_WEEK);

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ressources</h1>
          <p className="page-sub">{unlocked.length} débloquées · {locked.length} à venir</p>
        </div>
      </div>

      {/* Progression */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>Progression du parcours</div>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
            {unlocked.length}/{resources.length}
          </span>
        </div>
        <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${(unlocked.length / resources.length) * 100}%`,
            background: 'var(--green)',
            borderRadius: 4,
            transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
          }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          Continuez votre progression pour débloquer les {locked.length} ressources restantes
        </div>
      </div>

      {/* Débloquées */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
        Disponibles ({unlocked.length})
      </div>
      <div className="resource-grid" style={{ marginBottom: 32 }}>
        {unlocked.map((res) => (
          <div key={res.id} className="card resource-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={TYPE_ICONS[res.type] || 'folder'} size={16} />
              </div>
              <span className="pill pill-green" style={{ fontSize: 10, alignSelf: 'flex-start' }}>Disponible</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>{res.title}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 12 }}>{res.desc}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span className="pill pill-neutral" style={{ fontSize: 10 }}>{res.type}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{res.duration || `Sem. ${res.week}`}</span>
            </div>
            <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', display: 'flex', gap: 6, fontSize: 12 }} type="button">
              <Icon name="external" size={13} /> Accéder
            </button>
          </div>
        ))}
      </div>

      {/* Verrouillées */}
      {locked.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
            À venir ({locked.length})
          </div>
          <div className="resource-grid">
            {locked.map((res) => (
              <div key={res.id} className="card resource-card" style={{ opacity: 0.55 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="lock" size={16} />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="lock" size={11} /> Sem. {res.week}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>{res.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{res.desc}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
