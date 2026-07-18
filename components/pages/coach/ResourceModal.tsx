'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon, { type IconName } from '@/components/ui/Icon';
import ModalShell from '@/components/ui/ModalShell';
import { getEmbedUrl, stripExtension, type ResourceType } from '@/lib/resourceHelpers';
import { createClient } from '@/lib/supabase/client';
import type { Resource, ResourceSection } from '@/lib/resourceTypes';

export type { Resource };

interface Props {
  resource?: Resource | null;
  sections: ResourceSection[];
  onClose: () => void;
  onSaved: (resource: Resource) => void;
}

const TYPE_OPTIONS: { type: ResourceType; icon: IconName; label: string; sub: string }[] = [
  { type: 'link', icon: 'link', label: 'Lien', sub: 'URL vers une ressource externe' },
  { type: 'file', icon: 'folder', label: 'Fichier', sub: 'PDF, image, document…' },
  { type: 'video', icon: 'play', label: 'Vidéo', sub: 'YouTube ou Vimeo' },
];

const TYPE_COLOR: Record<ResourceType, string> = {
  link: '#2563eb',
  file: '#b58025',
  video: '#cd5b3f',
};

export default function ResourceModal({ resource, sections, onClose, onSaved }: Props) {
  const isEdit = !!resource;
  const [step, setStep] = useState<1 | 2>(isEdit ? 2 : 1);
  const [type, setType] = useState<ResourceType>((resource?.type as ResourceType) || 'link');
  const [title, setTitle] = useState(resource?.title || '');
  const [description, setDescription] = useState(resource?.description || '');
  const [url, setUrl] = useState(resource?.url || '');
  const [videoUrl, setVideoUrl] = useState(resource?.video_url || '');
  const [fileUrl, setFileUrl] = useState(resource?.file_url || '');
  const [fileName, setFileName] = useState(resource?.file_name || '');
  const [fileSize, setFileSize] = useState<number | null>(resource?.file_size || null);
  const [videoDuration, setVideoDuration] = useState<number | null>(resource?.video_duration ?? null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(resource?.thumbnail_url ?? null);
  const [pageCount, setPageCount] = useState<number | null>(resource?.page_count ?? null);
  const [isDefault, setIsDefault] = useState(resource?.is_default ?? false);
  const [sectionId, setSectionId] = useState<string | null>(resource?.section_id ?? null);
  const rootSections = sections.filter(s => s.parent_id === null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingTitle, setFetchingTitle] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  useEffect(() => {
    if (step === 2) setTimeout(() => titleRef.current?.focus(), 100);
  }, [step]);

  const ytFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleYtUrlChange = useCallback((url: string) => {
    setVideoUrl(url);
    if (ytFetchTimerRef.current) clearTimeout(ytFetchTimerRef.current);
    const isYt = /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|&v(?:i)?=))([^#&?\s]{11})/.test(url);
    if (!isYt) return;
    ytFetchTimerRef.current = setTimeout(async () => {
      setFetchingTitle(true);
      try {
        const res = await fetch(`/api/resources/yt-meta?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.title && !title.trim()) setTitle(data.title);
        if (data.duration) setVideoDuration(data.duration);
      } catch { /* silencieux */ }
      setFetchingTitle(false);
    }, 600);
  }, [title]);

  async function handleUpload(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/resources/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (data.url) {
      setFileUrl(data.url);
      setFileName(data.name);
      setFileSize(data.size);
      setThumbnailUrl(data.thumbnail_url ?? null);
      setPageCount(data.page_count ?? null);
      if (!title.trim()) setTitle(stripExtension(data.name));
    }
    setUploading(false);
  }

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const payload: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      type,
      url: type === 'link' ? url.trim() || null : null,
      video_url: type === 'video' ? videoUrl.trim() || null : null,
      video_duration: type === 'video' ? videoDuration : null,
      markdown_content: null,
      file_url: type === 'file' ? fileUrl || null : null,
      file_name: type === 'file' ? fileName || null : null,
      file_size: type === 'file' ? fileSize : null,
      thumbnail_url: type === 'file' ? thumbnailUrl : null,
      page_count: type === 'file' ? pageCount : null,
      is_default: isDefault,
      section_id: sectionId,
    };

    let result: Resource | null = null;

    if (isEdit && resource) {
      const { data, error } = await supabase.from('resources').update(payload).eq('id', resource.id).select().single();
      if (error) { console.error('update error', error); setSaving(false); return; }
      result = data;
    } else {
      const { count } = await supabase.from('resources').select('*', { count: 'exact', head: true }).eq('coach_id', user.id);
      const { data, error } = await supabase.from('resources').insert({
        ...payload,
        coach_id: user.id,
        position: count ?? 0,
        is_new: false,
        locked: true,
      }).select().single();
      if (error) { console.error('insert error', error); setSaving(false); return; }
      result = data;
    }

    setSaving(false);
    if (result) onSaved(result);
  }

  const embedPreview = type === 'video' && videoUrl ? getEmbedUrl(videoUrl) : null;

  return (
    <ModalShell onClose={onClose} width={600}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 24px 0',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>
            {isEdit ? 'Modifier la ressource' : (step === 1 ? 'Nouvelle ressource' : 'Détails')}
          </div>
          {!isEdit && step === 2 && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 16, height: 16, borderRadius: '50%',
                background: TYPE_COLOR[type], color: '#fff', fontSize: 9, fontWeight: 700,
              }}>
                <Icon name={TYPE_OPTIONS.find(t => t.type === type)?.icon || 'link'} size={9} />
              </span>
              {TYPE_OPTIONS.find(t => t.type === type)?.label}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, borderRadius: 6, lineHeight: 0 }}
        >
          <Icon name="x" size={18} />
        </button>
      </div>

      {/* Steps */}
      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.15 }}
            style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}
          >
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
              Quel type de contenu veux-tu ajouter ?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {TYPE_OPTIONS.map(opt => (
                <motion.button
                  key={opt.type}
                  type="button"
                  whileHover={{ y: -1, boxShadow: 'var(--shadow-elev)' }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { setType(opt.type); setStep(2); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '16px 18px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'box-shadow 150ms',
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                    background: `${TYPE_COLOR[opt.type]}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name={opt.icon} size={18} style={{ color: TYPE_COLOR[opt.type] }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>{opt.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.3 }}>{opt.sub}</div>
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.15 }}
            style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Titre */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Titre *
                  </label>
                  {type === 'video' && videoUrl && (
                    <button
                      type="button"
                      onClick={() => handleYtUrlChange(videoUrl)}
                      disabled={fetchingTitle}
                      style={{
                        fontSize: 11, color: fetchingTitle ? 'var(--muted)' : 'var(--accent)',
                        background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                        padding: '3px 9px', cursor: fetchingTitle ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <Icon name="refresh-cw" size={11} />
                      {fetchingTitle ? 'Récupération…' : 'Récupérer le titre'}
                    </button>
                  )}
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    ref={titleRef}
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSave(); }}
                    placeholder={fetchingTitle ? 'Récupération du titre…' : 'Nom de la ressource…'}
                    style={{
                      width: '100%', padding: title ? '10px 36px 10px 14px' : '10px 14px',
                      border: '1px solid var(--border)', borderRadius: 9,
                      background: 'var(--bg)', fontSize: 14, color: 'var(--ink)',
                      outline: 'none', boxSizing: 'border-box',
                      transition: 'border-color 150ms',
                    }}
                    onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                    onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                  />
                  {title && (
                    <button
                      type="button"
                      onMouseDown={e => { e.preventDefault(); setTitle(''); titleRef.current?.focus(); }}
                      style={{
                        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--muted)', padding: 2, lineHeight: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  Description
                </label>
                <input
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Courte description (optionnel)…"
                  style={{
                    width: '100%', padding: '10px 14px',
                    border: '1px solid var(--border)', borderRadius: 9,
                    background: 'var(--bg)', fontSize: 14, color: 'var(--ink)',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Champ URL */}
              {type === 'link' && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    URL
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      placeholder="https://…"
                      type="url"
                      style={{
                        width: '100%', padding: url ? '10px 36px 10px 14px' : '10px 14px',
                        border: '1px solid var(--border)', borderRadius: 9,
                        background: 'var(--bg)', fontSize: 14, color: 'var(--ink)',
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                    {url && (
                      <button
                        type="button"
                        onMouseDown={e => { e.preventDefault(); setUrl(''); }}
                        style={{
                          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--muted)', padding: 2, lineHeight: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Champ Vidéo */}
              {type === 'video' && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    URL YouTube / Vimeo
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      value={videoUrl}
                      onChange={e => handleYtUrlChange(e.target.value)}
                      placeholder="https://youtube.com/watch?v=…"
                      style={{
                        width: '100%', padding: videoUrl ? '10px 36px 10px 14px' : '10px 14px',
                        border: '1px solid var(--border)', borderRadius: 9,
                        background: 'var(--bg)', fontSize: 14, color: 'var(--ink)',
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                    {videoUrl && (
                      <button
                        type="button"
                        onMouseDown={e => { e.preventDefault(); setVideoUrl(''); setVideoDuration(null); }}
                        style={{
                          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--muted)', padding: 2, lineHeight: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    )}
                  </div>
                  {embedPreview && (
                    <div style={{ marginTop: 12, borderRadius: 10, overflow: 'hidden', position: 'relative', paddingBottom: '40%', height: 0, background: '#000' }}>
                      <iframe
                        src={embedPreview}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Toggle par défaut */}
              <button
                type="button"
                onClick={() => setIsDefault(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', borderRadius: 10,
                  background: isDefault ? 'rgba(5,150,105,0.07)' : 'var(--surface-2)',
                  border: `1px solid ${isDefault ? 'rgba(5,150,105,0.25)' : 'var(--border)'}`,
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                  transition: 'background 150ms, border-color 150ms',
                }}
              >
                <div style={{
                  width: 32, height: 18, borderRadius: 9, flexShrink: 0,
                  background: isDefault ? 'var(--green)' : 'var(--border)',
                  position: 'relative', transition: 'background 200ms',
                }}>
                  <div style={{
                    position: 'absolute', top: 2, left: isDefault ? 16 : 2,
                    width: 14, height: 14, borderRadius: '50%', background: '#fff',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    transition: 'left 200ms',
                  }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: isDefault ? 'var(--green)' : 'var(--accent)' }}>
                    Ressource par défaut
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.4 }}>
                    Donnée automatiquement à tout nouvel élève qui rejoint.
                    <br />
                    Reste active même si tu retires l'accès à un élève existant — seul ce toggle contrôle les futurs élèves.
                  </div>
                </div>
              </button>

              {/* Dossier */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  Dossier
                </label>
                <select
                  value={sectionId ?? ''}
                  onChange={e => setSectionId(e.target.value || null)}
                  style={{
                    width: '100%', padding: '10px 14px',
                    border: '1px solid var(--border)', borderRadius: 9,
                    background: 'var(--bg)', fontSize: 14, color: 'var(--ink)',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                >
                  <option value="">Aucun dossier</option>
                  {rootSections.map(root => (
                    <optgroup key={root.id} label={root.name}>
                      <option value={root.id}>{root.name}</option>
                      {sections.filter(s => s.parent_id === root.id).map(sub => (
                        <option key={sub.id} value={sub.id}>{'   ↳ '}{sub.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Champ Fichier */}
              {type === 'file' && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    Fichier
                  </label>
                  {fileUrl ? (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 16px',
                      background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9,
                    }}>
                      <Icon name="folder" size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fileSize ? `${(fileSize / 1024).toFixed(0)} Ko` : ''}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setFileUrl(''); setFileName(''); setFileSize(null); setThumbnailUrl(null); setPageCount(null); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2 }}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        padding: '28px 16px',
                        border: '2px dashed var(--border)', borderRadius: 9,
                        textAlign: 'center', cursor: 'pointer',
                        background: 'var(--surface-2)',
                        transition: 'border-color 150ms, background 150ms',
                      }}
                      onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; }}
                      onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                      onDrop={e => {
                        e.preventDefault();
                        e.currentTarget.style.borderColor = 'var(--border)';
                        const file = e.dataTransfer.files[0];
                        if (file) handleUpload(file);
                      }}
                    >
                      {uploading ? (
                        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Envoi en cours…</div>
                      ) : (
                        <>
                          <Icon name="upload" size={22} style={{ color: 'var(--muted)', marginBottom: 10 }} />
                          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--accent)', marginBottom: 4 }}>
                            Glisse un fichier ici
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>ou clique pour sélectionner · max 50 Mo</div>
                        </>
                      )}
                    </div>
                  )}
                  {/* Input file invisible — opacity:0 pas display:none (iOS Safari) */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
                    style={{ opacity: 0, position: 'absolute', width: 1, height: 1, pointerEvents: 'none' }}
                    aria-hidden="true"
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 24px 20px',
        borderTop: step === 2 ? '1px solid var(--border)' : 'none',
        flexShrink: 0,
      }}>
        <div>
          {step === 2 && !isEdit && (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn-ghost"
              style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <Icon name="arrowR" size={13} style={{ transform: 'rotate(180deg)' }} />
              Retour
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} className="btn-ghost" style={{ fontSize: 13 }}>
            Annuler
          </button>
          {step === 2 && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !title.trim() || uploading}
              className="btn-primary"
              style={{ fontSize: 13, minWidth: 110, opacity: saving || !title.trim() ? 0.6 : 1, justifyContent: 'center', lineHeight: 1 }}
            >
              {saving ? 'Enregistrement…' : (isEdit ? 'Mettre à jour' : 'Enregistrer')}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
