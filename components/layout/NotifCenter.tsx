'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * Bornes de la durée de sortie, en millisecondes.
 *
 * Quand la fermeture vient d'un geste, la durée se déduit de la vitesse du
 * doigt : la feuille finit sa course au rythme qu'on venait de lui donner.
 * Sans plancher, un geste très vif la ferait disparaître d'un seul cadre — on
 * ne verrait rien partir. Sans plafond, un geste lent mais franc la laisserait
 * traîner. Entre les deux, c'est le doigt qui décide.
 */
const SORTIE_MIN_MS = 130;
const SORTIE_MAX_MS = 340;
/** Fermeture sans geste (croix, voile, Échap) : durée Material 3 « short4 ». */
const SORTIE_PAR_DEFAUT_MS = 200;

export default function NotifCenter({ notifs, onClose, onRapportDone, onRefresh }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [rapportNotif, setRapportNotif] = useState<AppNotif | null>(null);
  const [sessionRapportNotif, setSessionRapportNotif] = useState<AppNotif | null>(null);
  const [vidageEnCours, setVidageEnCours] = useState(false);

  const [glisseY, setGlisseY] = useState(0);
  const [enGlisse, setEnGlisse] = useState(false);
  const [enSortie, setEnSortie] = useState(false);

  // ── Fermeture animée ─────────────────────────────────────────────────────
  //
  // `onClose` démonte le composant sur-le-champ : la feuille disparaissait donc
  // d'un coup, y compris au bout d'un glissement où le doigt venait justement
  // de lui donner une trajectoire. On la pousse d'abord hors de l'écran, PUIS
  // on démonte.
  //
  // La cible est `innerHeight` en pixels et non `translateY(100%)` : le
  // glissement écrit déjà une transformation en ligne, et deux sources pour la
  // même propriété se disputeraient la priorité. Une seule valeur, un seul
  // endroit — la sortie prolonge simplement le geste au lieu de le remplacer.
  const sortieLancee = useRef(false);
  const glisseYRef = useRef(0);
  const [dureeSortie, setDureeSortie] = useState(SORTIE_PAR_DEFAUT_MS);

  function poserGlisse(v: number) {
    glisseYRef.current = v;
    setGlisseY(v);
  }

  /** @param vitesse px/ms au moment du relâché, si la fermeture vient d'un geste. */
  const fermer = useCallback((vitesse?: number) => {
    if (sortieLancee.current) return;
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Desktop : le menu ancré n'a pas de trajectoire à prolonger. Mouvement
    // réduit : on ne rajoute pas une animation à quelqu'un qui les refuse.
    if (!mobile || reduit) { onClose(); return; }
    sortieLancee.current = true;

    // Distance restante depuis la position ACTUELLE, pas depuis le haut : au
    // bout d'un glissement la feuille est déjà à mi-course, et repartir de zéro
    // rallongerait artificiellement la fin du mouvement.
    const restant = Math.max(1, window.innerHeight - glisseYRef.current);
    const duree = vitesse && vitesse > 0
      ? Math.min(SORTIE_MAX_MS, Math.max(SORTIE_MIN_MS, restant / vitesse))
      : SORTIE_PAR_DEFAUT_MS;
    setDureeSortie(duree);

    setEnGlisse(false);
    // Une image d'écart avant de changer la transformation : appliquer la
    // transition et sa nouvelle valeur dans le même rendu peut faire sauter
    // l'animation, le navigateur n'ayant pas d'état de départ à interpoler.
    requestAnimationFrame(() => {
      setEnSortie(true);
      poserGlisse(window.innerHeight);
      window.setTimeout(onClose, duree);
    });
  }, [onClose]);

  // Lu par les écouteurs natifs, qui ne doivent pas se réabonner à chaque rendu.
  const fermerRef = useRef(fermer);
  useEffect(() => { fermerRef.current = fermer; }, [fermer]);

  useEscapeKey(fermer);

  // ── Glissement vers le bas pour refermer (mobile) ────────────────────────
  //
  // Deux points de départ possibles :
  //   1. la prise du haut (poignée + en-tête), qui porte `touch-action: none` ;
  //   2. n'importe où dans la liste, À CONDITION qu'elle soit déjà tout en
  //      haut — tirer vers le bas n'a alors rien à faire défiler.
  //
  // D'où des écouteurs natifs plutôt que les événements pointeur de React : le
  // second cas exige `preventDefault()` sur `touchmove` pour couper le
  // défilement natif au moment où l'on décide que le geste est une fermeture,
  // et React attache `touchmove` en passif, où `preventDefault()` est ignoré.
  //
  // L'armement se décide au premier mouvement, pas au contact : un doigt qui
  // part vers le HAUT depuis une liste en haut de course veut faire défiler,
  // pas fermer. On le laisse alors tranquille pour tout le reste du geste.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let y0 = 0, t0 = 0, arme = false, actif = false;

    function debut(e: TouchEvent) {
      if (window.matchMedia('(min-width: 768px)').matches) return;
      if (e.touches.length !== 1) return;
      const depuisPrise = !!(e.target as HTMLElement).closest?.('.notif-prise');
      arme = depuisPrise || el!.scrollTop <= 0;
      actif = false;
      y0 = e.touches[0].clientY;
      t0 = performance.now();
    }

    function bouge(e: TouchEvent) {
      if (!arme) return;
      const dy = e.touches[0].clientY - y0;
      if (!actif) {
        // Seuil de 6 px : en deçà, on ne sait pas encore si c'est un geste ou
        // un simple appui qui tremble.
        if (dy > 6) { actif = true; setEnGlisse(true); }
        else if (dy < -2) { arme = false; return; }
        else return;
      }
      e.preventDefault();
      // Vers le haut : forte résistance plutôt que blocage net. La feuille suit
      // un peu le doigt, ce qui dit « ça ne monte pas plus » sans paraître cassé.
      poserGlisse(dy > 0 ? dy : dy * 0.2);
    }

    function fin(e: TouchEvent) {
      if (!arme || !actif) { arme = false; actif = false; return; }
      const dy = (e.changedTouches[0]?.clientY ?? y0) - y0;
      const vitesse = dy / Math.max(1, performance.now() - t0); // px/ms
      arme = false; actif = false;
      setEnGlisse(false);
      // Deux façons de fermer : descendre assez loin, ou descendre vite. Sans le
      // critère de vitesse, un geste bref et franc — le plus naturel — ne
      // referme rien et la feuille remonte, ce qui se lit comme un raté.
      if (dy > 90 || vitesse > 0.55) { fermerRef.current(vitesse); return; }
      poserGlisse(0);
    }

    el.addEventListener('touchstart', debut, { passive: true });
    el.addEventListener('touchmove', bouge, { passive: false });
    el.addEventListener('touchend', fin);
    el.addEventListener('touchcancel', fin);
    return () => {
      el.removeEventListener('touchstart', debut);
      el.removeEventListener('touchmove', bouge);
      el.removeEventListener('touchend', fin);
      el.removeEventListener('touchcancel', fin);
    };
  }, []);

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
      if (ref.current && !ref.current.contains(e.target as Node)) fermerRef.current();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [rapportNotif, sessionRapportNotif]);

  // Le panneau prend le focus à l'ouverture. Sans ça la tabulation restait dans
  // la page derrière, et aucun lecteur d'écran n'annonçait l'arrivée du panneau.
  useEffect(() => { ref.current?.focus(); }, []);

  const aTraiter = notifs.filter(n => demandeUneAction(n.type));
  const pourInfo = notifs.filter(n => !demandeUneAction(n.type));
  const idsPourInfo = pourInfo.map(n => n.dbId).filter((id): id is string => !!id);

  return createPortal(
    <>
      <div className={`notif-voile${enSortie ? ' notif-voile-sortie' : ''}`} onClick={() => fermer()} />

      <div
        ref={ref}
        className={`notif-panneau${enGlisse ? ' notif-panneau-glisse' : ''}${enSortie ? ' notif-panneau-sortie' : ''}`}
        style={{
          ...(glisseY ? { transform: `translateY(${glisseY}px)` } : null),
          // Durée passée en variable CSS plutôt qu'en `transition` inline : la
          // courbe reste dans la feuille de styles, seul le tempo vient d'ici.
          ...(enSortie ? { ['--notif-sortie-duree' as string]: `${Math.round(dureeSortie)}ms` } : null),
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notif-titre"
        tabIndex={-1}
      >
        {/* Prise du geste de fermeture, et en-tête. La poignée n'est visible
            qu'en feuille : sur desktop le panneau est un menu ancré à la cloche,
            rien ne s'y glisse. */}
        <div className="notif-prise">
          <div className="notif-poignee" aria-hidden="true" />

          <div className="notif-entete">
            {/* La cloche répète le repère sur lequel on vient de cliquer : ouvert
                en plein écran sur mobile, le panneau perd sinon tout lien visuel
                avec son point de départ. */}
            <span className="notif-titre-cloche" aria-hidden="true">
              <Icon name="bell" size={15} />
            </span>
            <h2 className="notif-titre" id="notif-titre">Notifications</h2>
            {notifs.length > 0 && <span className="notif-total">{notifs.length}</span>}
            <button type="button" className="notif-fermer" onClick={() => fermer()} aria-label="Fermer">
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
