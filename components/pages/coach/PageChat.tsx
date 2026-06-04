'use client';

import { useState, useRef, useEffect, useCallback, createContext, useContext } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';

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
}

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
        transition: 'transform 80ms ease-out',
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

  useEffect(() => {
    try { if (typeof window !== 'undefined' && window.MediaRecorder) setMediaRecorderSupported(true); } catch {}
  }, []);

  // Charge messages
  useEffect(() => {
    setLoading(true);
    setMessages([]);
    supabase.from('messages')
      .select('id, text, sender_id, created_at, type, audio_url, duration_s, read_at, read')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setMessages((data as Msg[]) || []);
        setLoading(false);
        // Marquer lu
        const unread = (data || []).filter((m: Msg) => !m.read_at && m.sender_id !== userId).map((m: Msg) => m.id);
        if (unread.length > 0) {
          supabase.from('messages').update({ read_at: new Date().toISOString(), read: true }).in('id', unread).then(() => {
            setMessages(prev => prev.map(m => unread.includes(m.id) ? { ...m, read_at: new Date().toISOString() } : m));
          });
        }
      });
  }, [clientId, userId, supabase]);

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
          if (msg.sender_id !== userId) {
            await supabase.from('messages').update({ read_at: new Date().toISOString(), read: true }).eq('id', msg.id);
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read_at: new Date().toISOString() } : m));
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `client_id=eq.${clientId}` },
        (payload) => {
          const updated = payload.new as Msg;
          setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
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
  }, [messages, clientTyping, loading]);

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

  // Envoi fichier
  async function sendFile(file: File) {
    const isImage = file.type.startsWith('image/');
    const type: 'image' | 'document' = isImage ? 'image' : 'document';
    if (file.size > (isImage ? 5*1024*1024 : 20*1024*1024)) return;
    const ext = file.name.split('.').pop() || 'bin';
    const fileName = `${clientId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('chat-medias').upload(fileName, file, { contentType: file.type });
    if (error) return;
    const { data: urlData } = supabase.storage.from('chat-medias').getPublicUrl(fileName);
    await supabase.from('messages').insert({ client_id: clientId, sender_id: userId, text: file.name, type, audio_url: urlData.publicUrl, read: false });
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

  // Groupes
  const messageGroups: Array<{ dateLabel: string; msgs: Msg[] }> = [];
  messages.forEach((msg, i) => {
    const prev = messages[i-1];
    if (!prev || !isSameDay(prev.created_at, msg.created_at)) messageGroups.push({ dateLabel: formatDate(msg.created_at), msgs: [msg] });
    else messageGroups[messageGroups.length-1].msgs.push(msg);
  });

  return (
    <AudioContext.Provider value={{ activeId: activeAudioId, setActive: setActiveAudioId }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--bg)' }}>

        {/* Header */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, background: 'var(--surface)' }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, position: 'relative', flexShrink: 0 }}>
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
        <div ref={chatZoneRef} className="chat-messages-zone" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '16px 20px 8px', display: 'flex', flexDirection: 'column', gap: 2, WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, paddingTop: 40 }}>Chargement…</div>
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
                const isMe = msg.sender_id === userId;
                const isAudio = msg.type === 'audio';
                const isImage = msg.type === 'image';
                const isDocument = msg.type === 'document';
                const prevMsg = group.msgs[msgIdx-1];
                const nextMsg = group.msgs[msgIdx+1];
                const isContinued = prevMsg && prevMsg.sender_id === msg.sender_id;
                const isLast = !nextMsg || nextMsg.sender_id !== msg.sender_id;
                return (
                  <div key={msg.id} className="msg-bubble-in" style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '72%', marginTop: isContinued ? 2 : 8 }}>
                    <div style={{
                      background: isMe ? 'var(--ink)' : 'var(--surface)',
                      color: isMe ? '#fff' : 'var(--ink)',
                      borderRadius: isMe
                        ? (isContinued ? '18px 4px 4px 18px' : isLast ? '18px 4px 18px 18px' : '18px 4px 4px 18px')
                        : (isContinued ? '4px 18px 18px 4px' : isLast ? '4px 18px 18px 18px' : '4px 18px 18px 4px'),
                      padding: isAudio ? '10px 12px 8px 12px' : isImage ? '4px' : '9px 12px',
                      border: isMe ? 'none' : '1px solid var(--border)',
                      boxShadow: isMe ? 'none' : 'var(--shadow-item)',
                    }}>
                      {isAudio && msg.audio_url ? (
                        <AudioBubble id={msg.id} url={msg.audio_url} duration={msg.duration_s} isMe={isMe} />
                      ) : isImage && msg.audio_url ? (
                        <img src={msg.audio_url} alt="" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 10, display: 'block', cursor: 'pointer' }} onClick={() => window.open(msg.audio_url, '_blank')} />
                      ) : isDocument && msg.audio_url ? (
                        <a href={msg.audio_url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: isMe ? '#fff' : 'var(--ink)' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          <span style={{ fontSize: 13, wordBreak: 'break-all' }}>{msg.text || 'Document'}</span>
                        </a>
                      ) : (
                        <div style={{ fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.text}</div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3, marginTop: isImage ? 0 : 4 }}>
                        <span style={{ fontSize: 10, color: isMe ? 'rgba(255,255,255,0.5)' : 'var(--muted)' }}>{formatTime(msg.created_at)}</span>
                        <MessageStatus isMe={isMe} msgId={msg.id} readAt={msg.read_at} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {clientTyping && <div className="msg-bubble-in" style={{ marginTop: 8 }}><TypingIndicator /></div>}
          <div ref={bottomRef} />
        </div>

        {/* Input file */}
        <input ref={fileInputRef} type="file" accept="image/*,application/pdf,.doc,.docx" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = ''; }} />

        {/* Panneau enregistrement */}
        {isRecording && (
          <div className="chat-input-bar" style={{ padding: '8px 16px', flexShrink: 0, background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, gap: 12, animation: 'rec-fadein 0.15s ease-out' }}>
              <button onClick={cancelRecording} type="button" style={{ width: 48, height: 48, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'center' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', animation: 'pulse-rec 1s ease-in-out infinite' }} />
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {`${Math.floor(recordingElapsed/60)}:${(recordingElapsed%60).toString().padStart(2,'0')}`}
                </span>
              </div>
              <button onClick={stopRecording} type="button" style={{ width: 48, height: 48, borderRadius: '50%', border: 'none', background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* Input bar */}
        {!isRecording && (
          <div className="chat-input-bar" style={{ padding: '8px 12px', background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
            <button type="button" onClick={() => fileInputRef.current?.click()} style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => {
                setInput(e.target.value);
                if (presenceCh) {
                  presenceCh.send({ type: 'broadcast', event: 'typing', payload: { role: 'coach' } });
                }
              }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
              placeholder={`Écrire à ${clientName}…`}
              autoComplete="off" autoCorrect="off" autoCapitalize="sentences"
              spellCheck={false} inputMode="text"
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

  // Presence coach : rejoindre le canal du client actif
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
        if (status === 'SUBSCRIBED') {
          await ch.track({ user_id: userId, role: 'coach', online_at: new Date().toISOString() });
        }
      });
    presenceChRef.current = ch;
    setPresenceCh(ch);
    return () => { supabase.removeChannel(ch); presenceChRef.current = null; setPresenceCh(null); };
  }, [userId, activeId, supabase]);

  if (loading) return (
    <div className="page-content">
      <div style={{ color: 'var(--muted)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>Chargement…</div>
    </div>
  );

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
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>

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
