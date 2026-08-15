'use client';

import { useState, useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import type { Call } from '@/lib/supabase/types';

interface UnmatchedItem {
  id: string;
  fathom_recording_id: string;
  fathom_share_url: string | null;
  meeting_title: string | null;
  meeting_url: string | null;
  calendar_invitees: { name?: string; email?: string }[] | null;
  recording_start_time: string | null;
  created_at: string;
}

interface Props {
  calls: Call[];
  getClientName: (clientId: string | null) => string | null;
  onResolved: () => void;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function FathomUnmatchedTab({ calls, getClientName, onResolved }: Props) {
  const [items, setItems] = useState<UnmatchedItem[] | null>(null);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/fathom/unmatched');
    const data = await res.json().catch(() => ({}));
    setItems(res.ok ? data.items || [] : []);
  }

  useEffect(() => { load(); }, []);

  async function attach(unmatchedId: string) {
    const callId = selectedCallId[unmatchedId];
    if (!callId) return;
    setAttachingId(unmatchedId);
    setError(null);
    try {
      const res = await fetch('/api/fathom/unmatched', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unmatchedId, callId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors du rattachement');
      }
      await load();
      onResolved();
    } catch (e: any) {
      setError(e.message || 'Erreur lors du rattachement');
    } finally {
      setAttachingId(null);
    }
  }

  // Calls candidats au rattachement manuel — pas déjà matchés, triés du plus récent au plus ancien.
  const candidateCalls = calls
    .filter(c => !c.fathom_recording_id)
    .sort((a, b) => new Date(b.scheduled_at || 0).getTime() - new Date(a.scheduled_at || 0).getTime());

  if (items === null) {
    return <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Chargement…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>
        Aucun enregistrement Fathom en attente de rattachement.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {error && (
        <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 12px', background: '#fef2f2', borderRadius: 8 }}>{error}</div>
      )}
      {items.map(item => {
        const inviteeLabel = item.calendar_invitees?.map(i => i.name || i.email).filter(Boolean).join(', ') || '—';
        return (
          <div key={item.id} className="card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                  {item.meeting_title || 'Enregistrement Fathom'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {formatDate(item.recording_start_time || item.created_at)} · {inviteeLabel}
                </div>
              </div>
              {item.fathom_share_url && (
                <a href={item.fathom_share_url} target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  <Icon name="video" size={13} /> Voir
                </a>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              <select
                value={selectedCallId[item.id] || ''}
                onChange={e => setSelectedCallId(prev => ({ ...prev, [item.id]: e.target.value }))}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 12, fontFamily: 'inherit' }}
              >
                <option value="">Rattacher à un call…</option>
                {candidateCalls.map(c => (
                  <option key={c.id} value={c.id}>
                    {formatDate(c.scheduled_at)} — {getClientName(c.client_id) || c.invitee_name || c.invitee_email || 'Sans nom'}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary-brand"
                style={{ fontSize: 12, flexShrink: 0 }}
                disabled={!selectedCallId[item.id] || attachingId === item.id}
                onClick={() => attach(item.id)}
              >
                {attachingId === item.id ? '…' : 'Rattacher'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
