'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import type { Message } from '@/lib/supabase/types';

export default function PageChat() {
  const { clients, loading } = useSupabaseClients();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id || null));
  }, []);

  useEffect(() => {
    if (clients.length > 0 && !activeId) {
      setActiveId(clients[0].id);
    }
  }, [clients]);

  useEffect(() => {
    if (!activeId) return;
    supabase.from('messages').select('*, sender:profiles(*)').eq('client_id', activeId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setMessages(data || []));

    const channel = supabase.channel(`messages:${activeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `client_id=eq.${activeId}` },
        payload => setMessages(prev => [...prev, payload.new as Message])
      ).subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !activeId || !userId) return;
    setInput('');
    await supabase.from('messages').insert({ client_id: activeId, sender_id: userId, text: text.trim(), read: false });
  }, [activeId, userId]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  }

  const activeClient = clients.find(c => c.id === activeId);

  if (loading) {
    return (
      <div className="page-content">
        <div style={{ color: 'var(--muted)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
          <Icon name="refresh-cw" size={16} /> Chargement…
        </div>
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="page-content">
        <div className="page-header"><h1 className="page-title">Messages</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>
          Aucun client pour le moment. Les conversations apparaîtront ici dès qu'un client rejoindra la plateforme.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '260px 1fr',
      height: '100%',
      overflow: 'hidden',
      background: 'var(--bg)',
    }}>
      {/* Liste clients */}
      <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface)' }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 10 }}>Messages</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {clients.map(cl => {
            const isActive = cl.id === activeId;
            return (
              <div key={cl.id} onClick={() => setActiveId(cl.id)} style={{
                padding: '11px 16px', cursor: 'pointer',
                background: isActive ? 'var(--surface-2)' : 'transparent',
                borderLeft: `3px solid ${isActive ? 'var(--ink)' : 'transparent'}`,
                display: 'flex', gap: 10, alignItems: 'center',
              }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                  {cl.initials || cl.name.slice(0, 2).toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cl.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Semaine {cl.week}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Thread */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, background: 'var(--surface)' }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
            {activeClient?.initials || '??'}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{activeClient?.name || '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Semaine {activeClient?.week}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, marginTop: 40 }}>
              Aucun message pour le moment.
            </div>
          )}
          {messages.map((msg, i) => {
            const isMe = msg.sender_id === userId;
            return (
              <div key={msg.id || i} className={`message-bubble${isMe ? ' outgoing' : ''}`}
                style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '72%' }}>
                <div style={{ fontSize: 13, lineHeight: 1.55 }}>{msg.text}</div>
                <div style={{ fontSize: 10, marginTop: 4, textAlign: 'right', color: isMe ? 'rgba(255,255,255,0.55)' : 'var(--muted)' }}>
                  {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'flex-end', flexShrink: 0, background: 'var(--surface)' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Écrire un message… (Entrée pour envoyer)"
            rows={1}
            style={{ flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: 'var(--surface-2)', color: 'var(--ink)', minHeight: 42, maxHeight: 120 }}
          />
          <button className="btn-primary" onClick={() => sendMessage(input)} type="button" style={{ padding: '10px 14px', flexShrink: 0 }}>
            <Icon name="send" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
