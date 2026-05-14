'use client';

import Icon from '@/components/ui/Icon';
import { callsToday } from '@/lib/data';

const nextCall = callsToday[0];

export default function PageClientCalls() {
  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Prochain call</h1>
      </div>

      {/* Prochain call */}
      <div className="card" style={{ marginBottom: 24, borderLeft: '4px solid var(--green)', padding: '28px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>PROCHAIN CALL</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)', lineHeight: 1.1 }}>
              Jeudi 14 mai
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--accent)', marginTop: 4 }}>
              {nextCall?.time || '14:00'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>
              {nextCall?.topic || 'Session de coaching hebdomadaire'}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn-primary" type="button">
                <Icon name="video" size={14} /> Rejoindre le call
              </button>
              <button className="btn-ghost" type="button">
                <Icon name="calendar" size={14} /> Reporter
              </button>
            </div>
          </div>
          <div style={{ padding: '20px 24px', background: 'var(--surface-2)', borderRadius: 12, textAlign: 'center', minWidth: 160 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
              03
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>jours restants</div>
            <div style={{ width: '100%', height: 6, background: 'var(--border)', borderRadius: 3, marginTop: 12, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '57%', background: 'var(--green)', borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>de la semaine</div>
          </div>
        </div>
      </div>

      {/* Préparation */}
      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Se préparer</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {[
              'Compléter les tâches de la semaine',
              'Rassembler ses stats de la semaine (posts, DM, réponses)',
              'Préparer 1-2 questions pour le coach',
              'Identifier son principal blocage',
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 20, height: 20, borderRadius: 4, border: '1.5px solid var(--border)', flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 13, color: 'var(--accent)', lineHeight: 1.5 }}>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Infos pratiques</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
            {[
              { icon: 'activity' as const, label: 'Durée', value: '60 minutes' },
              { icon: 'video' as const, label: 'Plateforme', value: 'Zoom' },
              { icon: 'star' as const, label: 'Coach', value: 'Marc Laurent' },
              { icon: 'calendar' as const, label: 'Fréquence', value: 'Hebdomadaire' },
            ].map(({ icon, label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Icon name={icon} size={14} />
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Historique */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Historique des calls</div>
        </div>
        <div style={{ marginTop: 16 }}>
          {[
            { date: '7 mai', topic: 'Stratégie DM et closing', duration: '62 min', takeaway: 'Revoir le script d\'ouverture DM' },
            { date: '30 avr', topic: 'Stratégie contenu Reels', duration: '58 min', takeaway: 'Tester le format Q&A 2x/semaine' },
            { date: '23 avr', topic: 'Objectifs et positionnement', duration: '55 min', takeaway: 'Niche sur les créateurs 18-25 ans' },
          ].map((call, i) => (
            <div key={i} style={{ padding: '14px 0', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{call.topic}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                    {call.date} · {call.duration}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 12, color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }}>
                Action clé : {call.takeaway}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
