'use client';

import { useRef, useState } from 'react';
import ZonesDefilement from './ZonesDefilement';
import { useViewerTimeZone } from '@/lib/UserContext';
import { formatDateIn, formatTimeIn } from '@/lib/timezone';
import { formatDraftAge } from '@/lib/draftAge';
import { usePendingDrafts } from '@/lib/usePendingDrafts';

/**
 * Gouttiere entre deux cartes du fil. Doit rester identique a la valeur `gap`
 * de `.rapport-fil` dans globals.css : le calcul de la position courante en
 * depend, et un ecart y decalerait la pastille active d'une carte.
 */
const SLIDE_GAP = 12;

/**
 * Carrousel « N rapports en attente », partagé par les trois écrans qui l'affichent :
 * accueil coach (PageToday), accueil élève (PageClientView) et page Calls élève
 * (PageClientCalls). Les trois en avaient chacun leur copie — mêmes styles inline
 * recopiés à l'identique, flèches comprises — ce qui obligeait à porter la moindre
 * évolution trois fois.
 *
 * Les écarts qui EXISTAIENT entre les trois copies sont conservés, en props :
 *  - `arrowSize` : 44 px sur la page Calls élève (cible tactile mobile), 32 px ailleurs.
 *  - `marginBottom` : 24 px sur la page Calls élève, 20 px sur les deux accueils.
 *  - `badge` : seul l'accueil coach l'affiche — c'est le seul écran où coaching et
 *    vente se mélangent. Chez l'élève il n'y a que de la vente, un badge y serait
 *    toujours le même mot.
 *  - `subtitle` : seul l'accueil coach montre le sujet du call sous le nom.
 *
 * Ce composant ne connaît ni AppNotif ni Call : les appelants lui passent des
 * `PendingRapportItem` déjà normalisés. C'est ce qui permet à la page Calls élève
 * (qui travaille sur des `Call` bruts) et aux deux accueils (qui travaillent sur
 * des notifications) d'utiliser le même carrousel sans conversion tordue.
 */

export interface PendingRapportItem {
  /**
   * Clé de rendu. ATTENTION : côté accueils c'est l'id de la NOTIFICATION
   * (`session_rapport_<uuid>`), pas celui du call — d'où `callId` séparé.
   */
  id: string;
  /**
   * Identifiant du call, indispensable pour retrouver son brouillon. Le confondre
   * avec `id` faisait échouer le rapprochement en silence : le listing ne renvoyait
   * rien et la mention « Commencé » n'apparaissait jamais.
   */
  callId: string;
  /** Ligne principale : « Session avec Marie », « Appel avec Julien »… */
  title: string;
  /** Ligne grise sous le titre. Aujourd'hui : le sujet du call, côté coach seulement. */
  subtitle?: string | null;
  scheduledAt?: string | null;
  duration?: string | null;
  /** Absent chez l'élève, qui n'a que des rapports de vente. */
  badge?: { label: string; tone: 'coaching' | 'sales' } | null;
  /**
   * Rapport commencé mais pas soumis. Ne change RIEN au fait qu'il soit en
   * attente : un brouillon ne compte jamais nulle part, il ajoute seulement un
   * repère de progression et bascule le bouton sur « Reprendre ».
   */
  draft?: { stepIndex: number; stepTotal: number; updatedAt: string } | null;
  /**
   * Libellé de l'étiquette bleue en haut de carte. Par défaut « RAPPORT DE CALL ».
   * Une demande de call coaching y met son propre intitulé : depuis que les
   * invitations et les rapports partagent le même fil, une carte doit pouvoir
   * dire ce qu'elle est.
   */
  kicker?: string;
  /**
   * Actions de la carte. Par défaut le bouton « Remplir / Reprendre le rapport ».
   * Une invitation y passe ses deux boutons Accepter / Refuser — c'est ce qui
   * permet au carrousel d'héberger des cartes qui ne se traitent pas pareil.
   */
  actions?: React.ReactNode;
  /**
   * `false` pour une carte qui n'a pas de brouillon possible (invitation) : elle
   * est alors exclue de la requête de listing au lieu d'y envoyer un id pour rien.
   */
  trackDraft?: boolean;
}

interface Props {
  items: PendingRapportItem[];
  onOpen: (item: PendingRapportItem, index: number) => void;
  /** Titre au-dessus du fil. Par défaut « N rapport(s) en attente ». */
  label?: string;
  arrowSize?: number;
  marginBottom?: number;
}

export default function PendingRapportCard({ items, onOpen, label, marginBottom = 20 }: Props) {
  const [idx, setIdx] = useState(0);
  const viewerTz = useViewerTimeZone();
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Les brouillons sont chargés ICI et non par les trois appelants : une seule
  // requête, un seul endroit à maintenir. Les appelants n'ont rien à savoir des
  // brouillons — ils passent juste leurs items.
  //
  // Le hook est appelé avant tout `return` conditionnel : la règle des hooks
  // interdit d'en sauter un selon la longueur de la liste.
  const drafts = usePendingDrafts(
    items.filter(i => i.trackDraft !== false).map(i => i.callId)
  );

  // Position courante deduite du defilement reel, jamais d'un etat qu'on
  // essaierait de garder synchronise a la main : le doigt peut s'arreter
  // n'importe ou, c'est l'accroche CSS qui tranche.
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const first = el.firstElementChild as HTMLElement | null;
    if (!first) return;
    const step = first.offsetWidth + SLIDE_GAP;
    const next = Math.round(el.scrollLeft / step);
    setIdx(prev => (prev === next ? prev : next));
  };

  const goTo = (i: number) => {
    const el = scrollerRef.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return;
    // `smooth` seulement si l'utilisateur n'a pas demande a reduire les
    // animations — un defilement anime est exactement ce que ce reglage vise.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: i * (first.offsetWidth + SLIDE_GAP), behavior: reduced ? 'auto' : 'smooth' });
  };

  if (items.length === 0) return null;

  // `idx` peut dépasser après qu'un rapport a été rempli (la liste raccourcit sans
  // que l'index bouge). On borne au rendu plutôt que de synchroniser dans un effet :
  // pas de rendu intermédiaire sur une carte vide.
  const safeIdx = Math.min(idx, items.length - 1);
  const single = items.length <= 1;

  return (
    <div style={{ marginBottom }}>
      <div className="eyebrow-lg" style={{ color: 'var(--accent-brand)', marginBottom: 10 }}>
        {label ?? `${items.length} rapport${items.length > 1 ? 's' : ''} en attente`}
      </div>

      {/* Defilement natif avec accroche, plutot que deux fleches laterales.
          Les fleches faisaient 44 px chacune sur mobile et prelevaient 104 px
          avec leurs gouttieres, sur 358 px disponibles : la carte tombait a
          211 px de contenu utile, et elles restaient affichees (a opacity 0.2)
          meme pour un seul element.
          Le debord de la carte suivante remplace le mot « glisser » : un
          element visiblement coupe se lit comme « ca continue ». */}
      {/* Enveloppe qui ancre les zones cliquables des deux bords (desktop) :
          sans position: relative elles se caleraient sur la page. */}
      <div className="fil-avec-zones">
      {!single && <ZonesDefilement cible={scrollerRef} gap={SLIDE_GAP}
        libelleAvant="Rapport suivant" libelleArriere="Rapport precedent" />}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className={`rapport-fil${single ? ' rapport-fil-seul' : ''}`}
      >
        {items.map((raw, i) => {
        const it = { ...raw, draft: raw.draft ?? drafts[raw.callId] ?? null };
        return (
        <div className="rapport-slide" key={it.id}>
        {/* Plus de `border-left: 3px` colore : un liseré decoratif qui decalait
            le texte de 3 px par rapport aux autres cartes de la page, et
            repetait ce que l'etiquette bleue dit deja en toutes lettres. */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-brand)' }}>
                  {it.kicker ?? 'RAPPORT DE CALL'}
                </span>
                {it.badge && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, flexShrink: 0,
                    background: it.badge.tone === 'coaching' ? 'var(--surface-2)' : 'var(--accent-brand-soft)',
                    color: it.badge.tone === 'coaching' ? 'var(--accent)' : 'var(--accent-brand)',
                  }}>
                    {it.badge.label}
                  </span>
                )}
              </div>

              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{it.title}</div>

              {it.subtitle && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{it.subtitle}</div>
              )}

              {it.scheduledAt && (
                // Formaté dans le fuseau du lecteur. L'accueil coach utilisait
                // `toLocaleDateString` sans fuseau, donc l'heure de l'appareil : un
                // coach hors de France y voyait une heure fausse, alors que les deux
                // écrans élève étaient déjà corrects. L'extraction aligne les trois.
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                  {formatDateIn(new Date(it.scheduledAt), viewerTz)}
                  {' · '}
                  {formatTimeIn(new Date(it.scheduledAt), viewerTz)}
                  {it.duration && <span style={{ marginLeft: 8 }}>· {it.duration}</span>}
                </div>
              )}

              {/* Progression d'un rapport commencé. L'ancienneté vient EN PREMIER
                  (« Commencé il y a 3 h · étape 3/5 ») : c'est elle qui dit s'il faut
                  reprendre le brouillon ou repartir de zéro — passé quelques jours on
                  ne reconnaît plus ses propres réponses, et ce rapport-là compte dans
                  les statistiques. L'étape suit, en retrait. */}
              {it.draft && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6,
                  fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
                  background: 'var(--accent-brand-soft)', color: 'var(--accent-brand)',
                }}>
                  {(() => {
                    const age = formatDraftAge(it.draft.updatedAt);
                    // `age` ne vaut null que sur une date absente, invalide ou future :
                    // la pastille reste alors lisible sans repère de temps.
                    return age ? `Commencé ${age}` : 'Commencé';
                  })()}
                  <span style={{ opacity: 0.45, fontWeight: 400 }}>·</span>
                  <span style={{ fontWeight: 600, opacity: 0.8 }}>
                    étape {it.draft.stepIndex}/{it.draft.stepTotal}
                  </span>
                </div>
              )}
            </div>

            {it.actions ?? (
              <button
                className="btn-primary-brand"
                type="button"
                style={{ fontSize: 13, background: 'var(--accent-brand)', flexShrink: 0 }}
                onClick={() => onOpen(it, i)}
              >
                {it.draft ? 'Reprendre le rapport' : 'Remplir le rapport'}
              </button>
            )}
          </div>
        </div>
        </div>
        );
        })}
      </div>
      </div>

      {/* Pastilles : reperes de position, et deuxieme moyen d'atteindre une
          carte precise. Les zones des bords disent le GESTE (avancer d'un
          cran), les pastilles disent la POSITION — les deux repondent a des
          questions differentes, aucune ne remplace l'autre.
          La cible tactile est portee a 44 px par un pseudo-element, sans
          grossir le point lui-meme. */}
      {!single && (
        <div className="rapport-points" role="tablist" aria-label="Navigation entre les cartes">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={i === safeIdx}
              aria-label={`Carte ${i + 1} sur ${items.length}`}
              className={`rapport-point${i === safeIdx ? ' actif' : ''}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
