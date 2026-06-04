'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Msg {
  id: string;
  client_id?: string;
  text: string;
  sender_id: string;
  created_at: string;
  type?: 'text' | 'audio' | 'image' | 'document';
  audio_url?: string;  // URL générique pour audio/image/document
  duration_s?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isToday) return "Aujourd'hui";
  if (isYesterday) return 'Hier';
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

// ─── AudioBubble ─────────────────────────────────────────────────────────────

function AudioBubble({ url, duration, isMe }: { url: string; duration?: number; isMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(duration ?? 0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTimeUpdate = () => {
      const dur = el.duration || currentDuration || 1;
      setProgress((el.currentTime / dur) * 100);
    };
    const onEnded = () => { setPlaying(false); setProgress(0); };
    const onLoaded = () => { if (el.duration && !isNaN(el.duration)) setCurrentDuration(el.duration); };
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('ended', onEnded);
    el.addEventListener('loadedmetadata', onLoaded);
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('loadedmetadata', onLoaded);
    };
  }, [currentDuration]);

  const togglePlay = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      try { await el.play(); setPlaying(true); } catch { /* ignore */ }
    }
  }, [playing]);

  const trackColor = isMe ? 'rgba(255,255,255,0.3)' : 'var(--border)';
  const fillColor = isMe ? '#fff' : 'var(--ink)';
  const iconColor = isMe ? '#fff' : 'var(--ink)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 180 }}>
      <audio ref={audioRef} src={url} preload="metadata" />
      <button
        onClick={togglePlay}
        style={{
          width: 34, height: 34, borderRadius: '50%', border: 'none', flexShrink: 0,
          background: isMe ? 'rgba(255,255,255,0.2)' : 'var(--surface-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill={iconColor}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill={iconColor}><polygon points="5 3 19 12 5 21 5 3"/></svg>
        )}
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          style={{ height: 3, background: trackColor, borderRadius: 2, overflow: 'hidden', cursor: 'pointer' }}
          onClick={(e) => {
            const el = audioRef.current;
            if (!el) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            el.currentTime = ratio * (el.duration || 0);
            setProgress(ratio * 100);
          }}
        >
          <div style={{ width: `${progress}%`, height: '100%', background: fillColor, borderRadius: 2, transition: 'width 0.1s linear' }} />
        </div>
        <span style={{ fontSize: 10, color: isMe ? 'rgba(255,255,255,0.6)' : 'var(--muted)' }}>
          {formatDuration(currentDuration)}
        </span>
      </div>
    </div>
  );
}

// ─── RecordingOverlay ─────────────────────────────────────────────────────────

function RecordingOverlay({ onCancel, onSend, elapsed, isLocked, swipeX, swipeY }: {
  onCancel: () => void; onSend: () => void; elapsed: number;
  isLocked: boolean; swipeX: number; swipeY: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, position: 'relative' }}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--red)', animation: 'pulse-rec 1s ease-in-out infinite', flexShrink: 0 }} />
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', minWidth: 36 }}>
        {formatDuration(elapsed)}
      </span>
      {isLocked ? (
        <>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--muted)' }}>Verrouillé</span>
          <button onClick={onCancel} style={{ fontSize: 12, fontWeight: 600, color: 'var(--red)', background: 'none', border: `1px solid var(--red)`, borderRadius: 16, padding: '6px 12px', cursor: 'pointer', flexShrink: 0 }}>
            Annuler
          </button>
          <button onClick={onSend} style={{ width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </>
      ) : (
        <>
          {/* Indicateur glisser-annuler */}
          <span style={{
            flex: 1, fontSize: 12, color: 'var(--muted)',
            transform: `translateX(${Math.min(0, swipeX * 0.4)}px)`,
            transition: swipeX === 0 ? 'transform 0.2s' : 'none',
            overflow: 'hidden', whiteSpace: 'nowrap',
          }}>
            ‹ Glisser pour annuler
          </span>
          {/* Indicateur verrouillage — monte quand swipe vers le haut */}
          {swipeY < -10 && (
            <div style={{
              position: 'absolute', right: 54, bottom: 48,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '6px 10px', fontSize: 11,
              color: 'var(--muted)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              transform: `translateY(${Math.max(-40, swipeY * 0.5)}px)`,
              transition: 'transform 0.05s',
            }}>
              🔒 Verrouiller
            </div>
          )}
        </>
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
  const [isLocked, setIsLocked] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const [swipeY, setSwipeY] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);
  const touchStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabase = useRef(createClient()).current;

  // Vérifie le support MediaRecorder
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.MediaRecorder) {
        setMediaRecorderSupported(true);
      }
    } catch { /* pas dispo */ }
  }, []);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      const { data: clientRow } = await supabase
        .from('clients')
        .select('id, coach_id, name')
        .eq('profile_id', user.id)
        .single();

      if (!clientRow) { setLoading(false); return; }
      setClientId(clientRow.id);

      const { data: coachProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', clientRow.coach_id)
        .single();

      if (coachProfile?.full_name) {
        setCoachName(coachProfile.full_name);
        const parts = coachProfile.full_name.trim().split(' ');
        setCoachInitials(
          parts.length >= 2
            ? (parts[0][0] + parts[1][0]).toUpperCase()
            : coachProfile.full_name.slice(0, 2).toUpperCase()
        );
      }

      const { data, error } = await supabase
        .from('messages')
        .select('id, text, sender_id, created_at, type, audio_url, duration_s')
        .eq('client_id', clientRow.id)
        .order('created_at', { ascending: true });

      if (error) console.error('messages fetch error:', error.message, error.code);
      setMessages((data as Msg[]) || []);
      setLoading(false);
    }
    load();
  }, [supabase]);

  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel('messages-client')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `client_id=eq.${clientId}`,
      }, (payload) => {
        const incoming = payload.new as Msg;
        setMessages(prev => {
          // Évite doublon entre message optimiste et event realtime
          if (prev.some(m => m.id === incoming.id)) return prev;
          // Remplace l'optimiste texte si même contenu/sender dans la même seconde
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
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Scroll lock pendant enregistrement vocal
  useEffect(() => {
    const zone = document.querySelector('.chat-messages-zone') as HTMLElement | null;
    if (!zone) return;
    zone.style.overflowY = isRecording ? 'hidden' : 'auto';
  }, [isRecording]);

  // Nettoyage enregistrement au démontage
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  async function sendMessage(text: string) {
    if (!text.trim() || !clientId || !userId) return;
    setInput('');
    const optimistic: Msg = {
      id: `opt-${Date.now()}`,
      client_id: clientId,
      sender_id: userId,
      text: text.trim(),
      created_at: new Date().toISOString(),
      type: 'text',
    };
    setMessages(prev => [...prev, optimistic]);
    const { data } = await supabase.from('messages').insert({
      client_id: clientId,
      sender_id: userId,
      text: text.trim(),
      type: 'text',
    }).select('id, text, sender_id, created_at, type, audio_url, duration_s').single();
    if (data) {
      setMessages(prev => prev.map(m => m.id === optimistic.id ? data as Msg : m));
    }
  }

  async function sendAudioMessage(blob: Blob, durationS: number) {
    if (!clientId || !userId) return;
    const optimisticId = `opt-audio-${Date.now()}`;
    const localUrl = URL.createObjectURL(blob);
    const optimistic: Msg = {
      id: optimisticId,
      client_id: clientId,
      sender_id: userId,
      text: '',
      created_at: new Date().toISOString(),
      type: 'audio',
      audio_url: localUrl,
      duration_s: durationS,
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      const fileName = `${clientId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('voice-messages')
        .upload(fileName, blob, { contentType: blob.type || 'audio/webm' });

      if (uploadError) {
        // Upload échoué — retirer le message optimiste
        setMessages(prev => prev.filter(m => m.id !== optimisticId));
        URL.revokeObjectURL(localUrl);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('voice-messages')
        .getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;

      const { data } = await supabase.from('messages').insert({
        client_id: clientId,
        sender_id: userId,
        text: '',
        type: 'audio',
        audio_url: publicUrl,
        duration_s: Math.round(durationS),
      }).select('id, text, sender_id, created_at, type, audio_url, duration_s').single();

      if (data) {
        // Remplace l'optimiste par le message final AVANT de révoquer l'URL locale
        setMessages(prev => prev.map(m => m.id === optimisticId ? data as Msg : m));
        // Petit délai pour laisser le nouveau audio_url se charger avant de libérer l'ancien
        setTimeout(() => URL.revokeObjectURL(localUrl), 3000);
      } else {
        // Insert échoué mais upload ok — garde le message optimiste avec l'URL locale
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      URL.revokeObjectURL(localUrl);
    }
  }

  async function sendFile(file: File) {
    if (!clientId || !userId) return;
    const isImage = file.type.startsWith('image/');
    const type: 'image' | 'document' = isImage ? 'image' : 'document';
    const maxSize = isImage ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > maxSize) return; // silencieux, taille trop grande

    const ext = file.name.split('.').pop() || 'bin';
    const fileName = `${clientId}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('chat-medias')
      .upload(fileName, file, { contentType: file.type });
    if (uploadError) return;

    const { data: urlData } = supabase.storage.from('chat-medias').getPublicUrl(fileName);
    await supabase.from('messages').insert({
      client_id: clientId,
      sender_id: userId,
      text: file.name,
      type,
      audio_url: urlData.publicUrl,
    });
  }

  async function startRecording() {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Priorité audio/mp4 pour Safari iOS (seul format natif), fallback webm/ogg pour Chrome/FF
      const mimeType = MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : '';
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        const dur = (Date.now() - recordingStartRef.current) / 1000;
        const blob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' });
        if (blob.size > 0) {
          sendAudioMessage(blob, dur);
        }
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setIsRecording(false);
        setRecordingElapsed(0);
      };
      mr.start(100);
      mediaRecorderRef.current = mr;
      recordingStartRef.current = Date.now();
      setIsRecording(true);
      setRecordingElapsed(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingElapsed(Math.floor((Date.now() - recordingStartRef.current) / 1000));
      }, 1000);
    } catch { /* micro refusé ou pas dispo */ }
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function cancelRecording() {
    setIsLocked(false);
    setSwipeX(0);
    setSwipeY(0);
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

  // Groupes de messages par jour
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
    <>
      <style>{`
        @keyframes pulse-rec {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>

      {/* Shell messagerie — position fixed sur mobile via .chat-shell CSS, normal sur desktop */}
      <div className="chat-shell" style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
      }}>
        {/* ── Header style WhatsApp ── */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
          background: 'var(--surface)',
        }}>
          <div style={{
            width: 42, height: 42, borderRadius: '50%',
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: 'var(--ink)', flexShrink: 0,
          }}>
            {coachInitials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', lineHeight: 1.2 }}>{coachName}</div>
            <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>En ligne</div>
          </div>
        </div>

        {/* ── Zone messages ── */}
        <div className="chat-messages-zone" style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          WebkitOverflowScrolling: 'touch',
        } as React.CSSProperties}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, paddingTop: 40 }}>Chargement…</div>
          ) : messages.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, paddingTop: 60 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Aucun message</div>
              <div style={{ fontSize: 12 }}>Commence la conversation avec ton coach</div>
            </div>
          ) : messageGroups.map((group) => (
            <div key={group.dateLabel} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Date separator */}
              <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
                <span style={{
                  fontSize: 11, color: 'var(--muted)',
                  background: 'rgba(0,0,0,0.06)', padding: '3px 10px',
                  borderRadius: 10,
                }}>
                  {group.dateLabel}
                </span>
              </div>
              {group.msgs.map((msg) => {
                const isMe = msg.sender_id === userId;
                const isAudio = msg.type === 'audio';
                return (
                  <div
                    key={msg.id}
                    className="msg-bubble-in"
                    style={{
                      alignSelf: isMe ? 'flex-end' : 'flex-start',
                      maxWidth: '78%',
                      background: isMe ? 'var(--ink)' : 'var(--surface)',
                      color: isMe ? '#fff' : 'var(--ink)',
                      borderRadius: isMe ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
                      padding: isAudio ? '10px 13px 8px 13px' : '9px 13px',
                      border: isMe ? 'none' : '1px solid var(--border)',
                      boxShadow: isMe ? 'none' : '0 1px 3px rgba(0,0,0,0.08)',
                    }}
                  >
                    {isAudio && msg.audio_url ? (
                      <AudioBubble url={msg.audio_url} duration={msg.duration_s} isMe={isMe} />
                    ) : msg.type === 'image' && msg.audio_url ? (
                      <img
                        src={msg.audio_url} alt={msg.text || 'image'}
                        style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 10, display: 'block', cursor: 'pointer' }}
                        onClick={() => window.open(msg.audio_url, '_blank')}
                      />
                    ) : msg.type === 'document' && msg.audio_url ? (
                      <a href={msg.audio_url} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: isMe ? '#fff' : 'var(--ink)' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                        </svg>
                        <span style={{ fontSize: 13, wordBreak: 'break-all' }}>{msg.text || 'Document'}</span>
                      </a>
                    ) : (
                      <div style={{ fontSize: 14, lineHeight: 1.45, wordBreak: 'break-word' }}>{msg.text}</div>
                    )}
                    <div style={{
                      fontSize: 10, marginTop: 3, textAlign: 'right',
                      color: isMe ? 'rgba(255,255,255,0.6)' : 'var(--muted)',
                    }}>
                      {formatTime(msg.created_at)}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* ── Input bar ── */}
        <div className="chat-input-bar" style={{
          padding: '8px 12px',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
          flexShrink: 0,
        }}>
          {/* Input file invisible — images + PDF + docs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,.doc,.docx"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = ''; }}
          />
          {/* Bouton trombone — caché pendant enregistrement */}
          {!isRecording && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Envoyer un fichier"
              style={{
                width: 44, height: 44, borderRadius: '50%', border: '1px solid var(--border)',
                background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
          )}
          {isRecording ? (
            <RecordingOverlay
              elapsed={recordingElapsed}
              onCancel={cancelRecording}
              onSend={stopRecording}
              isLocked={isLocked}
              swipeX={swipeX}
              swipeY={swipeY}
            />
          ) : (
            <>
              {/* Bouton micro — maintien mobile, clic PC */}
              {mediaRecorderSupported && !input.trim() && (
                <button
                  type="button"
                  title="Maintenir pour enregistrer"
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onMouseLeave={() => { if (isRecording) stopRecording(); }}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                    setSwipeX(0); setSwipeY(0); setIsLocked(false);
                    startRecording();
                  }}
                  onTouchMove={(e) => {
                    if (!isRecording || isLocked) return;
                    const dx = e.touches[0].clientX - touchStartRef.current.x;
                    const dy = e.touches[0].clientY - touchStartRef.current.y;
                    setSwipeX(dx); setSwipeY(dy);
                    if (dx < -80) { cancelRecording(); }
                    else if (dy < -60) { setIsLocked(true); setSwipeX(0); setSwipeY(0); }
                  }}
                  onTouchEnd={(e) => { e.preventDefault(); if (!isLocked) stopRecording(); }}
                  style={{
                    width: 44, height: 44, borderRadius: '50%', border: '1px solid var(--border)',
                    background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', flexShrink: 0, userSelect: 'none',
                    touchAction: 'none', WebkitUserSelect: 'none',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                </button>
              )}

              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                placeholder="Écrire à ton coach…"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="sentences"
                spellCheck={false}
                inputMode="text"
                name="chat-momentum-x7k"
                style={{
                  flex: 1, resize: 'none', border: '1px solid var(--border)',
                  borderRadius: 24, padding: '11px 16px', fontSize: 14,
                  fontFamily: 'inherit', lineHeight: 1.5, outline: 'none',
                  background: 'var(--surface-2)', color: 'var(--ink)',
                  minHeight: 44, maxHeight: 120,
                }}
                rows={1}
              />

              {/* Bouton send — visible seulement si texte */}
              {input.trim() && (
                <button
                  className="btn-primary"
                  onClick={() => sendMessage(input)}
                  type="button"
                  style={{
                    width: 44, height: 44, borderRadius: '50%', padding: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon name="send" size={16} />
                </button>
              )}

              {/* Bouton send visible si pas de micro et champ vide */}
              {!input.trim() && !mediaRecorderSupported && (
                <button
                  className="btn-primary"
                  onClick={() => sendMessage(input)}
                  type="button"
                  disabled
                  style={{
                    width: 44, height: 44, borderRadius: '50%', padding: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, opacity: 0.3,
                  }}
                >
                  <Icon name="send" size={16} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
