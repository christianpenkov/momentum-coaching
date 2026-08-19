'use client';

import { useState } from 'react';
import Icon from '@/components/ui/Icon';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import type { DealRow, DealDetail } from './types';
import { fmtEur, fmtDateLong, fmtRelative } from './types';

/**
 * Ce qu'il reste à aller chercher, groupé par CAUSE — parce que la cause dicte le
 * message à envoyer, et que la même action (copier un lien) n'a pas le même sens
 * selon qu'on relance un oubli ou une carte expirée.
 *
 * Une seule action partout : « Copier le lien ». Momentum prépare, l'élève envoie
 * depuis son propre canal. Pas de bouton « Réessayer le prélèvement » : Stripe
 * rejoue les échecs tout seul, et c'est la seule action qui toucherait l'argent
 * d'un client sans passer par un lien envoyé à la main.
 */

type Group = {
  key: string;
  title: string;
  tone: 'red' | 'amber';
  help: string;
  items: { deal: DealRow; sub: string; url: string | null; amount: number }[];
};

export default function RelancesTab({ deals, details }: { deals: DealRow[]; details: Record<string, DealDetail> }) {
  const groups = buildGroups(deals, details);
  const total = groups.reduce((s, g) => s + g.items.length, 0);

  if (total === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 60, paddingBottom: 60 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--green-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={20} color="var(--green)" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Rien à relancer</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 300 }}>
            Tous tes deals sont soldés ou leurs échéances sont à jour.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {groups.filter(g => g.items.length > 0).map(g => (
        <div key={g.key} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: `var(--${g.tone})` }} />
            <span className="mono" style={{ color: 'var(--ink-2)' }}>{g.title}</span>
            <span style={{ fontSize: 11, color: 'var(--faint)' }}>{g.items.length}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, paddingLeft: 16, maxWidth: 560 }}>{g.help}</div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {g.items.map((it, i) => (
              <RelanceRow key={it.deal.id} item={it} first={i === 0} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RelanceRow({ item, first }: { item: Group['items'][number]; first: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!item.url) return;
    await navigator.clipboard.writeText(item.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
      borderTop: first ? 'none' : '1px solid var(--border-soft)',
    }}>
      <Avatar initials={getInitials(item.deal.buyerName)} size={30} seed={item.deal.id} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{item.deal.buyerName}</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{item.sub}</span>
      </span>
      <span className="tabular" style={{ fontSize: 13, fontWeight: 600, width: 84, textAlign: 'right' }}>{fmtEur(item.amount)}</span>
      <button className="btn-ghost" onClick={copy} disabled={!item.url}
        style={{ fontSize: 12, flexShrink: 0, border: '1px solid var(--border)', borderRadius: 7, padding: '7px 13px', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: item.url ? 1 : .5 }}>
        <Icon name={copied ? 'check' : 'copy'} size={13} color={copied ? 'var(--green)' : 'var(--muted)'} />
        {copied ? 'Copié' : 'Copier le lien'}
      </button>
    </div>
  );
}

function buildGroups(deals: DealRow[], details: Record<string, DealDetail>): Group[] {
  const failed: Group['items'] = [];
  const dueNow: Group['items'] = [];
  const waiting: Group['items'] = [];

  const today = new Date().toISOString().slice(0, 10);

  for (const d of deals) {
    if (d.status === 'paid' || d.status === 'canceled') continue;
    const detail = details[d.id];
    const remaining = d.amountTotal - d.collected;

    // Prélèvement refusé : Stripe réessaie seul, l'élève peut envoyer le lien de
    // mise à jour de carte s'il veut aller plus vite.
    if (d.hasFailure) {
      const fail = detail?.payments.find(p => p.status === 'failed');
      failed.push({
        deal: d,
        sub: fail?.failure_reason
          ? `${fail.failure_reason} · Stripe réessaiera automatiquement`
          : 'Prélèvement refusé · Stripe réessaiera automatiquement',
        url: d.shortUrl,
        amount: remaining,
      });
      continue;
    }

    // Mode manuel : une échéance dont la date est passée et le lien pas encore envoyé.
    const next = detail?.installments.find(i => i.status !== 'paid');
    if (next) {
      const late = next.due_on <= today;
      const item = {
        deal: d,
        sub: late
          ? `Échéance ${next.rank}/${detail!.installments.length} · à envoyer depuis le ${fmtDateLong(next.due_on)}`
          : `Échéance ${next.rank}/${detail!.installments.length} · à envoyer le ${fmtDateLong(next.due_on)}`,
        url: next.short_url,
        amount: Number(next.amount),
      };
      (late ? dueNow : waiting).push(item);
      continue;
    }

    // Comptant jamais payé : le lien a été envoyé, rien n'est arrivé.
    if (d.collected === 0) {
      waiting.push({
        deal: d,
        sub: `Lien envoyé ${fmtRelative(d.signedAt)} · aucun paiement`,
        url: d.shortUrl,
        amount: d.amountTotal,
      });
    }
  }

  return [
    {
      key: 'failed', title: 'Carte refusée', tone: 'red',
      help: 'Échec d\'une échéance automatique. Stripe réessaie tout seul les jours suivants — envoie le lien seulement si tu veux aller plus vite.',
      items: failed,
    },
    {
      key: 'due', title: 'Échéance à envoyer', tone: 'amber',
      help: 'La date est passée et le lien n\'a pas encore été envoyé.',
      items: dueNow,
    },
    {
      key: 'waiting', title: 'En attente de paiement', tone: 'amber',
      help: 'Le lien est parti, le paiement n\'est pas arrivé. Un message personnel vaut souvent mieux qu\'un rappel.',
      items: waiting,
    },
  ];
}
