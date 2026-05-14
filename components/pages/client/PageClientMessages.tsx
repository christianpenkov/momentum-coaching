'use client';

import { useState, useRef, useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import { thomasChat } from '@/lib/data';

interface Msg { from: string; text: string; time: string }

export default function PageClientMessages() {
  const [messages, setMessages] = useState<Msg[]>(
    thomasChat.map(m => ({ from: m.side === 'me' ? 'client' : 'coach', text: m.text, time: m.time || '' }))
  );
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function sendMessage(text: string) {
    if (!text.trim()) return;
    setMessages(prev => [...prev, {
      from: 'client',
      text: text.trim(),
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    }]);
    setInput('');
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 52px)',
      overflow: 'hidden',
      background: 'var(--bg)',
    }}>
      {/* Header — fixe, ne scrolle pas */}
      <div style={{
        padding: '14px 24px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
        background: 'var(--surface)',
        zIndex: 2,
      }}>
        <div className="avatar" style={{ width: 38, height: 38, fontSize: 14 }}>ML</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>Marc Laurent</div>
          <div style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
            En ligne
          </div>
        </div>
      </div>

      {/* Zone messages — scroll uniquement ici */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}>
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`message-bubble${msg.from === 'client' ? ' outgoing' : ''}`}
            style={{ alignSelf: msg.from === 'client' ? 'flex-end' : 'flex-start', maxWidth: '75%' }}
          >
            {msg.from !== 'client' && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.0)', marginBottom: 3, fontWeight: 600 }}>Marc Laurent</div>
            )}
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>{msg.text}</div>
            <div style={{
              fontSize: 10,
              marginTop: 4,
              textAlign: 'right',
              color: msg.from === 'client' ? 'rgba(255,255,255,0.6)' : 'var(--muted)',
            }}>{msg.time}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Zone saisie — fixe en bas */}
      <div style={{
        padding: '14px 24px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-end',
        flexShrink: 0,
        background: 'var(--surface)',
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder="Écrire à votre coach…"
          style={{
            flex: 1,
            resize: 'none',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 13,
            fontFamily: 'inherit',
            lineHeight: 1.5,
            outline: 'none',
            background: 'var(--surface-2)',
            color: 'var(--accent)',
            minHeight: 44,
          }}
          rows={1}
        />
        <button className="btn-primary" onClick={() => sendMessage(input)} type="button" style={{ padding: '11px 16px', flexShrink: 0 }}>
          <Icon name="send" size={15} />
        </button>
      </div>
    </div>
  );
}
