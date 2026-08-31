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
        {/* L'explication générique vivait ici parce qu'on ne savait pas distinguer
            les cas. Chaque bloc porte désormais SA cause, et la cause décide du
            geste : la garder ici en plus ne ferait que répéter du vague. */}
        Chaque bloc est un encaissement réel qu&apos;aucune vente ne revendique. La cause est indiquée sur chacun — c&apos;est elle qui dit quoi faire.
      </div>
      {orphans.map(o => <OrphanCard key={o.paymentId} orphan={o} onDone={onDone} />)}
    </div>
  );
}

/**
 * Pourquoi CE paiement n'appartient à aucune vente, et ce que ça change à faire.
 *
 * Une étiquette qui nommerait la cause sans dire l'action ne vaudrait pas mieux
 * que l'explication générique qu'elle remplace : les trois causes n'appellent pas
 * le même geste.
 *
 * ⚠️ `abonnement_inconnu` est le seul cas où rattacher le paiement NE RÈGLE PAS le
 * problème. L'abonnement continue de prélever sans être relié à une vente : la
 * prochaine échéance retombera ici, et celle d'après. Sans cet avertissement,
 * l'élève rattache un versement par mois pendant un an sans comprendre pourquoi
 * ça revient — et conclut que l'écran est cassé.
 */
function CauseDeLOrphelinat({ cause }: { cause: Orphan['cause'] }) {
  // `null` = on ne sait pas, et surtout PAS « aucune cause ». Le dire, plutôt que
  // de n'afficher rien : un blanc se lit comme une absence de problème.
  const c = cause === 'metadata_absente'
    ? { ton: 'neutre' as const, titre: 'Encaissé hors des liens Momentum',
        texte: 'Lien créé directement dans Stripe, ou virement saisi à la main. Rattache-le à la bonne vente.' }
    : cause === 'deal_supprime'
    ? { ton: 'attention' as const, titre: 'La vente visée n’existe plus',
        texte: 'Ce paiement désignait une vente qui a été supprimée depuis. Avant de le rattacher ailleurs, vérifie ce qui a été supprimé — l’argent, lui, a bien été encaissé.' }
    : cause === 'abonnement_inconnu'
    ? { ton: 'grave' as const, titre: 'Prélèvement d’un abonnement sans vente',
        texte: 'Rattacher ce paiement ne suffira pas : l’abonnement n’est relié à aucune vente, donc la prochaine échéance reviendra ici, et les suivantes aussi. Rattache-le, puis relie l’abonnement à cette vente depuis Stripe.' }
    : { ton: 'neutre' as const, titre: 'Cause inconnue',
        texte: 'Cet encaissement est antérieur à l’enregistrement des causes, ou trop ancien pour que Stripe le renseigne encore. On ne sait pas pourquoi il est orphelin — ce n’est pas la preuve qu’il n’y a rien à comprendre.' };

  const teinte = c.ton === 'grave'
    ? { fond: 'var(--red-soft)', bord: 'rgba(205,91,63,.28)', ink: 'var(--red)' }
    : c.ton === 'attention'
    ? { fond: 'var(--amber-soft)', bord: 'rgba(181,128,37,.28)', ink: 'var(--amber-ink)' }
    : { fond: 'var(--surface)', bord: 'var(--border-soft)', ink: 'var(--ink-2)' };

  return (
    <div style={{
      padding: '11px 18px', background: teinte.fond,
      borderBottom: `1px solid ${teinte.bord}`, fontSize: 12.5, lineHeight: 1.6,
    }}>
      <span style={{ fontWeight: 600, color: teinte.ink }}>{c.titre}</span>
      <span style={{ color: 'var(--ink-2)' }}> — {c.texte}</span>
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

      {/* Le même argent porte deux identifiants chez Stripe. On n'affiche qu'une
          ligne — deux auraient permis de le rattacher deux fois — mais on le dit,
          sinon l'élève qui retrouve l'autre identifiant dans son dashboard croit
          qu'un encaissement manque. */}
      {orphan.autresIdentifiants.length > 0 && (
        <div style={{ padding: '9px 18px', borderBottom: '1px solid var(--border-soft)', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55 }}>
          Ce versement apparaît sous {orphan.autresIdentifiants.length + 1} identifiants chez Stripe
          (facture et paiement). Une seule ligne ici, pour un seul encaissement.
        </div>
      )}

      <CauseDeLOrphelinat cause={orphan.cause} />

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
