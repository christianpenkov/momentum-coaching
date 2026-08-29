'use client';

import { useState } from 'react';
import Icon from '@/components/ui/Icon';
import { Pill } from './PagePaiements';
import type { Orphan, Candidate } from './types';
import { fmtEur, fmtDateLong } from './types';

/**
 * Paiements qu'aucun deal ne revendique : virement encaissé à la main, lien créé
 * dans le dashboard Stripe, deal antérieur à la fonctionnalité.
 *
 * Jamais de rattachement automatique, même sur un score parfait — un faux positif
 * silencieux attribue du cash au mauvais lead sans que personne le remarque.
 */
export default function ReconcileTab({ orphans, onDone }: { orphans: Orphan[]; onDone: () => void }) {
  if (orphans.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 60, paddingBottom: 60 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--green-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={20} color="var(--green)" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Tout est rattaché</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 320 }}>
            Chaque paiement encaissé est relié à sa vente. Ceux qu&apos;aucune vente ne revendique apparaîtront ici.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, maxWidth: 640, lineHeight: 1.6 }}>
        Chaque bloc est un paiement reçu que Momentum n&apos;a pas su rattacher — lien créé directement dans Stripe, ou vente antérieure à la fonctionnalité.
      </div>
      {orphans.map(o => <OrphanCard key={o.paymentId} orphan={o} onDone={onDone} />)}
    </div>
  );
}

function OrphanCard({ orphan, onDone }: { orphan: Orphan; onDone: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (candidates || loading) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/payments/orphans?paymentId=${encodeURIComponent(orphan.paymentId)}`);
      const d = await r.json();
      setCandidates(d.candidates ?? []);
    } catch {
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/payments/orphans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paymentId: orphan.paymentId, ...body }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Échec du rattachement');
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ padding: '14px 18px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap' }}>
        <span className="mono" style={{ width: 78, flexShrink: 0 }}>{fmtDateLong(orphan.date)}</span>
        <span style={{ width: 1, height: 24, background: 'var(--border)', flexShrink: 0 }} />
        <span className="tabular" style={{ fontSize: 16, fontWeight: 600 }}>{fmtEur(orphan.amount)}</span>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--muted)', minWidth: 120 }}>
          {orphan.description || 'Aucun descriptif'}
        </span>
        <Pill label="Non rattaché" tone="amber" />
      </div>

      <div style={{ padding: '2px 18px 14px' }}>
        {!candidates && (
          <button onClick={load} disabled={loading}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--accent-brand)', padding: '13px 0', textDecoration: 'underline' }}>
            {loading ? 'Recherche…' : 'Chercher à quel deal le rattacher'}
          </button>
        )}

        {candidates?.map(c => (
          <div key={c.dealId} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0', borderTop: '1px solid var(--border-soft)', flexWrap: 'wrap' }}>
            <span style={{ width: 78, flexShrink: 0 }}>
              <Pill label={c.confidence === 'certain' ? 'Certain' : 'Possible'} tone={c.confidence === 'certain' ? 'green' : 'amber'} />
            </span>
            <span style={{ flex: 1, minWidth: 180 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
                {c.buyerName} — {fmtEur(c.amountTotal)}, signé le {fmtDateLong(c.signedAt)}
              </span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{c.reason}</span>
            </span>
            {/* Un seul bouton ardoise par bloc : le candidat certain. */}
            <button
              className={c.confidence === 'certain' ? 'btn-primary-brand' : 'btn-ghost'}
              style={{ fontSize: 12, flexShrink: 0, ...(c.confidence !== 'certain' ? { border: '1px solid var(--border)', borderRadius: 7, padding: '7px 13px' } : {}) }}
              disabled={busy}
              onClick={() => act({ dealId: c.dealId })}>
              Rattacher
            </button>
          </div>
        ))}

        {candidates && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0', borderTop: '1px solid var(--border-soft)' }}>
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-2)' }}>
              {candidates.length === 0
                ? 'Aucun deal ne correspond à ce paiement.'
                : 'Ce paiement n\'est pas un deal (remboursement, virement personnel)'}
            </span>
            <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} disabled={busy}
              onClick={() => act({ action: 'ignore' })}>
              Ignorer
            </button>
          </div>
        )}

        {error && <div style={{ fontSize: 12, color: 'var(--red)', paddingBottom: 10 }}>{error}</div>}
      </div>
    </div>
  );
}
