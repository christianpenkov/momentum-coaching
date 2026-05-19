'use client';

import { useState, useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';

interface Resource {
  id: string;
  title: string;
  type: string;
  description: string | null;
  duration: string | null;
  week: number | null;
  locked: boolean | null;
  url: string | null;
  tags: string[] | null;
}

const TYPE_ICONS: Record<string, 'play' | 'folder' | 'list' | 'mic'> = {
  Vidéo: 'play',
  PDF: 'folder',
  Notion: 'list',
  Template: 'list',
  Checklist: 'list',
};

export default function PageClientResources() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [clientWeek, setClientWeek] = useState<number>(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Récupère le client + son coach
      const { data: clientRow } = await supabase
        .from('clients')
        .select('coach_id, week')
        .eq('profile_id', user.id)
        .single();

      if (!clientRow) { setLoading(false); return; }

      const week = clientRow.week || 1;
      setClientWeek(week);

      // Récupère les ressources du coach
      const { data } = await supabase
        .from('resources')
        .select('*')
        .eq('coach_id', clientRow.coach_id)
        .order('week', { ascending: true });

      setResources(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const unlocked = resources.filter(r => !r.locked && (r.week || 1) <= clientWeek);
  const locked = resources.filter(r => r.locked || (r.week || 1) > clientWeek);

  if (loading) {
    return (
      <div className="page-content">
        <div className="page-header"><h1 className="page-title">Ressources</h1></div>
        <div style={{ color: 'var(--muted)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
          <Icon name="refresh-cw" size={16} /> Chargement…
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ressources</h1>
          <p className="page-sub">{unlocked.length} débloquées · {locked.length} à venir</p>
        </div>
      </div>

      {resources.length === 0 ? (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>📚</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Aucune ressource pour le moment</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
            Ton coach n'a pas encore publié de ressources. Reviens bientôt !
          </div>
        </div>
      ) : (
        <>
          {/* Progression */}
          {resources.length > 0 && (
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
                  width: `${resources.length > 0 ? (unlocked.length / resources.length) * 100 : 0}%`,
                  background: 'var(--green)',
                  borderRadius: 4,
                  transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
                }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                Semaine {clientWeek} · {locked.length} ressource{locked.length > 1 ? 's' : ''} à venir
              </div>
            </div>
          )}

          {/* Débloquées */}
          {unlocked.length > 0 && (
            <>
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
                    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 12 }}>{res.description}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span className="pill pill-neutral" style={{ fontSize: 10 }}>{res.type}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{res.duration || (res.week ? `Sem. ${res.week}` : '')}</span>
                    </div>
                    {res.url ? (
                      <a href={res.url} target="_blank" rel="noopener noreferrer" className="btn-primary"
                        style={{ width: '100%', justifyContent: 'center', display: 'flex', gap: 6, fontSize: 12, textDecoration: 'none' }}>
                        <Icon name="external" size={13} /> Accéder
                      </a>
                    ) : (
                      <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', display: 'flex', gap: 6, fontSize: 12 }} type="button" disabled>
                        <Icon name="external" size={13} /> Bientôt disponible
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

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
                      {res.week && (
                        <span style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="lock" size={11} /> Sem. {res.week}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>{res.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{res.description}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
