'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback, createContext, useContext, Fragment } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import Avatar from '@/components/ui/Avatar';
import { createClient } from '@/lib/supabase/client';
import InlineLoader from '@/components/ui/InlineLoader';
import PushInit from '@/components/PushInit';
import { useLongPress } from '@/lib/useLongPress';
import { clearAppBadge } from '@/lib/pwaBadge';
import { logChatScroll } from '@/lib/chatScrollDebug';
import { useGlobalClientPresence } from '@/lib/GlobalPresenceContext';
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

// Waveform statique — compacte, aspect "onde vocale" sans prendre trop de place dans la bulle
const WAVEFORM = [4,8,14,9,18,12,20,15,22,11,17,13,21,10,16,8,19,12,6,14,9,17,11,5,7];

// ─── AudioBubble — player custom coordonné ───────────────────────────────────

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
  // Position de lecture persistée (localStorage) — survit au changement de page ET au refresh
  // complet, contrairement à un simple state/ref React qui se réinitialise au démontage.
  const positionKey = `audio-pos-${id}`;
  // Marquage "écouté" — comme WhatsApp : play réellement enclenché suffit (pas besoin
  // d'aller jusqu'au bout), avec une petite garde anti-clic-accidentel. Le seuil est le MIN
  // entre 1.5s et la durée totale — sinon un vocal de 1-2s n'atteindrait jamais 1.5s de
  // lecture continue et ne serait jamais marqué écouté.
  const listenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      try { localStorage.setItem(positionKey, String(el.currentTime)); } catch {}
    };
    const onEnded = () => {
      setActive(null);
      setProgress(0);
      try { localStorage.removeItem(positionKey); } catch {}
    };
    const onLoaded = () => {
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
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('ended', onEnded);
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
    };
  }, [currentDuration, setActive, listened, onListened, id]);

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
  const mutedColor = isMe ? 'rgba(255,255,255,0.5)' : 'var(--muted)';

  // Calcule l'index de la barre de progression dans la waveform
  const progressIdx = Math.round((progress / 100) * (WAVEFORM.length - 1));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 200, maxWidth: 260 }}>
      <audio ref={audioRef} src={url} preload="metadata" />

      {/* Avatar + bouton play/pause superposé */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar initials={initials} avatarUrl={avatarUrl} size={38} />
        <button onClick={togglePlay} className="tap-scale" style={{
          position: 'absolute', bottom: -3, right: -3, width: 18, height: 18, borderRadius: '50%',
          border: '2px solid var(--surface)', background: 'var(--ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          {playing ? (
            <svg width="7" height="7" viewBox="0 0 24 24" fill="#fff">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
          ) : (
            <svg width="7" height="7" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: 1 }}>
              <polygon points="6 3 20 12 6 21 6 3"/>
            </svg>
          )}
        </button>
        {/* Pastille "non écouté" — rappel visuel personnel sur les vocaux REÇUS pas encore
            écoutés (disparaît une fois le vocal réellement lancé, voir onPlay plus haut).
            Distinct des coches MessageStatus, qui informent l'EXPÉDITEUR si le destinataire
            a écouté SES propres vocaux envoyés. */}
        {onListened && !listened && (
          <span style={{
            position: 'absolute', top: -1, right: -1, width: 9, height: 9,
            borderRadius: '50%', background: 'var(--red)', border: '2px solid var(--surface)',
          }} />
        )}
      </div>

      {/* Waveform pointillée + curseur bleu */}
      <div
        onClick={seekTo}
        style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', gap: 3, height: 24, cursor: 'pointer' }}
      >
        {WAVEFORM.map((h, i) => (
          <div
            key={i}
            style={{
              width: 2.5, height: 2.5, borderRadius: '50%', flexShrink: 0,
              background: i <= progressIdx && progress > 0 ? fillColor : trackBg,
              transition: 'background 0.1s',
            }}
          />
        ))}
        {progress > 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: `${progress}%`, width: 11, height: 11, borderRadius: '50%',
            background: '#3b82f6', transform: 'translate(-50%, -50%)', boxShadow: '0 1px 3px rgba(0,0,0,.3)',
            transition: playing ? 'left 0.1s linear' : 'none', pointerEvents: 'none',
          }} />
        )}
      </div>

      {/* Durée */}
      <span style={{ fontSize: 10, color: mutedColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1, flexShrink: 0, alignSelf: 'flex-end' }}>
        {progress > 0 && audioRef.current
          ? formatDuration(audioRef.current.currentTime)
          : formatDuration(currentDuration)}
      </span>
    </div>
  );
}

// ─── Coches de statut ────────────────────────────────────────────────────────

function MessageStatus({ isMe, msgId, readAt, isAudio, listenedAt }: {
  isMe: boolean; msgId: string; readAt?: string | null;
  isAudio?: boolean; listenedAt?: string | null;
}) {
  if (!isMe) return null;
  // Pour un vocal : "lu" (double coche pleine) signifie réellement ÉCOUTÉ par le
  // destinataire (play + 1.5s ou durée totale si plus court — voir AudioBubble), pas juste
  // "la bulle est passée dans son viewport". C'est ce que l'expéditeur veut savoir : est-ce
  // que la personne a vraiment écouté mon message, pas juste vu qu'il existe.
  const isRead = isAudio ? !!listenedAt : !!readAt;
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
      <button onClick={onCancel} type="button" className="tap-scale" style={{
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
      <button onClick={onSend} type="button" className="tap-scale" style={{
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

function MessageBubble({ msg, userId, isContinued, isLast, isEditing, editRect, editText, setEditText, onStartEdit, onCancelEdit, onSaveEdit, canEdit, canDelete, onOpenCtxMenu, onOpenLightbox, isMenuTarget, liftPx, onEnterViewport, registerBubbleRef, animate, onListened, quotedMsg, onQuoteClick, coachName, coachAvatarUrl, coachInitials, myAvatarUrl, myInitials }: {
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
  coachName: string;
  coachAvatarUrl?: string | null;
  coachInitials?: string;
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
  // Long-press + clic droit combinés dans un seul hook (voir lib/useLongPress.ts).
  // Désactivé en mode édition et tant que le menu contextuel est ouvert sur cette
  // bulle (v2 sans clone : la bulle reste visible, juste désactivé pour éviter une
  // double ouverture).
  const canOpenMenu = !isEditing && !isMenuTarget;
  const { ref: wrapperRef } = useLongPress(() => openMenu(), canOpenMenu);
  // Flèche hover desktop (WhatsApp desktop) — coexiste avec le clic droit natif.
  const [hovered, setHovered] = useState(false);
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
              {quotedMsg ? (quotedMsg.sender_id === userId ? 'Toi' : coachName) : ''}
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
            avatarUrl={isMe ? myAvatarUrl : coachAvatarUrl}
            initials={(isMe ? myInitials : coachInitials) || '?'}
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

// ─── Composant principal ──────────────────────────────────────────────────────

export default function PageClientMessages() {
  const { user } = useUser();
  const myAvatarUrl = user?.avatar_url ?? null;
  const myInitials = user?.initials ?? '?';
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [coachName, setCoachName] = useState('Coach');
  const [coachInitials, setCoachInitials] = useState('CO');
  const [coachAvatarUrl, setCoachAvatarUrl] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [mediaRecorderSupported, setMediaRecorderSupported] = useState(false);
  // En ligne/hors ligne = présence plateforme entière (voir lib/GlobalPresenceContext.tsx),
  // pas seulement "a la messagerie ouverte" — plus précis pour l'utilisateur.
  const { coachOnline: isCoachOnline, channel: globalChannel } = useGlobalClientPresence();
  const [coachTyping, setCoachTyping] = useState(false);
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [showScrollArrow, setShowScrollArrow] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ file: File; previewUrl?: string; type: 'image' | 'document' } | null>(null);
  const [fileCaption, setFileCaption] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isSendingFile, setIsSendingFile] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ rect: DOMRect; msgId: string; lift: number; menuOnly: boolean } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Msg | null>(null);
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

  // worker: true déporte le heartbeat WebSocket Realtime dans un Web Worker — insensible au
  // throttling de timers que les navigateurs appliquent aux onglets en arrière-plan, cause
  // principale des faux "hors ligne"/"en ligne" figés observés en prod (canal resté ouvert
  // des heures sans que le heartbeat parte, donc sans que le serveur détecte la coupure).
  const supabase = useRef(createClient({ worker: true, heartbeatIntervalMs: 15_000 })).current;

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
        .from('profiles').select('full_name, avatar_url').eq('id', clientRow.coach_id).maybeSingle();
      if (coachProfile?.full_name) {
        setCoachName(coachProfile.full_name);
        const parts = coachProfile.full_name.trim().split(' ');
        setCoachInitials(parts.length >= 2
          ? (parts[0][0] + parts[1][0]).toUpperCase()
          : coachProfile.full_name.slice(0, 2).toUpperCase());
      }
      setCoachAvatarUrl(coachProfile?.avatar_url || null);

      const { data, error } = await supabase
        .from('messages')
        .select('id, text, sender_id, created_at, type, audio_url, duration_s, read_at, listened_at, edited_at, caption, reply_to_id, reaction_emoji, reaction_by, file_size_bytes, page_count, thumbnail_url')
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

  // Tant que le calcul du premier non-lu (voir useLayoutEffect de scroll plus bas) n'a pas eu
  // lieu pour cette ouverture de conversation, on refuse tout marquage "lu" automatique — même
  // si l'IntersectionObserver d'une bulle se déclenche. Sans ce garde : un message reçu pendant
  // que l'app est en arrière-plan (Realtime insère la ligne, React monte la bulle, l'observer la
  // voit "visible" même page cachée) pouvait être marqué lu automatiquement au retour, AVANT que
  // l'utilisateur n'ait eu la moindre chance de le voir — et donc jamais compté comme non-lu.
  const suppressAutoReadRef = useRef(true);
  const markMessageRead = useCallback((msgId: string) => {
    if (suppressAutoReadRef.current) return;
    setMessages(prev => {
      const msg = prev.find(m => m.id === msgId);
      if (!msg || msg.read_at) return prev;
      supabase.from('messages').update({ read_at: new Date().toISOString() })
        .eq('id', msgId).then(() => { clearAppBadge(); });
      return prev.map(m => m.id === msgId ? { ...m, read_at: new Date().toISOString() } : m);
    });
  }, [supabase]);

  // Marquage "écouté" pour les messages vocaux — signal binaire comme WhatsApp (play
  // réellement enclenché suffit, pas besoin d'aller jusqu'au bout), voir AudioBubble pour le
  // détail du seuil (min 1.5s / durée totale). Colonne distincte de read_at : "vu" (la bulle
  // est passée dans le viewport) ne veut pas dire "écouté" (l'audio a été lancé).
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
    // change de page dans la fraction de seconde qui suit (le fetch part mais n'aboutit jamais,
    // le state local reste optimiste alors que la DB n'a rien — d'où la pastille qui "revient"
    // et les coches qui ne passent jamais côté expéditeur après un refetch).
    supabase.from('messages').update({ listened_at: ts }).eq('id', msgId).then(({ error }) => {
      if (error) {
        // Revert optimiste si la persistance a réellement échoué (RLS, réseau...)
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, listened_at: null } : m));
      }
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

  // ── Presence : écoute coach + typing (canal messagerie uniquement pour broadcast) ──────
  // Pattern robuste inspiré de Slack/Discord — on ne fait JAMAIS confiance à la seule
  // présence du peer dans presenceState() : le join/leave du canal peut rester bloqué des
  // heures si le WebSocket meurt silencieusement, sans jamais déclencher de "leave" côté
  // serveur (cause du bug "en ligne" figé constaté en prod). Trois protections combinées :
  //  1. Heartbeat applicatif (heartbeatRef) : re-track() toutes les 20s avec online_at frais.
  //  2. TTL local (staleCheck) : le coach n'est "en ligne" que si son dernier online_at a
  //     moins de PRESENCE_STALE_MS — vérifié indépendamment de l'état du canal WebSocket.
  //  3. presenceRetryKey force la recréation du canal sur retour réseau ou erreur
  //     (CHANNEL_ERROR/TIMED_OUT/CLOSED), au lieu d'attendre un hard refresh.
  // Le broadcast "typing" utilise désormais le MÊME canal que la présence globale
  // (global-presence-${clientId}, exposé par GlobalPresenceClientProvider) au lieu d'un
  // canal presence-chat-* séparé. Avoir deux canaux Realtime Presence actifs en parallèle par
  // paire coach/élève doublait le volume d'events track()/heartbeat, ce qui déclenchait le
  // rate limit Supabase Realtime ("ClientPresenceRateLimitReached") et causait un clignotement
  // en ligne/hors ligne (constaté en prod : clignote uniquement quand le peer est en ligne —
  // cohérent avec un rate limit qui ne se déclenche que sur des track() réussis en rafale).
  useEffect(() => {
    if (!globalChannel) { presenceChRef.current = null; return; }
    presenceChRef.current = globalChannel;

    const handler = (payload: { payload?: { role?: string } }) => {
      if (payload.payload?.role === 'coach') {
        setCoachTyping(true);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        // 4s, nettement au-dessus de l'intervalle d'émission (2s côté émetteur) pour
        // absorber la latence réseau variable (surtout mobile) — sinon l'indicateur
        // s'éteint puis se rallume (clignote) entre deux broadcasts.
        typingTimerRef.current = setTimeout(() => setCoachTyping(false), 4000);
      }
    };
    globalChannel.on('broadcast', { event: 'typing' }, handler);
    isSubscribedRef.current = true;

    return () => {
      isSubscribedRef.current = false;
      // Annuler le timer sans réinitialiser coachTyping laissait l'indicateur "en train
      // d'écrire" bloqué indéfiniment si le canal était recréé entre le setCoachTyping(true)
      // et l'expiration du timer — plus rien ne repassait alors coachTyping à false.
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      setCoachTyping(false);
    };
  }, [globalChannel]);


  // ── Scroll bas — instant au chargement, ancré tant que l'utilisateur ne scrolle pas ──
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
  // Premier message non lu (du coach) au moment du chargement initial — figé une fois pour
  // toutes, sinon il disparaîtrait dès que markMessageRead commence à marquer les messages
  // lus au fil du scroll. Comme WhatsApp/Telegram : si des messages non lus existent,
  // l'ouverture de la conversation atterrit dessus plutôt que tout en bas.
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const firstUnreadComputedRef = useRef(false);
  // Tant que l'utilisateur n'a pas scrollé lui-même, on reste ancré en bas — y compris quand
  // des images/audio finissent de charger après coup et changent la hauteur du contenu
  // (setTimeout à délai fixe ne suffit pas : ResizeObserver réagit au vrai changement de taille).
  const stickToBottomRef = useRef(true);
  // Ancrage sur le séparateur "Nouveaux messages" (cas landedOnUnread) — protège la position
  // pendant la stabilisation exactement comme stickToBottomRef protège le bas absolu. Sans ça,
  // le reflow post-paint (constaté : léger recul de quelques messages au-dessus du divider)
  // n'était corrigé nulle part, car la boucle rAF de stabilisation ne recollait qu'au bas.
  const stickToDividerRef = useRef(false);
  // Pendant la phase de stabilisation (hard refresh : viewport mobile qui rétrécit quand la
  // barre d'adresse se replie, fonts qui swap, hydration) le navigateur peut émettre un event
  // "scroll" natif alors que l'utilisateur n'a rien touché — on ignore onScroll pendant cette
  // fenêtre pour ne pas désarmer stickToBottomRef par erreur.
  const settlingRef = useRef(true);
  // Réinitialiser à chaque nouveau chargement (retour sur la page en PWA)
  useEffect(() => {
    if (loading) { initialScrollDone.current = false; stickToBottomRef.current = true; settlingRef.current = true; knownIdsRef.current = null; firstUnreadComputedRef.current = false; setFirstUnreadId(null); setContentReady(false); suppressAutoReadRef.current = true; }
  }, [loading]);
  // Le reset ci-dessus ne se déclenche qu'au tout premier chargement (loading passe à true
  // une seule fois par montage du composant) — si l'app PWA n'est jamais complètement fermée
  // (mise en arrière-plan puis réouverte), `loading` reste `false` pour toujours et
  // firstUnreadComputedRef.current reste bloqué à `true` depuis la première ouverture : le
  // calcul du premier non-lu ne se refait jamais, même en revenant des heures plus tard avec
  // plein de nouveaux messages (constaté : le séparateur "Nouveaux messages" n'apparaît jamais
  // dans ce scénario). On refait donc le même reset sur un retour au premier plan après une
  // absence significative (seuil de 5s pour ignorer les micro-blur/focus, ex: notification
  // rapide, changement d'app puis retour immédiat).
  const hiddenAtRef = useRef<number | null>(null);
  // Compteur incrémenté à CHAQUE reset (pas un booléen/valeur qui peut retomber sur elle-même) —
  // ajouté aux dépendances du useLayoutEffect juste en dessous pour GARANTIR sa ré-exécution.
  // Bug corrigé : setFirstUnreadId(null) seul ne redéclenche l'effet que si firstUnreadId était
  // déjà non-null — s'il était déjà null (cas fréquent : pas de non-lu à l'ouverture), React
  // bail-out (Object.is égal) et ne re-render pas, donc l'effet ne se redéclenche JAMAIS, donc
  // contentReady reste bloqué à false pour toujours → container en visibility:hidden en
  // permanence → scroll tactile bloqué par le navigateur sur un élément invisible (constaté :
  // plus aucun scroll possible après un simple changement d'onglet/verrouillage, PC ET mobile,
  // y compris après seulement 1-2 minutes) + boucle rAF de stabilisation jamais désarmée.
  const [resetTick, setResetTick] = useState(0);
  useEffect(() => {
    const handleBackgroundReturn = () => {
      if (document.visibilityState === 'hidden') { hiddenAtRef.current = Date.now(); return; }
      // visible
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
  // peigne le DOM. Avec useEffect, un premier paint pouvait survenir avec scrollTop:0 (haut
  // de la conversation) avant que le scroll ne soit corrigé — flash intermittent constaté en
  // usage réel malgré le masquage visibility (le masquage lui-même n'était appliqué qu'au
  // paint SUIVANT ce premier paint fautif). useLayoutEffect élimine la fenêtre elle-même.
  useLayoutEffect(() => {
    if (loading) return;
    const container = chatZoneRef.current;
    if (!container) return;
    if (!knownIdsRef.current) knownIdsRef.current = new Set(messages.map(m => m.id));
    else messages.forEach(m => knownIdsRef.current!.add(m.id));
    if (!firstUnreadComputedRef.current) {
      // On calcule le premier non-lu et on attend le re-render suivant (le séparateur
      // "Nouveaux messages" doit être monté dans le DOM avant qu'on puisse scroller dessus).
      // Toujours synchrone : setFirstUnreadId déclenche un re-render + ce même
      // useLayoutEffect avant le prochain paint, donc pas de fenêtre de flash entre les deux.
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
      logChatScroll('initial scroll', { firstUnreadId, landedOnUnread: !!target, scrollHeight: container.scrollHeight, scrollTop: container.scrollTop, clientHeight: container.clientHeight, gap: container.scrollHeight - container.scrollTop - container.clientHeight });
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
      // dé-corrélé du cycle de vie de CE useLayoutEffect (voir plus bas).
    } else if (stickToBottomRef.current) {
      const gapBefore = container.scrollHeight - container.scrollTop - container.clientHeight;
      logChatScroll('new message → stick scroll', { messageCount: messages.length, gapBefore });
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      logChatScroll('new message, NOT sticking (user scrolled up)', { messageCount: messages.length });
    }
  }, [messages, coachTyping, loading, firstUnreadId, clientId, userId, resetTick]);

  // Timer de fin de fenêtre de stabilisation — posé UNE SEULE FOIS quand contentReady passe à
  // true, indépendant des re-déclenchements de l'effet de scroll ci-dessus (voir commentaire
  // détaillé plus haut sur le bug corrigé : app figée après un 2e message dans les 2.5s).
  useEffect(() => {
    if (!settlingRef.current) return;
    const t = setTimeout(() => { settlingRef.current = false; }, 2500);
    return () => clearTimeout(t);
  }, [contentReady]);

  // Boucle rAF active en continu pendant toute la fenêtre de stabilisation (settlingRef,
  // 2.5s) — ne dépend d'AUCUN événement navigateur (ResizeObserver, onScroll, visualViewport).
  // Un seul scrollTo() par notification ResizeObserver s'est révélé insuffisant en pratique
  // (constaté : écart de plusieurs messages malgré des logs indiquant gap:0 juste avant — le
  // contenu continue de grandir entre deux notifications regroupées par le navigateur). Cette
  // boucle vérifie et corrige à CHAQUE frame tant qu'on est en phase de stabilisation, ancré
  // en bas OU ancré sur le divider "Nouveaux messages" (cas landedOnUnread), donc aucune
  // fenêtre de croissance non détectée n'est possible dans les deux cas.
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
  // ResizeObserver reste le filet de sécurité classique — moins critique une fois le layout
  // initial stabilisé, une seule correction par notification suffit à ce stade.
  useEffect(() => {
    const container = chatZoneRef.current;
    if (!container || loading) return;
    const ro = new ResizeObserver(() => {
      const c = chatZoneRef.current;
      if (!c || !stickToBottomRef.current) return;
      const gap = c.scrollHeight - c.scrollTop - c.clientHeight;
      if (gap > 0) {
        logChatScroll('ResizeObserver fired (post-settling)', { gapBefore: gap });
        c.scrollTo({ top: c.scrollHeight, behavior: 'instant' as ScrollBehavior });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [loading]);

  // Le shell mobile (voir useViewportShellHeight) recalcule sa hauteur via visualViewport
  // APRÈS le premier paint — la barre d'adresse finit de se replier un instant après le
  // scroll initial du chat, ce qui réduit .chat-messages-zone après coup et donne
  // l'impression que la conversation "remonte" juste après être arrivée en bas. Ce resize
  // n'est jamais un geste utilisateur : on force le rescroll bas sans passer par settlingRef.
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
      logChatScroll('visualViewport resize', { vvHeight: vv!.height });
      // Le resize peut continuer sur quelques frames (clavier/barre d'adresse qui finit son
      // animation) — on corrige en continu pendant 500ms au lieu d'une seule fois.
      stopAt = Date.now() + 500;
      if (rafId === null) rafId = requestAnimationFrame(tick);
    };
    vv.addEventListener('resize', onViewportResize);
    return () => { vv.removeEventListener('resize', onViewportResize); if (rafId !== null) cancelAnimationFrame(rafId); };
  }, [loading]);

  // ── Envoi texte ────────────────────────────────────────────────────────────
  async function sendMessage(text: string) {
    if (!text.trim() || !clientId || !userId) return;
    setInput('');
    const replyId = replyingTo?.id ?? null;
    const optimisticId = `opt-text-${Date.now()}`;
    const optimistic: Msg = {
      id: optimisticId, client_id: clientId, sender_id: userId,
      text: text.trim(), created_at: new Date().toISOString(), type: 'text', reply_to_id: replyId,
    };
    setMessages(prev => [...prev, optimistic]);
    setReplyingTo(null);
    const { data } = await supabase.from('messages').insert({
      client_id: clientId, sender_id: userId, text: text.trim(), type: 'text', reply_to_id: replyId,
    }).select('id, text, sender_id, created_at, type, audio_url, duration_s, read_at, listened_at, edited_at, caption, reply_to_id, reaction_emoji, reaction_by, file_size_bytes, page_count, thumbnail_url').single();
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
    return !!userId && msg.sender_id === userId && Date.now() - new Date(msg.created_at).getTime() < EDIT_WINDOW_MS;
  }
  function canDeleteMsg(msg: Msg) {
    return !!userId && msg.sender_id === userId && Date.now() - new Date(msg.created_at).getTime() < DELETE_WINDOW_MS;
  }

  // Ouverture du menu contextuel (clic droit / long-press / flèche hover / clic sur
  // un badge de réaction). Calcule le lift nécessaire pour que le menu reste
  // TOUJOURS en dessous du message (jamais au-dessus) — voir docs/architecture-messagerie.md.
  function openMenu(bubbleEl: HTMLDivElement, msg: Msg, opts: { menuOnly?: boolean } = {}) {
    const isMe = !!userId && msg.sender_id === userId;
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

  // ── Envoi vocal ────────────────────────────────────────────────────────────
  async function sendAudioMessage(blob: Blob, durationS: number) {
    const clientId = clientIdRef.current;
    const userId = userIdRef.current;
    if (!clientId || !userId) return;
    const replyId = replyingTo?.id ?? null;
    setReplyingTo(null);
    const optimisticId = `opt-audio-${Date.now()}`;
    const localUrl = URL.createObjectURL(blob);
    const optimistic: Msg = {
      id: optimisticId, client_id: clientId, sender_id: userId,
      text: '', created_at: new Date().toISOString(), type: 'audio',
      audio_url: localUrl, duration_s: durationS, reply_to_id: replyId,
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
        type: 'audio', audio_url: urlData.publicUrl, duration_s: Math.round(durationS), reply_to_id: replyId,
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
  async function sendFile(file: File, caption?: string) {
    if (!clientId || !userId) return;
    const isImage = file.type.startsWith('image/');
    const type: 'image' | 'document' = isImage ? 'image' : 'document';
    const maxSize = isImage ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > maxSize) return;
    setIsSendingFile(true);
    const replyId = replyingTo?.id ?? null;
    const ext = file.name.split('.').pop() || 'bin';
    const fileName = `${clientId}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('chat-medias').upload(fileName, file, { contentType: file.type });
    if (uploadError) { setIsSendingFile(false); return; }
    const { data: urlData } = supabase.storage.from('chat-medias').getPublicUrl(fileName);
    await supabase.from('messages').insert({
      client_id: clientId, sender_id: userId, text: file.name, type, audio_url: urlData.publicUrl,
      caption: caption?.trim() || null, reply_to_id: replyId,
    });
    setIsSendingFile(false);
    setReplyingTo(null);
    setFileCaption('');
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

  // Lookup O(1) pour l'affichage des citations (§13) — construite une fois par changement
  // de `messages`, évite un .find() O(n) par bulle affichée.
  const messagesById = new Map(messages.map(m => [m.id, m]));

  return (
    <AudioContext.Provider value={{ activeId: activeAudioId, setActive: setActiveAudioId }}>
      <div className="chat-shell" style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg)', position: 'relative' }}>

        {/* ── Header ── */}
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
          background: 'var(--surface)',
        }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Avatar initials={coachInitials} avatarUrl={coachAvatarUrl} size={40} />
            {/* Point de présence */}
            <div style={{
              position: 'absolute', bottom: 1, right: 1,
              width: 9, height: 9, borderRadius: '50%',
              background: isCoachOnline ? 'var(--green)' : 'var(--faint)',
              border: '2px solid var(--surface)',
              transition: 'background 0.4s ease',
            }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
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
        <div ref={chatZoneRef} onScroll={handleChatScroll}
          onTouchStart={handleUserGestureStart} onMouseDown={handleUserGestureStart} onWheel={handleUserGestureStart}
          className="chat-messages-zone" style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 2,
          WebkitOverflowScrolling: 'touch',
          // Masqué (mais toujours mesurable pour scrollHeight) tant que le scroll initial
          // n'est pas posé — évite le flash "tout en haut" avant correction de la position.
          visibility: (!loading && messages.length > 0 && !contentReady) ? 'hidden' : 'visible',
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
                      onOpenCtxMenu={(bubbleEl, m, opts) => openMenu(bubbleEl, m, opts)}
                      onOpenLightbox={setLightboxUrl}
                      isMenuTarget={ctxMenu?.msgId === msg.id}
                      liftPx={ctxMenu?.msgId === msg.id ? ctxMenu.lift : 0}
                      onEnterViewport={markMessageRead}
                      onListened={markMessageListened}
                      quotedMsg={msg.reply_to_id ? messagesById.get(msg.reply_to_id) : undefined}
                      onQuoteClick={scrollToMessage}
                      coachName={coachName}
                      coachAvatarUrl={coachAvatarUrl}
                      coachInitials={coachInitials}
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

          {/* Indicateur de frappe — pas de msg-bubble-in ici : ce conteneur reste monté en
              continu tant que coachTyping est true (ne se démonte qu'à l'extinction), l'animation
              d'entrée n'a donc pas lieu d'être et pouvait, sur certains navigateurs mobiles,
              interagir avec l'animation infinie des points et donner une impression de
              clignotement au lieu d'un mouvement continu des 3 points. */}
          {coachTyping && (
            <div style={{ marginTop: 8 }}>
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
                {replyingTo.sender_id === userId ? 'Toi' : coachName}
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
                // Broadcast typing throttlé — drop si canal pas encore SUBSCRIBED.
                // Intervalle d'émission (2s) nettement inférieur au timeout d'extinction côté
                // récepteur (4s, voir plus bas) pour absorber la latence réseau variable — sur
                // mobile en particulier, un ancien réglage à 2.5s/3s laissait une marge trop
                // fine et l'indicateur "en train d'écrire" clignotait (s'éteignait puis se
                // rallumait) dès que la latence dépassait ~500ms.
                if (presenceChRef.current && isSubscribedRef.current) {
                  const now = Date.now();
                  if (now - lastTypingSentRef.current > 2000) {
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
              <button type="button" onClick={startRecording} className="tap-scale" style={{
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
              <button className="btn-primary tap-scale" onClick={() => sendMessage(input)} type="button" style={{
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
              // Remesure au clic (pas ctxMenu.rect figé au long-press) — la page
              // a pu scroller ou recevoir de nouveaux messages entre l'ouverture
              // du menu et ce clic. Mesurer AVANT de passer isEditing=true : une
              // fois isEditing vrai, le contenu texte de la bulle est vidé (rendu
              // null) et son rect s'effondre à la taille du padding seul.
              const el = bubbleRefsMap.current.get(msg.id);
              const measured = el ? el.getBoundingClientRect() : ctxMenu.rect;
              setEditRect(measured);
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
