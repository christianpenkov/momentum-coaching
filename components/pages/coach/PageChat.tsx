'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Avatar from '@/components/ui/Avatar';
import Icon from '@/components/ui/Icon';
import Pill from '@/components/ui/Pill';
import { conversations, thomasChat, clients } from '@/lib/data';

interface Msg { from: 'coach' | 'client'; text: string; time: string }

// Messages par clientId — thomas a le vrai chat, les autres ont des messages générés
const MOCK_THREADS: Record<string, Msg[]> = {
  thomas: thomasChat.map(m => ({
    from: m.side === 'me' ? 'coach' : 'client',
    text: m.text,
    time: m.time || '',
  })),
  lea: [
    { from: 'client', text: 'Marc j\'ai fini le module 5, incroyable !', time: '08:12' },
    { from: 'coach',  text: 'Super Léa ! Tu continues sur ta lancée. Quel est ton objectif S13 ?', time: '09:04' },
    { from: 'client', text: 'Dépasser les 50k followers et fermer 3 deals.', time: '09:31' },
    { from: 'coach',  text: 'Parfait. Prépare une analyse de ton meilleur Reel de la semaine pour notre call.', time: '10:02' },
    { from: 'client', text: 'Merci ! On en parle mercredi', time: '10:15' },
  ],
  hugo: [
    { from: 'client', text: 'Salut Marc, j\'ai un peu de mal avec le module 2.', time: '14:22' },
    { from: 'coach',  text: 'Quel point précisément ? La partie contenu ou la partie DM ?', time: '15:10' },
    { from: 'client', text: 'La partie DM, je ne sais pas quoi écrire.', time: '15:44' },
    { from: 'coach',  text: 'OK, regarde le script r3 dans tes ressources. On reprend ça vendredi.', time: '16:20' },
    { from: 'client', text: 'Tu peux me débloquer le module ?', time: '17:05' },
  ],
  sofia: [
    { from: 'client', text: 'J\'ai testé le format horizontal cette semaine !', time: '11:00' },
    { from: 'coach',  text: 'Et les résultats ?', time: '11:30' },
    { from: 'client', text: 'Le nouveau format marche très bien, +40% de vues 🔥', time: '12:14' },
    { from: 'coach',  text: 'Excellent ! Continue sur cette lancée. Double la fréquence la semaine prochaine.', time: '13:00' },
  ],
  karim: [
    { from: 'coach',  text: 'Karim, comment avancent tes Reels cette semaine ?', time: '09:00' },
    { from: 'client', text: 'Pas terrible, j\'ai perdu la motivation.', time: '10:30' },
    { from: 'coach',  text: 'Normal après 4 semaines. On va simplifier : un seul format cette semaine, 3 posts max.', time: '11:00' },
    { from: 'client', text: 'Je relance les Reels demain', time: '14:20' },
  ],
  camille: [
    { from: 'client', text: 'Marc !!! 6 nouveaux clients ce mois-ci !', time: '08:00' },
    { from: 'coach',  text: 'Félicitations Camille ! C\'est le résultat de 3 mois de travail rigoureux.', time: '08:45' },
    { from: 'client', text: 'On scale ! 6 nouveaux clients', time: '09:00' },
    { from: 'coach',  text: 'Prépare ton offre premium pour le prochain call. Tu es prête.', time: '09:30' },
  ],
  ines: [
    { from: 'client', text: 'J\'ai écrit un brief pour le tournage de la semaine prochaine.', time: '16:00' },
    { from: 'coach',  text: 'Envoie-moi ça !', time: '16:30' },
    { from: 'client', text: 'Brief envoyé, tu valides ?', time: '17:00' },
    { from: 'coach',  text: 'Je regarde ça ce soir et je reviens vers toi.', time: '17:10' },
  ],
};

function getThread(clientId: string): Msg[] {
  return MOCK_THREADS[clientId] ?? [
    { from: 'coach', text: 'Bonjour ! Comment se passe ta semaine ?', time: '09:00' },
    { from: 'client', text: '...', time: '09:01' },
  ];
}


export default function PageChat() {
  const [activeId, setActiveId] = useState(conversations[0].clientId);
  const [threads, setThreads] = useState<Record<string, Msg[]>>(() => {
    const init: Record<string, Msg[]> = {};
    conversations.forEach(c => { init[c.clientId] = getThread(c.clientId); });
    return init;
  });
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = threads[activeId] ?? [];
  const activeClient = clients.find(c => c.id === activeId);
  const activeConv = conversations.find(c => c.clientId === activeId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeId, messages.length]);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    const msg: Msg = {
      from: 'coach',
      text: text.trim(),
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    };
    setThreads(prev => ({ ...prev, [activeId]: [...(prev[activeId] ?? []), msg] }));
    setInput('');
  }, [activeId]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '260px 1fr 260px',
      height: '100%',
      overflow: 'hidden',
      background: 'var(--bg)',
    }}>

      {/* ── Col 1 : liste ── */}
      <div style={{
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--surface)',
      }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)', marginBottom: 10 }}>Messages</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <Icon name="search" size={13} />
            <input placeholder="Rechercher…" style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 12, color: 'var(--accent)', flex: 1 }} />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {conversations.map(conv => {
            const cl = clients.find(c => c.id === conv.clientId);
            const isActive = conv.clientId === activeId;
            return (
              <div
                key={conv.clientId}
                onClick={() => setActiveId(conv.clientId)}
                style={{
                  padding: '11px 16px',
                  cursor: 'pointer',
                  background: isActive ? 'var(--surface-2)' : 'transparent',
                  borderLeft: `3px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  transition: 'background 0.12s',
                }}
              >
                <Avatar initials={cl?.initials || '??'} size={34} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cl?.name || conv.clientId}</span>
                    <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0, marginLeft: 4 }}>{conv.when}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.last}</div>
                </div>
                {conv.unread && (
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Col 2 : thread ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
        {/* Header thread */}
        <div style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
          background: 'var(--surface)',
        }}>
          <Avatar initials={activeClient?.initials || '??'} size={38} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>{activeClient?.name || activeId}</div>
            <div style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
              En ligne
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="icon-btn" title="Vidéo" type="button"><Icon name="video" size={15} /></button>
            <button className="icon-btn" title="Appel" type="button"><Icon name="phone-call" size={15} /></button>
          </div>
        </div>

        {/* Messages scrollables */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map((msg, i) => (
            <div
              key={`${activeId}-${i}`}
              className={`message-bubble${msg.from === 'coach' ? ' outgoing' : ''}`}
              style={{ alignSelf: msg.from === 'coach' ? 'flex-end' : 'flex-start', maxWidth: '72%' }}
            >
              <div style={{ fontSize: 13, lineHeight: 1.55 }}>{msg.text}</div>
              {msg.time && (
                <div style={{ fontSize: 10, marginTop: 4, textAlign: 'right', color: msg.from === 'coach' ? 'rgba(255,255,255,0.55)' : 'var(--muted)' }}>
                  {msg.time}
                </div>
              )}
            </div>
          ))}
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
            style={{ flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5, outline: 'none', background: 'var(--surface-2)', color: 'var(--accent)', minHeight: 42, maxHeight: 120 }}
          />
          <button className="btn-primary" onClick={() => sendMessage(input)} type="button" style={{ padding: '10px 14px', flexShrink: 0 }}>
            <Icon name="send" size={14} />
          </button>
        </div>
      </div>

      {/* ── Col 3 : contexte IA ── */}
      <div style={{
        borderLeft: '1px solid var(--border)',
        overflowY: 'auto',
        padding: '20px 16px',
        background: 'var(--surface)',
      }}>
        {activeClient ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
              <Avatar initials={activeClient.initials} size={36} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{activeClient.name}</div>
                <Pill status={activeClient.status as 'green' | 'amber' | 'red'} label={`Sem. ${activeClient.week}`} size="sm" />
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              <Icon name="brain" size={11} /> Contexte IA
            </div>
            {[
              { label: 'MRR', value: activeClient.mrr },
              { label: 'Followers', value: activeClient.followers },
              { label: 'Posts/sem', value: `${activeClient.posts}` },
              { label: 'DM/sem', value: activeClient.dms },
              { label: 'Momentum', value: `${activeClient.momentumScore}/100` },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 10, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--muted)' }}>{label}</span>
                <strong style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{value}</strong>
              </div>
            ))}
            {activeClient.suspens && activeClient.suspens.length > 0 && (
              <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, borderLeft: '2px solid var(--amber)' }}>
                <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>Suspens</div>
                {activeClient.suspens.map((s, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 4 }}>· {s.label}</div>
                ))}
              </div>
            )}
            {activeClient.privateNotes && (
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, borderLeft: '2px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' }}>Note privée</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                  {activeClient.privateNotes.slice(0, 140)}{activeClient.privateNotes.length > 140 ? '…' : ''}
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Sélectionner une conversation</div>
        )}
      </div>
    </div>
  );
}
