'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Icon from '@/components/ui/Icon';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import DealPanel from './DealPanel';
import ReconcileTab from './ReconcileTab';
import RelancesTab from './RelancesTab';
import CreateLinkModal from './CreateLinkModal';
import type { PaymentsData, DealRow } from './types';
import { fmtEur } from './types';

/**
 * Page Paiements — « où est mon argent ».
 *
 * Un seul composant monté deux fois, comme PageClientStats : le coach voit son
 * propre business, l'élève le sien. Les deux business ne sont jamais reliés —
 * qu'un élève paie Quennel n'a aucun rapport avec ce que cet élève encaisse de
 * ses prospects.
 */

type Tab = 'deals' | 'reconcile' | 'relances';
type Filter = 'all' | 'open' | 'unpaid' | 'paid';

export default function PagePaiements({ title = 'Paiements', isCoach = false }: { title?: string; isCoach?: boolean }) {
  const [tab, setTab] = useState<Tab>('deals');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [openDeal, setOpenDeal] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, refetch } = useQuery<PaymentsData>({
    queryKey: ['payments'],
    queryFn: () => fetch('/api/payments').then(r => {
      if (!r.ok) throw new Error('Chargement impossible');
      return r.json();
    }),
    staleTime: 60_000,
  });

  const deals = data?.deals ?? [];

  const filtered = useMemo(() => {
    let rows = deals;
    if (filter === 'open') rows = rows.filter(d => d.status === 'open');
    else if (filter === 'unpaid') rows = rows.filter(d => d.status === 'past_due' || d.hasFailure);
    else if (filter === 'paid') rows = rows.filter(d => d.status === 'paid');

    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter(d =>
      d.buyerName.toLowerCase().includes(q) || (d.buyerSubtitle ?? '').toLowerCase().includes(q)
    );
    return rows;
  }, [deals, filter, search]);

  const k = data?.kpis;
  const orphanCount = data?.orphans.length ?? 0;
  const relanceCount = useMemo(() => countRelances(deals), [deals]);

  return (
    <div className="page-content" style={{ paddingBottom: 40 }}>
      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px', margin: 0 }}>{title}</h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            {isLoading ? '…' : subtitleFor(tab, deals.length, orphanCount, relanceCount, isCoach)}
          </div>
        </div>
        <button className="btn-primary-brand" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => setCreating(true)}>
          <Icon name="plus" size={13} /> Créer un lien de paiement
        </button>
      </div>

      {/* ── Ruban de KPI ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 20 }}>
        <Kpi label="Cash contracté" value={k ? fmtEur(k.contracted) : '—'}
          sub={k ? `${k.dealsCount} deal${k.dealsCount > 1 ? 's' : ''} signé${k.dealsCount > 1 ? 's' : ''}` : ''} />
        <Kpi label="Cash collecté" value={k ? fmtEur(k.collected) : '—'}
          sub={k ? `${k.collectedRate} % du contracté` : ''} color="var(--green)" />
        <Kpi label="Reste à encaisser" value={k ? fmtEur(k.remaining) : '—'} sub="échéances à venir" />
        <Kpi label="Impayés" value={k ? fmtEur(k.unpaid) : '—'}
          sub={k && k.failedCount > 0 ? `${k.failedCount} carte refusée` : 'tout est à jour'}
          color={k && k.unpaid > 0 ? 'var(--red)' : 'var(--green)'} />
      </div>

      {/* ── Onglets ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 18 }}>
        <TabButton active={tab === 'deals'} onClick={() => setTab('deals')} label="Deals" />
        <TabButton active={tab === 'reconcile'} onClick={() => setTab('reconcile')} label="À rattacher" count={orphanCount} alert />
        <TabButton active={tab === 'relances'} onClick={() => setTab('relances')} label="Relances" count={relanceCount} />
      </div>

      {isLoading ? (
        <div style={{ padding: 60, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>Chargement…</div>
      ) : tab === 'deals' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {([['all', 'Tous'], ['open', 'En cours'], ['unpaid', 'Impayés'], ['paid', 'Soldés']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)}
                style={{
                  border: `1px solid ${filter === key ? 'var(--ink)' : 'var(--border)'}`,
                  background: filter === key ? 'var(--ink)' : 'var(--surface)',
                  color: filter === key ? '#fff' : 'var(--ink-2)',
                  fontWeight: filter === key ? 600 : 400,
                  borderRadius: 999, padding: '6px 13px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
                }}>{label}</button>
            ))}
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', background: 'var(--surface)' }}>
              <Icon name="search" size={15} color="var(--faint)" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une personne…"
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, color: 'var(--ink)', fontFamily: 'inherit', width: 180 }} />
            </span>
          </div>

          {deals.length === 0
            ? <EmptyDeals onCreate={() => setCreating(true)} />
            : <DealsTable rows={filtered} isCoach={isCoach} onOpen={setOpenDeal} />}
        </>
      ) : tab === 'reconcile' ? (
        <ReconcileTab orphans={data?.orphans ?? []} onDone={refetch} />
      ) : (
        <RelancesTab deals={deals} details={data?.details ?? {}} />
      )}

      {openDeal && data && (
        <DealPanel
          deal={deals.find(d => d.id === openDeal)!}
          detail={data.details[openDeal]}
          onClose={() => setOpenDeal(null)}
        />
      )}

      {creating && (
        <CreateLinkModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); refetch(); }} />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value tabular" style={color ? { color } : undefined}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 5 }}>{sub}</div>
    </div>
  );
}

function TabButton({ active, onClick, label, count, alert }: {
  active: boolean; onClick: () => void; label: string; count?: number; alert?: boolean;
}) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 15px', fontSize: 13,
      marginBottom: -1, borderBottom: `2px solid ${active ? 'var(--accent-brand)' : 'transparent'}`,
      color: active ? 'var(--ink)' : 'var(--muted)', fontWeight: active ? 600 : 400,
      background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
      borderBottomWidth: 2, borderBottomStyle: 'solid',
      borderBottomColor: active ? 'var(--accent-brand)' : 'transparent',
    }}>
      {label}
      {count !== undefined && count > 0 && (
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999,
          background: alert ? 'var(--red)' : 'var(--surface-2)',
          color: alert ? '#fff' : 'var(--muted)',
        }}>{count}</span>
      )}
    </button>
  );
}

function DealsTable({ rows, isCoach, onOpen }: { rows: DealRow[]; isCoach: boolean; onOpen: (id: string) => void }) {
  if (rows.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>Aucun deal ne correspond.</div>;
  }
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ minWidth: isCoach ? 860 : 780 }}>
          <thead>
            <tr>
              <th>Personne</th>
              <th>Plan</th>
              <th style={{ textAlign: 'right' }}>Contracté</th>
              <th style={{ textAlign: 'right' }}>Collecté</th>
              <th>Avancement</th>
              <th>Statut</th>
              {isCoach && <th>Type</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(d => <DealRowView key={d.id} d={d} isCoach={isCoach} onOpen={onOpen} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DealRowView({ d, isCoach, onOpen }: { d: DealRow; isCoach: boolean; onOpen: (id: string) => void }) {
  const pct = d.amountTotal > 0 ? Math.min(100, Math.round((d.collected / d.amountTotal) * 100)) : 0;
  const st = statusOf(d);

  return (
    <tr>
      <td>
        <span style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
          <Avatar initials={getInitials(d.buyerName)} size={26} seed={d.id} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.buyerName}</span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {[d.buyerSubtitle, fmtDate(d.signedAt)].filter(Boolean).join(' · ')}
            </span>
          </span>
        </span>
      </td>
      <td style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{planLabel(d)}</td>
      <td className="tabular" style={{ textAlign: 'right', fontWeight: 600 }}>{fmtEur(d.amountTotal)}</td>
      {/* « — » et non « 0 € » : rien d'encaissé n'est pas un encaissement de zéro. */}
      <td className="tabular" style={{ textAlign: 'right', fontWeight: 600, color: d.collected > 0 ? 'var(--ink)' : 'var(--muted)' }}>
        {d.collected > 0 ? fmtEur(d.collected) : '—'}
      </td>
      <td>
        <span style={{ display: 'block', height: 4, borderRadius: 2, background: 'var(--surface-2)', overflow: 'hidden', minWidth: 90 }}>
          <span style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 2, background: st.barColor }} />
        </span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>{progressLabel(d)}</span>
      </td>
      <td><Pill label={st.label} tone={st.tone} /></td>
      {isCoach && <td><Pill label={d.buyerKind === 'student' ? 'Élève' : 'Externe'} tone="neutral" /></td>}
      <td style={{ textAlign: 'right' }}>
        <button className="btn-ghost" style={{ fontSize: 12, padding: '5px 11px', border: '1px solid var(--ink)', color: 'var(--ink)', borderRadius: 7 }}
          onClick={() => onOpen(d.id)}>Détails</button>
      </td>
    </tr>
  );
}

export function Pill({ label, tone }: { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }) {
  const map = {
    green: { bg: 'var(--green-soft)', fg: 'var(--green)' },
    amber: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
    red: { bg: 'var(--red-soft)', fg: 'var(--red)' },
    neutral: { bg: 'var(--surface-2)', fg: 'var(--muted)' },
  }[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
      padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', background: map.bg, color: map.fg,
    }}>
      {tone !== 'neutral' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />}
      {label}
    </span>
  );
}

function EmptyDeals({ onCreate }: { onCreate: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 60, paddingBottom: 60 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="circle-dollar-sign" size={20} color="var(--muted)" />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Aucun deal pour l&apos;instant</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 300 }}>
          Un deal apparaît ici dès que tu clôtures un call, ou quand tu crées un lien de paiement à la main.
        </div>
      </div>
      <button className="btn-primary-brand" style={{ fontSize: 12, marginTop: 6 }} onClick={onCreate}>
        Créer un lien de paiement
      </button>
    </div>
  );
}

/* ── Helpers d'affichage ──────────────────────────────────────────────────── */

function statusOf(d: DealRow): { label: string; tone: 'green' | 'amber' | 'red'; barColor: string } {
  if (d.status === 'paid') return { label: 'Payé', tone: 'green', barColor: 'var(--green)' };
  if (d.hasFailure || d.status === 'past_due') return { label: 'Carte refusée', tone: 'red', barColor: 'var(--red)' };
  if (d.paymentPlan === 'installments_manual' && d.paidCount > 0) return { label: 'À envoyer', tone: 'amber', barColor: 'var(--amber)' };
  if (d.collected > 0) return { label: 'En cours', tone: 'amber', barColor: 'var(--amber)' };
  return { label: 'En attente', tone: 'amber', barColor: 'var(--amber)' };
}

function planLabel(d: DealRow): string {
  if (d.paymentPlan === 'one_shot') return 'Comptant';
  const every = d.installmentInterval === 'week' ? 'hebdo' : 'mensuel';
  const mode = d.paymentPlan === 'installments_auto' ? 'auto' : 'manuel';
  return `${d.installmentsCount}× ${every} · ${mode}`;
}

function progressLabel(d: DealRow): string {
  if (d.status === 'paid') return 'soldé';
  if (d.paymentPlan === 'one_shot') return d.collected > 0 ? 'partiel' : 'en attente de paiement';
  return `${d.paidCount} / ${d.expectedCount} versements`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function subtitleFor(tab: Tab, deals: number, orphans: number, relances: number, isCoach: boolean): string {
  if (tab === 'reconcile') return `${orphans} paiement${orphans > 1 ? 's' : ''} sans identifiant Momentum`;
  if (tab === 'relances') return `${relances} relance${relances > 1 ? 's' : ''} en attente`;
  return `${isCoach ? 'Mon business' : ''}${isCoach ? ' · ' : ''}${deals} deal${deals > 1 ? 's' : ''} signé${deals > 1 ? 's' : ''}`;
}

/** Un deal appelle une relance dès qu'il reste de l'argent à aller chercher. */
export function countRelances(deals: DealRow[]): number {
  return deals.filter(d => d.status !== 'paid' && d.status !== 'canceled').length;
}
