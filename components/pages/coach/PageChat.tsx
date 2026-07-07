'use client';
import InlineLoader from '@/components/ui/InlineLoader';

import { useState, useRef, useEffect, useCallback, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { useLongPress } from '@/lib/useLongPress';
import { clearAppBadge } from '@/lib/pwaBadge';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Msg {
  id: string;
  client_id?: string;
  text: string;
  sender_id: string;
  created_at: string;
  type?: 'text' | 'audio' | 'image' | 'document';
  audio_url?: string;
  duration_s?: number;
  read_at?: string | null;
  read?: boolean;
  edited_at?: string | null;
}

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const DELETE_WINDOW_MS = 60 * 60 * 1000;

// ─── Audio context — un seul player actif à la fois ──────────────────────────

interface AudioCtx { activeId: string | null; setActive: (id: string | null) => void; }
const AudioContext = createContext<AudioCtx>({ activeId: null, setActive: () => {} });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function formatDate(dateStr: string) {
  const d = new Date(dateStr); const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Aujourd'hui";
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}
function isSameDay(a: string, b: string) { return new Date(a).toDateString() === new Date(b).toDateString(); }
function formatDuration(s: number) { const m = Math.floor(s/60); const sec = Math.floor(s%60); return `${m}:${sec.toString().padStart(2,'0')}`; }
function getFileExt(name: string) { return (name.split('.').pop() || '').toUpperCase(); }

const WAVEFORM = [3,5,8,6,10,14,9,12,16,11,8,14,18,12,9,16,13,10,7,12,15,10,8,11,14,9,6,10,7,4];

// ─── AudioBubble ─────────────────────────────────────────────────────────────

function AudioBubble({ id, url, duration, isMe }: { id: string; url: string; duration?: number; isMe: boolean }) {
  const { activeId, setActive } = useContext(AudioContext);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [progress, setProgress] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(duration ?? 0);
  const playing = activeId === id;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!playing && !el.paused) el.pause();
  }, [playing]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => { const dur = el.duration || currentDuration || 1; setProgress((el.currentTime/dur)*100); };
    const onEnd = () => { setActive(null); setProgress(0); };
    const onLoad = () => { if (el.duration && !isNaN(el.duration)) setCurrentDuration(el.duration); };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnd);
    el.addEventListener('loadedmetadata', onLoad);
    return () => { el.removeEventListener('timeupdate', onTime); el.removeEventListener('ended', onEnd); el.removeEventListener('loadedmetadata', onLoad); };
  }, [currentDuration, setActive]);

  const togglePlay = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setActive(null); }
    else { setActive(id); try { await el.play(); } catch { setActive(null); } }
  }, [playing, id, setActive]);

  const seekTo = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * (el.duration || 0);
    setProgress(ratio * 100);
  }, []);

  const progressIdx = Math.round((progress / 100) * (WAVEFORM.length - 1));
  const fillColor = isMe ? 'rgba(255,255,255,0.9)' : 'var(--ink)';
  const trackBg = isMe ? 'rgba(255,255,255,0.2)' : 'var(--border)';
  const iconColor = isMe ? '#fff' : 'var(--ink)';
  const mutedColor = isMe ? 'rgba(255,255,255,0.5)' : 'var(--muted)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200, maxWidth: 260 }}>
      <audio ref={audioRef} src={url} preload="metadata" />
      <button onClick={togglePlay} style={{
        width: 36, height: 36, borderRadius: '50%', border: 'none', flexShrink: 0,
        background: isMe ? 'rgba(255,255,255,0.15)' : 'var(--surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        transition: 'transform 80ms ease-out, opacity 80ms',
      }}>
        {playing
          ? <svg width="13" height="13" viewBox="0 0 24 24" fill={iconColor}><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
          : <svg width="13" height="13" viewBox="0 0 24 24" fill={iconColor}><polygon points="6 3 20 12 6 21 6 3"/></svg>}
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div onClick={seekTo} style={{ display: 'flex', alignItems: 'center', gap: 2, height: 28, cursor: 'pointer' }}>
          {WAVEFORM.map((h, i) => (
            <div key={i} style={{
              width: 3, borderRadius: 2, flexShrink: 0,
              height: Math.round((h/18)*28),
              background: i <= progressIdx && progress > 0 ? fillColor : trackBg,
              transition: 'background 0.1s',
              transform: playing && Math.abs(i - progressIdx) <= 1 ? 'scaleY(1.15)' : 'scaleY(1)',
              transformOrigin: 'center',
              transitionDuration: playing ? '0.08s' : '0.1s',
            }} />
          ))}
        </div>
        <span style={{ fontSize: 10, color: mutedColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {progress > 0 && audioRef.current ? formatDuration(audioRef.current.currentTime) : formatDuration(currentDuration)}
        </span>
      </div>
    </div>
  );
}

// ─── Coches de statut ─────────────────────────────────────────────────────────

function MessageStatus({ isMe, msgId, readAt }: { isMe: boolean; msgId: string; readAt?: string | null }) {
  if (!isMe) return null;
  const isRead = !!readAt;
  const isOptimistic = msgId.startsWith('opt-');
  if (isOptimistic) return (
    <svg width="16" height="11" viewBox="0 0 16 11" fill="none" style={{ flexShrink: 0, opacity: 0.65 }}>
      <path d="M1 5.5l4 4L14 1.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  if (isRead) return (
    <svg width="20" height="11" viewBox="0 0 20 11" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1 5.5l4 4L13 1.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 5.5l4 4L18 1.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  return (
    <svg width="20" height="11" viewBox="0 0 20 11" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
      <path d="M1 5.5l4 4L13 1.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 5.5l4 4L18 1.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ─── Indicateur frappe ────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: '4px 18px 18px 18px', alignSelf: 'flex-start', width: 52,
    }}>
      {[0,1,2].map(i => (
        <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--muted)', animation: 'typing-dot 1.2s ease-in-out infinite', animationDelay: `${i*0.2}s` }} />
      ))}
    </div>
  );
}

// ─── RecordingOverlay (waveform Web Audio, zéro re-render) ───────────────────

const BAR_COUNT = 13;

function RecordingOverlay({ onCancel, onSend, elapsed, stream }: {
  onCancel: () => void; onSend: () => void; elapsed: number; stream: MediaStream | null;
}) {
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    if (!stream) return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyserRef.current = analyser;
    ctx.createMediaStreamSource(stream).connect(analyser);
    dataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    if (navigator.vibrate) navigator.vibrate(40);

    const draw = () => {
      const an = analyserRef.current; const da = dataRef.current;
      if (!an || !da) return;
      an.getByteFrequencyData(da);
      let total = 0; for (let i = 0; i < da.length; i++) total += da[i];
      const amp = Math.min(100, (total / da.length / 140) * 100);
      barRefs.current.forEach((bar, i) => {
        if (!bar) return;
        const factor = 1 - Math.abs(i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
        bar.style.height = `${Math.max(15, amp * factor * 0.85)}%`;
        bar.style.background = amp > 10 ? 'var(--ink)' : 'var(--muted)';
      });
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      analyser.disconnect(); ctx.close();
    };
  }, [stream]);

  const fmt = (s: number) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, gap: 12, animation: 'rec-fadein 0.15s ease-out' }}>
      <button onClick={onCancel} type="button" style={{ width: 48, height: 48, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, background: 'var(--surface-2)', borderRadius: 24, padding: '0 14px', height: 44 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--red)', flexShrink: 0, animation: 'pulse-rec 1s ease-in-out infinite' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmt(elapsed)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, height: '100%', justifyContent: 'center' }}>
          {Array.from({ length: BAR_COUNT }).map((_, i) => (
            <div key={i} ref={el => { barRefs.current[i] = el; }} style={{ width: 3, height: '15%', borderRadius: 2, background: 'var(--muted)', flexShrink: 0, willChange: 'height, background', transition: 'height 0.04s ease-out' }} />
          ))}
        </div>
      </div>
      <button onClick={onSend} type="button" style={{ width: 48, height: 48, borderRadius: '50%', border: 'none', background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, animation: 'rec-popin 0.2s cubic-bezier(0.175,0.885,0.32,1.275)' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  );
}

// ─── MessageContextMenu — clic droit desktop / appui long mobile ─────────────

const CTX_MENU_WIDTH = 160;
const CTX_MENU_HEIGHT = 90;
const BUBBLE_SCALE = 1.3;

function MessageContextMenu({ rect, html, canEdit, canDelete, onEdit, onDelete, onClose }: {
  rect: DOMRect; html: string; canEdit: boolean; canDelete: boolean;
  onEdit: () => void; onDelete: () => void; onClose: () => void;
}) {
  const cloneRef = useRef<HTMLDivElement>(null);
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (cloneRef.current) cloneRef.current.innerHTML = html;
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, [html]);

  if (typeof document === 'undefined') return null;
  // Le clone visuel grossit toujours symétriquement depuis la bulle réelle (effet
  // WhatsApp), mais le MENU s'ancre sur la bulle réelle (rect), pas sur le clone
  // agrandi — pour un message long qui occupe presque tout l'écran, ancrer sur le
  // clone poussait le menu très loin (parfois tout en bas). Règle simple et
  // prévisible : juste au-dessus si assez de place, sinon juste en-dessous.
  const GAP = 8;
  const SCREEN_MARGIN = 16;
  const scaledWidth = rect.width * BUBBLE_SCALE;
  const scaledHeight = rect.height * BUBBLE_SCALE;
  const idealLeft = rect.left - (scaledWidth - rect.width) / 2;
  const cloneLeft = Math.min(Math.max(idealLeft, SCREEN_MARGIN), window.innerWidth - scaledWidth - SCREEN_MARGIN);
  const idealTop = rect.top - (scaledHeight - rect.height) / 2;
  const cloneTop = Math.max(idealTop, SCREEN_MARGIN);
  const spaceAbove = rect.top - SCREEN_MARGIN;
  const openUpward = spaceAbove >= CTX_MENU_HEIGHT + GAP;
  const rawTop = openUpward ? rect.top - CTX_MENU_HEIGHT - GAP : rect.bottom + GAP;
  const top = Math.min(Math.max(rawTop, SCREEN_MARGIN), window.innerHeight - CTX_MENU_HEIGHT - SCREEN_MARGIN);
  // Aligné au bord droit de la bulle (les messages sont à droite de l'écran).
  const left = Math.min(Math.max(rect.right - CTX_MENU_WIDTH, 8), window.innerWidth - CTX_MENU_WIDTH - 8);
  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', animation: 'fadeIn 120ms ease-out' }} onMouseDown={onClose} onTouchStart={onClose} />
      {/* Clone visuel de la bulle — même raison que côté élève : overflow:auto de la
          zone de scroll parente clippe tout transform:scale() sur l'original. */}
      <div
        ref={cloneRef}
        style={{
          position: 'fixed',
          left: grown ? cloneLeft : rect.left,
          top: grown ? cloneTop : rect.top,
          width: grown ? scaledWidth : rect.width,
          height: grown ? scaledHeight : rect.height,
          zIndex: 10000,
          transition: 'left 160ms cubic-bezier(0.34, 1.56, 0.64, 1), top 160ms cubic-bezier(0.34, 1.56, 0.64, 1), width 160ms cubic-bezier(0.34, 1.56, 0.64, 1), height 160ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          pointerEvents: 'none',
        }}
      />
      <div style={{
        position: 'fixed', left, top, zIndex: 10000,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)',
        minWidth: CTX_MENU_WIDTH, overflow: 'hidden', fontSize: 13,
      }}>
        {canEdit && (
          <button className="msg-ctx-btn" onMouseDown={() => { onEdit(); onClose(); }} style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
            border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink)',
          }}>
            Modifier
          </button>
        )}
        {canDelete && (
          <button className="msg-ctx-btn" onMouseDown={() => { onDelete(); onClose(); }} style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
            border: 'none', background: 'none', cursor: 'pointer', color: 'var(--red)',
          }}>
            Supprimer
          </button>
        )}
        {!canEdit && !canDelete && (
          <div style={{ padding: '10px 14px', color: 'var(--faint)' }}>Délai dépassé</div>
        )}
      </div>
    </>,
    document.body
  );
}

// ─── DeleteMessageConfirm — confirmation avec case à cocher avant suppression ──

function DeleteMessageConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const [checked, setChecked] = useState(false);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 10001 }} onMouseDown={onCancel} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: 10002, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '24px 28px', minWidth: 320, boxShadow: '0 8px 32px rgba(0,0,0,.18)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Supprimer ce message ?</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Cette action supprime définitivement le message pour toi et ton interlocuteur.
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', marginBottom: 20, cursor: 'pointer' }}>
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} style={{ width: 14, height: 14, cursor: 'pointer' }} />
          Je comprends que cette action est irréversible
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="msg-confirm-btn" onMouseDown={onCancel} style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}>
            Annuler
          </button>
          <button className="msg-confirm-btn" onMouseDown={() => { if (!checked) return; onConfirm(); }} style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', background: '#dc2626', color: '#fff', cursor: checked ? 'pointer' : 'not-allowed', opacity: checked ? 1 : 0.4 }}>
            Supprimer
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}

// ─── EditBubbleOverlay — mode édition en portail, fond assombri/flouté façon menu ──

function EditBubbleOverlay({ rect, isMe, editText, setEditText, originalText, onSave, onCancel }: {
  rect: DOMRect; isMe: boolean; editText: string; setEditText: (v: string) => void;
  originalText: string; onSave: () => void; onCancel: () => void;
}) {
  // Sur mobile, l'ouverture du clavier virtuel réduit la zone réellement visible
  // sans changer window.innerHeight — sans ça, la boîte reste positionnée comme si
  // tout l'écran était visible et se retrouve masquée derrière le clavier. On suit
  // window.visualViewport (hauteur + décalage) pour recalculer en direct.
  const [viewport, setViewport] = useState(() => ({
    height: typeof window !== 'undefined' ? (window.visualViewport?.height ?? window.innerHeight) : 0,
    offsetTop: typeof window !== 'undefined' ? (window.visualViewport?.offsetTop ?? 0) : 0,
  }));
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setViewport({ height: vv.height, offsetTop: vv.offsetTop });
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  const unchanged = editText.trim() === originalText.trim() || editText.trim().length === 0;
  // La bulle d'origine peut être très étroite (message court, ex: "ok") — la zone
  // d'édition a besoin d'une largeur confortable pour taper, pas la largeur exacte
  // du texte affiché. On part du rect réel mais avec un plancher, plafonné à l'écran.
  const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 32);
  const left = Math.min(Math.max(rect.left, 16), window.innerWidth - width - 16);
  // Boîte d'édition plafonnée à l'espace vertical réellement visible (viewport visuel,
  // pas window.innerHeight qui ignore le clavier). Le textarea reprend la hauteur
  // réelle de la bulle d'origine (petit message → petite boîte, long message →
  // grande boîte), avec un plancher confortable et un plafond pour les très longs
  // messages (scroll interne au-delà).
  const visibleTop = viewport.offsetTop;
  const visibleHeight = viewport.height;
  const maxBoxHeight = visibleHeight - 32;
  const textareaHeight = Math.min(Math.max(rect.height, 60), Math.min(maxBoxHeight - 70, 400));
  const boxHeight = Math.min(textareaHeight + 70, maxBoxHeight);
  const top = Math.min(Math.max(rect.top, visibleTop + 16), visibleTop + visibleHeight - boxHeight - 16);
  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', animation: 'fadeIn 120ms ease-out' }} onMouseDown={onCancel} />
      <div style={{
        position: 'fixed', left, top, width, maxHeight: boxHeight, zIndex: 10000,
        background: isMe ? 'var(--ink)' : 'var(--surface)',
        color: isMe ? '#fff' : 'var(--ink)',
        border: isMe ? 'none' : '1px solid var(--border)',
        borderRadius: 14, padding: '9px 12px', boxShadow: '0 8px 32px rgba(0,0,0,.25)',
        display: 'flex', flexDirection: 'column', gap: 6,
        animation: 'scaleIn 160ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>
        <textarea
          autoFocus
          value={editText}
          onChange={e => setEditText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!unchanged) onSave(); }
            if (e.key === 'Escape') onCancel();
          }}
          style={{
            fontSize: 14, lineHeight: 1.5, fontFamily: 'inherit', resize: 'none',
            background: 'transparent', color: isMe ? '#fff' : 'var(--ink)',
            border: `1px solid ${isMe ? 'rgba(255,255,255,0.3)' : 'var(--border)'}`,
            borderRadius: 8, padding: '6px 8px', outline: 'none', width: '100%', boxSizing: 'border-box',
            height: textareaHeight, overflowY: 'auto',
          }}
        />
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button className="msg-edit-btn" onClick={onCancel} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: 'none', background: 'transparent', color: isMe ? 'rgba(255,255,255,0.7)' : 'var(--muted)', cursor: 'pointer' }}>Annuler</button>
          <button
            className="msg-edit-btn"
            onClick={onSave}
            disabled={unchanged}
            style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 6, border: 'none',
              background: isMe ? 'rgba(255,255,255,0.2)' : 'var(--ink)', color: '#fff',
              cursor: unchanged ? 'not-allowed' : 'pointer', opacity: unchanged ? 0.4 : 1,
            }}
          >
            Enregistrer
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}

// ─── MessageBubble — une bulle de message, isolée pour porter useLongPress proprement ──

function MessageBubble({ msg, userId, isContinued, isLast, isEditing, editRect, editText, setEditText, onStartEdit, onCancelEdit, onSaveEdit, canEdit, canDelete, onOpenCtxMenu, onOpenLightbox, isMenuTarget, onEnterViewport, registerBubbleRef }: {
  msg: Msg; userId: string; isContinued: boolean; isLast: boolean;
  isEditing: boolean; editRect: DOMRect | null; editText: string; setEditText: (v: string) => void;
  onStartEdit: () => void; onCancelEdit: () => void; onSaveEdit: () => void;
  canEdit: boolean; canDelete: boolean;
  onOpenCtxMenu: (rect: DOMRect, html: string) => void;
  onOpenLightbox: (url: string) => void;
  isMenuTarget?: boolean;
  onEnterViewport?: (msgId: string) => void;
  registerBubbleRef?: (msgId: string, el: HTMLDivElement | null) => void;
}) {
  const isMe = msg.sender_id === userId;
  const isAudio = msg.type === 'audio';
  const isImage = msg.type === 'image';
  const isDocument = msg.type === 'document';
  const bubbleRef = useRef<HTMLDivElement>(null);
  const setBubbleRef = (el: HTMLDivElement | null) => {
    bubbleRef.current = el;
    registerBubbleRef?.(msg.id, el);
  };
  const openMenu = () => {
    if (!bubbleRef.current) return;
    onOpenCtxMenu(bubbleRef.current.getBoundingClientRect(), bubbleRef.current.outerHTML);
  };
  // Long-press + clic droit combinés (voir lib/useLongPress.ts). Désactivé en
  // mode édition et tant que le menu contextuel est ouvert sur cette bulle (la
  // bulle reste dans le DOM en visibility:hidden pendant ce temps).
  const canOpenMenu = isMe && (canEdit || canDelete) && !isEditing && !isMenuTarget;
  const { ref: wrapperRef } = useLongPress(() => openMenu(), canOpenMenu);
  // editRect est remesuré par le composant parent au clic sur "Modifier" via
  // bubbleRefsMap (pas un rect figé au long-press) — voir onEdit dans le rendu
  // du menu contextuel.

  // Marque le message lu seulement quand sa bulle entre réellement dans le
  // viewport visible (scroll) — pas juste "la conversation est ouverte".
  // Pas de document.hasFocus() : peu fiable en PWA standalone. Si le message est
  // déjà visible au montage mais la page pas encore visible à cet instant, on
  // retente au prochain visibilitychange (IntersectionObserver ne redéclenche pas
  // tant qu'on ne re-scrolle pas hors-champ puis dedans).
  useEffect(() => {
    if (!onEnterViewport || isMe || !bubbleRef.current || typeof IntersectionObserver === 'undefined') return;
    const el = bubbleRef.current;
    let pendingVisible = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Le message doit rester affiché ~1,5s avant d'être considéré lu — un simple
    // passage rapide en scrollant ne doit pas suffire.
    const READ_DELAY_MS = 1000;

    const clearTimer = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };

    const tryMark = () => {
      clearTimer();
      if (pendingVisible && document.visibilityState === 'visible') {
        timer = setTimeout(() => {
          if (pendingVisible && document.visibilityState === 'visible') onEnterViewport(msg.id);
        }, READ_DELAY_MS);
      }
    };

    const observer = new IntersectionObserver((entries) => {
      pendingVisible = !!entries[0]?.isIntersecting;
      tryMark();
    }, { threshold: 0.6 });
    observer.observe(el);
    document.addEventListener('visibilitychange', tryMark);

    return () => {
      clearTimer();
      observer.disconnect();
      document.removeEventListener('visibilitychange', tryMark);
    };
  }, [onEnterViewport, isMe, msg.id]);

  return (
    <div ref={wrapperRef} className="msg-bubble-in" style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '78%', marginTop: isContinued ? 2 : 8 }}>
      <div
        ref={setBubbleRef}
        style={{
          background: isMe ? 'var(--ink)' : 'var(--surface)',
          color: isMe ? '#fff' : 'var(--ink)',
          borderRadius: isMe
            ? (isContinued ? '18px 4px 4px 18px' : isLast ? '18px 4px 18px 18px' : '18px 4px 4px 18px')
            : (isContinued ? '4px 18px 18px 4px' : isLast ? '4px 18px 18px 18px' : '4px 18px 18px 4px'),
          padding: isAudio ? '10px 12px 8px 12px' : isImage ? '4px' : '9px 12px',
          border: isMe ? 'none' : '1px solid var(--border)',
          boxShadow: isMe ? 'none' : 'var(--shadow-item)',
          position: 'relative',
          visibility: (isMenuTarget || isEditing) ? 'hidden' : 'visible',
        }}>
        {isEditing ? null : isAudio && msg.audio_url ? (
          <AudioBubble id={msg.id} url={msg.audio_url} duration={msg.duration_s} isMe={isMe} />
        ) : isImage && msg.audio_url ? (
          <div style={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }}
            onClick={() => onOpenLightbox(msg.audio_url!)}
          >
            <img
              src={msg.audio_url} alt=""
              style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 12, display: 'block' }}
            />
            <div style={{
              position: 'absolute', inset: 0, borderRadius: 12,
              background: 'rgba(0,0,0,0)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              transition: 'background 180ms',
            }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.18)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0)')}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ opacity: 0, transition: 'opacity 180ms', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))' }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
              >
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </div>
          </div>
        ) : isDocument && msg.audio_url ? (
          <a href={msg.audio_url} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
              background: isMe ? 'rgba(255,255,255,0.10)' : 'var(--surface-2)',
              borderRadius: 10, padding: '10px 12px', minWidth: 200, maxWidth: 280 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 8, flexShrink: 0,
              background: isMe ? 'rgba(255,255,255,0.15)' : 'var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isMe ? 'rgba(255,255,255,0.85)' : 'var(--muted)'} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: isMe ? '#fff' : 'var(--ink)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {msg.text || 'Document'}
              </div>
              <div style={{ fontSize: 11, color: isMe ? 'rgba(255,255,255,0.55)' : 'var(--muted)', marginTop: 2 }}>
                {getFileExt(msg.text || '')}
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isMe ? 'rgba(255,255,255,0.5)' : 'var(--muted)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        ) : (
          <div style={{ fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.text}</div>
        )}
        {!isEditing && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            gap: 3, marginTop: isImage ? 0 : 4,
            ...(isImage ? {
              position: 'absolute', bottom: 6, right: 8,
              background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
              borderRadius: 6, padding: '2px 5px',
            } : {}),
          }}>
            {msg.edited_at && (
              <span style={{ fontSize: 10, color: isImage ? 'rgba(255,255,255,0.7)' : (isMe ? 'rgba(255,255,255,0.5)' : 'var(--faint)') }}>modifié ·</span>
            )}
            <span style={{ fontSize: 10, color: isImage ? 'rgba(255,255,255,0.9)' : (isMe ? 'rgba(255,255,255,0.5)' : 'var(--muted)') }}>{formatTime(msg.created_at)}</span>
            <MessageStatus isMe={isMe} msgId={msg.id} readAt={msg.read_at} />
          </div>
        )}
      </div>
      {isEditing && editRect && (
        <EditBubbleOverlay
          rect={editRect}
          isMe={isMe}
          editText={editText}
          setEditText={setEditText}
          originalText={msg.text}
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      )}
    </div>
  );
}

// ─── Zone de conversation ─────────────────────────────────────────────────────

function ConversationThread({ clientId, userId, clientName, clientInitials, isOnline, supabase, presenceCh }: {
  clientId: string; userId: string; clientName: string; clientInitials: string;
  isOnline: boolean; supabase: ReturnType<typeof createClient>;
  presenceCh: ReturnType<typeof supabase.channel> | null;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [clientTyping, setClientTyping] = useState(false);
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [mediaRecorderSupported, setMediaRecorderSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [showScrollArrow, setShowScrollArrow] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<{ file: File; previewUrl?: string; type: 'image' | 'document' } | null>(null);
  const [isSendingFile, setIsSendingFile] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ rect: DOMRect; html: string; msgId: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRect, setEditRect] = useState<DOMRect | null>(null);
  // Refs stables vers le DOM node de chaque bulle — remesurées juste avant
  // d'afficher l'édition (pas un rect figé au moment du long-press).
  const bubbleRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const [editText, setEditText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const chatZoneRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSentRef = useRef<number>(0);

  useEffect(() => {
    try { if (typeof window !== 'undefined' && window.MediaRecorder) setMediaRecorderSupported(true); } catch {}
  }, []);

  // Force un re-render toutes les minutes pour que les boutons Modifier/Supprimer
  // disparaissent au bon moment même si personne n'interagit avec la page.
  useEffect(() => {
    const t = setInterval(() => forceTick(n => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // Charge messages
  useEffect(() => {
    setLoading(true);
    setMessages([]);
    supabase.from('messages')
      .select('id, text, sender_id, created_at, type, audio_url, duration_s, read_at, read, edited_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setMessages((data as Msg[]) || []);
        setLoading(false);
        // Le marquage lu se fait maintenant uniquement via onEnterViewport (IntersectionObserver
        // par bulle) — un message trop haut dans l'historique, jamais scrollé jusqu'à lui, ne
        // doit pas être marqué lu juste parce que la conversation est ouverte.
      });
  }, [clientId, userId, supabase]);

  const markMessageRead = useCallback((msgId: string) => {
    setMessages(prev => {
      const msg = prev.find(m => m.id === msgId);
      if (!msg || msg.read_at) return prev;
      supabase.from('messages').update({ read_at: new Date().toISOString(), read: true })
        .eq('id', msgId).then(() => { clearAppBadge(); });
      return prev.map(m => m.id === msgId ? { ...m, read_at: new Date().toISOString() } : m);
    });
  }, [supabase]);

  // Realtime messages + typing client sur le canal presence
  useEffect(() => {
    const ch = supabase.channel(`msgs-coach-${clientId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `client_id=eq.${clientId}` },
        async (payload) => {
          const msg = payload.new as Msg;
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev;
            const optIdx = prev.findIndex(m =>
              m.id.startsWith('opt-') && m.sender_id === msg.sender_id &&
              m.text === msg.text && m.type === (msg.type || 'text')
            );
            if (optIdx !== -1) { const next = [...prev]; next[optIdx] = msg; return next; }
            return [...prev, msg];
          });
          // Le marquage lu se fait via onEnterViewport quand la bulle entre réellement
          // dans le viewport (pas automatique à la réception — cf. markMessageRead).
          // Push géré par le trigger Supabase côté serveur
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `client_id=eq.${clientId}` },
        (payload) => {
          const updated = payload.new as Msg;
          setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `client_id=eq.${clientId}` },
        (payload) => {
          const deletedId = (payload.old as Msg).id;
          setMessages(prev => prev.filter(m => m.id !== deletedId));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [clientId, userId, supabase]);

  // Écoute typing client sur le canal presence (presence-chat-{clientId})
  useEffect(() => {
    if (!presenceCh) return;
    const handler = (payload: { payload?: { role?: string } }) => {
      if (payload.payload?.role === 'client') {
        setClientTyping(true);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setClientTyping(false), 3000);
      }
    };
    presenceCh.on('broadcast', { event: 'typing' }, handler);
    return () => { if (typingTimerRef.current) clearTimeout(typingTimerRef.current); };
  }, [presenceCh]);

  const initialScrollDone = useRef(false);
  // Tant que l'utilisateur n'a pas scrollé lui-même, on reste ancré en bas — y compris quand
  // des images/audio finissent de charger après coup et changent la hauteur du contenu
  // (setTimeout à délai fixe ne suffit pas : ResizeObserver réagit au vrai changement de taille).
  const stickToBottomRef = useRef(true);
  // Pendant la phase de stabilisation (hard refresh : viewport mobile qui rétrécit quand la
  // barre d'adresse se replie, fonts qui swap, hydration) le navigateur peut émettre un event
  // "scroll" natif alors que l'utilisateur n'a rien touché — on ignore onScroll pendant cette
  // fenêtre pour ne pas désarmer stickToBottomRef par erreur.
  const settlingRef = useRef(true);
  useEffect(() => {
    if (loading) return;
    const container = chatZoneRef.current;
    if (!container) return;
    if (!initialScrollDone.current) {
      // behavior: 'instant' outrepasse scroll-behavior:smooth (CSS) sur .chat-messages-zone —
      // une simple affectation scrollTop serait animée par le navigateur et provoquerait un défilement visible.
      container.scrollTo({ top: container.scrollHeight, behavior: 'instant' as ScrollBehavior });
      initialScrollDone.current = true;
      stickToBottomRef.current = true;
      settlingRef.current = true;
      const t = setTimeout(() => { settlingRef.current = false; }, 1200);
      return () => clearTimeout(t);
    } else if (stickToBottomRef.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, clientTyping, loading]);

  useEffect(() => {
    const container = chatZoneRef.current;
    if (!container || loading) return;
    const ro = new ResizeObserver(() => {
      if (stickToBottomRef.current && chatZoneRef.current) {
        chatZoneRef.current.scrollTo({ top: chatZoneRef.current.scrollHeight, behavior: 'instant' as ScrollBehavior });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [loading]);

  // Envoi texte
  async function sendMessage(text: string) {
    if (!text.trim()) return;
    setInput('');
    const optimisticId = `opt-text-${Date.now()}`;
    const optimistic: Msg = { id: optimisticId, client_id: clientId, sender_id: userId, text: text.trim(), created_at: new Date().toISOString(), type: 'text' };
    setMessages(prev => [...prev, optimistic]);
    const { data } = await supabase.from('messages')
      .insert({ client_id: clientId, sender_id: userId, text: text.trim(), type: 'text', read: false })
      .select('id, text, sender_id, created_at, type, audio_url, duration_s, read_at, read').single();
    if (data) setMessages(prev => prev.map(m => m.id === optimisticId ? data as Msg : m));
  }

  // Édition / suppression — la policy RLS reste la seule vraie garantie de sécurité,
  // ces vérifications côté client ne sont qu'un affichage cohérent avec les permissions.
  function canEditMsg(msg: Msg) {
    return msg.sender_id === userId && Date.now() - new Date(msg.created_at).getTime() < EDIT_WINDOW_MS;
  }
  function canDeleteMsg(msg: Msg) {
    return msg.sender_id === userId && Date.now() - new Date(msg.created_at).getTime() < DELETE_WINDOW_MS;
  }
  async function editMessage(msgId: string, newText: string) {
    if (!newText.trim()) return;
    const editedAt = new Date().toISOString();
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, text: newText.trim(), edited_at: editedAt } : m));
    const { error } = await supabase.from('messages')
      .update({ text: newText.trim(), edited_at: editedAt }).eq('id', msgId);
    if (error) setActionError('Trop tard pour modifier ce message');
  }
  async function deleteMessage(msgId: string) {
    const backup = messages;
    setMessages(prev => prev.filter(m => m.id !== msgId));
    const { error } = await supabase.from('messages').delete().eq('id', msgId);
    if (error) { setMessages(backup); setActionError('Trop tard pour supprimer ce message'); }
  }

  // Envoi vocal
  async function sendAudioMessage(blob: Blob, durationS: number) {
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const strictType = ext === 'mp4' ? 'audio/mp4' : ext === 'ogg' ? 'audio/ogg' : 'audio/webm';
    const optimisticId = `opt-audio-${Date.now()}`;
    const localUrl = URL.createObjectURL(blob);
    const optimistic: Msg = { id: optimisticId, client_id: clientId, sender_id: userId, text: '', created_at: new Date().toISOString(), type: 'audio', audio_url: localUrl, duration_s: durationS };
    setMessages(prev => [...prev, optimistic]);
    try {
      const fileName = `${clientId}/${Date.now()}.${ext}`;
      const audioFile = new File([blob], `${Date.now()}.${ext}`, { type: strictType });
      const { error: uploadError } = await supabase.storage.from('voice-messages').upload(fileName, audioFile, { contentType: strictType, cacheControl: '3600' });
      if (uploadError) { setMessages(prev => prev.filter(m => m.id !== optimisticId)); URL.revokeObjectURL(localUrl); return; }
      const { data: urlData } = supabase.storage.from('voice-messages').getPublicUrl(fileName);
      const { error: insertError } = await supabase.from('messages').insert({ client_id: clientId, sender_id: userId, text: '', type: 'audio', audio_url: urlData.publicUrl, duration_s: Math.round(durationS), read: false });
      if (insertError) { setMessages(prev => prev.filter(m => m.id !== optimisticId)); URL.revokeObjectURL(localUrl); return; }
      setTimeout(() => URL.revokeObjectURL(localUrl), 5000);
    } catch { setMessages(prev => prev.filter(m => m.id !== optimisticId)); URL.revokeObjectURL(localUrl); }
  }

  // Envoi fichier — preview + confirmation avant envoi, comme côté élève
  async function sendFile(file: File) {
    const isImage = file.type.startsWith('image/');
    const type: 'image' | 'document' = isImage ? 'image' : 'document';
    if (file.size > (isImage ? 5*1024*1024 : 20*1024*1024)) { setIsSendingFile(false); return; }
    setIsSendingFile(true);
    const ext = file.name.split('.').pop() || 'bin';
    const fileName = `${clientId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('chat-medias').upload(fileName, file, { contentType: file.type });
    if (error) { setIsSendingFile(false); return; }
    const { data: urlData } = supabase.storage.from('chat-medias').getPublicUrl(fileName);
    await supabase.from('messages').insert({ client_id: clientId, sender_id: userId, text: file.name, type, audio_url: urlData.publicUrl, read: false });
    setIsSendingFile(false);
    setPendingFile(prev => { if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl); return null; });
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  // Enregistrement
  async function startRecording() {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        const dur = (Date.now() - recordingStartRef.current) / 1000;
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size > 0) sendAudioMessage(blob, dur);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setIsRecording(false); setRecordingElapsed(0);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      recordingStartRef.current = Date.now();
      setIsRecording(true); setRecordingElapsed(0);
      recordingTimerRef.current = setInterval(() => setRecordingElapsed(Math.floor((Date.now() - recordingStartRef.current) / 1000)), 1000);
    } catch {}
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
  }

  function cancelRecording() {
    if (!mediaRecorderRef.current) return;
    audioChunksRef.current = [];
    const mr = mediaRecorderRef.current;
    mr.onstop = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); setIsRecording(false); setRecordingElapsed(0); };
    if (mr.state !== 'inactive') mr.stop();
  }

  function handleChatScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollArrow(distanceFromBottom > 120);
    // Pendant la stabilisation (settlingRef), un "scroll" natif peut venir du navigateur
    // lui-même (reflow viewport/fonts), pas de l'utilisateur — on ne désarme pas l'ancrage bas.
    if (!settlingRef.current) stickToBottomRef.current = distanceFromBottom < 40;
  }
  function scrollToBottom() {
    const el = chatZoneRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stickToBottomRef.current = true;
  }

  // Groupes
  const messageGroups: Array<{ dateLabel: string; msgs: Msg[] }> = [];
  messages.forEach((msg, i) => {
    const prev = messages[i-1];
    if (!prev || !isSameDay(prev.created_at, msg.created_at)) messageGroups.push({ dateLabel: formatDate(msg.created_at), msgs: [msg] });
    else messageGroups[messageGroups.length-1].msgs.push(msg);
  });

  return (
    <AudioContext.Provider value={{ activeId: activeAudioId, setActive: setActiveAudioId }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--bg)', position: 'relative' }}>

        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, background: 'var(--surface)' }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, position: 'relative', flexShrink: 0 }}>
            {clientInitials}
            <div style={{ position: 'absolute', bottom: 1, right: 1, width: 9, height: 9, borderRadius: '50%', background: isOnline ? 'var(--green)' : 'var(--faint)', border: '2px solid var(--surface)', transition: 'background 0.4s' }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{clientName}</div>
            <div style={{ fontSize: 11, color: isOnline ? 'var(--green)' : 'var(--muted)', transition: 'color 0.4s' }}>
              {clientTyping ? 'En train d\'écrire…' : isOnline ? 'En ligne' : 'Hors ligne'}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={chatZoneRef} onScroll={handleChatScroll} className="chat-messages-zone" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 2, WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          {loading ? (
            <InlineLoader />
          ) : messages.length === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: 60 }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 12px', display: 'block' }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <div style={{ fontWeight: 600, color: 'var(--ink-2)', fontSize: 13, marginBottom: 4 }}>Aucun message</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Commencez la conversation</div>
            </div>
          ) : messageGroups.map(group => (
            <div key={group.dateLabel} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 6px' }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface-2)', padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border-soft)' }}>
                  {group.dateLabel}
                </span>
              </div>
              {group.msgs.map((msg, msgIdx) => {
                const prevMsg = group.msgs[msgIdx-1];
                const nextMsg = group.msgs[msgIdx+1];
                const isContinued = prevMsg && prevMsg.sender_id === msg.sender_id;
                const isLast = !nextMsg || nextMsg.sender_id !== msg.sender_id;
                return (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    userId={userId}
                    isContinued={!!isContinued}
                    isLast={isLast}
                    isEditing={editingId === msg.id}
                    editRect={editingId === msg.id ? editRect : null}
                    editText={editText}
                    setEditText={setEditText}
                    onStartEdit={() => { setEditingId(msg.id); setEditText(msg.text); }}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={() => { editMessage(msg.id, editText); setEditingId(null); }}
                    canEdit={canEditMsg(msg)}
                    canDelete={canDeleteMsg(msg)}
                    onOpenCtxMenu={(rect, html) => setCtxMenu({ rect, html, msgId: msg.id })}
                    onOpenLightbox={setLightboxUrl}
                    isMenuTarget={ctxMenu?.msgId === msg.id}
                    onEnterViewport={markMessageRead}
                    registerBubbleRef={(id, el) => {
                      if (el) bubbleRefsMap.current.set(id, el);
                      else bubbleRefsMap.current.delete(id);
                    }}
                  />
                );
              })}
            </div>
          ))}
          {clientTyping && <div className="msg-bubble-in" style={{ marginTop: 8 }}><TypingIndicator /></div>}
          <div ref={bottomRef} />
        </div>

        {/* Flèche scroll bas */}
        <button
          onClick={scrollToBottom}
          aria-label="Aller en bas"
          style={{
            position: 'absolute', right: 16, bottom: 72,
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--surface)', border: '1px solid var(--border)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', zIndex: 10,
            opacity: showScrollArrow ? 1 : 0,
            transform: showScrollArrow ? 'scale(1) translateY(0)' : 'scale(0.8) translateY(6px)',
            pointerEvents: showScrollArrow ? 'auto' : 'none',
            transition: 'opacity 0.18s ease-out, transform 0.18s ease-out',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Input file */}
        <input ref={fileInputRef} type="file" accept="image/*,application/pdf,.doc,.docx" style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0];
            if (!f) return;
            const isImg = f.type.startsWith('image/');
            const previewUrl = isImg ? URL.createObjectURL(f) : undefined;
            setPendingFile({ file: f, previewUrl, type: isImg ? 'image' : 'document' });
            e.target.value = '';
          }} />

        {/* Preview fichier en attente — même pattern que côté élève */}
        {pendingFile && (
          <div style={{
            padding: '10px 12px', background: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
            animation: 'slideUp 180ms ease-out',
          }}>
            {pendingFile.type === 'image' && pendingFile.previewUrl ? (
              <img src={pendingFile.previewUrl} alt=""
                style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{
                width: 56, height: 56, borderRadius: 8, flexShrink: 0,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pendingFile.file.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                {formatFileSize(pendingFile.file.size)}
              </div>
            </div>
            <button type="button"
              onClick={() => {
                if (pendingFile.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
                setPendingFile(null);
              }}
              style={{
                width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--border)',
                background: 'var(--surface-2)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <button type="button"
              disabled={isSendingFile}
              onClick={() => sendFile(pendingFile.file)}
              className="btn-primary"
              style={{
                height: 36, padding: '0 16px', borderRadius: 18, fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                opacity: isSendingFile ? 0.6 : 1,
              }}>
              {isSendingFile ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ animation: 'spin 0.8s linear infinite' }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  Envoi…
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                  Envoyer
                </>
              )}
            </button>
          </div>
        )}

        {/* Panneau enregistrement */}
        {isRecording && (
          <div className="chat-input-bar" style={{ padding: '8px 16px', flexShrink: 0, background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
            <RecordingOverlay elapsed={recordingElapsed} onCancel={cancelRecording} onSend={stopRecording} stream={streamRef.current} />
          </div>
        )}

        {/* Input bar */}
        {!isRecording && !pendingFile && (
          <div className="chat-input-bar" style={{ padding: '8px 12px', background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
            <button type="button" onClick={() => fileInputRef.current?.click()} style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => {
                setInput(e.target.value);
                // Throttle — évite de spammer le canal realtime à chaque frappe
                if (presenceCh) {
                  const now = Date.now();
                  if (now - lastTypingSentRef.current > 2500) {
                    lastTypingSentRef.current = now;
                    presenceCh.send({ type: 'broadcast', event: 'typing', payload: { role: 'coach' } });
                  }
                }
              }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
              placeholder={`Écrire à ${clientName}…`}
              autoComplete="off" autoCorrect="off" autoCapitalize="sentences"
              spellCheck={false} inputMode="text" name="chat-momentum-coach-x7k"
              style={{ flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: 22, padding: '10px 14px', fontSize: 14, fontFamily: 'inherit', lineHeight: 1.5, outline: 'none', background: 'var(--surface-2)', color: 'var(--ink)', minHeight: 42, maxHeight: 120 }}
              rows={1}
            />
            {mediaRecorderSupported && !input.trim() && (
              <button type="button" onClick={startRecording} style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              </button>
            )}
            {input.trim() && (
              <button className="btn-primary" onClick={() => sendMessage(input)} type="button" style={{ width: 40, height: 40, borderRadius: '50%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="send" size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      {actionError && (
        <div style={{
          position: 'absolute', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--ink)', color: '#fff', fontSize: 12, padding: '8px 14px',
          borderRadius: 20, zIndex: 20, animation: 'fadeIn 150ms ease-out',
        }}
          ref={el => { if (el) setTimeout(() => setActionError(null), 2500); }}
        >
          {actionError}
        </div>
      )}

      {ctxMenu && (() => {
        const msg = messages.find(m => m.id === ctxMenu.msgId);
        if (!msg) return null;
        return (
          <MessageContextMenu
            rect={ctxMenu.rect}
            html={ctxMenu.html}
            canEdit={canEditMsg(msg)} canDelete={canDeleteMsg(msg)}
            onEdit={() => {
              // Mesurer AVANT isEditing=true : une fois vrai, le contenu texte de
              // la bulle est vidé (rendu null) et son rect s'effondre au padding seul.
              const el = bubbleRefsMap.current.get(msg.id);
              setEditRect(el ? el.getBoundingClientRect() : ctxMenu.rect);
              setEditingId(msg.id);
              setEditText(msg.text);
            }}
            onDelete={() => setConfirmDeleteId(msg.id)}
            onClose={() => setCtxMenu(null)}
          />
        );
      })()}

      {confirmDeleteId && (
        <DeleteMessageConfirm
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => { deleteMessage(confirmDeleteId); setConfirmDeleteId(null); }}
        />
      )}

      {lightboxUrl && typeof document !== 'undefined' && createPortal(
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'fadeIn 200ms ease-out',
          }}
        >
          <img
            src={lightboxUrl} alt=""
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: 'min(90vw, 900px)', maxHeight: '85vh',
              objectFit: 'contain', borderRadius: 12,
              animation: 'scaleIn 200ms ease-out',
              boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
            }}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            style={{
              position: 'absolute', top: 16, right: 16,
              width: 44, height: 44, borderRadius: '50%',
              background: 'rgba(255,255,255,0.12)', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#fff',
            }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <a
            href={lightboxUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: 16, right: 68,
              width: 44, height: 44, borderRadius: '50%',
              background: 'rgba(255,255,255,0.12)', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#fff', textDecoration: 'none',
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        </div>,
        document.body
      )}
    </AudioContext.Provider>
  );
}

// ─── PageChat principal ───────────────────────────────────────────────────────

export default function PageChat() {
  const { clients, loading } = useSupabaseClients();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [onlineClients, setOnlineClients] = useState<Set<string>>(new Set());
  const supabase = useRef(createClient()).current;
  const presenceChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [presenceCh, setPresenceCh] = useState<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id || null));
  }, [supabase]);

  useEffect(() => {
    if (clients.length > 0 && !activeId) setActiveId(clients[0].id);
  }, [clients, activeId]);

  // Presence coach : écoute présence client sur les deux canaux (messagerie + global)
  useEffect(() => {
    if (!userId || !activeId) return;

    const ch = supabase.channel(`presence-chat-${activeId}`, {
      config: { presence: { key: userId } },
    });
    ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState();
        const isOnline = Object.entries(state).some(([key, entries]) =>
          key !== userId && (entries as Array<Record<string, unknown>>).some(e => e.role === 'client')
        );
        setOnlineClients(prev => {
          const next = new Set(prev);
          if (isOnline) next.add(activeId); else next.delete(activeId);
          return next;
        });
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED' && document.visibilityState === 'visible') {
          await ch.track({ user_id: userId, role: 'coach', online_at: new Date().toISOString() });
        }
      });
    presenceChRef.current = ch;
    setPresenceCh(ch);

    const handleVisibility = async () => {
      if (!presenceChRef.current) return;
      if (document.visibilityState === 'hidden') {
        await presenceChRef.current.untrack();
      } else {
        await presenceChRef.current.track({ user_id: userId, role: 'coach', online_at: new Date().toISOString() });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      supabase.removeChannel(ch);
      presenceChRef.current = null;
      setPresenceCh(null);
    };
  }, [userId, activeId, supabase]);

  if (loading) return <InlineLoader fullPage />;

  if (clients.length === 0) return (
    <div className="page-content">
      <div className="page-header"><h1 className="page-title">Messages</h1></div>
      <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>
        Aucun client. Les conversations apparaîtront ici dès qu'un client rejoindra.
      </div>
    </div>
  );

  const activeClient = clients.find(c => c.id === activeId);

  return (
    <div className="chat-shell" style={{ display: 'flex', flexDirection: 'row', background: 'var(--bg)' }}>

      {/* Sidebar clients */}
      <div style={{ width: 260, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface)', flexShrink: 0 }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Messages</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {clients.map(cl => {
            const isActive = cl.id === activeId;
            const isOnline = onlineClients.has(cl.id);
            const initials = cl.initials || cl.name.slice(0, 2).toUpperCase();
            return (
              <div key={cl.id} onClick={() => setActiveId(cl.id)} style={{
                padding: '11px 16px', cursor: 'pointer',
                background: isActive ? 'var(--surface-2)' : 'transparent',
                borderLeft: `3px solid ${isActive ? 'var(--ink)' : 'transparent'}`,
                display: 'flex', gap: 10, alignItems: 'center',
                transition: 'background 100ms',
              }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>
                    {initials}
                  </div>
                  <div style={{ position: 'absolute', bottom: 0, right: 0, width: 9, height: 9, borderRadius: '50%', background: isOnline ? 'var(--green)' : 'var(--faint)', border: '2px solid var(--surface)', transition: 'background 0.4s' }} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cl.name}</div>
                  <div style={{ fontSize: 11, color: isOnline ? 'var(--green)' : 'var(--muted)' }}>
                    {isOnline ? 'En ligne' : `Semaine ${cl.week}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Thread */}
      {activeId && userId && activeClient ? (
        <ConversationThread
          key={activeId}
          clientId={activeId}
          userId={userId}
          clientName={activeClient.name}
          clientInitials={activeClient.initials || activeClient.name.slice(0, 2).toUpperCase()}
          isOnline={onlineClients.has(activeId)}
          supabase={supabase}
          presenceCh={presenceCh}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Sélectionne un client
        </div>
      )}
    </div>
  );
}
