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
import { logAudio } from '@/lib/audioDebug';
import fixWebmDuration from 'fix-webm-duration';
import { useGlobalClientPresence } from '@/lib/GlobalPresenceContext';
import { useUser } from '@/lib/UserContext';
import { compressImageIfNeeded } from '@/lib/compressImage';
import { buildMenuItems, renderMenuItem, ReactionBar, ReactionDetail, MENU_ITEM_HEIGHT, REACTION_BAR_HEIGHT, REACTION_BAR_WIDTH, REACTION_DETAIL_HEIGHT, REACTION_DETAIL_WIDTH, MENU_GAP, MENU_SCREEN_MARGIN, CTX_MENU_WIDTH } from '@/components/pages/shared/MessageMenuParts';

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
  // Le hack WebKit (voir onLoaded) pose volontairement el.currentTime = 1e10 pour forcer un
  // recalcul de durée sur les mp4 fragmentés — si ce recalcul échoue, cette valeur peut fuiter
  // jusqu'ici (constaté : "166666666:40" affiché). Toute durée >= 1e6s (~11 jours, aucun vocal
  // légitime) est traitée comme invalide plutôt que d'être affichée telle quelle.
  const safe = Number.isFinite(s) && s < 1e6 ? s : 0;
  const min = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function getFileExt(name: string) {
  return (name.split('.').pop() || '').toUpperCase();
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// Waveform statique — compacte, aspect "onde vocale" sans prendre trop de place dans la bulle
const WAVEFORM = [4,9,15,20,12,18,8,22,14,6,17,10,19,13,5,8,16,11,21,7,14,9,18,12,4,15,10,20,6,13];

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
  const [playError, setPlayError] = useState(false);
  const playing = activeId === id;
  // Position de lecture persistée (localStorage) — survit au changement de page ET au refresh
  // complet, contrairement à un simple state/ref React qui se réinitialise au démontage.
  const positionKey = `audio-pos-${id}`;
  // Marquage "écouté" — comme WhatsApp : play réellement enclenché suffit (pas besoin
  // d'aller jusqu'au bout), avec une petite garde anti-clic-accidentel. Le seuil est le MIN
  // entre 1.5s et la durée totale — sinon un vocal de 1-2s n'atteindrait jamais 1.5s de
  // lecture continue et ne serait jamais marqué écouté.
  const listenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pendant un drag du curseur, la lecture continue en arrière-plan produit ses propres
  // `timeupdate` naturels qui entrent en concurrence avec les `seekTo` du drag pour piloter
  // `progress` — le curseur tremble/recule au lieu de suivre le doigt. On ignore ces
  // `timeupdate` naturels tant que le drag est actif (voir onTimeUpdate plus bas).
  const isDraggingRef = useRef(false);
  // Promesse de `el.play()` en vol — le navigateur rejette un `play()` interrompu par un
  // `pause()` concurrent (AbortError) et peut laisser le player dans un état bâtard où le
  // prochain clic play ne fait plus rien (constaté en usage réel : lecture qui se coupe
  // toute seule juste après le clic, puis play qui ne redémarre plus). On attend que la
  // promesse se résolve avant de laisser l'effect ci-dessous appeler pause().
  const pendingPlayRef = useRef<Promise<void> | null>(null);

  // Pause quand un autre player devient actif
  useEffect(() => {
    const el = audioRef.current;
    if (!el || playing) return;
    const doPause = () => { if (!el.paused) el.pause(); };
    if (pendingPlayRef.current) pendingPlayRef.current.then(doPause, doPause);
    else doPause();
  }, [playing]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTimeUpdate = () => {
      if (isDraggingRef.current) return; // le drag pilote seul `progress`, voir seekTo/handlePointerDown
      const dur = (Number.isFinite(el.duration) && el.duration > 0) ? el.duration : (currentDuration || 1);
      setProgress((el.currentTime / dur) * 100);
      try { localStorage.setItem(positionKey, String(el.currentTime)); } catch {}
    };
    const onEnded = () => {
      setActive(null);
      setProgress(0);
      try { localStorage.removeItem(positionKey); } catch {}
    };
    const onLoaded = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setCurrentDuration(el.duration);
      } else {
        // Bug WebKit connu (bugs.webkit.org #216832) : les vocaux enregistrés sur iOS
        // Safari via MediaRecorder produisent un mp4 fragmenté sans durée dans les
        // métadonnées (mvhd/tkhd/mdhd à 0) — el.duration reste 0/NaN/Infinity même une
        // fois le média chargé. Patch standard : forcer un seek loin dans le "futur"
        // déclenche le recalcul interne de la durée réelle par le moteur, captée via
        // l'event durationchange, puis on revient à 0 pour ne pas perturber la lecture.
        logAudio('duration-fix:trigger', { id, duration: el.duration, readyState: el.readyState });
        const onDurationChange = () => {
          if (Number.isFinite(el.duration) && el.duration > 0 && el.duration < 1e9) {
            logAudio('duration-fix:recovered', { id, duration: el.duration });
            setCurrentDuration(el.duration);
            el.currentTime = 0;
            el.removeEventListener('durationchange', onDurationChange);
          }
        };
        el.addEventListener('durationchange', onDurationChange);
        try { el.currentTime = 1e10; } catch {}
      }
      try {
        const saved = parseFloat(localStorage.getItem(positionKey) || '');
        if (!isNaN(saved) && saved > 0 && Number.isFinite(el.duration) && saved < el.duration) {
          el.currentTime = saved;
          setProgress((saved / el.duration) * 100);
        }
      } catch {}
    };
    const onPlay = () => {
      logAudio('event:play', { id, readyState: el.readyState, duration: el.duration, currentTime: el.currentTime });
      if (listened || !onListened) return;
      const dur = el.duration || currentDuration || 0;
      const threshold = dur > 0 ? Math.min(1500, dur * 1000) : 1500;
      if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
      listenTimerRef.current = setTimeout(() => onListened(id), threshold);
    };
    const onPause = () => {
      logAudio('event:pause', { id, readyState: el.readyState, currentTime: el.currentTime, ended: el.ended });
      if (listenTimerRef.current) { clearTimeout(listenTimerRef.current); listenTimerRef.current = null; }
      try { localStorage.setItem(positionKey, String(el.currentTime)); } catch {}
    };
    const onError = () => logAudio('event:error', { id, error: el.error ? { code: el.error.code, message: el.error.message } : null });
    const onStalled = () => logAudio('event:stalled', { id, readyState: el.readyState });
    const onSuspend = () => logAudio('event:suspend', { id, readyState: el.readyState });
    const onWaiting = () => logAudio('event:waiting', { id, readyState: el.readyState });
    const onCanPlay = () => logAudio('event:canplay', { id, readyState: el.readyState });
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('ended', onEnded);
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('error', onError);
    el.addEventListener('stalled', onStalled);
    el.addEventListener('suspend', onSuspend);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('canplay', onCanPlay);
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('error', onError);
      el.removeEventListener('stalled', onStalled);
      el.removeEventListener('suspend', onSuspend);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('canplay', onCanPlay);
      if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
    };
  }, [currentDuration, setActive, listened, onListened, id]);

  const togglePlay = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    logAudio('togglePlay:click', { id, playing, readyState: el.readyState, paused: el.paused, networkState: el.networkState });
    if (playing) {
      el.pause();
      setActive(null);
    } else {
      setActive(id);
      setPlayError(false);
      try {
        const p = el.play();
        pendingPlayRef.current = p;
        await p;
        logAudio('togglePlay:play-resolved', { id });
      } catch (err) {
        logAudio('togglePlay:play-rejected', { id, err: err instanceof Error ? err.message : String(err) });
        setActive(null);
        // Échec silencieux avant ce fix : l'icône play revenait sans aucun signal, l'utilisateur
        // reclique sans comprendre pourquoi rien ne se passe. Affiche un état d'erreur temporaire
        // sur le bouton (icône warning ~2s) — signal clair que CE clic précis a échoué (fichier
        // corrompu/codec non supporté/réseau, cause exacte dans les logs via "Logs vocaux").
        setPlayError(true);
        setTimeout(() => setPlayError(false), 2000);
      } finally {
        pendingPlayRef.current = null;
      }
    }
  }, [playing, id, setActive]);

  // Seek au clic ET glisser (souris + tactile unifiés via Pointer Events) — le curseur
  // suit le doigt/la souris en continu tant que le bouton est maintenu, pas seulement
  // au clic initial. setPointerCapture garantit que les événements pointermove
  // continuent d'arriver même si le curseur sort de la waveform pendant le drag.
  // `applySeek=false` pendant un drag actif : ne met à jour QUE le visuel (`progress`),
  // sans toucher à `el.currentTime` à chaque pointermove. Assigner `currentTime` déclenche un
  // vrai seek sur le média (recherche du bon fragment/décodage) — sur mobile ou un fichier pas
  // entièrement bufferisé (`preload="metadata"`), ça peut prendre plusieurs dizaines à
  // centaines de ms. Empiler un seek à chaque pointermove fait traîner l'audio derrière le
  // doigt (constaté en usage réel : latence/imprécision du curseur pendant un drag en lecture,
  // absente en pause car aucun seek concurrent n'était en vol). Le curseur reste ainsi
  // toujours parfaitement synchrone avec le doigt ; le seek réel n'est posé qu'au relâchement
  // (voir onUp dans handlePointerDown).
  const seekTo = useCallback((clientX: number, rect: DOMRect, applySeek = true) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (applySeek) el.currentTime = ratio * el.duration;
    setProgress(ratio * 100);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const rect = target.getBoundingClientRect();
    const el = audioRef.current;
    // isDraggingRef doit être armé AVANT tout pause()/seekTo — sinon un `timeupdate` déjà en
    // file d'attente au moment du pointerdown peut encore s'exécuter juste après (event déjà
    // mis en queue par le navigateur avant qu'on intervienne) et écraser transitoirement
    // `progress` avec l'ancienne position de lecture, donnant un micro-jitter du curseur/de
    // la waveform pendant le tout début du drag en lecture (constaté en usage réel).
    isDraggingRef.current = true;
    // Pause pendant le drag — sinon la lecture continue en arrière-plan et ses `timeupdate`
    // naturels concurrencent ceux du drag. Reprend au relâchement si la lecture était en cours.
    const wasPlaying = !!el && !el.paused;
    if (wasPlaying) el?.pause();
    // Seek réel appliqué une seule fois (au premier down) — le reste du geste ne fait bouger
    // que le visuel, voir seekTo.
    seekTo(e.clientX, rect, true);
    const onMove = (ev: PointerEvent) => seekTo(ev.clientX, rect, false);
    const onUp = (ev: PointerEvent) => {
      isDraggingRef.current = false;
      // Pose le seek réel une seule fois, à la position finale du doigt — évite d'empiler un
      // vrai seek média à chaque pointermove (voir commentaire sur seekTo).
      seekTo(ev.clientX, rect, true);
      if (wasPlaying) el?.play().catch(() => {});
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }, [seekTo]);

  const trackBg = isMe ? 'rgba(255,255,255,0.2)' : 'var(--border)';
  const fillColor = isMe ? 'rgba(255,255,255,0.9)' : 'var(--accent-brand)';
  const mutedColor = isMe ? 'rgba(255,255,255,0.5)' : 'var(--muted)';

  // Calcule l'index de la barre de progression dans la waveform
  const progressIdx = Math.round((progress / 100) * (WAVEFORM.length - 1));

  return (
    <div style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'flex-start', gap: 10, width: 300, maxWidth: '100%' }}>
      <audio ref={audioRef} src={url} preload="metadata" />

      {/* Avatar (rappel écouté/non écouté) + bouton play/pause séparé, comme WhatsApp */}
      <div className="audio-avatar-col" style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar initials={initials} avatarUrl={avatarUrl} size={42} />
        {/* Icône micro — overlay discret sur l'avatar, signale "ceci est un vocal" (WhatsApp). */}
        <span style={{
          position: 'absolute', bottom: -1, right: -1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.6))',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="2" width="6" height="12" rx="3" fill="#fff" stroke="none"/>
            <path d="M5 11a7 7 0 0014 0M12 18v3"/>
          </svg>
        </span>
        {/* Pastille "non écouté" — rappel visuel personnel sur les vocaux REÇUS pas encore
            écoutés (disparaît une fois le vocal réellement lancé, voir onPlay plus haut).
            Distinct des coches MessageStatus, qui informent l'EXPÉDITEUR si le destinataire
            a écouté SES propres vocaux envoyés. */}
        {onListened && !listened && (
          <span style={{
            position: 'absolute', top: -1, right: -1, width: 11, height: 11,
            borderRadius: '50%', background: 'var(--red)', border: '2px solid var(--surface)',
          }} />
        )}
      </div>
      <button onClick={togglePlay} className="tap-scale audio-play-btn" title={playError ? 'Impossible de lire ce vocal' : undefined} style={{
        borderRadius: '50%', border: 'none', flexShrink: 0,
        background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }}>
        {playError ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.29 3.86l-8.18 14.14A2 2 0 004.02 21h15.96a2 2 0 001.91-2.99L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
        ) : playing ? (
          <svg viewBox="0 0 24 24" fill={isMe ? '#fff' : 'var(--accent-brand)'}>
            <rect x="6" y="4" width="4" height="16" rx="1"/>
            <rect x="14" y="4" width="4" height="16" rx="1"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill={isMe ? '#fff' : 'var(--accent-brand)'} style={{ marginLeft: 1 }}>
            <polygon points="6 3 20 12 6 21 6 3"/>
          </svg>
        )}
      </button>

      <div className="audio-wave-col" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Waveform + curseur, étirée pour remplir l'espace disponible (comme WhatsApp) */}
        <div
          onPointerDown={handlePointerDown}
          style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 24, cursor: 'pointer', touchAction: 'none' }}
        >
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {WAVEFORM.map((h, i) => (
              <div
                key={i}
                style={{
                  width: 3, flexShrink: 0, height: Math.max(3, Math.round((h / 22) * 22)), borderRadius: 2,
                  background: i <= progressIdx && progress > 0 ? fillColor : trackBg,
                  transition: 'background 0.1s',
                }}
              />
            ))}
          </div>
          {progress > 0 && (
            <div style={{
              position: 'absolute', top: '50%', left: `${progress}%`, width: 14, height: 14, borderRadius: '50%',
              background: 'var(--accent-brand)', transform: 'translate(-50%, -50%)', boxShadow: '0 1px 4px rgba(0,0,0,.4)',
              transition: playing ? 'left 0.1s linear' : 'none', pointerEvents: 'none',
            }} />
          )}
        </div>

        {/* Durée — affiche la position de lecture uniquement pendant une lecture active et
            plausible (bornée par currentDuration) ; sinon la durée totale connue. Avant, la
            condition était juste `progress > 0` (restait vraie après un seek ou en pause après
            un drag) et affichait audioRef.current.currentTime sans aucune vérification — d'où
            des durées corrompues fuitées par le hack WebKit ci-dessus (voir formatDuration). */}
        <span style={{ fontSize: 12, color: mutedColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1, whiteSpace: 'nowrap' }}>
          {playing && audioRef.current && audioRef.current.currentTime < 1e6
            ? formatDuration(audioRef.current.currentTime)
            : formatDuration(currentDuration)}
        </span>
      </div>
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
        <path d="M1 5.5l4 4L14 1.5" stroke="#6aa0c4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }

  if (isRead) {
    // Deux coches pleines accent-brand = lu
    return (
      <svg width="20" height="11" viewBox="0 0 20 11" fill="none" style={{ flexShrink: 0 }}>
        <path d="M1 5.5l4 4L13 1.5" stroke="#6aa0c4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M6 5.5l4 4L18 1.5" stroke="#6aa0c4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }

  // Deux coches accent-brand semi-transparentes = envoyé
  return (
    <svg width="20" height="11" viewBox="0 0 20 11" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
      <path d="M1 5.5l4 4L13 1.5" stroke="#6aa0c4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 5.5l4 4L18 1.5" stroke="#6aa0c4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
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

function MessageContextMenu({ rect, bubbleHtml, isMe, isTextMessage, canEdit, canDelete, menuOnly, reactionDetail, reactorAvatarUrl, reactorInitials, reactorName, reactionEmoji, onReactionRemove, onReply, onCopy, onEdit, onDelete, onReact, onClose }: {
  rect: DOMRect; bubbleHtml: string; isMe: boolean; isTextMessage: boolean; canEdit: boolean; canDelete: boolean; menuOnly: boolean;
  reactionDetail?: boolean; reactorAvatarUrl?: string | null; reactorInitials?: string; reactorName?: string;
  reactionEmoji?: string | null; onReactionRemove?: () => void;
  onReply: () => void; onCopy: () => void; onEdit: () => void; onDelete: () => void; onReact: (emoji: string) => void; onClose: () => void;
}) {
  if (typeof document === 'undefined') return null;
  const items = buildMenuItems(isMe, isTextMessage, canEdit, canDelete);
  // Le panneau de détail de réaction (avatar + "Cliquez pour supprimer") remplace la
  // barre d'emojis + la liste d'actions quand on clique sur un badge existant — même
  // calcul de position que le menu normal, pour ne plus dupliquer (et mal reproduire)
  // la logique de lift/clamp dans un système séparé.
  const belowHeight = reactionDetail
    ? REACTION_DETAIL_HEIGHT
    : (menuOnly ? 0 : items.length * MENU_ITEM_HEIGHT) + REACTION_BAR_HEIGHT + MENU_GAP;
  const top = Math.min(rect.bottom + MENU_GAP, window.innerHeight - belowHeight - MENU_SCREEN_MARGIN);
  const reactionBarTop = Math.max(MENU_SCREEN_MARGIN, rect.top - REACTION_BAR_HEIGHT - MENU_GAP);
  const left = Math.min(Math.max(rect.right - CTX_MENU_WIDTH, 8), window.innerWidth - CTX_MENU_WIDTH - 8);
  const reactionBarLeft = Math.min(Math.max(rect.right - REACTION_BAR_WIDTH, 8), window.innerWidth - REACTION_BAR_WIDTH - 8);
  const detailLeft = Math.min(Math.max(rect.right - REACTION_DETAIL_WIDTH, MENU_SCREEN_MARGIN / 2), window.innerWidth - REACTION_DETAIL_WIDTH - MENU_SCREEN_MARGIN / 2);
  // Le clone HTML peut avoir capturé le bouton chevron hover si la souris survolait la
  // bulle au moment du clic (isMenuTarget devient vrai seulement après ce commit React,
  // donc pas encore reflété dans l'outerHTML figé) — on le retire avant l'injection pour
  // que le clone affiche le message "tel quel", jamais avec un contrôle d'interface dessus.
  const cleanBubbleHtml = (() => {
    if (typeof document === 'undefined') return bubbleHtml;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = bubbleHtml;
    wrapper.querySelector('.msg-hover-arrow')?.remove();
    return wrapper.innerHTML;
  })();
  return createPortal(
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', animation: 'fadeIn 120ms ease-out' }}
        onMouseDown={onClose}
        onTouchEnd={e => { e.preventDefault(); onClose(); }}
      />
      {/* Clone visuel de la bulle réelle — l'original vit dans un conteneur overflow:auto
          (scroll des messages) qui le clippe toujours, peu importe le z-index. On affiche
          donc une copie hors de ce conteneur, positionnée pile à l'écran là où l'original
          apparaît, pendant que l'original est masqué (visibility:hidden, voir isMenuTarget). */}
      <div
        style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.height, zIndex: 10000, pointerEvents: 'none' }}
        dangerouslySetInnerHTML={{ __html: cleanBubbleHtml }}
      />
      {reactionDetail && reactionEmoji ? (
        <ReactionDetail
          top={top} left={detailLeft}
          avatarUrl={reactorAvatarUrl} initials={reactorInitials || '?'} name={reactorName || ''}
          emoji={reactionEmoji}
          onRemove={onReactionRemove ? () => { onReactionRemove(); onClose(); } : undefined}
        />
      ) : (
        <>
          <ReactionBar top={reactionBarTop} left={reactionBarLeft} isMe={isMe} onReact={emoji => { onReact(emoji); onClose(); }} />
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
        </>
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

function MessageBubble({ msg, userId, isContinued, isLast, isEditing, editRect, editText, setEditText, onStartEdit, onCancelEdit, onSaveEdit, canEdit, canDelete, onOpenCtxMenu, onOpenLightbox, onDoubleTapReact, isMenuTarget, liftPx, onEnterViewport, registerBubbleRef, animate, onListened, quotedMsg, onQuoteClick, coachName, coachAvatarUrl, coachInitials, myAvatarUrl, myInitials }: {
  msg: Msg; userId: string; isContinued: boolean; isLast: boolean;
  isEditing: boolean; editRect: DOMRect | null; editText: string; setEditText: (v: string) => void;
  onStartEdit: () => void; onCancelEdit: () => void; onSaveEdit: () => void;
  canEdit: boolean; canDelete: boolean;
  onOpenCtxMenu: (bubbleEl: HTMLDivElement, msg: Msg, opts?: { menuOnly?: boolean; reactionDetail?: boolean }) => void;
  onOpenLightbox: (url: string) => void;
  onDoubleTapReact: (msg: Msg) => void;
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
  const isTextMessage = !msg.type || msg.type === 'text';
  const hasMenuItems = buildMenuItems(isMe, isTextMessage, !!canEdit, !!canDelete).length > 0;
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
  const { ref: wrapperRef } = useLongPress(() => openMenu(), canOpenMenu, 500, () => onDoubleTapReact(msg));
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
      // La classe d'animation d'entrée (msg-bubble-in/sent) pose sa PROPRE valeur de
      // transform via keyframes CSS, qui écrase systématiquement tout transform inline
      // tant qu'elle tourne — en conflit direct avec le translateY(-liftPx) du lift au
      // clic sur une réaction. Désactivée dès qu'un lift est nécessaire (liftPx > 0) :
      // à ce stade le message est déjà stable, l'animation d'entrée n'a plus lieu d'être.
      className={(animate && !liftPx) ? (isMe ? 'msg-bubble-sent' : 'msg-bubble-in') : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '78%',
        marginTop: isContinued ? 2 : 8, marginBottom: msg.reaction_emoji ? 10 : 0,
        position: 'relative', overflow: 'visible',
        transform: liftPx ? `translateY(-${liftPx}px)` : undefined,
        // Transition seulement à la remontée (liftPx > 0) — le retour au repos est
        // instantané. Sans ça, un clic juste après la fermeture d'un précédent menu
        // pouvait mesurer getBoundingClientRect() en pleine transition (position "en
        // vol", ni l'ancienne ni la nouvelle), faussant tout le calcul de position du
        // panneau suivant (dérive visible verticale et horizontale sur mobile).
        transition: liftPx ? 'transform 160ms ease-out' : 'none',
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
          padding: isAudio ? '10px 12px' : isImage ? '4px' : '9px 12px',
          border: isMe ? 'none' : '1px solid var(--border)',
          boxShadow: isMe ? 'none' : 'var(--shadow-item)',
          position: 'relative',
          // Masquée pendant l'édition ET pendant que le menu contextuel est ouvert sur
          // cette bulle — un clone identique (bubbleHtml) est affiché en portail à sa
          // place exacte, hors du conteneur scrollable qui clipperait sinon tout z-index.
          visibility: (isEditing || isMenuTarget) ? 'hidden' : 'visible',
        }}>
        {hovered && !isEditing && !isMenuTarget && hasMenuItems && (
          <button
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); openMenu(); }}
            className="msg-hover-arrow tap-scale"
            style={{
              position: 'absolute', top: 4, right: 6,
              width: 28, height: 28, borderRadius: '50%', border: 'none',
              background: isImage
                ? 'radial-gradient(circle, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.15) 70%, transparent 100%)'
                : (isMe ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.06)'),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', zIndex: 5,
            } as React.CSSProperties}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isImage ? '#fff' : (isMe ? '#fff' : 'var(--ink)')} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
        {msg.reaction_emoji && (
          <div
            onClick={() => onOpenCtxMenu(bubbleRef.current!, msg, { menuOnly: true, reactionDetail: true })}
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
              display: 'flex', flexDirection: 'column', gap: 2,
              background: isMe ? 'rgba(255,255,255,0.14)' : 'var(--surface-2)',
              borderLeft: `3px solid ${isMe ? '#fff' : 'var(--green)'}`,
              borderRadius: 6, padding: '6px 8px', marginBottom: 6,
              marginLeft: isImage ? 4 : 0, marginRight: isImage ? 4 : 0, marginTop: isImage ? 4 : 0,
              cursor: quotedMsg ? 'pointer' : 'default',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: isMe ? '#fff' : 'var(--green)' }}>
              {quotedMsg ? (quotedMsg.sender_id === userId ? 'Toi' : coachName) : ''}
            </div>
            <div style={{
              fontSize: 12.5, color: isMe ? 'rgba(255,255,255,0.9)' : 'var(--ink)',
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
          <div style={{ maxWidth: 260 }}>
            <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', cursor: 'pointer' }}
              onClick={() => onOpenLightbox(msg.audio_url!)}
            >
              <img
                src={msg.thumbnail_url || msg.audio_url} alt=""
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
              <div style={{ fontSize: 15, lineHeight: 1.4, color: isMe ? '#fff' : 'var(--ink)', padding: '8px 4px 2px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {msg.caption}
              </div>
            )}
          </div>
        ) : isDocument && msg.audio_url ? (
          <>
            <div style={{ borderRadius: 10, overflow: 'hidden', minWidth: 220, maxWidth: 280, background: isMe ? 'rgba(255,255,255,0.10)' : 'var(--surface-2)' }}>
              {msg.thumbnail_url ? (
                <img src={msg.thumbnail_url} alt="" style={{ width: '100%', height: 140, objectFit: 'cover', objectPosition: 'top', display: 'block', borderBottom: '1px solid var(--border-soft)' }} />
              ) : getFileExt(msg.text || '').toLowerCase() === 'pdf' ? (
                <div style={{ background: '#fff', height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border-soft)' }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
              ) : null}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                <div style={{ width: 32, height: 32, borderRadius: 6, flexShrink: 0, background: isMe ? 'rgba(255,255,255,0.15)' : '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isMe ? 'rgba(255,255,255,0.85)' : '#dc2626'} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: isMe ? '#fff' : 'var(--ink)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {msg.text || 'Document'}
                  </div>
                  <div style={{ fontSize: 13, color: isMe ? 'rgba(255,255,255,0.55)' : 'var(--muted)', marginTop: 2 }}>
                    {msg.page_count ? `${msg.page_count} page${msg.page_count > 1 ? 's' : ''} · ` : ''}
                    {getFileExt(msg.text || '').toLowerCase()}{msg.file_size_bytes ? ` · ${formatFileSize(msg.file_size_bytes)}` : ''}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', borderTop: `1px solid ${isMe ? 'rgba(255,255,255,0.15)' : 'var(--border)'}` }}>
                <a href={msg.audio_url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textAlign: 'center', padding: '12px 0', fontSize: 15, fontWeight: 600, color: isMe ? '#fff' : 'var(--ink)', textDecoration: 'none' }}>Ouvrir</a>
                <div style={{ width: 1, background: isMe ? 'rgba(255,255,255,0.15)' : 'var(--border)' }} />
                <a href={msg.audio_url} download={msg.text || undefined} style={{ flex: 1, textAlign: 'center', padding: '12px 0', fontSize: 15, fontWeight: 600, color: isMe ? '#fff' : 'var(--ink)', textDecoration: 'none' }}>Enregistrer sous...</a>
              </div>
            </div>
            {msg.caption && (
              <div style={{ fontSize: 15, lineHeight: 1.4, color: isMe ? '#fff' : 'var(--ink)', padding: '8px 2px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {msg.caption}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 15, lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.text}</div>
        )}
        {!isEditing && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            gap: 3, marginTop: isAudio ? 4 : 6,
            width: 'fit-content', marginLeft: 'auto',
            ...(isAudio ? {} : {
              background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
              borderRadius: 6, padding: '2px 5px',
            }),
          }}>
            {msg.edited_at && (
              <span style={{ fontSize: 10, color: isAudio ? (isMe ? 'rgba(255,255,255,0.5)' : 'var(--faint)') : 'rgba(255,255,255,0.7)' }}>modifié ·</span>
            )}
            <span style={{ fontSize: 10, color: isAudio ? (isMe ? 'rgba(255,255,255,0.5)' : 'var(--muted)') : 'rgba(255,255,255,0.9)' }}>{formatTime(msg.created_at)}</span>
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
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isSendingFile, setIsSendingFile] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ rect: DOMRect; msgId: string; lift: number; menuOnly: boolean; reactionDetail: boolean; bubbleHtml: string } | null>(null);
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
      const msgs = (data as Msg[]) || [];
      setMessages(msgs);
      setLoading(false);
      // Le marquage lu se fait maintenant uniquement via onEnterViewport (IntersectionObserver
      // par bulle) — un message trop haut dans l'historique, jamais scrollé jusqu'à lui, ne
      // doit pas être marqué lu juste parce que la page est ouverte.
      await resolveMediaUrls(msgs);
    }
    load();
  }, [supabase]);

  // Résout les URLs signées pour les messages media (image/document/audio) d'un lot donné —
  // nécessaire depuis que chat-medias/voice-messages sont des buckets privés, voir
  // components/pages/coach/PageChat.tsx pour le pendant côté coach (même logique).
  const resolveMediaUrls = useCallback(async (msgs: Msg[]) => {
    const mediaIds = msgs.filter(m => m.type === 'image' || m.type === 'document' || m.type === 'audio').map(m => m.id);
    if (mediaIds.length === 0) return;
    try {
      const res = await fetch('/api/messages/media-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: mediaIds }),
      });
      if (!res.ok) return;
      const { urls } = await res.json();
      setMessages(prev => prev.map(m => {
        const resolved = urls[m.id];
        if (!resolved?.url) return m;
        return { ...m, audio_url: resolved.url, thumbnail_url: resolved.thumbnailUrl || m.thumbnail_url };
      }));
    } catch {
      // Échec silencieux — voir commentaire équivalent côté coach.
    }
  }, []);

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
        if (incoming.type === 'image' || incoming.type === 'document' || incoming.type === 'audio') {
          resolveMediaUrls([incoming]);
        }
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



  // ── Scroll : refonte column-reverse ──────────────────────────────────────────
  // La zone .chat-messages-zone est en `flex-direction: column-reverse` (voir CSS) et le
  // contenu est rendu en ordre inversé (dernier message = premier enfant DOM). Le navigateur
  // ANCRE alors nativement en bas : un contenu qui grandit après le premier paint (polices
  // web qui basculent via display:swap, images/vocaux qui chargent tard) pousse vers le haut
  // hors-champ AU LIEU de décaler la vue. Fini le bug historique du scroll qui "saute" au 1er
  // tap (prouvé : scrollHeight +1810px au chargement des polices, scrollTop figé, invisible à
  // toute instrumentation JS). Plus besoin d'aucune boucle rAF, settlingRef, ResizeObserver de
  // rattrapage, stickTo*, ni handlers de geste — tout supprimé, le navigateur fait le travail.

  // IDs déjà présents au premier chargement — ces messages ne jouent pas l'animation d'entrée
  // (sinon translateY/opacity donne l'impression d'un mouvement). Inchangé par column-reverse.
  const knownIdsRef = useRef<Set<string> | null>(null);
  // Premier message non lu (du coach) au chargement — figé une fois, sinon il disparaîtrait
  // dès que markMessageRead marque les messages lus. Sert au séparateur "Nouveaux messages"
  // et à l'atterrissage dessus (comme WhatsApp/Telegram).
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const firstUnreadComputedRef = useRef(false);
  const initialLandingDoneRef = useRef(false);
  // Masque la zone (visibility:hidden) juste le temps de poser l'atterrissage sur le divider
  // non-lus — sans non-lus, column-reverse ancre nativement en bas dès le 1er paint, donc pas
  // de flash à masquer (contentReady passe alors à true immédiatement).
  const [contentReady, setContentReady] = useState(false);

  // Recalcul du premier non-lu au chargement ET au retour d'arrière-plan (PWA jamais fermée :
  // `loading` reste false, il faut re-détecter les nouveaux non-lus arrivés pendant l'absence).
  const hiddenAtRef = useRef<number | null>(null);
  const resetLanding = useCallback(() => {
    firstUnreadComputedRef.current = false;
    initialLandingDoneRef.current = false;
    knownIdsRef.current = null;
    suppressAutoReadRef.current = true;
    setFirstUnreadId(null);
    setContentReady(false);
  }, []);
  useEffect(() => {
    if (loading) resetLanding();
  }, [loading, resetLanding]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAtRef.current = Date.now(); return; }
      const wasHiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = null;
      if (wasHiddenFor >= 5000) resetLanding();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [resetLanding]);

  // Atterrissage initial. useLayoutEffect (synchrone avant paint) : calcule firstUnread une
  // fois, puis pose la position AVANT le premier paint pour éviter tout flash.
  // - Avec non-lus : scrollIntoView(center) sur le divider (reste valide en column-reverse).
  // - Sans non-lus : rien à faire, column-reverse est déjà ancré en bas nativement.
  useLayoutEffect(() => {
    if (loading) return;
    const container = chatZoneRef.current;
    if (!container) return;
    if (!knownIdsRef.current) knownIdsRef.current = new Set(messages.map(m => m.id));
    else messages.forEach(m => knownIdsRef.current!.add(m.id));

    if (!firstUnreadComputedRef.current) {
      firstUnreadComputedRef.current = true;
      const firstUnread = messages.find(m => m.sender_id !== userId && !m.read_at);
      if (firstUnread) { setFirstUnreadId(firstUnread.id); return; } // re-render → divider monté
    }
    if (initialLandingDoneRef.current) return;
    initialLandingDoneRef.current = true;
    const divider = firstUnreadId ? document.getElementById(`unread-divider-${clientId}`) : null;
    if (divider) divider.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
    // (sans divider : column-reverse ancre déjà en bas, rien à faire)
    setContentReady(true);
    suppressAutoReadRef.current = false;
  }, [messages, loading, firstUnreadId, clientId, userId]);

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
  function openMenu(bubbleEl: HTMLDivElement, msg: Msg, opts: { menuOnly?: boolean; reactionDetail?: boolean } = {}) {
    const isMe = !!userId && msg.sender_id === userId;
    const isTextMessage = !msg.type || msg.type === 'text';
    const items = buildMenuItems(isMe, isTextMessage, canEditMsg(msg), canDeleteMsg(msg));
    if (!opts.menuOnly && items.length === 0) return;
    // Remesure via requestAnimationFrame avant de committer — le clic déclencheur (sur le
    // badge de réaction ou la flèche hover) peut lui-même provoquer un micro-reflow
    // (démontage du bouton hover, changement de visibility) entre le mousedown et le
    // moment où on mesure ; une mesure synchrone immédiate peut donc capturer une
    // position pas encore stabilisée, surtout left/x qui n'est jamais recorrigé après
    // coup (seul top l'est pour le lift) — d'où un décalage horizontal visible du clone.
    const measureWhenSettled = () => {
      const rawRect = bubbleEl.getBoundingClientRect();
      // Le panneau de détail de réaction n'affiche jamais la barre d'emojis complète —
      // utiliser REACTION_BAR_HEIGHT ici sous-évaluait la place nécessaire dans certains
      // cas et sur-évaluait dans d'autres, faisant remonter le message de travers et
      // laissant le panneau coupé en bas d'écran (hauteur réelle très différente).
      const menuHeight = opts.reactionDetail
        ? REACTION_DETAIL_HEIGHT + MENU_GAP
        : (opts.menuOnly ? 0 : items.length * MENU_ITEM_HEIGHT) + REACTION_BAR_HEIGHT + MENU_GAP;
      const spaceBelow = window.innerHeight - rawRect.bottom - MENU_SCREEN_MARGIN;
      const lift = Math.max(0, (menuHeight + MENU_GAP) - spaceBelow);
      // Le rect brut est capturé avant que le lift ne soit appliqué visuellement (transform
      // translateY sur le wrapper) — sans corriger top/bottom ici, le menu s'ancre à l'ancienne
      // position de la bulle pendant qu'elle remonte visuellement à l'écran.
      const rect = lift > 0
        ? new DOMRect(rawRect.x, rawRect.top - lift, rawRect.width, rawRect.height)
        : rawRect;
      // Clone HTML de la bulle affiché en portail au-dessus du fond flouté pendant que le
      // menu est ouvert — l'original vit dans un conteneur overflow:auto (scroll des
      // messages), qui clippe toujours ses enfants visuellement peu importe le z-index,
      // donc impossible de le faire "sortir" par-dessus l'overlay sans le dupliquer ainsi.
      setCtxMenu({ rect, msgId: msg.id, lift, menuOnly: !!opts.menuOnly, reactionDetail: !!opts.reactionDetail, bubbleHtml: bubbleEl.outerHTML });
    };
    requestAnimationFrame(measureWhenSettled);
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
        storage_bucket: 'voice-messages', storage_path: fileName,
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
    setIsSendingFile(true);
    let isImage = file.type.startsWith('image/');
    // Compression AVANT le check de taille : les photos iPhone/Android récentes dépassent
    // souvent 5 Mo, et la route API (Vercel Serverless Node.js) plafonne à 4.5 Mo — voir
    // compressImage.ts. Sans ça, sendFile() retournait silencieusement (bug : clic sur
    // "Envoyer" sans aucun feedback).
    if (isImage) {
      try { file = await compressImageIfNeeded(file); } catch { /* compression échouée — on tente l'envoi tel quel */ }
    }
    const maxSize = isImage ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > maxSize) {
      setIsSendingFile(false);
      setActionError(isImage ? 'Image trop lourde, réessaie avec une autre photo' : 'Fichier trop volumineux (max 20 Mo)');
      return;
    }
    const replyId = replyingTo?.id ?? null;
    // Upload via la route serveur (pas d'upload direct navigateur→Storage) : elle
    // génère la miniature PDF + compte les pages (pdf-to-img, Node.js uniquement)
    // et fait l'insert du message elle-même.
    const formData = new FormData();
    formData.append('file', file);
    formData.append('client_id', clientId);
    if (replyId) formData.append('reply_to_id', replyId);
    try {
      const res = await fetch('/api/messages/upload-file', { method: 'POST', body: formData });
      const json = await res.json();
      if (res.ok && json.message) {
        setMessages(prev => [...prev, json.message as Msg]);
        resolveMediaUrls([json.message as Msg]);
      } else {
        setActionError('Envoi échoué, réessaie');
      }
    } catch {
      setActionError('Envoi échoué, vérifie ta connexion');
    }
    setIsSendingFile(false);
    setReplyingTo(null);
    setPendingFile(prev => { if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl); return null; });
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
      mr.onstop = async () => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        const dur = (Date.now() - recordingStartRef.current) / 1000;
        const finalType = mimeType || 'audio/mp4';
        let blob = new Blob(audioChunksRef.current, { type: finalType });
        // MediaRecorder produit du webm sans durée valide dans les métadonnées (bug connu,
        // cf. bugzilla #1385699) — el.duration reste Infinity/NaN à la lecture selon le
        // navigateur. On répare le fichier À LA SOURCE avec la durée wall-clock déjà connue,
        // plutôt que de patcher la lecture à chaque affichage (fragile, dépend du lecteur).
        // Pas de fix équivalent praticable côté client pour mp4 fragmenté (iOS Safari) — le
        // hack de lecture existant (voir onLoad/onLoaded) reste la protection pour cette branche.
        if (blob.size > 0 && finalType.startsWith('audio/webm')) {
          try {
            const fixed = await fixWebmDuration(blob, dur * 1000, { logger: false });
            blob = fixed;
          } catch { /* fix échoué — on envoie le blob tel quel, pas pire qu'avant */ }
        }
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
  // Désarmement de l'ancrage bas (settlingRef) sur INTENTION DE SCROLL réelle uniquement.
  //
  // Piège corrigé : avant, un simple touchstart/mousedown (un TAP, sans aucun mouvement)
  // coupait settlingRef instantanément. Or pendant les premières secondes, les polices web
  // finissent de charger (display:'swap' historique → FOUT) et agrandissent le texte, donc
  // En column-reverse, "bas" = scrollTop ≈ 0 (Chrome/Firefox utilisent des valeurs négatives,
  // WebKit reste positif historiquement — Math.abs couvre les deux sans détection navigateur).
  function handleChatScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distanceFromBottom = Math.abs(el.scrollTop);
    setShowScrollArrow(distanceFromBottom > 120);
  }
  function scrollToBottom() {
    chatZoneRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
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
              background: isCoachOnline ? 'var(--accent-brand)' : 'var(--faint)',
              border: '2px solid var(--surface)',
              transition: 'background 0.4s ease',
            }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', lineHeight: 1.2 }}>{coachName}</div>
            <div style={{
              fontSize: 11, color: isCoachOnline ? 'var(--accent-brand)' : 'var(--muted)',
              marginTop: 1, transition: 'color 0.4s ease',
            }}>
              {coachTyping ? 'En train d\'écrire…' : isCoachOnline ? 'En ligne' : 'Hors ligne'}
            </div>
          </div>
          {/* Bouton activation notifications — géré par PushInit */}
          {userId && <PushInit userId={userId} />}
        </div>

        {/* ── Zone messages ── */}
        {/* column-reverse : le navigateur ancre nativement en bas, immunisé contre tout
            reflow de contenu post-paint (polices, images, vocaux qui chargent tard). Le
            JSX est donc rendu en ordre INVERSE (dernier message = premier enfant DOM) pour
            retrouver l'ordre de lecture correct à l'écran. */}
        <div ref={chatZoneRef} onScroll={handleChatScroll}
          className="chat-messages-zone" style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          padding: '16px 16px 8px', display: 'flex', flexDirection: 'column-reverse', gap: 2,
          WebkitOverflowScrolling: 'touch',
          // Masqué (mais toujours mesurable) le temps de poser l'atterrissage sur le divider
          // non-lus — sans non-lus, column-reverse ancre déjà en bas au 1er paint (pas de flash).
          visibility: (!loading && messages.length > 0 && !contentReady) ? 'hidden' : 'visible',
        } as React.CSSProperties}>
          {/* Indicateur de frappe — premier enfant DOM = visuellement en bas grâce à
              column-reverse. Pas de msg-bubble-in ici : ce conteneur reste monté en continu
              tant que coachTyping est true, l'animation d'entrée n'a donc pas lieu d'être. */}
          {coachTyping && (
            <div style={{ marginTop: 8 }}>
              <TypingIndicator />
            </div>
          )}

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
          ) : messageGroups.slice().reverse().map((group) => (
            <div key={group.dateLabel} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 3 }}>
              {group.msgs.slice().reverse().map((msg, revIdx, revArr) => {
                const msgIdx = revArr.length - 1 - revIdx;
                const prevMsg = group.msgs[msgIdx - 1];
                const isContinued = prevMsg && prevMsg.sender_id === msg.sender_id;
                const nextMsg = group.msgs[msgIdx + 1];
                const isLast = !nextMsg || nextMsg.sender_id !== msg.sender_id;
                return (
                  <Fragment key={msg.id}>
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
                      onDoubleTapReact={m => handleReact(m, '👍')}
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
                    {firstUnreadId === msg.id && (
                      <div id={`unread-divider-${clientId}`} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 6px' }}>
                        <div style={{ flex: 1, height: 1, background: 'var(--red-soft)' }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)', background: 'var(--red-soft)', padding: '3px 10px', borderRadius: 20 }}>
                          Nouveaux messages
                        </span>
                        <div style={{ flex: 1, height: 1, background: 'var(--red-soft)' }} />
                      </div>
                    )}
                  </Fragment>
                );
              })}

              {/* Séparateur date — dernier enfant DOM du groupe = visuellement au-dessus
                  grâce à column-reverse (reste au-dessus du groupe comme avant). */}
              <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 6px' }}>
                <span style={{
                  fontSize: 11, color: 'var(--muted)',
                  background: 'var(--surface-2)', padding: '3px 10px',
                  borderRadius: 20, border: '1px solid var(--border-soft)',
                }}>
                  {group.dateLabel}
                </span>
              </div>
            </div>
          ))}
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
              <button type="button"
                disabled={isSendingFile}
                onClick={() => sendFile(pendingFile.file)}
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
              background: 'var(--surface-chat-field)', display: 'flex', alignItems: 'center',
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
                background: 'var(--surface-chat-field)', color: 'var(--ink)',
                minHeight: 42, maxHeight: 120,
              }}
              rows={1}
            />

            {mediaRecorderSupported && !input.trim() && (
              <button type="button" onClick={startRecording} className="tap-scale" style={{
                width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border)',
                background: 'var(--surface-chat-field)', display: 'flex', alignItems: 'center',
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
              <button className="btn-primary btn-primary-brand tap-scale" onClick={() => sendMessage(input)} type="button" style={{
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
        const reactorIsMe = msg.reaction_by === userId;
        return (
          <MessageContextMenu
            rect={ctxMenu.rect}
            bubbleHtml={ctxMenu.bubbleHtml}
            menuOnly={ctxMenu.menuOnly}
            isMe={msgIsMe}
            isTextMessage={isTextMessage}
            canEdit={canEditMsg(msg)} canDelete={canDeleteMsg(msg)}
            reactionDetail={ctxMenu.reactionDetail}
            reactorAvatarUrl={reactorIsMe ? myAvatarUrl : coachAvatarUrl}
            reactorInitials={(reactorIsMe ? myInitials : coachInitials) || '?'}
            reactorName={reactorIsMe ? 'Vous' : coachName}
            reactionEmoji={msg.reaction_emoji}
            onReactionRemove={reactorIsMe ? () => clearReaction(msg.id) : undefined}
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
