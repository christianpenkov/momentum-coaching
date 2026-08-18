'use client';

import { isCoachingCall, isCallMissingRecording } from '@/lib/sessionRapport';

// Badges et pastilles de résultat d'un call — source unique pour les pages Calls
// coach et élève, le pipeline et les widgets d'accueil. CallTypeBadge existait en 4
// copies et FathomBadge en 2, avec des divergences silencieuses (whiteSpace absent
// sur certaines copies, ce qui cassait la carte sur les petits écrans).

type CallLike = {
  call_type?: string | null;
  status?: string | null;
  fathom_status?: 'pending' | 'matched' | 'unmatched' | 'not_recorded' | null;
  no_show?: boolean | null;
  deal_closed?: boolean | null;
  revenue?: number | null;
  outcome?: string | null;
  session_completed?: boolean | null;
  session_no_show?: boolean | null;
  scheduled_at?: string | null;
  duration?: string | null;
};

// Forme pilule (borderRadius 20) conservée telle qu'en production : c'est ce que les
// élèves ont sous les yeux aujourd'hui, et la forme distingue nettement le badge de
// type de la pastille de résultat, plus carrée.
const badgeBase: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: 20,
  whiteSpace: 'nowrap',
};

export function CallTypeBadge({ call }: { call: CallLike }) {
  const coaching = isCoachingCall(call);
  return (
    <span style={{ ...badgeBase, background: coaching ? 'var(--surface-2)' : 'var(--accent-brand-soft)', color: coaching ? 'var(--accent)' : 'var(--accent-brand)' }}>
      {coaching ? 'Coaching' : 'Vente'}
    </span>
  );
}

// Info neutre, pas une alerte — un call sans replay Fathom n'est pas un problème
// (bot pas rejoint, appel hors visio…). Fond transparent + bordure pour rester
// visuellement distinct de CallTypeBadge, qui est plein.
export function FathomBadge({ call, now }: { call: CallLike; now?: number }) {
  if (call.fathom_status === 'matched') {
    return (
      <span style={{ ...badgeBase, background: 'var(--green-soft)', color: 'var(--green)' }}>
        Replay dispo
      </span>
    );
  }
  if (isCallMissingRecording(call as never, now)) {
    return (
      <span style={{ ...badgeBase, background: 'transparent', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
        Pas de replay
      </span>
    );
  }
  return null;
}

export function InProgressBadge() {
  return (
    <span style={{ ...badgeBase, background: 'var(--green-soft)', color: 'var(--green)' }}>
      En cours
    </span>
  );
}

export function CanceledBadge({ declined }: { declined: boolean }) {
  return (
    <span style={{ ...badgeBase, background: 'var(--red-soft)', color: 'var(--red)', border: '1px solid var(--red)' }}>
      {declined ? 'Refusé' : 'Annulé'}
    </span>
  );
}

export function PendingBadge() {
  return (
    <span style={{ ...badgeBase, background: 'var(--amber-soft)', color: 'var(--amber)', border: '1px solid var(--amber)' }}>
      Réponse en attente
    </span>
  );
}

// Résultat d'un call terminé. La nature du résultat dépend du TYPE de call, pas du
// rôle qui regarde : un call de vente porte un verdict commercial (closé, à
// recontacter…), un coaching porte une présence. Cette cascade n'existait que côté
// élève — le coach ne voyait aucun résultat sur ses propres calls de vente.
export function CallResultPill({ call, now }: { call: CallLike; now?: number }) {
  const pillStyle: React.CSSProperties = { fontSize: 11 };

  if (isCoachingCall(call)) {
    if (call.session_no_show === true) {
      return <span className="pill pill-neutral" style={pillStyle}><span className="dot" />No-show</span>;
    }
    if (call.session_completed === true) {
      return <span className="pill pill-green" style={pillStyle}><span className="dot" />Présent</span>;
    }
    return <span className="pill pill-neutral" style={pillStyle}><span className="dot" />Terminé</span>;
  }

  if (call.no_show === true) {
    return <span className="pill pill-neutral" style={pillStyle}><span className="dot" />No-show</span>;
  }
  if (call.deal_closed === true) {
    return (
      <span className="pill pill-green" style={pillStyle}>
        <span className="dot" />Closé{call.revenue ? ` · ${call.revenue} €` : ''}
      </span>
    );
  }
  // Libellé neutre "Prochain call" quand c'est déjà un call de relance : parler d'un
  // "2ème call" sur un 3ème ou 4ème échange serait faux.
  if (call.outcome === 'second_call') {
    return (
      <span className="pill" style={{ ...pillStyle, background: 'var(--accent-brand-soft)', color: 'var(--accent-brand)' }}>
        <span className="dot" />Prochain call prévu
      </span>
    );
  }
  if (call.outcome === 'to_recontact') {
    return <span className="pill pill-amber" style={pillStyle}><span className="dot" />À recontacter</span>;
  }
  if (call.outcome === 'not_qualified') {
    return <span className="pill pill-neutral" style={pillStyle}><span className="dot" />Pas qualifié</span>;
  }
  if (call.outcome === 'not_closed' || (call.deal_closed === false && call.no_show === false)) {
    return <span className="pill pill-neutral" style={pillStyle}><span className="dot" />Pas closé</span>;
  }
  return <span className="pill pill-neutral" style={pillStyle}><span className="dot" />Terminé</span>;
}
