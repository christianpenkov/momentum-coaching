'use client';

import Link from 'next/link';
import Avatar from '@/components/ui/Avatar';
import type { ClientWithMetrics } from '@/lib/supabase/useCoachData';
import type { Call } from '@/lib/supabase/types';

const STATUS_LABEL: Record<string, string> = { green: 'Vert', amber: 'Vigilance', red: 'Alerte' };
const STATUS_COLOR: Record<string, string> = { green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)' };
const STATUS_BAR_WIDTH: Record<string, number> = { green: 90, amber: 55, red: 25 };

interface ChatContextPanelProps {
  client: ClientWithMetrics;
  calls: Call[];
}

export default function ChatContextPanel({ client, calls }: ChatContextPanelProps) {
  const nextCall = calls
    .filter(c => c.client_id === client.id && c.scheduled_at && new Date(c.scheduled_at) >= new Date())
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())[0];

  const nextCallLabel = nextCall?.scheduled_at
    ? new Date(nextCall.scheduled_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })
    : null;
  const nextCallTime = nextCall?.scheduled_at
    ? new Date(nextCall.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <aside style={{
      width: 260, flexShrink: 0, borderLeft: '1px solid var(--border)',
      background: 'var(--surface)', padding: '20px 16px',
      display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ margin: '0 auto 10px' }}>
          <Avatar initials={client.initials || client.name.slice(0, 2).toUpperCase()} avatarUrl={client.avatar_url} size={60} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{client.name}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
          {client.niche || 'Infopreneur'} · Semaine {client.week}
        </div>
      </div>

      <div className="card tight">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Momentum</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOR[client.status] || 'var(--muted)' }}>
            {STATUS_LABEL[client.status] || '—'}
          </span>
        </div>
        <div className="momentum-bar-track">
          <div
            className="momentum-bar-fill"
            style={{ width: `${STATUS_BAR_WIDTH[client.status] ?? 0}%`, background: STATUS_COLOR[client.status] || 'var(--faint)' }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>MRR</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
              {(client.latestMetrics?.stripe_mrr || 0).toLocaleString('fr-FR')} €
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Statut</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: STATUS_COLOR[client.status] || 'var(--ink)' }}>
              {STATUS_LABEL[client.status] || '—'}
            </div>
          </div>
        </div>
      </div>

      {nextCall && (
        <div style={{ background: 'var(--ink)', color: '#fbfbf7', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: 'rgba(251,251,247,0.65)', marginBottom: 4 }}>Prochain call</div>
          <div style={{ fontSize: 15, fontWeight: 600, textTransform: 'capitalize' }}>{nextCallLabel} · {nextCallTime}</div>
          {nextCall.topic && (
            <div style={{ fontSize: 12, color: 'rgba(251,251,247,0.75)', marginTop: 2 }}>{nextCall.topic}</div>
          )}
        </div>
      )}

      <div className="card tight" style={{ padding: '4px 14px' }}>
        <Link href={`/clients/${client.id}`} className="dc-liftrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', fontSize: 13, borderBottom: '1px solid var(--border-soft)', textDecoration: 'none', color: 'var(--ink)' }}>
          Voir la fiche client<span style={{ color: 'var(--faint)' }}>›</span>
        </Link>
        <Link href={`/clients/${client.id}#ressources`} className="dc-liftrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', fontSize: 13, borderBottom: '1px solid var(--border-soft)', textDecoration: 'none', color: 'var(--ink)' }}>
          Ressources partagées<span style={{ color: 'var(--faint)' }}>›</span>
        </Link>
        <Link href={`/clients/${client.id}#calls`} className="dc-liftrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', fontSize: 13, textDecoration: 'none', color: 'var(--ink)' }}>
          Historique des calls<span style={{ color: 'var(--faint)' }}>›</span>
        </Link>
      </div>
    </aside>
  );
}
