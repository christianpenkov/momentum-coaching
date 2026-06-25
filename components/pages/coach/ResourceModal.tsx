'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon, { type IconName } from '@/components/ui/Icon';
import { getEmbedUrl, renderMarkdown, type ResourceType } from '@/lib/resourceHelpers';
import { createClient } from '@/lib/supabase/client';

export interface Resource {
  id: string;
  title: string;
  type: string | null;
  description: string | null;
  url: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  video_url: string | null;
  markdown_content: string | null;
  section_id: string | null;
  position: number;
  is_new: boolean;
}

interface Props {
  resource?: Resource | null;
  onClose: () => void;
  onSaved: (resource: Resource) => void;
}

const TYPE_OPTIONS: { type: ResourceType; icon: IconName; label: string; sub: string }[] = [
  { type: 'link', icon: 'link', label: 'Lien', sub: 'URL vers une ressource externe' },
  { type: 'file', icon: 'folder', label: 'Fichier', sub: 'PDF, image, document…' },
  { type: 'video', icon: 'play', label: 'Vidéo', sub: 'YouTube ou Vimeo' },
  { type: 'markdown', icon: 'list', label: 'Note', sub: 'Texte formaté, instructions' },
];

const TYPE_COLOR: Record<ResourceType, string> = {
  link: '#2563eb',
  file: '#b58025',
  video: '#cd5b3f',
  markdown: '#3f8a52',
};

export default function ResourceModal({ resource, onClose, onSaved }: Props) {
  const isEdit = !!resource;
  const [step, setStep] = useState<1 | 2>(isEdit ? 2 : 1);
  const [type, setType] = useState<ResourceType>((resource?.type as ResourceType) || 'link');
  const [title, setTitle] = useState(resource?.title || '');
  const [description, setDescription] = useState(resource?.description || '');
  const [url, setUrl] = useState(resource?.url || '');
  const [videoUrl, setVideoUrl] = useState(resource?.video_url || '');
  const [markdownContent, setMarkdownContent] = useState(resource?.markdown_content || '');
  const [fileUrl, setFileUrl] = useState(resource?.file_url || '');
  const [fileName, setFileName] = useState(resource?.file_name || '');
  const [fileSize, setFileSize] = useState<number | null>(resource?.file_size || null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  useEffect(() => {
    if (step === 2) setTimeout(() => titleRef.current?.focus(), 100);
  }, [step]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
      markdown_content: type === 'markdown' ? markdownContent.trim() || null : null,
      file_url: type === 'file' ? fileUrl || null : null,
      file_name: type === 'file' ? fileName || null : null,
      file_size: type === 'file' ? fileSize : null,
    };

    let result: Resource | null = null;

    if (isEdit && resource) {
      const { data } = await supabase.from('resources').update(payload).eq('id', resource.id).select().single();
      result = data;
    } else {
      const { data: countData } = await supabase.from('resources').select('id', { count: 'exact', head: true }).eq('coach_id', user.id);
      const { data } = await supabase.from('resources').insert({
        ...payload,
        coach_id: user.id,
        position: (countData as unknown as number) ?? 0,
        is_new: false,
        locked: true,
      }).select().single();
      result = data;
    }

    setSaving(false);
    if (result) onSaved(result);
  }

  const embedPreview = type === 'video' && videoUrl ? getEmbedUrl(videoUrl) : null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px',
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          onClick={e => e.stopPropagation()}
          style={{
            width: 520, maxWidth: '94vw',
            background: 'var(--surface)',
            borderRadius: 16,
            boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '18px 20px 0',
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

          {/* Step 1 — Type picker */}
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.15 }}
                style={{ padding: '20px' }}
              >
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                  Quel type de contenu veux-tu ajouter ?
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {TYPE_OPTIONS.map(opt => (
                    <motion.button
                      key={opt.type}
                      type="button"
                      whileHover={{ y: -2, boxShadow: 'var(--shadow-elev)' }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => { setType(opt.type); setStep(2); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '14px 16px',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'box-shadow 150ms',
                      }}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: `${TYPE_COLOR[opt.type]}18`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon name={opt.icon} size={16} style={{ color: TYPE_COLOR[opt.type] }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{opt.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1, lineHeight: 1.3 }}>{opt.sub}</div>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Step 2 — Fields */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.15 }}
                style={{ padding: '20px' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Titre */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
                      Titre *
                    </label>
                    <input
                      ref={titleRef}
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSave(); }}
                      placeholder="Nom de la ressource…"
                      style={{
                        width: '100%', padding: '9px 12px',
                        border: '1px solid var(--border)', borderRadius: 8,
                        background: 'var(--bg)', fontSize: 13, color: 'var(--ink)',
                        outline: 'none', boxSizing: 'border-box',
                        transition: 'border-color 150ms',
                      }}
                      onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                      onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
                      Description
                    </label>
                    <input
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Courte description (optionnel)…"
                      style={{
                        width: '100%', padding: '9px 12px',
                        border: '1px solid var(--border)', borderRadius: 8,
                        background: 'var(--bg)', fontSize: 13, color: 'var(--ink)',
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {/* Champ selon type */}
                  {type === 'link' && (
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
                        URL
                      </label>
                      <input
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        placeholder="https://…"
                        type="url"
                        style={{
                          width: '100%', padding: '9px 12px',
                          border: '1px solid var(--border)', borderRadius: 8,
                          background: 'var(--bg)', fontSize: 13, color: 'var(--ink)',
                          outline: 'none', boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  )}

                  {type === 'video' && (
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
                        URL YouTube / Vimeo
                      </label>
                      <input
                        value={videoUrl}
                        onChange={e => setVideoUrl(e.target.value)}
                        placeholder="https://youtube.com/watch?v=…"
                        style={{
                          width: '100%', padding: '9px 12px',
                          border: '1px solid var(--border)', borderRadius: 8,
                          background: 'var(--bg)', fontSize: 13, color: 'var(--ink)',
                          outline: 'none', boxSizing: 'border-box',
                        }}
                      />
                      {embedPreview && (
                        <div style={{ marginTop: 10, borderRadius: 8, overflow: 'hidden', position: 'relative', paddingBottom: '40%', height: 0, background: '#000' }}>
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

                  {type === 'file' && (
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
                        Fichier
                      </label>
                      {fileUrl ? (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 14px',
                          background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8,
                        }}>
                          <Icon name="folder" size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fileSize ? `${(fileSize / 1024).toFixed(0)} Ko` : ''}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setFileUrl(''); setFileName(''); setFileSize(null); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2 }}
                          >
                            <Icon name="x" size={14} />
                          </button>
                        </div>
                      ) : (
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            padding: '24px 16px',
                            border: '2px dashed var(--border)', borderRadius: 8,
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
                              <Icon name="upload" size={20} style={{ color: 'var(--muted)', marginBottom: 8 }} />
                              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)', marginBottom: 4 }}>
                                Glisse un fichier ici
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>ou clique pour sélectionner · max 50 Mo</div>
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

                  {type === 'markdown' && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                          Contenu (Markdown)
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowPreview(p => !p)}
                          style={{ fontSize: 11, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                        >
                          {showPreview ? 'Éditer' : 'Prévisualiser'}
                        </button>
                      </div>
                      {showPreview ? (
                        <div
                          className="md-content"
                          style={{
                            minHeight: 120, maxHeight: 220, overflow: 'auto',
                            padding: '10px 12px',
                            border: '1px solid var(--border)', borderRadius: 8,
                            fontSize: 13, lineHeight: 1.7, color: 'var(--ink)',
                            background: 'var(--surface-2)',
                          }}
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(markdownContent || '*Aucun contenu*') }}
                        />
                      ) : (
                        <textarea
                          value={markdownContent}
                          onChange={e => setMarkdownContent(e.target.value)}
                          placeholder="# Titre&#10;&#10;Votre contenu en **Markdown**…"
                          rows={6}
                          style={{
                            width: '100%', padding: '9px 12px',
                            border: '1px solid var(--border)', borderRadius: 8,
                            background: 'var(--bg)', fontSize: 12, color: 'var(--ink)',
                            fontFamily: 'monospace', resize: 'vertical',
                            outline: 'none', boxSizing: 'border-box', lineHeight: 1.6,
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px 18px',
            borderTop: step === 2 ? '1px solid var(--border)' : 'none',
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
                  style={{ fontSize: 13, minWidth: 90, opacity: saving || !title.trim() ? 0.6 : 1 }}
                >
                  {saving ? 'Enregistrement…' : (isEdit ? 'Mettre à jour' : 'Enregistrer')}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
