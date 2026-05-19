'use client';

import { useState, useRef, useEffect } from 'react';
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 52px)', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, background: 'var(--surface)', zIndex: 2 }}>
        <div className="avatar" style={{ width: 38, height: 38, fontSize: 14 }}>{coachInitials}</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>{coachName}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Ton coach</div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, paddingTop: 40 }}>
            <Icon name="refresh-cw" size={16} /> Chargement…
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, paddingTop: 40 }}>
            Aucun message pour le moment. Envoie un message à ton coach !
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_id === userId;
            return (
              <div key={msg.id} className={`message-bubble${isMe ? ' outgoing' : ''}`}
                style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '75%' }}>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{msg.text}</div>
                <div style={{ fontSize: 10, marginTop: 4, textAlign: 'right', color: isMe ? 'rgba(255,255,255,0.6)' : 'var(--muted)' }}>
                  {formatTime(msg.created_at)}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Saisie */}
      <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'flex-end', flexShrink: 0, background: 'var(--surface)' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder="Écrire à votre coach…"
          style={{ flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5, outline: 'none', background: 'var(--surface-2)', color: 'var(--accent)', minHeight: 44 }}
          rows={1}
        />
        <button className="btn-primary" onClick={() => sendMessage(input)} type="button" style={{ padding: '11px 16px', flexShrink: 0 }}>
          <Icon name="send" size={15} />
        </button>
      </div>
    </div>
  );
}
