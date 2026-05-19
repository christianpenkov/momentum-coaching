'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import type { Message } from '@/lib/supabase/types';

// Coches style WhatsApp
function MessageTicks({ isMe, read }: { isMe: boolean; read: boolean }) {
  if (!isMe) return null;
  return (
    <span style={{ marginLeft: 4, display: 'inline-flex', alignItems: 'center' }}>
      {read ? (
        // Deux coches bleues = lu
        <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
          <path d="M1 5l3 3 5-6" stroke="#60a5fa" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M6 5l3 3 5-6" stroke="#60a5fa" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ) : (
        // Une coche blanche = envoyé
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4l3 3 5-6" stroke="rgba(255,255,255,0.7)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </span>
  );
}

export default function PageChat() {
  const { clients, loading } = useSupabaseClients();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [onlineClients, setOnlineClients] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  // Récupère userId
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id || null));
  }, []);

  // Sélectionne le premier client par défaut
  useEffect(() => {
    if (clients.length > 0 && !activeId) setActiveId(clients[0].id);
  }, [clients]);

  // Presence : publie la présence du coach + écoute les clients en ligne
  useEffect(() => {
    if (!userId) return;
    const presenceChannel = supabase.channel('presence-global', {
      config: { presence: { key: userId } },
    });

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState<{ role: string; clientId?: string }>();
        const online = new Set<string>();
        Object.values(state).forEach(presences => {
          presences.forEach((p: any) => {
            if (p.role === 'client' && p.clientId) online.add(p.clientId);
          });
        });
        setOnlineClients(online);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ role: 'coach', userId });
        }
      });

    return () => { supabase.removeChannel(presenceChannel); };
  }, [userId]);

  // Charge les messages + marque comme lus + écoute les nouveaux
  useEffect(() => {
    if (!activeId || !userId) return;

    supabase.from('messages')
      .select('*')
      .eq('client_id', activeId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setMessages(data || []);
        // Marque tous les messages non lus reçus (pas envoyés par moi) comme lus
        const unread = (data || []).filter(m => !m.read && m.sender_id !== userId).map(m => m.id);
        if (unread.length > 0) {
          supabase.from('messages').update({ read: true }).in('id', unread).then(() => {
            setMessages(prev => prev.map(m => unread.includes(m.id) ? { ...m, read: true } : m));
          });
        }
      });

    const channel = supabase.channel(`messages:${activeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `client_id=eq.${activeId}` },
        async (payload) => {
          const msg = payload.new as Message;
          setMessages(prev => [...prev, msg]);
          // Marque immédiatement comme lu si c'est le client qui écrit
          if (msg.sender_id !== userId) {
            await supabase.from('messages').update({ read: true }).eq('id', msg.id);
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read: true } : m));
          }
        }
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `client_id=eq.${activeId}` },
        (payload) => {
          const updated = payload.new as Message;
          setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, read: updated.read } : m));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeId, userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !activeId || !userId) return;
    setInput('');
    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      client_id: activeId,
      sender_id: userId,
      text: text.trim(),
      read: false,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    const { data } = await supabase.from('messages')
      .insert({ client_id: activeId, sender_id: userId, text: text.trim(), read: false })
      .select().single();
    if (data) {
      setMessages(prev => prev.map(m => m.id === optimistic.id ? (data as Message) : m));
    }
  }, [activeId, userId]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  }

  const activeClient = clients.find(c => c.id === activeId);
  const isActiveOnline = activeId ? onlineClients.has(activeId) : false;

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
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* Liste clients */}
      <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface)' }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Messages</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {clients.map(cl => {
            const isActive = cl.id === activeId;
            const isOnline = onlineClients.has(cl.id);
            return (
              <div key={cl.id} onClick={() => setActiveId(cl.id)} style={{
                padding: '11px 16px', cursor: 'pointer',
                background: isActive ? 'var(--surface-2)' : 'transparent',
                borderLeft: `3px solid ${isActive ? 'var(--ink)' : 'transparent'}`,
                display: 'flex', gap: 10, alignItems: 'center',
              }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                    {cl.initials || cl.name.slice(0, 2).toUpperCase()}
                  </div>
                  {isOnline && (
                    <span style={{ position: 'absolute', bottom: 0, right: 0, width: 9, height: 9, borderRadius: '50%', background: '#22c55e', border: '2px solid var(--surface)' }} />
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cl.name}</div>
                  <div style={{ fontSize: 11, color: isOnline ? '#22c55e' : 'var(--muted)' }}>
                    {isOnline ? 'En ligne' : `Semaine ${cl.week}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Thread */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
        {/* Header */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, background: 'var(--surface)' }}>
          <div style={{ position: 'relative' }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
              {activeClient?.initials || '??'}
            </div>
            {isActiveOnline && (
              <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', background: '#22c55e', border: '2px solid var(--surface)' }} />
            )}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{activeClient?.name || '—'}</div>
            <div style={{ fontSize: 11, color: isActiveOnline ? '#22c55e' : 'var(--muted)', fontWeight: isActiveOnline ? 600 : 400 }}>
              {isActiveOnline ? 'En ligne' : `Semaine ${activeClient?.week}`}
            </div>
          </div>
        </div>

        {/* Messages */}
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
                <div style={{ fontSize: 10, marginTop: 4, textAlign: 'right', color: isMe ? 'rgba(255,255,255,0.55)' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                  {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  <MessageTicks isMe={isMe} read={msg.read} />
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Saisie */}
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
