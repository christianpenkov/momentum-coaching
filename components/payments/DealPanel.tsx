'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/ui/Icon';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import type { DealRow, DealDetail } from './types';
import { fmtEur, fmtDateLong } from './types';

/**
 * Détail d'un deal — panneau latéral, pas modal centré : la liste reste visible
 * derrière, ce qui permet d'enchaîner plusieurs deals sans perdre le contexte.
 */
export default function DealPanel({ deal, detail, onClose }: {
  deal: DealRow;
  detail?: DealDetail;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // Échap ferme le panneau — attendu de tout overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const payments = detail?.payments ?? [];
  const installments = detail?.installments ?? [];
  const remaining = deal.amountTotal - deal.collected;
  const unpaid = deal.hasFailure ? remaining : 0;

  // Le lien à copier dépend de l'état : l'échéance suivante à envoyer en mode
  // manuel, le lien du deal sinon. L'élève copie et envoie, Momentum n'envoie rien.
  const nextInstallment = installments.find(i => i.status !== 'paid');
  const linkToCopy = nextInstallment?.short_url ?? deal.shortUrl;
  const linkLabel = nextInstallment
    ? `Lien de paiement · échéance ${nextInstallment.rank}/${installments.length}`
    : 'Lien de paiement Stripe';

  async function copy() {
    if (!linkToCopy) return;
    await navigator.clipboard.writeText(linkToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,21,.42)', zIndex: 400 }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px, 100vw)', zIndex: 401,
        background: 'var(--surface)', boxShadow: 'var(--shadow-modal)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* En-tête */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 13, flexShrink: 0 }}>
          <Avatar initials={getInitials(deal.buyerName)} size={38} seed={deal.id} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.1px' }}>{deal.buyerName}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {[deal.buyerSubtitle, `signé le ${fmtDateLong(deal.signedAt)}`].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
            <Icon name="x" size={18} color="var(--muted)" />
          </button>
        </div>

        {/* Totaux */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-soft)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, flexShrink: 0 }}>
          <Total label="Contracté" value={fmtEur(deal.amountTotal)} />
          <Total label="Collecté" value={fmtEur(deal.collected)} color="var(--green)" />
          <Total label="Reste dû" value={fmtEur(Math.max(0, remaining - unpaid))} />
          <Total label="Impayé" value={fmtEur(unpaid)} color={unpaid > 0 ? 'var(--red)' : undefined} />
        </div>

        {/* Versements */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
          <div className="mono" style={{ marginBottom: 13 }}>
            {planSummary(deal)}
          </div>

          {installments.length > 0
            ? installments.map(i => (
                <Line key={i.id}
                  dot={i.status === 'paid' ? 'green' : i.sent_at ? 'amber' : 'neutral'}
                  title={`Versement ${i.rank} · ${fmtDateLong(i.due_on)}`}
                  sub={i.status === 'paid' ? 'payé' : i.sent_at ? 'lien envoyé, en attente' : 'à envoyer'}
                  amount={fmtEur(Number(i.amount))}
                  dim={i.status !== 'paid'}
                />
              ))
            : payments.length > 0
              ? payments.map(p => (
                  <Line key={p.id}
                    dot={p.status === 'succeeded' ? 'green' : 'red'}
                    title={fmtDateLong(p.paid_at)}
                    sub={p.status === 'succeeded' ? 'encaissé' : (p.failure_reason ?? 'échec')}
                    amount={fmtEur(Number(p.amount))}
                    dim={p.status !== 'succeeded'}
                  />
                ))
              : <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Aucun paiement encaissé pour l&apos;instant.</div>}

          {/* Le lien vit ici, pas en pied de panneau : le bloc dit DE QUEL lien il
              s'agit, ce qu'un bouton isolé ne pourrait pas faire. */}
          {linkToCopy && deal.status !== 'paid' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 12, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}>
              <Icon name="link" size={15} color="var(--accent-brand)" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="mono" style={{ display: 'block' }}>{linkLabel}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {linkToCopy.replace(/^https?:\/\//, '')}
                </span>
              </span>
              <button className="btn-ghost" onClick={copy}
                style={{ fontSize: 12, padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 7, display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, background: 'var(--surface)' }}>
                <Icon name={copied ? 'check' : 'copy'} size={14} color={copied ? 'var(--green)' : 'var(--muted)'} />
                {copied ? 'Copié' : 'Copier'}
              </button>
            </div>
          )}
        </div>

        {/* Chaîne d'acquisition */}
        <div style={{ padding: '14px 24px 20px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div className="mono" style={{ marginBottom: 15 }}>Comment {deal.buyerName.split(' ')[0]} est arrivé</div>
          <AcquisitionChain dealId={deal.id} />
        </div>
      </aside>
    </>
  );
}

function Total({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>{label}</div>
      <div className="tabular" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px', color: color ?? 'var(--ink)' }}>{value}</div>
    </div>
  );
}

function Line({ dot, title, sub, amount, dim }: {
  dot: 'green' | 'red' | 'amber' | 'neutral'; title: string; sub: string; amount: string; dim?: boolean;
}) {
  const color = dot === 'green' ? 'var(--green)' : dot === 'red' ? 'var(--red)' : dot === 'amber' ? 'var(--amber)' : '#d8d2c5';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, color: dim ? 'var(--muted)' : 'var(--ink)' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{sub}</span>
      </span>
      <span className="tabular" style={{ fontSize: 13, fontWeight: 600, color: dim ? 'var(--muted)' : 'var(--ink)' }}>{amount}</span>
    </div>
  );
}

/**
 * Parcours du prospect, reconstruit depuis prospect_events — la table journalise
 * déjà tout le funnel (lm_sent, hook_replied, link_clicked, call_booked).
 */
function AcquisitionChain({ dealId }: { dealId: string }) {
  const [steps, setSteps] = useState<{ label: string; date: string }[] | null>(null);

  useEffect(() => {
    fetch(`/api/payments/chain?dealId=${dealId}`)
      .then(r => r.ok ? r.json() : { steps: [] })
      .then(d => setSteps(d.steps ?? []))
      .catch(() => setSteps([]));
  }, [dealId]);

  if (steps === null) return <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Chargement…</div>;
  if (steps.length === 0) {
    return (
      <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
        Ce deal n&apos;est rattaché à aucun prospect du pipeline — créé à la main ou vente directe.
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', paddingLeft: 24 }}>
      <div style={{ position: 'absolute', left: 5, top: 7, bottom: 11, width: 1, background: 'var(--border)' }} />
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <div key={i} style={{ position: 'relative', paddingBottom: last ? 0 : 8 }}>
            <span style={{
              position: 'absolute', left: -24, top: 3, width: 11, height: 11, borderRadius: '50%',
              boxSizing: 'border-box',
              background: last ? 'var(--accent-brand)' : 'var(--surface)',
              border: `1.5px solid ${last ? 'var(--accent-brand)' : 'var(--border)'}`,
            }} />
            <div style={{ display: 'flex', gap: 12 }}>
              <span style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.4 }}>{s.label}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{s.date}</span>
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 13 }}>
        Attribution au premier contact — le contenu qui a généré le lead.
      </div>
    </div>
  );
}

function planSummary(d: DealRow): string {
  const base = `Deal du ${fmtDateLong(d.signedAt)} · ${fmtEur(d.amountTotal)}`;
  if (d.paymentPlan === 'one_shot') return `${base} · comptant`;
  const every = d.installmentInterval === 'week' ? 'hebdomadaire' : 'mensuel';
  const mode = d.paymentPlan === 'installments_auto' ? 'prélèvement automatique' : 'un lien par échéance';
  return `${base} en ${d.installmentsCount}× ${every} · ${mode}`;
}
