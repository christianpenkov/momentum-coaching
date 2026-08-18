'use client';

import type { ReactNode } from 'react';
import Icon from '@/components/ui/Icon';
import Avatar from '@/components/ui/Avatar';
import { CallTypeBadge, FathomBadge, InProgressBadge, CanceledBadge, PendingBadge, CallResultPill } from '@/components/ui/CallBadges';
import { formatCallDay, formatCallTime } from '@/lib/callFormat';
import { isCallCanceled, isCallInProgress, isCallJoinable } from '@/lib/sessionRapport';

// Carte de call unique, partagée par la page Calls du coach et celle de l'élève.
// Les deux rôles voient exactement la même nature de données (chacun ses propres
// calls de vente + ses coachings) : seuls les BOUTONS diffèrent. C'est pourquoi la
// structure est identique et que seules les actions sont injectées par l'appelant.
//
// Une seule structure DOM sert mobile et desktop — la bascule est purement CSS
// (.call-card-* dans globals.css). Deux branches JSX pilotées par useIsMobile
// auraient produit un flash de disposition desktop au premier paint mobile, le hook
// renvoyant false côté serveur.

type CallLike = {
  id: string;
  topic?: string | null;
  scheduled_at: string | null;
  duration?: string | null;
  join_url?: string | null;
  status?: string | null;
  call_type?: string | null;
  invitee_name?: string | null;
  fathom_status?: 'pending' | 'matched' | 'unmatched' | 'not_recorded' | null;
  no_show?: boolean | null;
  deal_closed?: boolean | null;
  revenue?: number | null;
  outcome?: string | null;
  session_completed?: boolean | null;
  session_no_show?: boolean | null;
};

export interface CallCardProps {
  call: CallLike;
  /** upcoming = à venir ou en rattrapage · history = terminé · canceled = annulé/refusé · pending = invitation en attente de réponse */
  variant: 'upcoming' | 'history' | 'canceled' | 'pending';
  /** Nom affiché de l'interlocuteur — résolu par l'appelant, qui seul sait s'il faut lire le client, l'invité Calendly ou le coach. */
  displayName: string;
  initials: string;
  avatarUrl?: string | null;
  /** Graine de couleur stable de l'avatar (id de préférence) — cf. Avatar.tsx. */
  seed?: string;
  now?: number;
  /** Actions déjà construites par l'appelant (boutons Rapport, Annuler, Accepter…). Placées à droite sur desktop, sous les infos sur mobile. */
  actions?: ReactNode;
  /** Bloc libre rendu sous la carte — notes, commentaire perso, accordéon de notes élève. */
  children?: ReactNode;
}

export default function CallCard({
  call,
  variant,
  displayName,
  initials,
  avatarUrl,
  seed,
  now = Date.now(),
  actions,
  children,
}: CallCardProps) {
  if (!call.scheduled_at) return null;

  const { day, month } = formatCallDay(call.scheduled_at);
  const time = formatCallTime(call.scheduled_at);
  const canceled = isCallCanceled(call);
  const declined = call.status === 'declined';
  const showJoin = variant === 'upcoming' && call.join_url && isCallJoinable(call as never, now);

  return (
    <div className={`card call-card${canceled ? ' call-card-canceled' : ''}`}>
      <div className="call-card-rail">
        <div className="call-card-day">{day}</div>
        <div className="call-card-month">{month}</div>
        <div className="call-card-hour">{time}</div>
        <Avatar initials={initials} avatarUrl={avatarUrl} size={34} seed={seed} className="call-card-avatar" />
      </div>

      {/* Colonne à droite du rail : la ligne d'infos, puis les blocs libres en
          dessous. Sans ce conteneur, .call-card-extra devenait un frère du rail
          dans le flex horizontal et écrasait la colonne du nom. */}
      <div className="call-card-col">
      <div className="call-card-body">
        <div className="call-card-main">
          <div className="call-card-headline">
            <span className="call-card-name">{displayName}</span>
            <CallTypeBadge call={call} />
            {variant === 'history' && <FathomBadge call={call} now={now} />}
            {variant === 'upcoming' && isCallInProgress(call as never, now) && <InProgressBadge />}
            {variant === 'canceled' && <CanceledBadge declined={declined} />}
            {variant === 'pending' && <PendingBadge />}
          </div>
          {/* L'heure n'est visible qu'en mobile (en desktop elle vit dans le rail),
              donc le séparateur qui la suit doit disparaître avec elle — sinon il
              reste un "· 30 min" orphelin en tête de ligne. */}
          {/* Durée et intitulé sur une seule ligne tronquée. Le texte du topic est
              de longueur imprévisible (intitulés Calendly complets) : sans troncature
              il passait sur deux lignes et déséquilibrait la carte. */}
          <div className="call-card-meta">
            <span className="call-card-time">{time}</span>
            {call.duration && (
              <>
                <span className="call-card-time-sep"> · </span>
                <span className="call-card-duration">{call.duration}</span>
              </>
            )}
            {call.topic && (
              <span className="call-card-topic">{call.duration ? ' · ' : ''}{call.topic}</span>
            )}
          </div>
        </div>

        <div className="call-card-tail">
          {variant === 'history' && <CallResultPill call={call} now={now} />}
          {showJoin && (
            <a
              href={call.join_url!}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary-brand call-card-join"
            >
              <Icon name="video" size={14} /> Rejoindre
            </a>
          )}
          {actions}
        </div>
      </div>

        {children && <div className="call-card-extra">{children}</div>}
      </div>
    </div>
  );
}
