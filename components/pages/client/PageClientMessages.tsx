'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';

interface Msg {
  id: string;
  client_id?: string;
  text: string;
  sender_id: string;
  created_at: string;
}

export default function PageClientMessages() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [coachName, setCoachName] = useState('Coach');
  const [coachInitials, setCoachInitials] = useState('CO');
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const supabase = createClient();

  // iOS visualViewport — ajuste la hauteur quand le clavier s'ouvre
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const gap = window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardHeight(Math.max(0, gap));
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data: clientRow } = await supabase
        .from('clients')
        .select('id, coach_id, name')
        .eq('profile_id', user.id)
        .single();

      if (!clientRow) { setLoading(false); return; }
      setClientId(clientRow.id);

      // Infos du coach
      const { data: coachProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', clientRow.coach_id)
        .single();

      if (coachProfile?.full_name) {
        setCoachName(coachProfile.full_name);
        const parts = coachProfile.full_name.trim().split(' ');
        setCoachInitials(parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : coachProfile.full_name.slice(0, 2).toUpperCase());
      }

      // Charge les messages
      const { data } = await supabase
        .from('messages')
        .select('id, text, sender_id, created_at')
        .eq('client_id', clientRow.id)
        .order('created_at', { ascending: true });

      setMessages(data || []);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel('messages-client')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `client_id=eq.${clientId}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as Msg]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || !clientId || !userId) return;
    setInput('');
    const optimistic: Msg = {
      id: `opt-${Date.now()}`,
      client_id: clientId,
      sender_id: userId,
      text: text.trim(),
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    const { data } = await supabase.from('messages').insert({
      client_id: clientId,
      sender_id: userId,
      text: text.trim(),
    }).select('id, text, sender_id, created_at').single();
    if (data) {
      setMessages(prev => prev.map(m => m.id === optimistic.id ? data : m));
    }
  }

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // paddingBottom = bottom nav (56px) + safe-area + keyboard offset
  const bottomNavH = 56;
  const inputAreaPb = bottomNavH + keyboardHeight;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      position: 'fixed',
      top: 52, // topbar height
      left: 0,
      right: 0,
      bottom: 0,
      background: 'var(--bg)',
      zIndex: 10,
    }}>
      {/* Header style WhatsApp */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
        background: 'var(--surface)',
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%',
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: 'var(--ink)', flexShrink: 0,
        }}>{coachInitials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)', lineHeight: 1.2 }}>{coachName}</div>
          <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>En ligne</div>
        </div>
      </div>

      {/* Zone messages — scroll interne */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '12px 16px',
        paddingBottom: `${inputAreaPb + 72}px`, // espace sous les messages
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        WebkitOverflowScrolling: 'touch',
      } as React.CSSProperties}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, paddingTop: 40 }}>Chargement…</div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, paddingTop: 60 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Aucun message</div>
            <div style={{ fontSize: 12 }}>Commence la conversation avec ton coach</div>
          </div>
        ) : messages.map((msg) => {
          const isMe = msg.sender_id === userId;
          return (
            <div key={msg.id} style={{
              alignSelf: isMe ? 'flex-end' : 'flex-start',
              maxWidth: '75%',
              background: isMe ? 'var(--ink)' : 'var(--surface)',
              color: isMe ? '#fff' : 'var(--ink)',
              borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              padding: '9px 13px',
              border: isMe ? 'none' : '1px solid var(--border)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
            }}>
              <div style={{ fontSize: 14, lineHeight: 1.45, wordBreak: 'break-word' }}>{msg.text}</div>
              <div style={{ fontSize: 10, marginTop: 3, textAlign: 'right', opacity: 0.6 }}>
                {formatTime(msg.created_at)}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input — position fixed au-dessus du clavier */}
      <div style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: `${inputAreaPb}px`,
        padding: '8px 12px',
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-end',
        transition: 'bottom 0.15s ease-out',
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder="Écrire à ton coach…"
          style={{ flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: 22, padding: '11px 16px', fontSize: 14, fontFamily: 'inherit', lineHeight: 1.5, outline: 'none', background: 'var(--surface-2)', color: 'var(--accent)', minHeight: 44, maxHeight: 120 }}
          rows={1}
        />
        <button className="btn-primary" onClick={() => sendMessage(input)} type="button" style={{ width: 44, height: 44, borderRadius: '50%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="send" size={16} />
        </button>
      </div>
    </div>
  );
}
