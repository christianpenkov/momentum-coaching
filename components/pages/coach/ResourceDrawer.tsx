'use client';

import { useState, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';

export interface Resource {
  id: string;
  coach_id: string;
  section_id: string | null;
  title: string;
  type: string | null;
  description: string | null;
  url: string | null;
  markdown_content: string | null;
  file_url: string | null;
  file_size: number | null;
  file_name: string | null;
  video_url: string | null;
  position: number;
  is_new: boolean;
  locked: boolean | null;
  week: number | null;
}

interface AccessRow {
  client_id: string;
  unlocked: boolean;
  unlocked_at: string | null;
}

interface Props {
  resource: Resource | null;
  onClose: () => void;
  onSaved: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  link: 'Lien externe',
  file: 'Fichier (PDF, image…)',
  video: 'Vidéo (YouTube / Vimeo)',
  markdown: 'Texte / Note riche',
};

function formatDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function ResourceDrawer({ resource, onClose, onSaved }: Props) {
  const { clients } = useSupabaseClients();
  const supabase = createClient();

  const [tab, setTab] = useState<'access' | 'content'>('access');
  const [accessMap, setAccessMap] = useState<Record<string, AccessRow>>({});
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  // Form state (content tab)
  const [form, setForm] = useState({
    title: '',
    type: 'link' as string,
    description: '',
    url: '',
    video_url: '',
    markdown_content: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ url: string; name: string; size: number } | null>(null);

  // Init form when resource changes
  useEffect(() => {
    if (!resource) return;
    setForm({
      title: resource.title,
      type: resource.type || 'link',
      description: resource.description || '',
      url: resource.url || '',
      video_url: resource.video_url || '',
      markdown_content: resource.markdown_content || '',
    });
    setUploadedFile(
      resource.file_url
        ? { url: resource.file_url, name: resource.file_name || 'Fichier', size: resource.file_size || 0 }
        : null
    );
    setTab('access');
  }, [resource?.id]);

  // Load access rows
  const loadAccess = useCallback(async () => {
    if (!resource) return;
    setLoadingAccess(true);
    const { data } = await supabase
      .from('resource_access')
      .select('client_id, unlocked, unlocked_at')
      .eq('resource_id', resource.id);
    const map: Record<string, AccessRow> = {};
    for (const row of data || []) map[row.client_id] = row;
    setAccessMap(map);
    setLoadingAccess(false);
  }, [resource?.id]);

  useEffect(() => {
    if (resource && tab === 'access') loadAccess();
  }, [resource?.id, tab]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function toggleAccess(clientId: string) {
    if (!resource) return;
    setToggling(t => ({ ...t, [clientId]: true }));
    const current = accessMap[clientId];
    const newUnlocked = !current?.unlocked;

    await supabase.from('resource_access').upsert({
      resource_id: resource.id,
      client_id: clientId,
      unlocked: newUnlocked,
      unlocked_at: newUnlocked ? new Date().toISOString() : null,
    }, { onConflict: 'resource_id,client_id' });

    if (newUnlocked) {
      await supabase.from('resources').update({ is_new: true }).eq('id', resource.id);
    }

    setAccessMap(prev => ({
      ...prev,
      [clientId]: { client_id: clientId, unlocked: newUnlocked, unlocked_at: newUnlocked ? new Date().toISOString() : null },
    }));
    setToggling(t => ({ ...t, [clientId]: false }));
  }

  async function handleUpload(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/resources/upload', { method: 'POST', body: fd });
    if (res.ok) {
      const json = await res.json();
      setUploadedFile({ url: json.url, name: json.name, size: json.size });
    }
    setUploading(false);
  }

  async function saveContent() {
    if (!resource || !form.title.trim()) return;
    setSaving(true);
    const payload: Record<string, any> = {
      title: form.title.trim(),
      type: form.type,
      description: form.description.trim() || null,
    };
    if (form.type === 'link') payload.url = form.url.trim() || null;
    if (form.type === 'video') payload.video_url = form.video_url.trim() || null;
    if (form.type === 'markdown') payload.markdown_content = form.markdown_content || null;
    if (form.type === 'file' && uploadedFile) {
      payload.file_url = uploadedFile.url;
      payload.file_name = uploadedFile.name;
      payload.file_size = uploadedFile.size;
    }
    await supabase.from('resources').update(payload).eq('id', resource.id);
    setSaving(false);
    onSaved();
  }

  if (!resource) return null;

  const unlockedCount = Object.values(accessMap).filter(a => a.unlocked).length;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
          zIndex: 190, animation: 'fadeIn 150ms ease-out',
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(480px, 100vw)',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        zIndex: 200,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        animation: 'slideInRight 200ms cubic-bezier(0.16,1,0.3,1)',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 20px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {resource.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {TYPE_LABELS[resource.type || 'link'] || resource.type} · {unlockedCount} élève{unlockedCount !== 1 ? 's' : ''} débloqué{unlockedCount !== 1 ? 's' : ''}
            </div>
          </div>
          <button
            type="button" onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, flexShrink: 0 }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 20px' }}>
          {(['access', 'content'] as const).map(t => (
            <button
              key={t} type="button"
              onClick={() => setTab(t)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '12px 16px 11px',
                fontSize: 13, fontWeight: tab === t ? 700 : 400,
                color: tab === t ? 'var(--accent)' : 'var(--muted)',
                borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {t === 'access' ? 'Accès élèves' : 'Contenu'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* ── ACCESS TAB ── */}
          {tab === 'access' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {loadingAccess ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, paddingTop: 20, textAlign: 'center' }}>Chargement…</div>
              ) : clients.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, paddingTop: 20, textAlign: 'center' }}>Aucun élève pour le moment.</div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                    Activer l'accès pour déverrouiller cette ressource chez un élève spécifique.
                  </div>
                  {clients.map(client => {
                    const access = accessMap[client.profile_id || client.id];
                    const isOn = access?.unlocked ?? false;
                    const isToggling = toggling[client.profile_id || client.id];
                    return (
                      <div
                        key={client.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 14px',
                          background: 'var(--surface-2)',
                          borderRadius: 10,
                          border: `1px solid ${isOn ? 'var(--green)' : 'var(--border)'}`,
                          transition: 'border-color 150ms',
                        }}
                      >
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, color: 'var(--accent)', flexShrink: 0,
                        }}>
                          {(client.initials || client.name?.slice(0, 2) || '?').toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {client.name}
                          </div>
                          {isOn && access?.unlocked_at && (
                            <div style={{ fontSize: 11, color: 'var(--green)' }}>
                              Débloqué le {formatDate(access.unlocked_at)}
                            </div>
                          )}
                          {!isOn && (
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Non débloqué</div>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={isToggling}
                          onClick={() => toggleAccess(client.profile_id || client.id)}
                          style={{
                            width: 44, height: 24, borderRadius: 12,
                            background: isOn ? 'var(--green)' : 'var(--border)',
                            border: 'none', cursor: isToggling ? 'default' : 'pointer',
                            position: 'relative', transition: 'background 200ms',
                            flexShrink: 0, opacity: isToggling ? 0.6 : 1,
                          }}
                          aria-label={isOn ? 'Verrouiller' : 'Débloquer'}
                        >
                          <span style={{
                            position: 'absolute', top: 3,
                            left: isOn ? 23 : 3,
                            width: 18, height: 18, borderRadius: '50%',
                            background: 'white',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            transition: 'left 200ms cubic-bezier(0.16,1,0.3,1)',
                          }} />
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* ── CONTENT TAB ── */}
          {tab === 'content' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Title */}
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Titre *</label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {/* Type */}
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Type</label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', fontSize: 13, color: 'var(--ink)', outline: 'none', cursor: 'pointer' }}
                >
                  {Object.entries(TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Description <span style={{ fontWeight: 400 }}>(optionnel)</span></label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', fontSize: 13, color: 'var(--ink)', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
              </div>

              {/* Champ selon type */}
              {form.type === 'link' && (
                <div>
                  <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>URL</label>
                  <input
                    value={form.url}
                    onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                    placeholder="https://…"
                    type="url"
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              )}

              {form.type === 'video' && (
                <div>
                  <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>URL YouTube ou Vimeo</label>
                  <input
                    value={form.video_url}
                    onChange={e => setForm(f => ({ ...f, video_url: e.target.value }))}
                    placeholder="https://youtube.com/watch?v=… ou https://vimeo.com/…"
                    type="url"
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              )}

              {form.type === 'markdown' && (
                <div>
                  <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Contenu (Markdown)</label>
                  <textarea
                    value={form.markdown_content}
                    onChange={e => setForm(f => ({ ...f, markdown_content: e.target.value }))}
                    rows={10}
                    placeholder={`# Titre\n\nTon texte ici…\n\n**Gras**, *italique*, [lien](https://…)\n- Liste\n- Liste`}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', fontSize: 12, color: 'var(--ink)', outline: 'none', resize: 'vertical', fontFamily: 'var(--font-mono)', lineHeight: 1.6, boxSizing: 'border-box' }}
                  />
                </div>
              )}

              {form.type === 'file' && (
                <div>
                  <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Fichier</label>
                  {uploadedFile ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
                      <Icon name="folder" size={16} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uploadedFile.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{formatSize(uploadedFile.size)}</div>
                      </div>
                      <button type="button" onClick={() => setUploadedFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2 }}>
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  ) : (
                    <label style={{ display: 'block', padding: '20px', border: '2px dashed var(--border)', borderRadius: 8, textAlign: 'center', cursor: uploading ? 'default' : 'pointer', color: 'var(--muted)', fontSize: 13 }}>
                      {uploading ? 'Envoi en cours…' : 'Cliquer pour choisir un fichier (PDF, image… max 50 Mo)'}
                      <input
                        type="file"
                        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', overflow: 'hidden' }}
                        disabled={uploading}
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
                      />
                    </label>
                  )}
                </div>
              )}

              {/* Save */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                <button type="button" className="btn-ghost" onClick={onClose} style={{ fontSize: 13 }}>Annuler</button>
                <button
                  type="button" className="btn-primary"
                  disabled={saving || !form.title.trim() || uploading}
                  onClick={saveContent}
                  style={{ fontSize: 13 }}
                >
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}
