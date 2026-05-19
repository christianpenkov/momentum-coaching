'use client';

import { useState, useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';

interface Resource {
  id: string;
  coach_id: string;
  title: string;
  description: string | null;
  url: string | null;
  week: number | null;
  created_at: string;
}

export default function PageResources() {
  const { clients, loading } = useSupabaseClients();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loadingRes, setLoadingRes] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', description: '', url: '', week: '' });
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  async function loadResources() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('resources').select('*').eq('coach_id', user.id).order('created_at', { ascending: false });
    setResources(data || []);
    setLoadingRes(false);
  }

  useEffect(() => { loadResources(); }, []);

  function openNew() {
    setEditingId(null);
    setForm({ title: '', description: '', url: '', week: '' });
    setModalOpen(true);
  }

  function openEdit(r: Resource) {
    setEditingId(r.id);
    setForm({ title: r.title, description: r.description || '', url: r.url || '', week: r.week != null ? String(r.week) : '' });
    setModalOpen(true);
  }

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const payload = {
      coach_id: user.id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      url: form.url.trim() || null,
      week: form.week ? parseInt(form.week) : null,
    };
    if (editingId) {
      await supabase.from('resources').update(payload).eq('id', editingId);
    } else {
      await supabase.from('resources').insert(payload);
    }
    setSaving(false);
    setModalOpen(false);
    loadResources();
  }

  async function deleteResource(id: string) {
    await supabase.from('resources').delete().eq('id', id);
    setResources(prev => prev.filter(r => r.id !== id));
  }

  if (loading || loadingRes) {
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
          <p className="page-sub">{resources.length} ressource{resources.length !== 1 ? 's' : ''} publiée{resources.length !== 1 ? 's' : ''} · visible par tous tes élèves</p>
        </div>
        <button className="btn-primary" type="button" onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <Icon name="plus" size={14} /> Publier une ressource
        </button>
      </div>

      {/* Modal ajout/édition */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setModalOpen(false); }}>
          <div className="card" style={{ width: 480, maxWidth: '94vw', padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>{editingId ? 'Modifier la ressource' : 'Publier une ressource'}</div>
              <button type="button" onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}>
                <Icon name="x" size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Titre *</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Ex : Module 3 — Closing" autoFocus
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Décrit ce que contient cette ressource…" rows={3}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink)', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Lien (URL)</label>
                <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://…" type="url"
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Semaine de déverrouillage <span style={{ fontWeight: 400 }}>(optionnel)</span></label>
                <input value={form.week} onChange={e => setForm(f => ({ ...f, week: e.target.value }))}
                  placeholder="Ex : 3 → visible à partir de la semaine 3"
                  type="number" min={1}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)} style={{ fontSize: 13 }}>Annuler</button>
                <button type="button" className="btn-primary" onClick={save} disabled={saving || !form.title.trim()} style={{ fontSize: 13 }}>
                  {saving ? 'Enregistrement…' : editingId ? 'Mettre à jour' : 'Publier'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {resources.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>📚</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Aucune ressource publiée</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Les ressources que tu publies sont visibles par tous tes élèves selon la semaine de déverrouillage.</div>
          <button type="button" className="btn-primary" onClick={openNew} style={{ fontSize: 13 }}>
            <Icon name="plus" size={13} /> Publier ma première ressource
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {resources.map(r => (
            <div key={r.id} className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: r.description ? 4 : 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{r.title}</span>
                  {r.week != null && (
                    <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 20, background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600 }}>
                      Sem. {r.week}+
                    </span>
                  )}
                </div>
                {r.description && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{r.description}</div>}
                {r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="link" size={11} /> {r.url.length > 60 ? r.url.slice(0, 60) + '…' : r.url}
                  </a>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type="button" className="btn-ghost" onClick={() => openEdit(r)} style={{ fontSize: 12, padding: '5px 10px' }}>
                  <Icon name="edit" size={13} />
                </button>
                <button type="button" className="btn-ghost" onClick={() => deleteResource(r.id)} style={{ fontSize: 12, padding: '5px 10px', color: 'var(--red)' }}>
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
