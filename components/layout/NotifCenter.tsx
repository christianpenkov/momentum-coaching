'use client';

import { useEffect, useRef, useState } from 'react';
import { useEscapeKey } from '@/lib/useEscapeKey';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import { AppNotif } from '@/lib/useNotifications';
import RapportModal from '@/components/ui/RapportModalLoader';
import SessionRapportModal from '@/components/ui/SessionRapportModalLoader';
import { createClient } from '@/lib/supabase/client';
import { useViewerTimeZone } from '@/lib/UserContext';
import { formatDateIn, formatTimeIn } from '@/lib/timezone';

interface Props {
  notifs: AppNotif[];
  onClose: () => void;
  onRapportDone: () => void;
  onRefresh: () => void;
}

type RespondState = 'idle' | 'accepting' | 'declining' | 'done' | 'stale';

/**
 * Une notification demande-t-elle un TRAVAIL, ou signale-t-elle seulement ?
 *
 * Les deux vivaient dans une liste plate, avec la même carte et le même bouton
 * coloré : « Remplir le rapport » avait exactement l'apparence de « OK,
 * compris ». Rien ne disait ce qui restait dû.
 *
 * Le regroupement encode donc une distinction réelle — il ne décore pas.
 */
function demandeUneAction(t: AppNotif['type']) {
  return t === 'rapport_call' || t === 'session_rapport' || t === 'call_request';
}

/**
 * Couleur SÉMANTIQUE : l'issue de l'événement, jamais une décoration. Elle ne
 * teinte que le point de tête de ligne.
 *
 * Sept couleurs vivaient ici en dur (#ef4444, #f59e0b, #22c55e, #f97316 et
 * leurs variantes) hors du système, et quatre servaient de FOND de bouton avec
 * du texte blanc — entre 2,16:1 et 3,76:1, très en dessous du seuil de 4,5:1.
 * Les boutons n'utilisent plus que l'accent de marque pour l'action principale
 * et du neutre pour le reste ; la couleur reste sur le point, où elle n'a pas
 * de texte à porter.
 */
function tonDe(t: AppNotif['type']): 'marque' | 'positif' | 'negatif' | 'attention' {
  if (t === 'call_accepted') return 'positif';
  if (t === 'call_canceled' || t === 'call_declined') return 'negatif';
  if (t === 'call_rescheduled') return 'attention';
  return 'marque';
}

export default function NotifCenter({ notifs, onClose, onRapportDone, onRefresh }: Props) {
  useEscapeKey(onClose);
  const ref = useRef<HTMLDivElement>(null);
  const [rapportNotif, setRapportNotif] = useState<AppNotif | null>(null);
  const [sessionRapportNotif, setSessionRapportNotif] = useState<AppNotif | null>(null);
  const [vidageEnCours, setVidageEnCours] = useState(false);

  // ── Glissement vers le bas pour refermer (mobile) ────────────────────────
  //
  // La prise est volontairement limitée à la zone du haut (poignée + en-tête)
  // plutôt qu'à toute la feuille : le corps est une zone qui défile, et deux
  // gestes verticaux sur la même surface se disputent inévitablement. En posant
  // `touch-action: none` sur la seule prise, le navigateur n'essaie jamais d'y
  // faire défiler quoi que ce soit, et le doigt n'a rien à négocier.
  const [glisseY, setGlisseY] = useState(0);
  const [enGlisse, setEnGlisse] = useState(false);
  const priseRef = useRef<{ y0: number; t0: number } | null>(null);

  function surPrise(e: React.PointerEvent<HTMLDivElement>) {
    // Desktop : le panneau est un menu ancré, pas une feuille — aucun geste.
    if (window.matchMedia('(min-width: 768px)').matches) return;
    priseRef.current = { y0: e.clientY, t0: performance.now() };
    setEnGlisse(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function surDeplacement(e: React.PointerEvent<HTMLDivElement>) {
    const p = priseRef.current;
    if (!p) return;
    const dy = e.clientY - p.y0;
    // Vers le haut : résistance forte plutôt que blocage net. La feuille suit
    // un peu le doigt, ce qui dit « ça ne monte pas plus » sans paraître cassé.
    setGlisseY(dy > 0 ? dy : dy * 0.2);
  }

  function surRelache(e: React.PointerEvent<HTMLDivElement>) {
    const p = priseRef.current;
    if (!p) return;
    const dy = e.clientY - p.y0;
    const vitesse = dy / Math.max(1, performance.now() - p.t0); // px/ms
    priseRef.current = null;
    setEnGlisse(false);
    // Deux façons de fermer : descendre assez loin, ou descendre vite. Sans le
    // critère de vitesse, un geste bref et franc — le plus naturel — ne
    // referme rien et la feuille remonte, ce qui se lit comme un raté.
    if (dy > 90 || vitesse > 0.55) { onClose(); return; }
    setGlisseY(0);
  }

  async function marquerLu(ids: string[]) {
    if (ids.length === 0) return;
    const supabase = createClient();
    await supabase
      .from('client_notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', ids);
    onRefresh();
  }

  // Ferme si clic dehors — désactivé si une modale rapport est ouverte
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (rapportNotif || sessionRapportNotif) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, rapportNotif, sessionRapportNotif]);

  // Le panneau prend le focus à l'ouverture. Sans ça la tabulation restait dans
  // la page derrière, et aucun lecteur d'écran n'annonçait l'arrivée du panneau.
  useEffect(() => { ref.current?.focus(); }, []);

  const aTraiter = notifs.filter(n => demandeUneAction(n.type));
  const pourInfo = notifs.filter(n => !demandeUneAction(n.type));
  const idsPourInfo = pourInfo.map(n => n.dbId).filter((id): id is string => !!id);

  return createPortal(
    <>
      <div className="notif-voile" onClick={onClose} />

      <div
        ref={ref}
        className={`notif-panneau${enGlisse ? ' notif-panneau-glisse' : ''}`}
        style={glisseY ? { transform: `translateY(${glisseY}px)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notif-titre"
        tabIndex={-1}
      >
        {/* Prise du geste de fermeture, et en-tête. La poignée n'est visible
            qu'en feuille : sur desktop le panneau est un menu ancré à la cloche,
            rien ne s'y glisse. */}
        <div
          className="notif-prise"
          onPointerDown={surPrise}
          onPointerMove={surDeplacement}
          onPointerUp={surRelache}
          onPointerCancel={surRelache}
        >
          <div className="notif-poignee" aria-hidden="true" />

          <div className="notif-entete">
            <h2 className="notif-titre" id="notif-titre">Notifications</h2>
            {notifs.length > 0 && <span className="notif-total">{notifs.length}</span>}
            <button type="button" className="notif-fermer" onClick={onClose} aria-label="Fermer">
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        {notifs.length === 0 ? (
          /* Un état vide qui apprend l'écran. « Aucune notification » constatait
             le vide sans jamais dire ce qui atterrit ici. */
          <div className="notif-vide">
            <div className="notif-vide-icone" aria-hidden="true"><Icon name="bell" size={19} /></div>
            <p className="notif-vide-titre">Rien en attente</p>
            <p className="notif-vide-texte">
              Les rapports à remplir et les changements sur tes calls apparaîtront ici.
            </p>
          </div>
        ) : (
          <div className="notif-corps">
            {aTraiter.length > 0 && (
              <section>
                <h3 className="notif-groupe">
                  À traiter <span className="notif-groupe-n">{aTraiter.length}</span>
                </h3>
                {aTraiter.map(notif => (
                  <NotifLigne
                    key={notif.id}
                    notif={notif}
                    onAction={() => {
                      if (notif.type === 'rapport_call') setRapportNotif(notif);
                      if (notif.type === 'session_rapport') setSessionRapportNotif(notif);
                    }}
                    onRefresh={onRefresh}
                  />
                ))}
              </section>
            )}

            {pourInfo.length > 0 && (
              <section>
                <h3 className="notif-groupe">
                  Pour info <span className="notif-groupe-n">{pourInfo.length}</span>
                  {/* Ne vide QUE ce groupe. Un rapport à remplir ne se « lit » pas,
                      il se fait : l'effacer de la cloche le laisserait dû sur
                      l'accueil et la page Calls, et la cloche mentirait. */}
                  {idsPourInfo.length > 1 && (
                    <button
                      type="button"
                      className="notif-tout-lu"
                      disabled={vidageEnCours}
                      onClick={async () => {
                        setVidageEnCours(true);
                        await marquerLu(idsPourInfo);
                        setVidageEnCours(false);
                      }}
                    >
                      {vidageEnCours ? '…' : 'Tout marquer comme lu'}
                    </button>
                  )}
                </h3>
                {pourInfo.map(notif => (
                  <NotifLigne
                    key={notif.id}
                    notif={notif}
                    onAction={() => {}}
                    onDismiss={notif.dbId ? () => marquerLu([notif.dbId!]) : undefined}
                    onRefresh={onRefresh}
                  />
                ))}
              </section>
            )}
          </div>
        )}
      </div>

      {rapportNotif?.type === 'rapport_call' && rapportNotif.callId && (
        <RapportModal
          callId={rapportNotif.callId}
          inviteeName={rapportNotif.inviteeName ?? null}
          scheduledAt={rapportNotif.scheduledAt ?? null}
          onClose={() => { setRapportNotif(null); onRapportDone(); }}
        />
      )}

      {sessionRapportNotif?.type === 'session_rapport' && sessionRapportNotif.callId && (
        <SessionRapportModal
          callId={sessionRapportNotif.callId}
          studentName={sessionRapportNotif.inviteeName ?? null}
          scheduledAt={sessionRapportNotif.scheduledAt ?? null}
          topic={sessionRapportNotif.topic ?? null}
          onClose={() => { setSessionRapportNotif(null); onRapportDone(); }}
        />
      )}
    </>,
    document.body
  );
}

function NotifLigne({ notif, onAction, onDismiss, onRefresh }: {
  notif: AppNotif; onAction: () => void; onDismiss?: () => void; onRefresh: () => void;
}) {
  const [respondState, setRespondState] = useState<RespondState>('idle');
  const viewerTz = useViewerTimeZone();
  const isRapport = notif.type === 'rapport_call';
  const isSessionRapport = notif.type === 'session_rapport';
  const isCallRequest = notif.type === 'call_request';

  async function respond(response: 'accepted' | 'declined') {
    if (!notif.callId) return;
    setRespondState(response === 'accepted' ? 'accepting' : 'declining');
    const res = await fetch(`/api/calls/${notif.callId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response }),
    });
    setRespondState(res.ok ? 'done' : 'stale');
    onRefresh();
  }

  const quand = notif.scheduledAt ? new Date(notif.scheduledAt) : null;

  return (
    <div className="notif-ligne">
      <span className={`notif-point ton-${tonDe(notif.type)}`} aria-hidden="true" />

      <div className="notif-texte">
        <div className="notif-ligne-tete">
          {/* Pas de badge Coaching/Prospect ici, contrairement à la carte de l'accueil
              coach : depuis que les titres sont explicites ("Rapport de session de
              coaching" / "Rapport de call de vente"), le badge répétait le titre mot
              pour mot, et sa longueur le poussait sur une seconde ligne. */}
          <p className="notif-ligne-titre">{notif.title}</p>
          {quand && (
            /* Passe par les helpers partagés plutôt que par `toLocaleDateString`
               sans fuseau.
               À l'exécution le résultat est le MÊME : `useViewerTimeZone()` renvoie
               `detectBrowserTimeZone()`, soit la source qu'utilise déjà
               `toLocale*`. Ce n'est donc pas une correction d'heure fausse.
               Ce que ça achète : un seul endroit à changer. La règle produit a
               déjà basculé deux fois (« tout en heure de Paris » puis « chacun
               dans le sien », le 2026-08-19) ; un appel brut à `toLocale*`
               garderait silencieusement l'ancien comportement au prochain
               changement. Voir docs/fuseaux-horaires.md. */
            <time className="notif-ligne-date" dateTime={notif.scheduledAt ?? undefined}>
              {formatDateIn(quand, viewerTz)}
            </time>
          )}
        </div>

        <p className="notif-ligne-corps">{notif.body}</p>

        {quand && (
          <p className="notif-ligne-heure">{formatTimeIn(quand, viewerTz)}</p>
        )}


        {(isRapport || isSessionRapport) && (
          <div className="notif-actions">
            <button type="button" className="notif-btn notif-btn-primaire" onClick={onAction}>
              Remplir le rapport
            </button>
          </div>
        )}

        {isCallRequest && respondState !== 'done' && respondState !== 'stale' && (
          <div className="notif-actions">
            <button type="button" className="notif-btn notif-btn-primaire"
              onClick={() => respond('accepted')} disabled={respondState !== 'idle'}>
              {respondState === 'accepting' ? '…' : 'Accepter'}
            </button>
            {/* Refus en neutre, pas en rouge : décliner un créneau est un choix
                ordinaire, pas une destruction. Le rouge codé en dur y échouait de
                toute façon au contraste (3,76:1 pour du 12 px). */}
            <button type="button" className="notif-btn notif-btn-neutre"
              onClick={() => respond('declined')} disabled={respondState !== 'idle'}>
              {respondState === 'declining' ? '…' : 'Refuser'}
            </button>
          </div>
        )}

        {isCallRequest && respondState === 'done' && (
          <p className="notif-etat notif-etat-ok">Réponse envoyée</p>
        )}
        {isCallRequest && respondState === 'stale' && (
          <p className="notif-etat">Déjà traité ailleurs</p>
        )}

        {onDismiss && (
          <div className="notif-actions">
            <button type="button" className="notif-btn notif-btn-neutre" onClick={onDismiss}>
              OK, compris
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
