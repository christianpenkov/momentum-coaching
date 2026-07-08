'use client';
import InlineLoader from '@/components/ui/InlineLoader';

import { useState, useRef, useEffect, useLayoutEffect, useCallback, createContext, useContext, Fragment } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import Avatar from '@/components/ui/Avatar';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { useLongPress } from '@/lib/useLongPress';
import { clearAppBadge } from '@/lib/pwaBadge';
import { logChatScroll } from '@/lib/chatScrollDebug';
import { useGlobalCoachPresence } from '@/lib/GlobalPresenceContext';
import { useUser } from '@/lib/UserContext';
import { buildMenuItems, renderMenuItem, ReactionBar, MENU_ITEM_HEIGHT, REACTION_BAR_HEIGHT, MENU_GAP, MENU_SCREEN_MARGIN, CTX_MENU_WIDTH } from '@/components/pages/shared/MessageMenuParts';

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
  listened_at?: string | null;
  edited_at?: string | null;
  caption?: string | null;
  reply_to_id?: string | null;
  reaction_emoji?: string | null;
  reaction_by?: string | null;
  file_size_bytes?: number | null;
  page_count?: number | null;
  thumbnail_url?: string | null;
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

const WAVEFORM = [4,8,14,9,18,12,20,15,22,11,17,13,21,10,16,8,19,12,6,14,9,17,11,5,7];

// ─── AudioBubble ─────────────────────────────────────────────────────────────

function AudioBubble({ id, url, duration, isMe, listened, onListened, avatarUrl, initials }: {
  id: string; url: string; duration?: number; isMe: boolean;
  listened?: boolean; onListened?: (id: string) => void;
  avatarUrl?: string | null; initials: string;
}) {
  const { activeId, setActive } = useContext(AudioContext);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [progress, setProgress] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(duration ?? 0);
  const playing = activeId === id;
  // Marquage "écouté" — comme WhatsApp : play réellement enclenché suffit, avec une petite
  // garde anti-clic-accidentel. Seuil = MIN(1.5s, durée totale) pour ne jamais bloquer le
  // marquage sur les vocaux très courts (1-2s).
  const listenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Position de lecture persistée (localStorage) — survit au changement de page ET au refresh
  // complet, contrairement à un simple state/ref React qui se réinitialise au démontage.
  const positionKey = `audio-pos-${id}`;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!playing && !el.paused) el.pause();
  }, [playing]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      const dur = el.duration || currentDuration || 1;
      setProgress((el.currentTime/dur)*100);
      try { localStorage.setItem(positionKey, String(el.currentTime)); } catch {}
    };
    const onEnd = () => {
      setActive(null);
      setProgress(0);
      try { localStorage.removeItem(positionKey); } catch {}
    };
    const onLoad = () => {
      if (el.duration && !isNaN(el.duration)) setCurrentDuration(el.duration);
      try {
        const saved = parseFloat(localStorage.getItem(positionKey) || '');
        if (!isNaN(saved) && saved > 0 && saved < el.duration) {
          el.currentTime = saved;
          setProgress((saved / el.duration) * 100);
        }
      } catch {}
    };
    const onPlay = () => {
      if (listened || !onListened) return;
      const dur = el.duration || currentDuration || 0;
      const threshold = dur > 0 ? Math.min(1500, dur * 1000) : 1500;
      if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
      listenTimerRef.current = setTimeout(() => onListened(id), threshold);
    };
    const onPause = () => {
      if (listenTimerRef.current) { clearTimeout(listenTimerRef.current); listenTimerRef.current = null; }
      try { localStorage.setItem(positionKey, String(el.currentTime)); } catch {}
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnd);
    el.addEventListener('loadedmetadata', onLoad);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('loadedmetadata', onLoad);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
    };
  }, [currentDuration, setActive, listened, onListened, id]);

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
  const mutedColor = isMe ? 'rgba(255,255,255,0.5)' : 'var(--muted)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 200, maxWidth: 260 }}>
      <audio ref={audioRef} src={url} preload="metadata" />
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar initials={initials} avatarUrl={avatarUrl} size={38} />
        <button onClick={togglePlay} className="tap-scale" style={{
          position: 'absolute', bottom: -3, right: -3, width: 18, height: 18, borderRadius: '50%',
          border: '2px solid var(--surface)', background: 'var(--ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          {playing
            ? <svg width="7" height="7" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            : <svg width="7" height="7" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: 1 }}><polygon points="6 3 20 12 6 21 6 3"/></svg>}
        </button>
        {/* Pastille "non écouté" — comme WhatsApp, disparaît une fois le vocal réellement
            lancé. Uniquement sur les messages reçus (onListened défini seulement pour !isMe). */}
        {onListened && !listened && (
          <span style={{
            position: 'absolute', top: -1, right: -1, width: 9, height: 9,
            borderRadius: '50%', background: 'var(--red)', border: '2px solid var(--surface)',
          }} />
        )}
      </div>
      <div onClick={seekTo} style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', gap: 3, height: 24, cursor: 'pointer' }}>
        {WAVEFORM.map((h, i) => (
          <div key={i} style={{
            width: 2.5, height: 2.5, borderRadius: '50%', flexShrink: 0,
            background: i <= progressIdx && progress > 0 ? fillColor : trackBg,
            transition: 'background 0.1s',
          }} />
        ))}
        {progress > 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: `${progress}%`, width: 11, height: 11, borderRadius: '50%',
            background: '#3b82f6', transform: 'translate(-50%, -50%)', boxShadow: '0 1px 3px rgba(0,0,0,.3)',
            transition: playing ? 'left 0.1s linear' : 'none', pointerEvents: 'none',
          }} />
        )}
      </div>
      <span style={{ fontSize: 10, color: mutedColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1, flexShrink: 0, alignSelf: 'flex-end' }}>
        {progress > 0 && audioRef.current ? formatDuration(audioRef.current.currentTime) : formatDuration(currentDuration)}
      </span>
    </div>
  );
}

// ─── Coches de statut ─────────────────────────────────────────────────────────

function MessageStatus({ isMe, msgId, readAt, isAudio, listenedAt }: {
  isMe: boolean; msgId: string; readAt?: string | null;
  isAudio?: boolean; listenedAt?: string | null;
}) {
  if (!isMe) return null;
  // Pour un vocal : "lu" (double coche pleine) signifie réellement ÉCOUTÉ par le
  // destinataire (play + 1.5s ou durée totale si plus court), pas juste "vu à l'écran".
  const isRead = isAudio ? !!listenedAt : !!readAt;
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
      <button onClick={onCancel} type="button" className="tap-scale" style={{ width: 48, height: 48, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
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
      <button onClick={onSend} type="button" className="tap-scale" style={{ width: 48, height: 48, borderRadius: '50%', border: 'none', background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, animation: 'rec-popin 0.2s cubic-bezier(0.175,0.885,0.32,1.275)' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  );
}

// ─── MessageContextMenu — clic droit desktop / appui long mobile ─────────────
// v2 : plus de grossissement de bulle (juste le fond assombri/flouté), le message
// reste à sa taille et position réelles (potentiellement remonté par le lift du
// composant appelant si pas assez de place en dessous). Position toujours EN
// DESSOUS du message, jamais au-dessus — voir docs/architecture-messagerie.md.

function MessageContextMenu({ rect, isMe, isTextMessage, canEdit, canDelete, menuOnly, onReply, onCopy, onEdit, onDelete, onReact, onClose }: {
  rect: DOMRect; isMe: boolean; isTextMessage: boolean; canEdit: boolean; canDelete: boolean; menuOnly: boolean;
  onReply: () => void; onCopy: () => void; onEdit: () => void; onDelete: () => void; onReact: (emoji: string) => void; onClose: () => void;
}) {
  if (typeof document === 'undefined') return null;
  const items = buildMenuItems(isMe, isTextMessage, canEdit, canDelete);
  const menuHeight = (menuOnly ? 0 : items.length * MENU_ITEM_HEIGHT) + REACTION_BAR_HEIGHT + MENU_GAP;
  // Toujours en dessous — l'appelant (openMenu) a déjà remonté le message (lift)
  // si la place manquait, donc rect.bottom + GAP tient toujours dans l'écran ici.
  const top = Math.min(rect.bottom + MENU_GAP, window.innerHeight - menuHeight - MENU_SCREEN_MARGIN);
  const reactionBarTop = Math.max(MENU_SCREEN_MARGIN, rect.top - REACTION_BAR_HEIGHT - MENU_GAP);
  const left = Math.min(Math.max(rect.right - CTX_MENU_WIDTH, 8), window.innerWidth - CTX_MENU_WIDTH - 8);
  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', animation: 'fadeIn 120ms ease-out' }} onMouseDown={onClose} onTouchStart={onClose} />
      <ReactionBar top={reactionBarTop} left={left} onReact={emoji => { onReact(emoji); onClose(); }} />
      {!menuOnly && items.length > 0 && (
        <div style={{
          position: 'fixed', left, top, zIndex: 10000,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,.12)',
          minWidth: CTX_MENU_WIDTH, overflow: 'hidden', fontSize: 14,
        }}>
          {items.map(item => renderMenuItem(item.key, {
            onReply: () => { onReply(); onClose(); },
            onCopy: () => { onCopy(); onClose(); },
            onEdit: () => { onEdit(); onClose(); },
            onDelete: () => { onDelete(); onClose(); },
          }))}
        </div>
      )}
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

function MessageBubble({ msg, userId, isContinued, isLast, isEditing, editRect, editText, setEditText, onStartEdit, onCancelEdit, onSaveEdit, canEdit, canDelete, onOpenCtxMenu, onOpenLightbox, isMenuTarget, liftPx, onEnterViewport, registerBubbleRef, animate, onListened, quotedMsg, onQuoteClick, clientName, clientAvatarUrl, clientInitials, myAvatarUrl, myInitials }: {
  msg: Msg; userId: string; isContinued: boolean; isLast: boolean;
  isEditing: boolean; editRect: DOMRect | null; editText: string; setEditText: (v: string) => void;
  onStartEdit: () => void; onCancelEdit: () => void; onSaveEdit: () => void;
  canEdit: boolean; canDelete: boolean;
  onOpenCtxMenu: (bubbleEl: HTMLDivElement, msg: Msg, opts?: { menuOnly?: boolean }) => void;
  onOpenLightbox: (url: string) => void;
  isMenuTarget?: boolean;
  liftPx?: number;
  onEnterViewport?: (msgId: string) => void;
  registerBubbleRef?: (msgId: string, el: HTMLDivElement | null) => void;
  animate?: boolean;
  onListened?: (msgId: string) => void;
  quotedMsg?: Msg;
  onQuoteClick?: (msgId: string) => void;
  clientName: string;
  clientAvatarUrl?: string | null;
  clientInitials?: string;
  myAvatarUrl?: string | null;
  myInitials?: string;
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
    onOpenCtxMenu(bubbleRef.current, msg);
  };
  // Long-press + clic droit combinés (voir lib/useLongPress.ts). Désactivé en
  // mode édition et tant que le menu contextuel est ouvert sur cette bulle (la
  // bulle reste visible — v2 sans clone — mais le long-press est désactivé pour
  // éviter une double ouverture).
  const canOpenMenu = !isEditing && !isMenuTarget;
  const { ref: wrapperRef } = useLongPress(() => openMenu(), canOpenMenu);
  // Flèche hover desktop (WhatsApp desktop) — coexiste avec le clic droit natif.
  const [hovered, setHovered] = useState(false);
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
    <div
      ref={wrapperRef}
      className={animate ? (isMe ? 'msg-bubble-sent' : 'msg-bubble-in') : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '78%',
        marginTop: isContinued ? 2 : 8, marginBottom: msg.reaction_emoji ? 10 : 0,
        position: 'relative', overflow: 'visible',
        transform: liftPx ? `translateY(-${liftPx}px)` : undefined,
        transition: 'transform 160ms ease-out',
      }}
    >
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
          visibility: isEditing ? 'hidden' : 'visible',
        }}>
        {hovered && !isEditing && !isMenuTarget && (
          <button
            onClick={openMenu}
            className="msg-hover-arrow tap-scale"
            style={{
              position: 'absolute', top: 2, [isMe ? 'left' : 'right']: -28,
              width: 24, height: 24, borderRadius: '50%', border: 'none',
              background: 'var(--surface)', boxShadow: '0 1px 4px rgba(0,0,0,.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', opacity: 0.9, zIndex: 5,
            } as React.CSSProperties}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
        {msg.reaction_emoji && (
          <div
            onClick={() => onOpenCtxMenu(bubbleRef.current!, msg, { menuOnly: true })}
            style={{
              position: 'absolute', bottom: -10, [isMe ? 'left' : 'right']: 8,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
              padding: '2px 6px', fontSize: 13, boxShadow: '0 1px 3px rgba(0,0,0,.12)',
              cursor: 'pointer', lineHeight: 1, zIndex: 5,
            } as React.CSSProperties}
          >
            {msg.reaction_emoji}
          </div>
        )}
        {!isEditing && msg.reply_to_id && (
          <div
            onClick={() => quotedMsg && onQuoteClick?.(quotedMsg.id)}
            style={{
              display: 'flex', flexDirection: 'column', gap: 1,
              borderLeft: `3px solid ${isMe ? 'rgba(255,255,255,0.5)' : 'var(--ink)'}`,
              paddingLeft: 8, marginBottom: 6, marginLeft: isImage ? 4 : 0, marginRight: isImage ? 4 : 0,
              marginTop: isImage ? 4 : 0,
              cursor: quotedMsg ? 'pointer' : 'default', opacity: 0.85,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: isMe ? '#fff' : 'var(--ink)' }}>
              {quotedMsg ? (quotedMsg.sender_id === userId ? 'Toi' : clientName) : ''}
            </div>
            <div style={{
              fontSize: 12, color: isMe ? 'rgba(255,255,255,0.85)' : 'var(--muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220,
            }}>
              {!quotedMsg ? 'Message supprimé'
                : quotedMsg.type === 'audio' ? '🎤 Message vocal'
                : quotedMsg.type === 'image' ? '📷 Photo'
                : quotedMsg.type === 'document' ? '📄 Document'
                : quotedMsg.text}
            </div>
          </div>
        )}
        {isEditing ? null : isAudio && msg.audio_url ? (
          <AudioBubble
            id={msg.id} url={msg.audio_url} duration={msg.duration_s} isMe={isMe}
            listened={!!msg.listened_at} onListened={isMe ? undefined : onListened}
            avatarUrl={isMe ? myAvatarUrl : clientAvatarUrl}
            initials={(isMe ? myInitials : clientInitials) || '?'}
          />
        ) : isImage && msg.audio_url ? (
          <div>
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
            {msg.caption && (
              <div style={{ fontSize: 13, color: isMe ? '#fff' : 'var(--ink)', padding: '6px 4px 2px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {msg.caption}
              </div>
            )}
          </div>
        ) : isDocument && msg.audio_url ? (
          <>
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
            {msg.caption && (
              <div style={{ fontSize: 13, color: isMe ? '#fff' : 'var(--ink)', padding: '6px 2px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {msg.caption}
              </div>
            )}
          </>
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
            <MessageStatus isMe={isMe} msgId={msg.id} readAt={msg.read_at} isAudio={isAudio} listenedAt={msg.listened_at} />
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

function ConversationThread({ clientId, userId, clientName, clientInitials, clientAvatarUrl, isOnline, supabase, presenceCh }: {
  clientId: string; userId: string; clientName: string; clientInitials: string; clientAvatarUrl?: string | null;
  isOnline: boolean; supabase: ReturnType<typeof createClient>;
  presenceCh: ReturnType<typeof supabase.channel> | null;
}) {
  const { user } = useUser();
  const myAvatarUrl = user?.avatar_url ?? null;
  const myInitials = user?.initials ?? '?';
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
  const [fileCaption, setFileCaption] = useState('');
  const [isSendingFile, setIsSendingFile] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ rect: DOMRect; msgId: string; lift: number; menuOnly: boolean } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Msg | null>(null);
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
      .select('id, text, sender_id, created_at, type, audio_url, duration_s, read_at, read, listened_at, edited_at, caption, reply_to_id, reaction_emoji, reaction_by, file_size_bytes, page_count, thumbnail_url')
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

  // Tant que le calcul du premier non-lu (voir useLayoutEffect de scroll plus bas) n'a pas eu
  // lieu pour cette ouverture de conversation, on refuse tout marquage "lu" automatique — même
  // si l'IntersectionObserver d'une bulle se déclenche. Sans ce garde : un message reçu pendant
  // que l'app est en arrière-plan pouvait être marqué lu automatiquement au retour, AVANT que
  // l'utilisateur n'ait eu la moindre chance de le voir — et donc jamais compté comme non-lu.
  const suppressAutoReadRef = useRef(true);
  const markMessageRead = useCallback((msgId: string) => {
    if (suppressAutoReadRef.current) return;
    setMessages(prev => {
      const msg = prev.find(m => m.id === msgId);
      if (!msg || msg.read_at) return prev;
      supabase.from('messages').update({ read_at: new Date().toISOString(), read: true })
        .eq('id', msgId).then(() => { clearAppBadge(); });
      return prev.map(m => m.id === msgId ? { ...m, read_at: new Date().toISOString() } : m);
    });
  }, [supabase]);

  // Marquage "écouté" pour les messages vocaux — voir commentaire détaillé dans
  // PageClientMessages.tsx (même logique, symétrique).
  const markMessageListened = useCallback((msgId: string) => {
    const ts = new Date().toISOString();
    let shouldPersist = false;
    setMessages(prev => {
      const msg = prev.find(m => m.id === msgId);
      if (!msg || msg.listened_at) return prev;
      shouldPersist = true;
      return prev.map(m => m.id === msgId ? { ...m, listened_at: ts } : m);
    });
    if (!shouldPersist) return;
    // await explicite : sans lui, la requête peut être annulée en plein vol si l'utilisateur
    // change de page dans la fraction de seconde qui suit — voir PageClientMessages.tsx.
    supabase.from('messages').update({ listened_at: ts }).eq('id', msgId).then(({ error }) => {
      if (error) {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, listened_at: null } : m));
      }
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
        // 4s, nettement au-dessus de l'intervalle d'émission (2s côté émetteur) pour
        // absorber la latence réseau variable (surtout mobile) — sinon l'indicateur
        // s'éteint puis se rallume (clignote) entre deux broadcasts.
        typingTimerRef.current = setTimeout(() => setClientTyping(false), 4000);
      }
    };
    presenceCh.on('broadcast', { event: 'typing' }, handler);
    return () => {
      // Annuler le timer sans réinitialiser clientTyping laissait l'indicateur "en train
      // d'écrire" bloqué indéfiniment si le canal était recréé entre le setClientTyping(true)
      // et l'expiration du timer de 3s — plus rien ne repassait alors clientTyping à false.
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      setClientTyping(false);
    };
  }, [presenceCh]);

  const initialScrollDone = useRef(false);
  // La zone de messages reste masquée (visibility:hidden, garde le layout pour scrollHeight)
  // tant que le scroll initial n'a pas été posé — sinon le navigateur peint une frame avec
  // scrollTop:0 (tout en haut) avant que notre effect ne corrige la position, visible comme
  // un flash d'un instant à l'ouverture de la conversation.
  const [contentReady, setContentReady] = useState(false);
  // IDs déjà présents au premier chargement de la conversation — ces messages ne jouent pas
  // l'animation d'entrée (msg-bubble-in), sinon leur translateY/opacity donne l'impression
  // d'un scroll même quand la position finale est déjà correcte. Seuls les messages qui
  // arrivent APRÈS ce premier rendu (nouveaux messages en direct) sont animés.
  const knownIdsRef = useRef<Set<string> | null>(null);
  // Premier message non lu (de l'élève) au moment du chargement initial — figé une fois
  // pour toutes. Comme WhatsApp/Telegram : si des messages non lus existent, l'ouverture
  // de la conversation atterrit dessus plutôt que tout en bas.
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const firstUnreadComputedRef = useRef(false);
  // Tant que l'utilisateur n'a pas scrollé lui-même, on reste ancré en bas — y compris quand
  // des images/audio finissent de charger après coup et changent la hauteur du contenu
  // (setTimeout à délai fixe ne suffit pas : ResizeObserver réagit au vrai changement de taille).
  const stickToBottomRef = useRef(true);
  // Ancrage sur le séparateur "Nouveaux messages" (cas landedOnUnread) — protège la position
  // pendant la stabilisation exactement comme stickToBottomRef protège le bas absolu.
  const stickToDividerRef = useRef(false);
  // Pendant la phase de stabilisation (hard refresh : viewport mobile qui rétrécit quand la
  // barre d'adresse se replie, fonts qui swap, hydration) le navigateur peut émettre un event
  // "scroll" natif alors que l'utilisateur n'a rien touché — on ignore onScroll pendant cette
  // fenêtre pour ne pas désarmer stickToBottomRef par erreur.
  const settlingRef = useRef(true);
  // ConversationThread est démonté/remonté à chaque changement de conversation (key={activeId}),
  // donc le state initial suffit normalement à réinitialiser tout ça. MAIS si le coach reste sur
  // la MÊME conversation en arrière-plan longtemps (app PWA jamais fermée), rien ne redéclenche
  // ce cycle — firstUnreadComputedRef reste bloqué à `true` depuis la première ouverture, et le
  // calcul du premier non-lu ne se refait jamais pour les messages arrivés entre-temps (constaté
  // côté élève, même bug attendu ici). On refait le reset sur un retour au premier plan après
  // une absence significative (seuil 5s pour ignorer les micro-blur/focus).
  const hiddenAtRef = useRef<number | null>(null);
  // Compteur incrémenté à CHAQUE reset (pas un booléen/valeur qui peut retomber sur elle-même) —
  // ajouté aux dépendances du useLayoutEffect juste en dessous pour GARANTIR sa ré-exécution.
  // Bug corrigé : setFirstUnreadId(null) seul ne redéclenche l'effet que si firstUnreadId était
  // déjà non-null — s'il était déjà null, React bail-out (Object.is égal) et ne re-render pas,
  // donc l'effet ne se redéclenche JAMAIS, donc contentReady reste bloqué à false pour toujours
  // → container en visibility:hidden en permanence → scroll bloqué (constaté PC ET mobile, dès
  // 1-2 minutes de verrouillage/changement d'onglet).
  const [resetTick, setResetTick] = useState(0);
  useEffect(() => {
    const handleBackgroundReturn = () => {
      if (document.visibilityState === 'hidden') { hiddenAtRef.current = Date.now(); return; }
      const wasHiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = null;
      if (wasHiddenFor < 5000) return;
      initialScrollDone.current = false;
      stickToBottomRef.current = true;
      settlingRef.current = true;
      knownIdsRef.current = null;
      firstUnreadComputedRef.current = false;
      setFirstUnreadId(null);
      setContentReady(false);
      suppressAutoReadRef.current = true;
      setResetTick(t => t + 1);
    };
    document.addEventListener('visibilitychange', handleBackgroundReturn);
    return () => document.removeEventListener('visibilitychange', handleBackgroundReturn);
  }, []);
  // useLayoutEffect (pas useEffect) : s'exécute de façon SYNCHRONE avant que le navigateur
  // peigne le DOM — élimine la fenêtre de flash "haut de conversation" au premier paint.
  useLayoutEffect(() => {
    if (loading) return;
    const container = chatZoneRef.current;
    if (!container) return;
    if (!knownIdsRef.current) knownIdsRef.current = new Set(messages.map(m => m.id));
    else messages.forEach(m => knownIdsRef.current!.add(m.id));
    if (!firstUnreadComputedRef.current) {
      // On calcule le premier non-lu et on attend le re-render suivant (le séparateur
      // "Nouveaux messages" doit être monté dans le DOM avant qu'on puisse scroller dessus).
      firstUnreadComputedRef.current = true;
      const firstUnread = messages.find(m => m.sender_id !== userId && !m.read_at);
      logChatScroll('firstUnread computed', { found: !!firstUnread, id: firstUnread?.id, totalMsgs: messages.length });
      if (firstUnread) { setFirstUnreadId(firstUnread.id); return; }
    }
    if (!initialScrollDone.current) {
      // Message non lu trouvé : on cible son séparateur "Nouveaux messages" plutôt que
      // le tout-en-bas — comme WhatsApp/Telegram, pour ne rater aucun message précédent.
      const target = firstUnreadId ? document.getElementById(`unread-divider-${clientId}`) : null;
      if (target) {
        target.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
      } else {
        // behavior: 'instant' outrepasse scroll-behavior:smooth (CSS) sur .chat-messages-zone —
        // une simple affectation scrollTop serait animée par le navigateur et provoquerait un défilement visible.
        container.scrollTo({ top: container.scrollHeight, behavior: 'instant' as ScrollBehavior });
      }
      initialScrollDone.current = true;
      // Ancrage bas désactivé si on a atterri sur un message non lu au milieu de l'historique —
      // sinon le premier nouveau message réassocié par le ResizeObserver nous forcerait en bas.
      // On protège alors la position du divider à la place (stickToDividerRef).
      stickToBottomRef.current = !target;
      stickToDividerRef.current = !!target;
      settlingRef.current = true;
      logChatScroll('initial scroll', { firstUnreadId, landedOnUnread: !!target, gap: container.scrollHeight - container.scrollTop - container.clientHeight });
      setContentReady(true);
      // Le calcul du premier non-lu (firstUnread) est fait — on peut désormais laisser
      // l'IntersectionObserver de chaque bulle marquer les messages lus normalement au fil du
      // scroll, sans risquer d'avoir marqué prématurément un message reçu pendant l'absence.
      suppressAutoReadRef.current = false;
      // BUG CRITIQUE CORRIGÉ : ce setTimeout était posé DANS ce useLayoutEffect (dépendances
      // [messages, ...]) avec un cleanup `return () => clearTimeout(t)`. React exécute ce
      // cleanup à CHAQUE redéclenchement de l'effet (donc à chaque nouveau message) — mais un
      // nouveau timer n'était reposé que dans la branche `if (!initialScrollDone.current)`, qui
      // ne se reproduit jamais après le tout premier passage. Résultat : dès qu'un 2e message
      // arrivait dans les 2.5s suivant l'ouverture, le timer était annulé sans jamais être
      // reposé — settlingRef.current restait bloqué à `true` pour toujours, et la boucle rAF de
      // stabilisation (qui vérifie settlingRef à chaque frame) tournait indéfiniment à 60fps,
      // saturant le thread principal (confirmé : app totalement figée, PC et mobile, nécessitant
      // un hard refresh / fermeture complète). Le timer vit maintenant dans un effect séparé,
      // dé-corrélé du cycle de vie de CE useLayoutEffect.
    } else if (stickToBottomRef.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, clientTyping, loading, firstUnreadId, clientId, userId, resetTick]);

  // Timer de fin de fenêtre de stabilisation — posé UNE SEULE FOIS quand initialScrollDone
  // passe à true, indépendant des re-déclenchements de l'effet de scroll ci-dessus (voir
  // commentaire détaillé plus haut sur le bug corrigé).
  useEffect(() => {
    if (!settlingRef.current) return;
    const t = setTimeout(() => { settlingRef.current = false; }, 2500);
    return () => clearTimeout(t);
  }, [contentReady]);

  // Boucle rAF active en continu pendant toute la fenêtre de stabilisation (settlingRef,
  // 2.5s) — ne dépend d'AUCUN événement navigateur (ResizeObserver, onScroll, visualViewport).
  // Un seul scrollTo() par notification ResizeObserver s'est révélé insuffisant en pratique
  // (constaté côté élève : écart de plusieurs messages malgré des logs indiquant gap:0 juste
  // avant — le contenu continue de grandir entre deux notifications regroupées par le
  // navigateur). Cette boucle vérifie et corrige à CHAQUE frame tant qu'on est en phase de
  // stabilisation et ancré en bas, donc aucune fenêtre de croissance non détectée n'est possible.
  useEffect(() => {
    if (loading || !settlingRef.current) return;
    let rafId: number | null = null;
    const tick = () => {
      const c = chatZoneRef.current;
      if (!c || !settlingRef.current) { rafId = null; return; }
      if (stickToBottomRef.current) {
        const gap = c.scrollHeight - c.scrollTop - c.clientHeight;
        if (gap > 0) c.scrollTo({ top: c.scrollHeight, behavior: 'instant' as ScrollBehavior });
      } else if (stickToDividerRef.current) {
        const target = document.getElementById(`unread-divider-${clientId}`);
        if (target) target.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
      } else {
        rafId = null;
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => { if (rafId !== null) cancelAnimationFrame(rafId); };
  }, [loading, messages, clientId]);

  // Après la fenêtre de stabilisation (images/audio qui chargent encore plus tard), le
  // ResizeObserver reste le filet de sécurité classique.
  useEffect(() => {
    const container = chatZoneRef.current;
    if (!container || loading) return;
    const ro = new ResizeObserver(() => {
      const c = chatZoneRef.current;
      if (!c || !stickToBottomRef.current) return;
      const gap = c.scrollHeight - c.scrollTop - c.clientHeight;
      if (gap > 0) c.scrollTo({ top: c.scrollHeight, behavior: 'instant' as ScrollBehavior });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [loading]);

  // Le shell mobile (voir useViewportShellHeight) recalcule sa hauteur via visualViewport
  // APRÈS le premier paint — ce resize n'est jamais un geste utilisateur : on force le
  // rescroll bas sans passer par settlingRef.
  useEffect(() => {
    if (loading) return;
    const vv = window.visualViewport;
    if (!vv) return;
    let rafId: number | null = null;
    let stopAt = 0;
    const tick = () => {
      const c = chatZoneRef.current;
      if (!c || !stickToBottomRef.current || Date.now() > stopAt) { rafId = null; return; }
      const gap = c.scrollHeight - c.scrollTop - c.clientHeight;
      if (gap !== 0) c.scrollTo({ top: c.scrollHeight, behavior: 'instant' as ScrollBehavior });
      rafId = requestAnimationFrame(tick);
    };
    const onViewportResize = () => {
      if (!stickToBottomRef.current) return;
      // Le resize peut continuer sur quelques frames (clavier/barre d'adresse qui finit son
      // animation) — on corrige en continu pendant 500ms au lieu d'une seule fois.
      stopAt = Date.now() + 500;
      if (rafId === null) rafId = requestAnimationFrame(tick);
    };
    vv.addEventListener('resize', onViewportResize);
    return () => { vv.removeEventListener('resize', onViewportResize); if (rafId !== null) cancelAnimationFrame(rafId); };
  }, [loading]);

  // Envoi texte
  async function sendMessage(text: string) {
    if (!text.trim()) return;
    setInput('');
    const replyId = replyingTo?.id ?? null;
    const optimisticId = `opt-text-${Date.now()}`;
    const optimistic: Msg = { id: optimisticId, client_id: clientId, sender_id: userId, text: text.trim(), created_at: new Date().toISOString(), type: 'text', reply_to_id: replyId };
    setMessages(prev => [...prev, optimistic]);
    setReplyingTo(null);
    const { data } = await supabase.from('messages')
      .insert({ client_id: clientId, sender_id: userId, text: text.trim(), type: 'text', read: false, reply_to_id: replyId })
      .select('id, text, sender_id, created_at, type, audio_url, duration_s, read_at, read, listened_at, caption, reply_to_id, reaction_emoji, reaction_by, file_size_bytes, page_count, thumbnail_url').single();
    if (data) setMessages(prev => prev.map(m => m.id === optimisticId ? data as Msg : m));
  }

  async function copyMessageText(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard indisponible (contexte non sécurisé) */ }
  }

  function scrollToMessage(msgId: string) {
    const el = bubbleRefsMap.current.get(msgId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('msg-flash-highlight');
    setTimeout(() => el.classList.remove('msg-flash-highlight'), 1200);
  }

  // Réactions — RPC dédiées (voir migration), une seule réaction par message,
  // n'importe quel participant peut réagir à n'importe quel message (comme WhatsApp).
  async function reactToMessage(msgId: string, emoji: string) {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reaction_emoji: emoji, reaction_by: userId } : m));
    const { error } = await supabase.rpc('set_message_reaction', { p_message_id: msgId, p_emoji: emoji });
    if (error) setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reaction_emoji: null, reaction_by: null } : m));
  }
  async function clearReaction(msgId: string) {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reaction_emoji: null, reaction_by: null } : m));
    await supabase.rpc('clear_message_reaction', { p_message_id: msgId });
  }
  function handleReact(msg: Msg, emoji: string) {
    if (msg.reaction_emoji === emoji && msg.reaction_by === userId) clearReaction(msg.id);
    else reactToMessage(msg.id, emoji);
  }

  // Édition / suppression — la policy RLS reste la seule vraie garantie de sécurité,
  // ces vérifications côté client ne sont qu'un affichage cohérent avec les permissions.
  function canEditMsg(msg: Msg) {
    return msg.sender_id === userId && Date.now() - new Date(msg.created_at).getTime() < EDIT_WINDOW_MS;
  }
  function canDeleteMsg(msg: Msg) {
    return msg.sender_id === userId && Date.now() - new Date(msg.created_at).getTime() < DELETE_WINDOW_MS;
  }

  // Ouverture du menu contextuel (clic droit / long-press / flèche hover / clic sur
  // un badge de réaction). Calcule le lift nécessaire pour que le menu reste
  // TOUJOURS en dessous du message (jamais au-dessus) — voir docs/architecture-messagerie.md.
  function openMenu(bubbleEl: HTMLDivElement, msg: Msg, opts: { menuOnly?: boolean } = {}) {
    const isMe = msg.sender_id === userId;
    const isTextMessage = !msg.type || msg.type === 'text';
    const items = buildMenuItems(isMe, isTextMessage, canEditMsg(msg), canDeleteMsg(msg));
    if (!opts.menuOnly && items.length === 0) return;
    const rect = bubbleEl.getBoundingClientRect();
    const menuHeight = (opts.menuOnly ? 0 : items.length * MENU_ITEM_HEIGHT) + REACTION_BAR_HEIGHT + MENU_GAP;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_SCREEN_MARGIN;
    const lift = Math.max(0, (menuHeight + MENU_GAP) - spaceBelow);
    setCtxMenu({ rect, msgId: msg.id, lift, menuOnly: !!opts.menuOnly });
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
    const replyId = replyingTo?.id ?? null;
    setReplyingTo(null);
    const optimisticId = `opt-audio-${Date.now()}`;
    const localUrl = URL.createObjectURL(blob);
    const optimistic: Msg = { id: optimisticId, client_id: clientId, sender_id: userId, text: '', created_at: new Date().toISOString(), type: 'audio', audio_url: localUrl, duration_s: durationS, reply_to_id: replyId };
    setMessages(prev => [...prev, optimistic]);
    try {
      const fileName = `${clientId}/${Date.now()}.${ext}`;
      const audioFile = new File([blob], `${Date.now()}.${ext}`, { type: strictType });
      const { error: uploadError } = await supabase.storage.from('voice-messages').upload(fileName, audioFile, { contentType: strictType, cacheControl: '3600' });
      if (uploadError) { setMessages(prev => prev.filter(m => m.id !== optimisticId)); URL.revokeObjectURL(localUrl); return; }
      const { data: urlData } = supabase.storage.from('voice-messages').getPublicUrl(fileName);
      const { error: insertError } = await supabase.from('messages').insert({ client_id: clientId, sender_id: userId, text: '', type: 'audio', audio_url: urlData.publicUrl, duration_s: Math.round(durationS), read: false, reply_to_id: replyId });
      if (insertError) { setMessages(prev => prev.filter(m => m.id !== optimisticId)); URL.revokeObjectURL(localUrl); return; }
      setTimeout(() => URL.revokeObjectURL(localUrl), 5000);
    } catch { setMessages(prev => prev.filter(m => m.id !== optimisticId)); URL.revokeObjectURL(localUrl); }
  }

  // Envoi fichier — preview + confirmation avant envoi, comme côté élève
  async function sendFile(file: File, caption?: string) {
    const isImage = file.type.startsWith('image/');
    const type: 'image' | 'document' = isImage ? 'image' : 'document';
    if (file.size > (isImage ? 5*1024*1024 : 20*1024*1024)) { setIsSendingFile(false); return; }
    setIsSendingFile(true);
    const replyId = replyingTo?.id ?? null;
    const ext = file.name.split('.').pop() || 'bin';
    const fileName = `${clientId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('chat-medias').upload(fileName, file, { contentType: file.type });
    if (error) { setIsSendingFile(false); return; }
    const { data: urlData } = supabase.storage.from('chat-medias').getPublicUrl(fileName);
    await supabase.from('messages').insert({ client_id: clientId, sender_id: userId, text: file.name, type, audio_url: urlData.publicUrl, read: false, caption: caption?.trim() || null, reply_to_id: replyId });
    setIsSendingFile(false);
    setReplyingTo(null);
    setPendingFile(prev => { if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl); return null; });
    setFileCaption('');
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

  // Un vrai geste (touch/souris/molette) est un signal fiable à 100% qu'il vient de
  // l'utilisateur — jamais du navigateur — donc on désarme l'ancrage bas immédiatement,
  // sans attendre la fin de settlingRef. Sans ça, scroller vers le haut dans la seconde qui
  // suit l'ouverture de la conversation était systématiquement annulé par la boucle rAF.
  const userGestureRef = useRef(false);
  function handleUserGestureStart() {
    userGestureRef.current = true;
    settlingRef.current = false;
  }
  function handleChatScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollArrow(distanceFromBottom > 120);
    // Pendant la stabilisation (settlingRef) SANS geste utilisateur détecté, un "scroll"
    // natif peut venir du navigateur lui-même (reflow viewport/fonts) — on ignore ce cas
    // pour ne pas désarmer l'ancrage bas par erreur. Un vrai geste (userGestureRef) prime.
    if (userGestureRef.current || !settlingRef.current) stickToBottomRef.current = distanceFromBottom < 40;
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

  // Lookup O(1) pour l'affichage des citations (§13) — construite une fois par changement
  // de `messages`, évite un .find() O(n) par bulle affichée.
  const messagesById = new Map(messages.map(m => [m.id, m]));

  return (
    <AudioContext.Provider value={{ activeId: activeAudioId, setActive: setActiveAudioId }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--bg)', position: 'relative' }}>

        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, background: 'var(--surface)' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Avatar initials={clientInitials} avatarUrl={clientAvatarUrl} size={40} />
            <div style={{ position: 'absolute', bottom: 1, right: 1, width: 9, height: 9, borderRadius: '50%', background: isOnline ? 'var(--green)' : 'var(--faint)', border: '2px solid var(--surface)', transition: 'background 0.4s' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0, overflow: 'hidden' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clientName}</div>
            <div style={{ fontSize: 11, color: isOnline ? 'var(--green)' : 'var(--muted)', transition: 'color 0.4s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {clientTyping ? 'En train d\'écrire…' : isOnline ? 'En ligne' : 'Hors ligne'}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={chatZoneRef} onScroll={handleChatScroll}
          onTouchStart={handleUserGestureStart} onMouseDown={handleUserGestureStart} onWheel={handleUserGestureStart}
          className="chat-messages-zone" style={{
            flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '16px 16px 8px',
            display: 'flex', flexDirection: 'column', gap: 2, WebkitOverflowScrolling: 'touch',
            // Masqué (mais toujours mesurable pour scrollHeight) tant que le scroll initial
            // n'est pas posé — évite le flash "tout en haut" avant correction de la position.
            visibility: (!loading && messages.length > 0 && !contentReady) ? 'hidden' : 'visible',
          } as React.CSSProperties}>
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
                  <Fragment key={msg.id}>
                    {firstUnreadId === msg.id && (
                      <div id={`unread-divider-${clientId}`} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 6px' }}>
                        <div style={{ flex: 1, height: 1, background: 'var(--red-soft)' }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)', background: 'var(--red-soft)', padding: '3px 10px', borderRadius: 20 }}>
                          Nouveaux messages
                        </span>
                        <div style={{ flex: 1, height: 1, background: 'var(--red-soft)' }} />
                      </div>
                    )}
                    <MessageBubble
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
                      onOpenCtxMenu={(bubbleEl, m, opts) => openMenu(bubbleEl, m, opts)}
                      onOpenLightbox={setLightboxUrl}
                      isMenuTarget={ctxMenu?.msgId === msg.id}
                      liftPx={ctxMenu?.msgId === msg.id ? ctxMenu.lift : 0}
                      onEnterViewport={markMessageRead}
                      onListened={markMessageListened}
                      quotedMsg={msg.reply_to_id ? messagesById.get(msg.reply_to_id) : undefined}
                      onQuoteClick={scrollToMessage}
                      clientName={clientName}
                      clientAvatarUrl={clientAvatarUrl}
                      clientInitials={clientInitials}
                      myAvatarUrl={myAvatarUrl}
                      myInitials={myInitials}
                      registerBubbleRef={(id, el) => {
                        if (el) bubbleRefsMap.current.set(id, el);
                        else bubbleRefsMap.current.delete(id);
                      }}
                      animate={knownIdsRef.current ? !knownIdsRef.current.has(msg.id) : false}
                    />
                  </Fragment>
                );
              })}
            </div>
          ))}
          {/* Pas de msg-bubble-in ici : ce conteneur reste monté en continu tant que
              clientTyping est true — l'animation d'entrée n'a pas lieu d'être et pouvait
              interagir avec l'animation infinie des points (clignotement constaté mobile). */}
          {clientTyping && <div style={{ marginTop: 8 }}><TypingIndicator /></div>}
          <div ref={bottomRef} />
        </div>

        {/* Flèche scroll bas */}
        <button
          onClick={scrollToBottom}
          aria-label="Aller en bas"
          style={{
            position: 'absolute', right: 16, bottom: replyingTo ? 128 : 72,
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--surface)', border: '1px solid var(--border)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', zIndex: 10,
            opacity: showScrollArrow ? 1 : 0,
            transform: showScrollArrow ? 'scale(1) translateY(0)' : 'scale(0.8) translateY(6px)',
            pointerEvents: showScrollArrow ? 'auto' : 'none',
            transition: 'opacity 0.18s ease-out, transform 0.18s ease-out, bottom 0.18s ease-out',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Bandeau de réponse — visible au-dessus de n'importe quel état de la barre du bas
            (texte, fichier en attente, enregistrement vocal), pas seulement le textarea. */}
        {replyingTo && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 14px', background: 'var(--surface)',
            borderTop: '1px solid var(--border)', flexShrink: 0,
            animation: 'slideUp 150ms ease-out',
          }}>
            <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: 'var(--ink)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                {replyingTo.sender_id === userId ? 'Toi' : clientName}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {replyingTo.type === 'audio' ? '🎤 Message vocal'
                  : replyingTo.type === 'image' ? '📷 Photo'
                  : replyingTo.type === 'document' ? '📄 Document'
                  : replyingTo.text}
              </div>
            </div>
            <button type="button" onClick={() => setReplyingTo(null)} className="tap-scale" style={{
              width: 28, height: 28, borderRadius: '50%', border: 'none',
              background: 'var(--surface-2)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        )}

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
            display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
            animation: 'slideUp 180ms ease-out',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                  setFileCaption('');
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
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <textarea
                value={fileCaption}
                onChange={e => setFileCaption(e.target.value)}
                placeholder="Ajouter une légende…"
                rows={1}
                style={{
                  flex: 1, resize: 'none', border: '1px solid var(--border)',
                  borderRadius: 18, padding: '9px 14px', fontSize: 13,
                  fontFamily: 'inherit', lineHeight: 1.4, outline: 'none',
                  background: 'var(--surface-2)', color: 'var(--ink)',
                  maxHeight: 80,
                }}
              />
              <button type="button"
                disabled={isSendingFile}
                onClick={() => sendFile(pendingFile.file, fileCaption)}
                className="btn-primary tap-scale"
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
                // Throttle — évite de spammer le canal realtime à chaque frappe. Intervalle
                // (2s) nettement inférieur au timeout d'extinction côté récepteur (4s) pour
                // absorber la latence réseau variable, sinon l'indicateur clignote.
                if (presenceCh) {
                  const now = Date.now();
                  if (now - lastTypingSentRef.current > 2000) {
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
              <button type="button" onClick={startRecording} className="tap-scale" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              </button>
            )}
            {input.trim() && (
              <button className="btn-primary tap-scale" onClick={() => sendMessage(input)} type="button" style={{ width: 40, height: 40, borderRadius: '50%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
        const msgIsMe = msg.sender_id === userId;
        const isTextMessage = !msg.type || msg.type === 'text';
        return (
          <MessageContextMenu
            rect={ctxMenu.rect}
            menuOnly={ctxMenu.menuOnly}
            isMe={msgIsMe}
            isTextMessage={isTextMessage}
            canEdit={canEditMsg(msg)} canDelete={canDeleteMsg(msg)}
            onReply={() => setReplyingTo(msg)}
            onCopy={() => copyMessageText(msg.text)}
            onEdit={() => {
              // Mesurer AVANT isEditing=true : une fois vrai, le contenu texte de
              // la bulle est vidé (rendu null) et son rect s'effondre au padding seul.
              const el = bubbleRefsMap.current.get(msg.id);
              setEditRect(el ? el.getBoundingClientRect() : ctxMenu.rect);
              setEditingId(msg.id);
              setEditText(msg.text);
            }}
            onDelete={() => setConfirmDeleteId(msg.id)}
            onReact={emoji => handleReact(msg, emoji)}
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
  // En ligne/hors ligne = présence plateforme entière (voir lib/GlobalPresenceContext.tsx),
  // pas seulement "a la messagerie ouverte" — plus précis pour l'utilisateur.
  // Le broadcast "typing" utilise désormais le MÊME canal que la présence globale
  // (global-presence-${activeId}) au lieu d'un canal presence-chat-* séparé — avoir deux
  // canaux Realtime Presence actifs en parallèle par élève doublait le volume d'events
  // track()/heartbeat, déclenchant le rate limit Supabase Realtime
  // ("ClientPresenceRateLimitReached") et causant un clignotement en ligne/hors ligne.
  const { isClientOnline, getChannel } = useGlobalCoachPresence();
  const supabase = useRef(createClient()).current;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id || null));
  }, [supabase]);

  useEffect(() => {
    if (clients.length > 0 && !activeId) setActiveId(clients[0].id);
  }, [clients, activeId]);

  const presenceCh = activeId ? getChannel(activeId) : null;

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
            const isOnline = isClientOnline(cl.id);
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
                  <Avatar initials={initials} avatarUrl={cl.avatar_url} size={34} />
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
          clientAvatarUrl={activeClient.avatar_url}
          isOnline={isClientOnline(activeId)}
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
