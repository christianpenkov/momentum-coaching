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

type Item = {
  deal: DealRow;
  sub: string;
  url: string | null;
  amount: number;
  /** Renseigné en mode manuel : permet de marquer l'échéance comme envoyée. */
  installmentId?: string | null;
  sentAt?: string | null;
};

type Group = {
  key: string;
  title: string;
  tone: 'red' | 'amber';
  help: string;
  items: Item[];
};

export default function RelancesTab({ deals, details, onChange }: {
  deals: DealRow[];
  details: Record<string, DealDetail>;
  onChange?: () => void;
}) {
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
              <RelanceRow key={it.deal.id} item={it} first={i === 0} onChange={onChange} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RelanceRow({ item, first, onChange }: { item: Item; first: boolean; onChange?: () => void }) {
  const [copied, setCopied] = useState(false);
  // Optimiste : la case répond au clic sans attendre le serveur, sinon le geste
  // paraît cassé sur une connexion lente.
  const [sent, setSent] = useState(!!item.sentAt);
  const [saving, setSaving] = useState(false);
  const [marking, setMarking] = useState(false);

  async function copy() {
    if (!item.url) return;
    await navigator.clipboard.writeText(item.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 4000);
  }

  async function toggleSent() {
    if (!item.installmentId || saving) return;
    const next = !sent;
    setSent(next);
    setSaving(true);
    try {
      const r = await fetch('/api/payments/installments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installmentId: item.installmentId, sent: next }),
      });
      if (!r.ok) throw new Error();
      onChange?.();
    } catch {
      setSent(!next);   // l'écriture a échoué : la case ne doit pas mentir
    } finally {
      setSaving(false);
    }
  }

  /**
   * Échéance encaissée hors Stripe : l'élève déclare l'avoir reçue.
   *
   * Pas d'optimisme ici, contrairement à la case « Envoyé » : cette action
   * fait entrer de l'argent dans le cash collecté. Afficher un encaissement
   * qui n'a pas été écrit serait pire que d'attendre une seconde.
   */
  async function markReceived() {
    if (!item.installmentId || marking) return;
    setMarking(true);
    try {
      const r = await fetch('/api/payments/installments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installmentId: item.installmentId, received: true }),
      });
      if (!r.ok) throw new Error();
      onChange?.();
    } catch {
      setMarking(false);
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
      borderTop: first ? 'none' : '1px solid var(--border-soft)',
      flexWrap: 'wrap',
    }}>
      <Avatar initials={getInitials(item.deal.buyerName)} avatarUrl={item.deal.avatarUrl} size={30} seed={item.deal.id} />
      <span style={{ flex: 1, minWidth: 140 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{item.deal.buyerName}</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
          {sent && item.installmentId ? `Lien marqué comme envoyé · en attente de paiement` : item.sub}
        </span>
      </span>

      {/* Momentum ne peut pas savoir qu'un lien a été envoyé — l'élève le colle
          dans son DM, hors de la plateforme. Seule sa déclaration fait foi, d'où
          cette case, réversible parce qu'on se trompe de ligne.
          Sans lien (encaissement hors Stripe), il n'y a rien à envoyer : la
          case n'aurait aucun sens, seul « Marquer reçu » s'applique. */}
      {item.installmentId && item.url && (
        <button onClick={toggleSent} disabled={saving}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, background: 'none', border: 'none',
            cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', padding: '4px 0', flexShrink: 0,
            opacity: saving ? .6 : 1,
          }}>
          <span style={{
            width: 16, height: 16, borderRadius: 5, flexShrink: 0,
            border: `1.5px solid ${sent ? 'var(--green)' : 'var(--faint)'}`,
            background: sent ? 'var(--green)' : 'transparent',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {sent && <Icon name="check" size={11} color="#fff" />}
          </span>
          <span style={{ fontSize: 11.5, color: sent ? 'var(--green)' : 'var(--muted)' }}>Envoyé</span>
        </button>
      )}
      <span className="tabular" style={{ fontSize: 13, fontWeight: 600, width: 84, textAlign: 'right' }}>{fmtEur(item.amount)}</span>
      {/* Sans lien (deals repris de l'historique), un bouton « Copier le lien »
          grisé serait trompeur : il n'y a rien à copier. On dit ce qui manque. */}
      {item.url ? (
        <button className="btn-ghost" onClick={copy}
          style={{ fontSize: 12, flexShrink: 0, border: '1px solid var(--border)', borderRadius: 7, padding: '7px 13px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name={copied ? 'check' : 'copy'} size={13} color={copied ? 'var(--green)' : 'var(--muted)'} />
          {copied ? 'Copié' : 'Copier le lien'}
        </button>
      ) : item.installmentId ? (
        // Échéance hors Stripe : personne ne peut confirmer le paiement à la
        // place de l'élève, c'est lui qui déclare l'avoir reçu.
        <button className="btn-ghost" onClick={markReceived} disabled={marking}
          style={{ fontSize: 12, flexShrink: 0, border: '1px solid var(--border)', borderRadius: 7, padding: '7px 13px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="check" size={13} color="var(--green)" />
          {marking ? '…' : 'Marquer reçu'}
        </button>
      ) : (
        <span style={{ fontSize: 11.5, color: 'var(--faint)', flexShrink: 0, width: 118, textAlign: 'right' }}>
          Encaissé hors Momentum
        </span>
      )}

      {/* Rappel après copie : le geste suivant se passe hors de Momentum (coller
          dans un DM), donc l'élève oublie de revenir cocher. Ne s'affiche que si
          la case existe et n'est pas déjà cochée. */}
      {copied && item.installmentId && !sent && (
        <div style={{
          flexBasis: '100%', fontSize: 11.5, color: 'var(--accent-brand)',
          background: 'var(--accent-brand-soft)', borderRadius: 6, padding: '7px 10px', marginTop: 2,
        }}>
          Une fois le lien envoyé à ton client, coche « Envoyé » pour ne plus le voir ici.
        </div>
      )}
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
      // Sans lien Stripe, l'échéance est encaissée hors plateforme : il n'y a
      // rien à envoyer, seulement un versement à confirmer quand il arrive.
      const offline = !next.short_url;
      const rang = `Échéance ${next.rank}/${detail!.installments.length}`;
      const item: Item = {
        deal: d,
        sub: offline
          ? (late
              ? `${rang} · attendue depuis le ${fmtDateLong(next.due_on)}`
              : `${rang} · attendue le ${fmtDateLong(next.due_on)}`)
          : (late
              ? `${rang} · à envoyer depuis le ${fmtDateLong(next.due_on)}`
              : `${rang} · à envoyer le ${fmtDateLong(next.due_on)}`),
        url: next.short_url,
        amount: Number(next.amount),
        installmentId: next.id,
        sentAt: next.sent_at,
      };
      // Une échéance déjà marquée envoyée n'est plus une action à faire : elle
      // passe en attente de paiement, même si sa date est dépassée. En mode
      // hors Stripe il n'y a pas d'envoi, donc `sent_at` ne s'applique pas :
      // seule la date compte.
      ((late && (offline || !next.sent_at)) ? dueNow : waiting).push(item);
      continue;
    }

    // Comptant impayé. Sans lien, ne rien affirmer sur un envoi : les deals issus
    // du backfill (anciens calls closés) n'en ont jamais eu, et « lien envoyé »
    // décrirait une action qui n'a pas eu lieu.
    if (d.collected === 0) {
      waiting.push({
        deal: d,
        sub: d.shortUrl
          ? `Lien créé ${fmtRelative(d.signedAt)} · aucun paiement`
          : `Signé ${fmtRelative(d.signedAt)} · aucun lien de paiement`,
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
      // Le groupe mélange deux natures d'échéances : celles dont le lien
      // Stripe reste à envoyer, et celles encaissées hors plateforme dont le
      // versement est à confirmer. Le titre suit ce qu'il contient vraiment.
      key: 'due',
      title: dueNow.every(i => !i.url) && dueNow.length > 0
        ? 'Échéance à encaisser'
        : dueNow.some(i => !i.url)
          ? 'Échéance à traiter'
          : 'Échéance à envoyer',
      tone: 'amber',
      help: dueNow.every(i => !i.url) && dueNow.length > 0
        ? 'La date est passée. Vérifie que le virement est bien arrivé, puis marque-le comme reçu.'
        : 'La date est passée et le lien n\'a pas encore été envoyé.',
      items: dueNow,
    },
    {
      key: 'waiting', title: 'En attente de paiement', tone: 'amber',
      help: 'Le lien est parti, le paiement n\'est pas arrivé. Un message personnel vaut souvent mieux qu\'un rappel.',
      items: waiting,
    },
  ];
}
