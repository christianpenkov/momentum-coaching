'use client';

import { useState, useRef, useEffect } from 'react';
import Icon from './Icon';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  systemPrompt: string;
  placeholder?: string;
  welcomeMessage?: string;
  suggestedQuestions?: string[];
}

export default function AiChat({ systemPrompt, placeholder, welcomeMessage, suggestedQuestions }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  async function send(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;
    setInput('');

    const newMessages: Msg[] = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);
    setLoading(true);
    setStreamingText('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok || !res.body) {
        if (res.status === 400) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Erreur API');
        }
        throw new Error('Erreur API');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        setStreamingText(full);
      }

      setMessages(prev => [...prev, { role: 'assistant', content: full }]);
      setStreamingText('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Une erreur s'est produite.";
      setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
      setStreamingText('');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const isEmpty = messages.length === 0 && !loading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {isEmpty && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 24, paddingBottom: 60 }}>
            {/* Icône IA */}
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-dim) 0%, var(--surface-2) 100%)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={24} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
                {welcomeMessage ?? 'Assistant ORBIT'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 380, lineHeight: 1.6 }}>
                Posez n'importe quelle question. Je suis là pour vous aider.
              </div>
            </div>
            {suggestedQuestions && suggestedQuestions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 480 }}>
                {suggestedQuestions.map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => send(q)}
                    style={{
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 12, padding: '10px 16px', fontSize: 13,
                      color: 'var(--accent)', cursor: 'pointer', textAlign: 'left',
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {msg.role === 'assistant' && (
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 10, marginTop: 2 }}>
                <Icon name="sparkle" size={13} />
              </div>
            )}
            <div style={{
              maxWidth: '72%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              background: msg.role === 'user' ? 'var(--accent)' : 'var(--surface-2)',
              color: msg.role === 'user' ? 'var(--bg)' : 'var(--accent)',
              fontSize: 13,
              lineHeight: 1.65,
              border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {msg.content}
            </div>
          </div>
        ))}

        {/* Streaming en cours */}
        {(loading || streamingText) && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 10, marginTop: 2 }}>
              <Icon name="sparkle" size={13} />
            </div>
            <div style={{
              maxWidth: '72%', padding: '10px 14px', borderRadius: '16px 16px 16px 4px',
              background: 'var(--surface-2)', color: 'var(--accent)', fontSize: 13,
              lineHeight: 1.65, border: '1px solid var(--border)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {streamingText || (
                <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--muted)', animation: 'pulse 1.2s ease-in-out infinite' }} />
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--muted)', animation: 'pulse 1.2s ease-in-out 0.2s infinite' }} />
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--muted)', animation: 'pulse 1.2s ease-in-out 0.4s infinite' }} />
                </span>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 14, padding: '10px 14px', transition: 'border-color 0.15s' }}
          onFocus={() => {}}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? 'Posez votre question…'}
            rows={1}
            style={{
              flex: 1, border: 'none', background: 'transparent', resize: 'none',
              fontSize: 13, color: 'var(--accent)', outline: 'none', fontFamily: 'inherit',
              lineHeight: 1.5, maxHeight: 140, overflowY: 'auto',
            }}
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={!input.trim() || loading}
            style={{
              width: 32, height: 32, borderRadius: 8, border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
              background: input.trim() && !loading ? 'var(--accent)' : 'var(--border)',
              color: input.trim() && !loading ? 'var(--bg)' : 'var(--muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s', flexShrink: 0,
            }}
          >
            <Icon name="chevR" size={14} />
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>
          Entrée pour envoyer · Shift+Entrée pour sauter une ligne
        </div>
      </div>
    </div>
  );
}
