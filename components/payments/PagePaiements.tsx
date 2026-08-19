'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Icon from '@/components/ui/Icon';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import DealPanel from './DealPanel';
import ReconcileTab from './ReconcileTab';
import RelancesTab from './RelancesTab';
import CreateLinkModal from './CreateLinkModal';
import { useIsMobile } from '@/lib/useIsMobile';
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
  const isMobile = useIsMobile();

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
            {isLoading
              ? <span className="skeleton-shimmer" style={{ display: 'block', width: 96, height: 10, borderRadius: 4, marginTop: 3 }} />
              : subtitleFor(tab, deals.length, orphanCount, relanceCount, isCoach)}
          </div>
        </div>
        {/* Masqué tant que Stripe n'est pas connecté : proposer une action
            impossible fait perdre le temps de remplir un formulaire pour rien. */}
        {/* Libellé court sur mobile : en toutes lettres, le bouton mange la
            moitié de la largeur d'écran et écrase le titre de page. */}
        {data?.stripeConnected !== false && (
          <button className="btn-primary-brand" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
            onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} /> {isMobile ? 'Lien' : 'Créer un lien de paiement'}
          </button>
        )}
      </div>

      {/* Skeleton sur toute la zone de données — KPI, onglets et liste d'un
          bloc. Les afficher vides avec des « — » puis les remplir donnerait
          deux états successifs pour un même chargement. */}
      {isLoading && <PaymentsSkeleton isMobile={isMobile} />}

      {!isLoading && <>

      {/* ── Ruban de KPI ────────────────────────────────────────────────── */}
      {/* Mobile : un KPI héros (le collecté, la seule question qui compte sur un
          écran de 390px) et trois chiffres secondaires. Quatre cartes égales y
          seraient illisibles. */}
      {isMobile ? (
        <div style={{ marginBottom: 18 }}>
          {/* Pas de mention de période : les KPI portent sur l'intégralité des
              deals, pas sur une fenêtre glissante. Le « · 30 derniers jours »
              affiché jusqu'ici décrivait un bornage qui n'a jamais existé côté
              serveur — seul l'onglet « À rattacher » est borné. */}
          <div className="card" style={{ padding: '16px 18px', marginBottom: 10 }}>
            <div className="eyebrow-sm" style={{ marginBottom: 8 }}>Cash collecté</div>
            <div className="kpi-value tabular" style={{ color: 'var(--green)', fontSize: 34, letterSpacing: '-0.8px' }}>
              {k ? fmtEur(k.collected) : '—'}
            </div>
            <div style={{ height: 5, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden', margin: '12px 0 7px' }}>
              {(k?.collectedRate ?? 0) > 0 && (
                <div style={{ height: '100%', width: `${k?.collectedRate}%`, background: 'var(--green)', borderRadius: 3 }} />
              )}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              {k ? `${k.collectedRate} % de ${fmtEur(k.contracted)} contractés` : ''}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <MiniKpi label="Reste dû" value={k ? fmtEur(k.remaining) : '—'} />
            <MiniKpi label="Impayés" value={k ? fmtEur(k.unpaid) : '—'} color={k && k.unpaid > 0 ? 'var(--red)' : undefined} />
            <MiniKpi label="Deals" value={String(k?.dealsCount ?? 0)} />
          </div>
        </div>
      ) : (
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
      )}

      {/* ── Onglets ─────────────────────────────────────────────────────── */}
      {/* Mobile : les trois onglets se partagent la largeur au lieu d'être
          serrés à gauche — ça agrandit aussi les cibles tactiles. */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 18 }}>
        <TabButton active={tab === 'deals'} onClick={() => setTab('deals')} label="Deals" grow={isMobile} />
        <TabButton active={tab === 'reconcile'} onClick={() => setTab('reconcile')} label="À rattacher" count={orphanCount} alert grow={isMobile} />
        <TabButton active={tab === 'relances'} onClick={() => setTab('relances')} label="Relances" count={relanceCount} grow={isMobile} />
      </div>

      {tab === 'deals' ? (
        <>
          {/* Filtres masqués sans deal à filtrer : ils n'auraient aucun effet et
              encombreraient l'écran d'accueil d'un nouvel utilisateur. */}
          <div style={{ display: deals.length === 0 ? 'none' : 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
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
            {/* Desktop : poussée à droite de la rangée de filtres. Mobile : elle
                passe à la ligne, où `marginLeft: auto` la laissait décalée à
                droite sur une largeur fixe de 180px au lieu de prendre la
                largeur disponible. */}
            <span style={{
              marginLeft: isMobile ? 0 : 'auto',
              width: isMobile ? '100%' : undefined,
              display: 'flex', alignItems: 'center', gap: 8,
              border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', background: 'var(--surface)',
            }}>
              <Icon name="search" size={15} color="var(--faint)" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une personne…"
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, color: 'var(--ink)', fontFamily: 'inherit', width: isMobile ? '100%' : 180, minWidth: 0 }} />
            </span>
          </div>

          {/* Stripe absent prime sur « aucun deal » : c'est ce qui bloque, et le
              premier écran que verra tout nouvel utilisateur. */}
          {data && !data.stripeConnected
            ? <StripeDisconnected isCoach={isCoach} />
            : deals.length === 0
              ? <EmptyDeals onCreate={() => setCreating(true)} />
              : isMobile
                ? <DealCards rows={filtered} onOpen={setOpenDeal} />
                : <DealsTable rows={filtered} isCoach={isCoach} onOpen={setOpenDeal} />}
        </>
      ) : tab === 'reconcile' ? (
        <ReconcileTab orphans={data?.orphans ?? []} onDone={refetch} />
      ) : (
        <RelancesTab deals={deals} details={data?.details ?? {}} onChange={refetch} />
      )}

      </>}

      {openDeal && data && (
        <DealPanel
          deal={deals.find(d => d.id === openDeal)!}
          detail={data.details[openDeal]}
          onClose={() => setOpenDeal(null)}
          onChange={refetch}
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

/**
 * Squelette de chargement — reprend la structure exacte de la page (ruban de
 * KPI, onglets, lignes) pour que le contenu se substitue à lui sans que la
 * mise en page saute. Le shimmer `.skeleton-shimmer` est le même que sur les
 * autres écrans de l'app.
 */
function PaymentsSkeleton({ isMobile }: { isMobile: boolean }) {
  const bar = (w: number | string, h: number, extra?: React.CSSProperties) => (
    <div className="skeleton-shimmer" style={{ width: w, height: h, borderRadius: 4, ...extra }} />
  );

  return (
    <div aria-busy="true" aria-label="Chargement des paiements">
      {isMobile ? (
        <div style={{ marginBottom: 18 }}>
          <div className="card" style={{ padding: '16px 18px', marginBottom: 10 }}>
            {bar(110, 10, { marginBottom: 12 })}
            {bar(150, 30, { borderRadius: 6 })}
            {bar('100%', 5, { borderRadius: 3, margin: '14px 0 9px' })}
            {bar(170, 10)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[0, 1, 2].map(i => (
              <div key={i} className="card" style={{ padding: '12px 13px' }}>
                {bar('70%', 9, { marginBottom: 9 })}
                {bar('85%', 16, { borderRadius: 5 })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 20 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="card" style={{ padding: '16px 18px' }}>
              {bar('65%', 10, { marginBottom: 11 })}
              {bar('80%', 22, { borderRadius: 5, marginBottom: 9 })}
              {bar('50%', 9)}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: isMobile ? 4 : 20, borderBottom: '1px solid var(--border)', marginBottom: 18, padding: '0 0 11px' }}>
        {[70, 92, 78].map((w, i) => (
          <div key={i} style={{ flex: isMobile ? 1 : undefined, display: 'flex', justifyContent: isMobile ? 'center' : undefined }}>
            {bar(isMobile ? '70%' : w, 12)}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="card" style={{ padding: isMobile ? '14px 16px' : '15px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 11 }}>
              {bar(isMobile ? 32 : 30, isMobile ? 32 : 30, { borderRadius: '50%', flexShrink: 0 })}
              <div style={{ flex: 1, minWidth: 0 }}>
                {bar(`${45 + ((i * 13) % 30)}%`, 12, { marginBottom: 6 })}
                {bar(`${30 + ((i * 17) % 25)}%`, 9)}
              </div>
              {bar(72, 20, { borderRadius: 999, flexShrink: 0 })}
            </div>
            {bar('100%', 4, { borderRadius: 2 })}
          </div>
        ))}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label, count, alert, grow }: {
  active: boolean; onClick: () => void; label: string; count?: number; alert?: boolean;
  /** Partage la largeur disponible à parts égales (mobile). */
  grow?: boolean;
}) {
  return (
    <button onClick={onClick} style={{
      flex: grow ? 1 : undefined,
      justifyContent: grow ? 'center' : undefined,
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: grow ? '10px 4px' : '10px 15px', fontSize: 13,
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
          <Avatar initials={getInitials(d.buyerName)} avatarUrl={d.avatarUrl} size={26} seed={d.id} />
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
          {pct > 0 && (
            <span style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 2, background: st.barColor }} />
          )}
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

function MiniKpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '11px 12px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
      <div className="tabular" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px', color: color ?? 'var(--ink)' }}>{value}</div>
    </div>
  );
}

/**
 * Version mobile du tableau : une carte par deal.
 *
 * Pas de scroll horizontal — sept colonnes sur 390px sont illisibles, et faire
 * glisser un tableau latéralement pour lire un montant est une solution de repli
 * qu'on refuse ici (mobile et desktop sont deux usages réels, pas l'un dégradé
 * de l'autre). La carte entière est cliquable : la cible tactile fait toute la
 * ligne plutôt qu'un bouton de 30px.
 */
function DealCards({ rows, onOpen }: { rows: DealRow[]; onOpen: (id: string) => void }) {
  if (rows.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>Aucun deal ne correspond.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map(d => {
        const pct = d.amountTotal > 0 ? Math.min(100, Math.round((d.collected / d.amountTotal) * 100)) : 0;
        const st = statusOf(d);
        return (
          <button key={d.id} onClick={() => onOpen(d.id)} className="card"
            style={{
              padding: '14px 16px', textAlign: 'left', border: '1px solid var(--border)',
              cursor: 'pointer', fontFamily: 'inherit', width: '100%', display: 'block',
              // Sans couleur explicite, Safari iOS applique le bleu `buttontext`
              // par défaut à tout le contenu de la carte (nom, montants, barre).
              color: 'var(--ink)',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 10 }}>
              <Avatar initials={getInitials(d.buyerName)} avatarUrl={d.avatarUrl} size={32} seed={d.id} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.buyerName}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {[planLabel(d), fmtDate(d.signedAt)].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Pill label={st.label} tone={st.tone} />
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 9 }}>
              {/* Toujours un montant chiffré, jamais un tiret : « 0 € / 2 100 € »
                  se lit d'un coup d'œil comme « rien encaissé sur 2 100 »,
                  alors qu'un « — » oblige à interpréter. */}
              <span className="tabular" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.4px', color: d.collected > 0 ? 'var(--ink)' : 'var(--muted)' }}>
                {fmtEur(d.collected)}
              </span>
              <span className="tabular" style={{ fontSize: 13, color: 'var(--muted)' }}>/ {fmtEur(d.amountTotal)}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>{progressLabel(d)}</span>
            </div>

            <span style={{ display: 'block', height: 4, borderRadius: 2, background: 'var(--surface-2)', overflow: 'hidden' }}>
              {/* Rien de peint à 0 % : un `width: 0` laissait un reliquat visible
                  de la largeur du border-radius, collé à gauche. */}
              {pct > 0 && (
                <span style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 2, background: st.barColor }} />
              )}
            </span>
          </button>
        );
      })}
    </div>
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

/**
 * Premier écran de tout nouvel utilisateur : il doit vendre ce que la connexion
 * débloque, pas se contenter de constater une absence.
 */
function StripeDisconnected({ isCoach }: { isCoach: boolean }) {
  const bullets = [
    'Chaque euro encaissé rattaché à son deal et à son prospect',
    'Le contenu Instagram ou YouTube qui a produit le lead',
    'Échéances, impayés et relances suivis sans aucune saisie',
  ];
  return (
    <div className="card" style={{ padding: '48px 40px', maxWidth: 620, margin: '32px auto 0' }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-brand-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <Icon name="stripe" size={20} color="var(--accent-brand)" />
      </div>
      <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.2px', marginBottom: 10 }}>
        Relie Stripe, et le reste se fait tout seul
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.65, maxWidth: 420, marginBottom: 22 }}>
        Quand un client paie sur Stripe, il apparaît ici automatiquement, rattaché au deal et au contenu qui l&apos;a produit.
      </div>
      {bullets.map(t => (
        <div key={t} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', marginBottom: 11 }}>
          <span style={{ marginTop: 4, flexShrink: 0, display: 'flex' }}>
            <Icon name="check" size={14} color="var(--green)" />
          </span>
          <span style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>{t}</span>
        </div>
      ))}
      <a href={isCoach ? '/settings' : '/client/settings'} className="btn-primary-brand"
        style={{ fontSize: 12.5, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
        <Icon name="link" size={13} /> Connecter Stripe
      </a>
    </div>
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
