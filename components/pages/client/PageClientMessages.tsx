'use client';

import { useState, useRef, useEffect, useCallback, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';
import InlineLoader from '@/components/ui/InlineLoader';
import PushInit from '@/components/PushInit';
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
  edited_at?: string | null;
}

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const DELETE_WINDOW_MS = 60 * 60 * 1000;

// ─── Audio context — un seul player actif à la fois ──────────────────────────

interface AudioCtx {
  activeId: string | null;
  setActive: (id: string | null) => void;
}
const AudioContext = createContext<AudioCtx>({ activeId: null, setActive: () => {} });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Aujourd'hui";
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function isSameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function formatDuration(s: number) {
  const min = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function getFileExt(name: string) {
  return (name.split('.').pop() || '').toUpperCase();
}

// Waveform statique — 30 barres de hauteurs fixes, aspect naturel de voix
const WAVEFORM = [3,5,8,6,10,14,9,12,16,11,8,14,18,12,9,16,13,10,7,12,15,10,8,11,14,9,6,10,7,4];

// ─── AudioBubble — player custom coordonné ───────────────────────────────────

function AudioBubble({ id, url, duration, isMe }: { id: string; url: string; duration?: number; isMe: boolean }) {
  const { activeId, setActive } = useContext(AudioContext);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [progress, setProgress] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(duration ?? 0);
  const playing = activeId === id;

  // Pause quand un autre player devient actif
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!playing && !el.paused) {
      el.pause();
    }
  }, [playing]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTimeUpdate = () => {
      const dur = el.duration || currentDuration || 1;
      setProgress((el.currentTime / dur) * 100);
    };
    const onEnded = () => { setActive(null); setProgress(0); };
    const onLoaded = () => { if (el.duration && !isNaN(el.duration)) setCurrentDuration(el.duration); };
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('ended', onEnded);
    el.addEventListener('loadedmetadata', onLoaded);
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('loadedmetadata', onLoaded);
    };
  }, [currentDuration, setActive]);

  const togglePlay = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setActive(null);
    } else {
      setActive(id);
      try { await el.play(); } catch { setActive(null); }
    }
  }, [playing, id, setActive]);

  const seekTo = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * (el.duration || 0);
    setProgress(ratio * 100);
  }, []);

  const trackBg = isMe ? 'rgba(255,255,255,0.2)' : 'var(--border)';
  const fillColor = isMe ? 'rgba(255,255,255,0.9)' : 'var(--ink)';
  const iconColor = isMe ? '#fff' : 'var(--ink)';
  const mutedColor = isMe ? 'rgba(255,255,255,0.5)' : 'var(--muted)';

  // Calcule l'index de la barre de progression dans la waveform
  const progressIdx = Math.round((progress / 100) * (WAVEFORM.length - 1));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200, maxWidth: 260 }}>
      <audio ref={audioRef} src={url} preload="metadata" />

      {/* Bouton play/pause */}
      <button
        onClick={togglePlay}
        style={{
          width: 36, height: 36, borderRadius: '50%', border: 'none', flexShrink: 0,
          background: isMe ? 'rgba(255,255,255,0.15)' : 'var(--surface-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'transform 80ms ease-out, opacity 80ms',
        }}
      >
        {playing ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill={iconColor}>
            <rect x="6" y="4" width="4" height="16" rx="1"/>
            <rect x="14" y="4" width="4" height="16" rx="1"/>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill={iconColor}>
            <polygon points="6 3 20 12 6 21 6 3"/>
          </svg>
        )}
      </button>

      {/* Waveform + durée */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {/* Waveform cliquable */}
        <div
          onClick={seekTo}
          style={{ display: 'flex', alignItems: 'center', gap: 2, height: 28, cursor: 'pointer' }}
        >
          {WAVEFORM.map((h, i) => {
            const isPlayed = i <= progressIdx && progress > 0;
            const maxH = 28;
            const barH = Math.round((h / 18) * maxH);
            return (
              <div
                key={i}
                style={{
                  width: 3, borderRadius: 2, flexShrink: 0,
                  height: barH,
                  background: isPlayed ? fillColor : trackBg,
                  transition: 'background 0.1s',
                  // Légère animation quand playing sur les barres proches de la position
                  transform: playing && Math.abs(i - progressIdx) <= 1 ? 'scaleY(1.15)' : 'scaleY(1)',
                  transformOrigin: 'center',
                  transitionDuration: playing ? '0.08s' : '0.1s',
                }}
              />
            );
          })}
        </div>
        {/* Durée */}
        <span style={{ fontSize: 10, color: mutedColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {progress > 0 && audioRef.current
            ? formatDuration(audioRef.current.currentTime)
            : formatDuration(currentDuration)}
        </span>
      </div>
    </div>
  );
}

// ─── Coches de statut ────────────────────────────────────────────────────────

function MessageStatus({ isMe, msgId, readAt }: { isMe: boolean; msgId: string; readAt?: string | null }) {
  if (!isMe) return null;
  const isRead = !!readAt;
  const isOptimistic = msgId.startsWith('opt-');

  if (isOptimistic) {
    return (
      <svg width="16" height="11" viewBox="0 0 16 11" fill="none" style={{ flexShrink: 0, opacity: 0.65 }}>
        <path d="M1 5.5l4 4L14 1.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }

  if (isRead) {
    // Deux coches blanches pleines = lu
    return (
      <svg width="20" height="11" viewBox="0 0 20 11" fill="none" style={{ flexShrink: 0 }}>
        <path d="M1 5.5l4 4L13 1.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M6 5.5l4 4L18 1.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }

  // Deux coches blanches semi-transparentes = envoyé
  return (
    <svg width="20" height="11" viewBox="0 0 20 11" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
      <path d="M1 5.5l4 4L13 1.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 5.5l4 4L18 1.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ─── Indicateur de frappe ─────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '8px 12px', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: '4px 18px 18px 18px',
      alignSelf: 'flex-start', width: 52,
    }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--muted)',
          animation: 'typing-dot 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`,
        }} />
      ))}
    </div>
  );
}

// ─── RecordingOverlay ─────────────────────────────────────────────────────────
// Waveform animée via Web Audio API + refs directes — zéro re-render React

const BAR_COUNT = 13;

function RecordingOverlay({ onCancel, onSend, elapsed, stream }: {
  onCancel: () => void; onSend: () => void; elapsed: number;
  stream: MediaStream | null;
}) {
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    if (!stream) return;

    // Init Web Audio
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyserRef.current = analyser;
    ctx.createMediaStreamSource(stream).connect(analyser);
    dataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

    // Vibration haptique au démarrage (Android/PWA)
    if (navigator.vibrate) navigator.vibrate(40);

    // Boucle rAF — modifie le DOM directement, pas de setState
    const draw = () => {
      const an = analyserRef.current;
      const da = dataRef.current;
      if (!an || !da) return;
      an.getByteFrequencyData(da);
      let total = 0;
      for (let i = 0; i < da.length; i++) total += da[i];
      const amp = Math.min(100, (total / da.length / 140) * 100);

      barRefs.current.forEach((bar, i) => {
        if (!bar) return;
        // Courbe en cloche : barres centrales réagissent plus fort
        const factor = 1 - Math.abs(i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
        const h = Math.max(15, amp * factor * 0.85);
        bar.style.height = `${h}%`;
        bar.style.background = amp > 10 ? 'var(--ink)' : 'var(--muted)';
      });

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      analyser.disconnect();
      ctx.close();
    };
  }, [stream]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flex: 1, gap: 12, animation: 'rec-fadein 0.15s ease-out',
    }}>
      {/* Poubelle */}
      <button onClick={onCancel} type="button" style={{
        width: 48, height: 48, borderRadius: '50%', border: '1px solid var(--border)',
        background: 'var(--surface-2)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>

      {/* Timer + waveform */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flex: 1,
        background: 'var(--surface-2)', borderRadius: 24,
        padding: '0 14px', height: 44,
      }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--red)', flexShrink: 0, animation: 'pulse-rec 1s ease-in-out infinite' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {formatDuration(elapsed)}
        </span>
        {/* Barres waveform — animées par rAF via refs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, height: '100%', justifyContent: 'center' }}>
          {Array.from({ length: BAR_COUNT }).map((_, i) => (
            <div
              key={i}
              ref={el => { barRefs.current[i] = el; }}
              style={{
                width: 3, height: '15%', borderRadius: 2,
                background: 'var(--muted)', flexShrink: 0,
                willChange: 'height, background',
                transition: 'height 0.04s ease-out',
              }}
            />
          ))}
        </div>
      </div>

      {/* Envoyer */}
      <button onClick={onSend} type="button" style={{
        width: 48, height: 48, borderRadius: '50%', border: 'none', background: 'var(--ink)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', flexShrink: 0,
        animation: 'rec-popin 0.2s cubic-bezier(0.175,0.885,0.32,1.275)',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
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
    // Injecté après montage (pas via dangerouslySetInnerHTML) pour éviter tout
    // souci de sanitization React sur du HTML déjà rendu par nos soins.
    if (cloneRef.current) cloneRef.current.innerHTML = html;
    // Monté à la taille d'origine puis transitionné vers la taille cible juste après
    // (au lieu d'une keyframe CSS avec facteur fixe) — permet un left/top/width/height
    // cible calculé dynamiquement selon la position réelle de la bulle à l'écran.
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, [html]);

  if (typeof document === 'undefined') return null;
  // Ancré sous la bulle agrandie (façon WhatsApp), pas aux coordonnées brutes du doigt.
  // Bascule au-dessus si pas assez de place en dessous.
  // Le clone est repositionné en left/top/width/height cibles (pas un scale() CSS pur
  // depuis le centre) pour rester dans l'écran : une bulle collée à un bord ne peut
  // pas grossir symétriquement des deux côtés sans déborder — on la recentre donc
  // horizontalement dans la largeur disponible avec une marge de sécurité.
  const GAP = 8;
  const SCREEN_MARGIN = 16;
  const scaledWidth = rect.width * BUBBLE_SCALE;
  const scaledHeight = rect.height * BUBBLE_SCALE;
  const idealLeft = rect.left - (scaledWidth - rect.width) / 2;
  const cloneLeft = Math.min(Math.max(idealLeft, SCREEN_MARGIN), window.innerWidth - scaledWidth - SCREEN_MARGIN);
  const idealTop = rect.top - (scaledHeight - rect.height) / 2;
  const cloneTop = Math.max(idealTop, SCREEN_MARGIN);
  const cloneBottom = cloneTop + scaledHeight;
  const spaceBelow = window.innerHeight - cloneBottom;
  const openUpward = spaceBelow < CTX_MENU_HEIGHT + GAP + 16;
  const top = openUpward ? cloneTop - CTX_MENU_HEIGHT - GAP : cloneBottom + GAP;
  const left = Math.min(Math.max(cloneLeft, 8), window.innerWidth - CTX_MENU_WIDTH - 8);
  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', animation: 'fadeIn 120ms ease-out' }} onMouseDown={onClose} onTouchStart={onClose} />
      {/* Clone visuel de la bulle — la vraie bulle (dans la zone de scroll clippée)
          reste masquée (visibility:hidden) tant que ce menu est ouvert. Ce clone,
          rendu ici dans le portail, n'a pas de conteneur overflow au-dessus de lui
          donc l'agrandissement reste pleinement visible, façon WhatsApp/iOS. */}
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
        position: 'fixed', left, top: Math.max(top, 8), zIndex: 10000,
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
  if (typeof document === 'undefined') return null;
  const unchanged = editText.trim() === originalText.trim() || editText.trim().length === 0;
  const left = Math.min(Math.max(rect.left, 16), window.innerWidth - rect.width - 16);
  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', animation: 'fadeIn 120ms ease-out' }} onMouseDown={onCancel} />
      <div style={{
        position: 'fixed', left, top: rect.top, width: rect.width, zIndex: 10000,
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
          rows={3}
          style={{
            fontSize: 14, lineHeight: 1.5, fontFamily: 'inherit', resize: 'none',
            background: 'transparent', color: isMe ? '#fff' : 'var(--ink)',
            border: `1px solid ${isMe ? 'rgba(255,255,255,0.3)' : 'var(--border)'}`,
            borderRadius: 8, padding: '6px 8px', outline: 'none', width: '100%', boxSizing: 'border-box',
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
  // Long-press + clic droit combinés dans un seul hook (voir lib/useLongPress.ts).
  // Désactivé en mode édition et tant que le menu contextuel est ouvert sur cette
  // bulle (la bulle reste dans le DOM en visibility:hidden pendant ce temps).
  const canOpenMenu = isMe && (canEdit || canDelete) && !isEditing && !isMenuTarget;
  const { ref: wrapperRef } = useLongPress(() => openMenu(), canOpenMenu);
  // editRect est capturé par le composant parent au moment du clic sur "Modifier"
  // dans le menu contextuel (réutilise ctxMenu.rect, déjà mesuré au long-press) —
  // pas ici via un useEffect réagissant à isEditing, qui mesurerait la bulle une
  // fois son contenu déjà remplacé par null (isEditing ? null : ...), donnant une
  // largeur quasi nulle (juste le padding, sans texte).

  // Marque le message lu seulement quand sa bulle entre réellement dans le
  // viewport visible (scroll) — pas juste "la conversation est ouverte quelque
  // part avec un message trop haut, jamais scrollé jusqu'à lui".
  // Pas de document.hasFocus() ici : peu fiable en PWA standalone (pas de vraie
  // notion de "fenêtre focus" hors navigateur desktop classique) — visibilityState
  // seul suffit. Si le message est déjà visible au montage mais que la page n'est
  // pas encore visible à cet instant (ex: juste après un tap sur notification),
  // on retente au prochain visibilitychange plutôt que d'abandonner silencieusement
  // (IntersectionObserver ne redéclenche pas tant qu'on ne re-scrolle pas hors-champ).
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
          // La bulle originale est masquée pendant que le menu OU l'édition est ouvert —
          // un clone/overlay visuel est affiché dans un portail séparé (voir
          // MessageContextMenu / EditBubbleOverlay), car un transform:scale() ici
          // resterait clippé par overflow:auto de la zone de scroll parente, peu
          // importe le z-index (piège CSS classique).
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

// ─── Composant principal ──────────────────────────────────────────────────────

export default function PageClientMessages() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [coachName, setCoachName] = useState('Coach');
  const [coachInitials, setCoachInitials] = useState('CO');
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [mediaRecorderSupported, setMediaRecorderSupported] = useState(false);
  const [isCoachOnline, setIsCoachOnline] = useState(false);
  const [coachTyping, setCoachTyping] = useState(false);
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [showScrollArrow, setShowScrollArrow] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ file: File; previewUrl?: string; type: 'image' | 'document' } | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isSendingFile, setIsSendingFile] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ rect: DOMRect; html: string; msgId: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRect, setEditRect] = useState<DOMRect | null>(null);
  const [editText, setEditText] = useState('');
  // Refs stables vers le DOM node de chaque bulle — remesurées juste avant
  // d'afficher l'édition (pas un rect figé au moment du long-press), pour rester
  // à jour même si la liste a scrollé ou reçu de nouveaux messages entre-temps.
  const bubbleRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const [actionError, setActionError] = useState<string | null>(null);
  // Force un re-render périodique pour que les boutons Modifier/Supprimer
  // disparaissent au bon moment même si l'utilisateur reste immobile sur la page.
  const [, forceTick] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const chatZoneRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clientIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const coachIdRef = useRef<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isSubscribedRef = useRef(false);
  const lastTypingSentRef = useRef<number>(0);

  const supabase = useRef(createClient()).current;

  useEffect(() => {
    try { if (typeof window !== 'undefined' && window.MediaRecorder) setMediaRecorderSupported(true); }
    catch { /* pas dispo */ }
  }, []);

  // Force un re-render toutes les minutes pour que les boutons Modifier/Supprimer
  // disparaissent au bon moment même si personne n'interagit avec la page.
  useEffect(() => {
    const t = setInterval(() => forceTick(n => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // ── Chargement initial ──────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      userIdRef.current = user.id;

      const { data: clientRow } = await supabase
        .from('clients').select('id, coach_id, name').eq('profile_id', user.id).single();
      if (!clientRow) { setLoading(false); return; }
      setClientId(clientRow.id);
      clientIdRef.current = clientRow.id;
      coachIdRef.current = clientRow.coach_id;

      const { data: coachProfile } = await supabase
        .from('profiles').select('full_name').eq('id', clientRow.coach_id).maybeSingle();
      if (coachProfile?.full_name) {
        setCoachName(coachProfile.full_name);
        const parts = coachProfile.full_name.trim().split(' ');
        setCoachInitials(parts.length >= 2
          ? (parts[0][0] + parts[1][0]).toUpperCase()
          : coachProfile.full_name.slice(0, 2).toUpperCase());
      }

      const { data, error } = await supabase
        .from('messages')
        .select('id, text, sender_id, created_at, type, audio_url, duration_s, read_at, edited_at')
        .eq('client_id', clientRow.id)
        .order('created_at', { ascending: true });
      if (error) console.error('messages fetch error:', error.message);
      setMessages((data as Msg[]) || []);
      setLoading(false);
      // Le marquage lu se fait maintenant uniquement via onEnterViewport (IntersectionObserver
      // par bulle) — un message trop haut dans l'historique, jamais scrollé jusqu'à lui, ne
      // doit pas être marqué lu juste parce que la page est ouverte.
    }
    load();
  }, [supabase]);

  const markMessageRead = useCallback((msgId: string) => {
    setMessages(prev => {
      const msg = prev.find(m => m.id === msgId);
      if (!msg || msg.read_at) return prev;
      supabase.from('messages').update({ read_at: new Date().toISOString() })
        .eq('id', msgId).then(() => { clearAppBadge(); });
      return prev.map(m => m.id === msgId ? { ...m, read_at: new Date().toISOString() } : m);
    });
  }, [supabase]);

  // ── Realtime messages ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!clientId) return;
    // Nom du canal incluant clientId pour éviter les zombies en navigation PWA
    const channel = supabase.channel(`messages-client-${clientId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `client_id=eq.${clientId}`,
      }, (payload) => {
        const incoming = payload.new as Msg;
        setMessages(prev => {
          if (prev.some(m => m.id === incoming.id)) return prev;
          const optIdx = prev.findIndex(m =>
            m.id.startsWith('opt-') &&
            m.sender_id === incoming.sender_id &&
            m.text === incoming.text &&
            m.type === (incoming.type || 'text')
          );
          if (optIdx !== -1) {
            const next = [...prev];
            next[optIdx] = incoming;
            return next;
          }
          return [...prev, incoming];
        });
        // Le marquage lu se fait via onEnterViewport quand la bulle entre réellement
        // dans le viewport (pas automatique à la réception — cf. markMessageRead).
        // Push géré par le trigger Supabase côté serveur — pas de déclenchement client
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages',
        filter: `client_id=eq.${clientId}`,
      }, (payload) => {
        const updated = payload.new as Msg;
        setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'messages',
        filter: `client_id=eq.${clientId}`,
      }, (payload) => {
        const deletedId = (payload.old as Msg).id;
        setMessages(prev => prev.filter(m => m.id !== deletedId));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId, supabase]);

  // ── Presence : écoute coach + typing (canal messagerie uniquement pour broadcast)
  useEffect(() => {
    if (!clientId || !userId) return;
    // Canal messagerie pour broadcast typing + présence locale
    // La présence globale (hors messagerie) est gérée par GlobalPresenceClient dans le layout
    // sur le canal global-presence-${clientId}
    const ch = supabase.channel(`presence-chat-${clientId}`, {
      config: { presence: { key: userId } },
    });
    // Setter la ref immédiatement — pas dans le callback SUBSCRIBED
    // pour que le broadcast typing soit disponible dès la première frappe
    presenceChRef.current = ch;

    ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState();
        const coachOnline = Object.entries(state).some(([key, entries]) =>
          key !== userId &&
          (entries as Array<Record<string, unknown>>).some(e => e.role === 'coach')
        );
        setIsCoachOnline(coachOnline);
      })
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (payload.payload?.role === 'coach') {
          setCoachTyping(true);
          if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
          typingTimerRef.current = setTimeout(() => setCoachTyping(false), 3000);
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          isSubscribedRef.current = true;
          if (document.visibilityState === 'visible') {
            await ch.track({ user_id: userId, role: 'client', online_at: new Date().toISOString() });
          }
        }
      });

    // Gérer verrouillage écran : untrack quand caché, retrack quand visible
    const handleVisibility = async () => {
      if (!presenceChRef.current || !isSubscribedRef.current) return;
      if (document.visibilityState === 'hidden') {
        await presenceChRef.current.untrack();
      } else {
        await presenceChRef.current.track({ user_id: userId, role: 'client', online_at: new Date().toISOString() });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isSubscribedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      supabase.removeChannel(ch);
      presenceChRef.current = null;
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, [clientId, userId, supabase]);


  // ── Scroll bas — scrollTop direct pour iOS, smooth ensuite ────────────────
  const initialScrollDone = useRef(false);
  // Réinitialiser à chaque nouveau chargement (retour sur la page en PWA)
  useEffect(() => {
    if (loading) initialScrollDone.current = false;
  }, [loading]);
  useEffect(() => {
    if (loading) return;
    const container = chatZoneRef.current;
    if (!container) return;
    if (!initialScrollDone.current) {
      container.scrollTop = container.scrollHeight;
      const t = setTimeout(() => {
        if (chatZoneRef.current) chatZoneRef.current.scrollTop = chatZoneRef.current.scrollHeight;
      }, 60);
      initialScrollDone.current = true;
      return () => clearTimeout(t);
    } else {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, coachTyping, loading]);

  // ── Envoi texte ────────────────────────────────────────────────────────────
  async function sendMessage(text: string) {
    if (!text.trim() || !clientId || !userId) return;
    setInput('');
    const optimisticId = `opt-text-${Date.now()}`;
    const optimistic: Msg = {
      id: optimisticId, client_id: clientId, sender_id: userId,
      text: text.trim(), created_at: new Date().toISOString(), type: 'text',
    };
    setMessages(prev => [...prev, optimistic]);
    const { data } = await supabase.from('messages').insert({
      client_id: clientId, sender_id: userId, text: text.trim(), type: 'text',
    }).select('id, text, sender_id, created_at, type, audio_url, duration_s, read_at, edited_at').single();
    if (data) setMessages(prev => prev.map(m => m.id === optimisticId ? data as Msg : m));
  }

  // Édition / suppression — la policy RLS reste la seule vraie garantie de sécurité,
  // ces vérifications côté client ne sont qu'un affichage cohérent avec les permissions.
  function canEditMsg(msg: Msg) {
    return !!userId && msg.sender_id === userId && Date.now() - new Date(msg.created_at).getTime() < EDIT_WINDOW_MS;
  }
  function canDeleteMsg(msg: Msg) {
    return !!userId && msg.sender_id === userId && Date.now() - new Date(msg.created_at).getTime() < DELETE_WINDOW_MS;
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

  // ── Envoi vocal ────────────────────────────────────────────────────────────
  async function sendAudioMessage(blob: Blob, durationS: number) {
    const clientId = clientIdRef.current;
    const userId = userIdRef.current;
    if (!clientId || !userId) return;
    const optimisticId = `opt-audio-${Date.now()}`;
    const localUrl = URL.createObjectURL(blob);
    const optimistic: Msg = {
      id: optimisticId, client_id: clientId, sender_id: userId,
      text: '', created_at: new Date().toISOString(), type: 'audio',
      audio_url: localUrl, duration_s: durationS,
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      const strictType = ext === 'mp4' ? 'audio/mp4' : ext === 'ogg' ? 'audio/ogg' : 'audio/webm';
      const fileName = `${clientId}/${Date.now()}.${ext}`;
      const audioFile = new File([blob], `${Date.now()}.${ext}`, { type: strictType });
      const { error: uploadError } = await supabase.storage
        .from('voice-messages')
        .upload(fileName, audioFile, { contentType: strictType, cacheControl: '3600' });
      if (uploadError) {
        console.error('Upload audio échoué:', uploadError.message);
        setMessages(prev => prev.filter(m => m.id !== optimisticId));
        URL.revokeObjectURL(localUrl);
        return;
      }
      const { data: urlData } = supabase.storage.from('voice-messages').getPublicUrl(fileName);
      const { error: insertError } = await supabase.from('messages').insert({
        client_id: clientId, sender_id: userId, text: '',
        type: 'audio', audio_url: urlData.publicUrl, duration_s: Math.round(durationS),
      });
      if (insertError) {
        console.error('Insert message audio échoué:', insertError.message);
        setMessages(prev => prev.filter(m => m.id !== optimisticId));
        URL.revokeObjectURL(localUrl);
        return;
      }
      setTimeout(() => URL.revokeObjectURL(localUrl), 5000);
    } catch (e) {
      console.error('sendAudioMessage error:', e);
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      URL.revokeObjectURL(localUrl);
    }
  }

  // ── Envoi fichier ──────────────────────────────────────────────────────────
  async function sendFile(file: File) {
    if (!clientId || !userId) return;
    const isImage = file.type.startsWith('image/');
    const type: 'image' | 'document' = isImage ? 'image' : 'document';
    const maxSize = isImage ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > maxSize) return;
    setIsSendingFile(true);
    const ext = file.name.split('.').pop() || 'bin';
    const fileName = `${clientId}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('chat-medias').upload(fileName, file, { contentType: file.type });
    if (uploadError) { setIsSendingFile(false); return; }
    const { data: urlData } = supabase.storage.from('chat-medias').getPublicUrl(fileName);
    await supabase.from('messages').insert({
      client_id: clientId, sender_id: userId, text: file.name, type, audio_url: urlData.publicUrl,
    });
    setIsSendingFile(false);
    setPendingFile(prev => { if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl); return null; });
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  // ── Enregistrement vocal ───────────────────────────────────────────────────
  async function startRecording() {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        const dur = (Date.now() - recordingStartRef.current) / 1000;
        const finalType = mimeType || 'audio/mp4';
        const blob = new Blob(audioChunksRef.current, { type: finalType });
        if (blob.size > 0) sendAudioMessage(blob, dur);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setIsRecording(false);
        setRecordingElapsed(0);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      recordingStartRef.current = Date.now();
      setIsRecording(true);
      setRecordingElapsed(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingElapsed(Math.floor((Date.now() - recordingStartRef.current) / 1000));
      }, 1000);
    } catch { /* micro refusé */ }
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
    mr.onstop = () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      setIsRecording(false);
      setRecordingElapsed(0);
    };
    if (mr.state !== 'inactive') mr.stop();
  }

  // ── Flèche scroll bas ──────────────────────────────────────────────────────
  function handleChatScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    setShowScrollArrow(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
  }
  function scrollToBottom() {
    const el = chatZoneRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  // ── Groupes par jour ───────────────────────────────────────────────────────
  const messageGroups: Array<{ dateLabel: string; msgs: Msg[] }> = [];
  messages.forEach((msg, i) => {
    const prev = messages[i - 1];
    if (!prev || !isSameDay(prev.created_at, msg.created_at)) {
      messageGroups.push({ dateLabel: formatDate(msg.created_at), msgs: [msg] });
    } else {
      messageGroups[messageGroups.length - 1].msgs.push(msg);
    }
  });

  return (
    <AudioContext.Provider value={{ activeId: activeAudioId, setActive: setActiveAudioId }}>
      <div className="chat-shell" style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg)', position: 'relative' }}>

        {/* ── Header ── */}
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
          background: 'var(--surface)',
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: 'var(--ink)', position: 'relative',
          }}>
            {coachInitials}
            {/* Point de présence */}
            <div style={{
              position: 'absolute', bottom: 1, right: 1,
              width: 9, height: 9, borderRadius: '50%',
              background: isCoachOnline ? 'var(--green)' : 'var(--faint)',
              border: '2px solid var(--surface)',
              transition: 'background 0.4s ease',
            }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', lineHeight: 1.2 }}>{coachName}</div>
            <div style={{
              fontSize: 11, color: isCoachOnline ? 'var(--green)' : 'var(--muted)',
              marginTop: 1, transition: 'color 0.4s ease',
            }}>
              {coachTyping ? 'En train d\'écrire…' : isCoachOnline ? 'En ligne' : 'Hors ligne'}
            </div>
          </div>
          {/* Bouton activation notifications — géré par PushInit */}
          {userId && <PushInit userId={userId} />}
        </div>

        {/* ── Zone messages ── */}
        <div ref={chatZoneRef} onScroll={handleChatScroll} className="chat-messages-zone" style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 2,
          WebkitOverflowScrolling: 'touch',
        } as React.CSSProperties}>
          {loading ? (
            <InlineLoader />
          ) : messages.length === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: 60 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto', display: 'block' }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div style={{ fontWeight: 600, color: 'var(--ink-2)', fontSize: 14, marginBottom: 4 }}>Aucun message</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Commence la conversation avec ton coach</div>
            </div>
          ) : messageGroups.map((group) => (
            <div key={group.dateLabel} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Séparateur date */}
              <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 6px' }}>
                <span style={{
                  fontSize: 11, color: 'var(--muted)',
                  background: 'var(--surface-2)', padding: '3px 10px',
                  borderRadius: 20, border: '1px solid var(--border-soft)',
                }}>
                  {group.dateLabel}
                </span>
              </div>

              {group.msgs.map((msg, msgIdx) => {
                const prevMsg = group.msgs[msgIdx - 1];
                const isContinued = prevMsg && prevMsg.sender_id === msg.sender_id;
                const nextMsg = group.msgs[msgIdx + 1];
                const isLast = !nextMsg || nextMsg.sender_id !== msg.sender_id;
                return (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    userId={userId ?? ''}
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

          {/* Indicateur de frappe */}
          {coachTyping && (
            <div className="msg-bubble-in" style={{ marginTop: 8 }}>
              <TypingIndicator />
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Flèche scroll bas ── */}
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

        {/* ── Input file invisible ── */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf,.doc,.docx"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', overflow: 'hidden' }}
          onChange={e => {
            const f = e.target.files?.[0];
            if (!f) return;
            const isImg = f.type.startsWith('image/');
            const previewUrl = isImg ? URL.createObjectURL(f) : undefined;
            setPendingFile({ file: f, previewUrl, type: isImg ? 'image' : 'document' });
            e.target.value = '';
          }}
        />

        {/* ── Preview fichier en attente ── */}
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

        {/* ── Panneau enregistrement ── */}
        {isRecording && (
          <div className="chat-input-bar" style={{
            padding: '8px 16px', flexShrink: 0, background: 'var(--surface)',
            borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center',
          }}>
            <RecordingOverlay elapsed={recordingElapsed} onCancel={cancelRecording} onSend={stopRecording} stream={streamRef.current} />
          </div>
        )}

        {/* ── Input bar ── */}
        {!isRecording && !pendingFile && (
          <div className="chat-input-bar" style={{
            padding: '8px 12px', background: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0,
          }}>
            <button type="button" onClick={() => fileInputRef.current?.click()} style={{
              width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border)',
              background: 'var(--surface-2)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
            }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>

            <textarea
              ref={inputRef}
              value={input}
              onChange={e => {
                setInput(e.target.value);
                // Broadcast typing throttlé — drop si canal pas encore SUBSCRIBED
                if (presenceChRef.current && isSubscribedRef.current) {
                  const now = Date.now();
                  if (now - lastTypingSentRef.current > 2500) {
                    lastTypingSentRef.current = now;
                    presenceChRef.current.send({ type: 'broadcast', event: 'typing', payload: { role: 'client' } });
                  }
                }
              }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
              placeholder="Écrire à ton coach…"
              autoComplete="off" autoCorrect="off" autoCapitalize="sentences"
              spellCheck={false} inputMode="text" name="chat-momentum-x7k"
              style={{
                flex: 1, resize: 'none', border: '1px solid var(--border)',
                borderRadius: 22, padding: '10px 14px', fontSize: 14,
                fontFamily: 'inherit', lineHeight: 1.5, outline: 'none',
                background: 'var(--surface-2)', color: 'var(--ink)',
                minHeight: 42, maxHeight: 120,
              }}
              rows={1}
            />

            {mediaRecorderSupported && !input.trim() && (
              <button type="button" onClick={startRecording} style={{
                width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border)',
                background: 'var(--surface-2)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
              }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </button>
            )}

            {input.trim() && (
              <button className="btn-primary" onClick={() => sendMessage(input)} type="button" style={{
                width: 40, height: 40, borderRadius: '50%', padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
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
              setEditingId(msg.id);
              setEditText(msg.text);
              // Remesure au clic (pas ctxMenu.rect figé au long-press) — la page
              // a pu scroller ou recevoir de nouveaux messages entre l'ouverture
              // du menu et ce clic.
              const el = bubbleRefsMap.current.get(msg.id);
              const measured = el ? el.getBoundingClientRect() : ctxMenu.rect;
              console.log('[EDIT-DEBUG] el found:', !!el, 'rect:', measured.width, measured.height, measured.left, measured.top);
              setEditRect(measured);
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

      {/* ── Lightbox image ── */}
      {lightboxUrl && typeof document !== 'undefined' && createPortal(
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.88)',
            backdropFilter: 'blur(8px)',
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
