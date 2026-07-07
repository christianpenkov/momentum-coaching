'use client';

import { useState } from 'react';
import { getChatScrollLogs, clearChatScrollLogs } from '@/lib/chatScrollDebug';

/**
 * Bouton discret temporaire — copie les logs [chat-scroll] au presse-papier.
 * À retirer une fois le bug de scroll résolu.
 */
export default function ChatScrollLogsButton() {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        const logs = getChatScrollLogs();
        navigator.clipboard.writeText(logs || '(vide)');
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      onContextMenu={e => { e.preventDefault(); clearChatScrollLogs(); }}
      title="Copier les logs de scroll (clic droit / appui long = vider)"
      style={{
        position: 'absolute', top: 8, right: 8, zIndex: 30,
        fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
        background: copied ? 'var(--green-soft)' : 'var(--surface-2)',
        color: copied ? 'var(--green)' : 'var(--muted)',
        border: '1px solid var(--border)', cursor: 'pointer',
      }}
    >
      {copied ? 'Copié !' : '📋 Logs'}
    </button>
  );
}
