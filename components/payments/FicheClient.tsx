'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/ui/Icon';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import Portal from './Portal';
import { useIsMobile } from '@/lib/useIsMobile';
import { ETATS, etatDe, precisionEtat, modeDe, moyenDefini, libelleModalites, compteDansLesTotaux } from './etats';
import { useEcheancesAVenir } from './useEcheances';
import { fmtEur, fmtEurExact, fmtDateLong, type DealRow, type DealDetail, type PersonRow } from './types';
import ModifierMontant from './ModifierMontant';
import ModifierModalites from './ModifierModalites';
import Rembourser, { type MotifRemboursement } from './Rembourser';
import { Cloturer, Annuler, ArreterPrelevements, PaiementInattendu } from './FinDeVie';

/**
 * La fiche d'un CLIENT, et non d'une vente.
 *
 * ── Ce que la première version ratait ──────────────────────────────────────
 * Elle empilait les ventes sans les nommer, et on lisait « j'ai cru que les 3
 * échéances étaient 3 ventes ». D'où quatre partis pris qui ne sont pas
 * décoratifs :
 *
 *  · un séparateur FORT entre les informations du client et ses ventes — sans
 *    lui, on ne sait pas où finit l'un et où commencent les autres ;
 *  · une étiquette « VENTE DU [date] » en tête de chaque bloc, qui lève
 *    l'ambiguïté échéance / vente ;
 *  · les échéances DANS le bloc, sous un titre qui les compte ;
 *  · le journal DANS la vente aussi — il parle de cette vente-là.
 *
 * ── Les boutons ───────────────────────────────────────────────────────────
 * Cinq, sur une seule ligne, aux libellés courts : le titre du bloc dit déjà de
 * quelle vente on parle, les répéter dans chaque bouton allongerait la barre
 * sans rien apprendre. Elle défile horizontalement si l'écran est trop étroit.
 */

type Action =
  | { quoi: 'montant' | 'modalites' | 'cloturer' | 'annuler' | 'arreter' | 'inattendu'; dealId: string }
  | { quoi: 'rembourser'; dealId: string; motif: MotifRemboursement; montant: number; arret: boolean };

export default function FicheClient({
  person, deals, details, onClose, onChange, isCoach, actionInitiale,
}: {
  person: PersonRow;
  /** Les ventes de cette personne, la plus récente en premier. */
  deals: DealRow[];
  details: Record<string, DealDetail>;
  onClose: () => void;
  onChange: () => Promise<unknown> | void;
  isCoach?: boolean;
  /**
   * L'écran à ouvrir en même temps que la fiche.
   *
   * Lu une seule fois, au montage : ensuite l'état local prime, sinon fermer
   * l'écran le rouvrirait au rendu suivant.
   */
  actionInitiale?: Action | null;
}) {
  const isMobile = useIsMobile();
  const [action, setAction] = useState<Action | null>(actionInitiale ?? null);
  const [terminéesOuvertes, setTerminéesOuvertes] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !action) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, action]);

  const actives = deals.filter(d => !estTerminee(d));
  const terminees = deals.filter(estTerminee);

  const contracte = deals.filter(compteDansLesTotaux).reduce((s, d) => s + d.amountTotal, 0);
  const encaisse = deals.filter(compteDansLesTotaux).reduce((s, d) => s + d.collected, 0);
  const pct = contracte > 0 ? Math.min(100, Math.round((encaisse / contracte) * 100)) : 0;

  const dealDeLaction = action ? deals.find(d => d.id === action.dealId) : undefined;

  async function apresAction() {
    await onChange();
    setAction(null);
  }

  const corps = (
    <>
      {/* ── En-tête du client ───────────────────────────────────────────── */}
      <div style={{
        padding: isMobile ? '14px 20px' : '20px 24px', borderBottom: '1px solid var(--border-soft)',
        display: 'flex', alignItems: 'center', gap: 13, flexShrink: 0,
      }}>
        {isMobile ? (
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px 4px 0', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 12.5, color: 'var(--muted)', flexShrink: 0 }}>
            <Icon name="chevR" size={15} color="var(--muted)" />
            <span style={{ transform: 'none' }}>Clients</span>
          </button>
        ) : (
          <Avatar initials={getInitials(person.name)} avatarUrl={person.avatarUrl} size={38} seed={person.key} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.1px' }}>{person.name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {[
              `client depuis le ${fmtDateLong(person.since)}`,
              isCoach ? person.subtitleCoach : person.subtitle,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        {!isMobile && (
          <button onClick={onClose} aria-label="Fermer"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
            <Icon name="x" size={18} color="var(--muted)" />
          </button>
        )}
      </div>

      {/* ── Les totaux du client, toutes ventes confondues ──────────────────
          L'ENCAISSÉ À GAUCHE, le contracté à droite : la barre en dessous se
          remplit de gauche à droite, du premier vers le second. Dans l'autre
          sens, elle progressait visuellement à rebours de ses propres chiffres. */}
      <div style={{ padding: isMobile ? '16px 20px' : '18px 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginBottom: 11 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>Cash encaissé</div>
            <div className="tabular" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--green)' }}>{fmtEurExact(encaisse)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>Cash contracté</div>
            <div className="tabular" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px' }}>{fmtEurExact(contracte)}</div>
          </div>
        </div>
        <Barre pct={pct} etat={person.status} legende={`${pct} % encaissé`} />
      </div>

      {/* ── LE SÉPARATEUR FORT ──────────────────────────────────────────────
          2 px et non 1 : sans lui, on ne voyait pas où finissaient les
          informations du client et où commençaient ses ventes. */}
      <div style={{
        borderTop: '2px solid var(--border)', padding: isMobile ? '14px 20px 0' : '16px 24px 0', flexShrink: 0,
      }}>
        <div className="mono">{deals.length === 1 ? 'La vente' : `Les ${deals.length} ventes`}</div>
      </div>

      {/* ── Les ventes ──────────────────────────────────────────────────── */}
      <div style={{ padding: isMobile ? '12px 20px 24px' : '14px 24px 20px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {actives.map(d => (
          <BlocVente key={d.id} deal={d} detail={details[d.id]} isMobile={isMobile}
            onAction={(quoi) => setAction({ quoi, dealId: d.id } as Action)}
            onChange={onChange} />
        ))}

        {terminees.length > 0 && (
          <>
            {/* Repliées : elles n'appellent aucune action et pousseraient les
                ventes vivantes hors de l'écran chez un client de longue date. */}
            <button onClick={() => setTerminéesOuvertes(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '10px 0',
                marginTop: actives.length > 0 ? 6 : 0,
              }}>
              <Icon name={terminéesOuvertes ? 'chevron-up' : 'chevron-down'} size={14} color="var(--muted)" />
              <span className="mono">
                {terminees.length === 1 ? 'Une vente terminée' : `${terminees.length} ventes terminées`}
              </span>
            </button>
            {terminéesOuvertes && terminees.map(d => (
              <BlocVente key={d.id} deal={d} detail={details[d.id]} isMobile={isMobile}
                onAction={(quoi) => setAction({ quoi, dealId: d.id } as Action)}
                onChange={onChange} />
            ))}
          </>
        )}
      </div>
    </>
  );

  return (
    <>
      <Portal>
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,21,.42)', zIndex: 9998 }} />
        {/* Sur téléphone la fiche REMPLACE la liste, plein écran : une feuille à
            88 % de hauteur laisserait la liste dépasser derrière, et on ne saurait
            plus si on lit une personne ou toutes. */}
        <aside style={isMobile ? {
          position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--surface)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        } : {
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(520px, 100vw)', zIndex: 9999,
          background: 'var(--surface)', boxShadow: 'var(--shadow-modal)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {corps}
        </aside>
      </Portal>

      {/* ── Les écrans d'action ──────────────────────────────────────────── */}
      {action && dealDeLaction && (
        <>
          {action.quoi === 'montant' && (
            <ModifierMontant deal={dealDeLaction} detail={details[action.dealId]}
              onClose={() => setAction(null)} onDone={apresAction}
              onRembourser={(montant, arret) => setAction({
                quoi: 'rembourser', dealId: action.dealId, motif: 'surplus', montant, arret,
              })} />
          )}
          {action.quoi === 'modalites' && (
            <ModifierModalites deal={dealDeLaction} detail={details[action.dealId]}
              onClose={() => setAction(null)} onDone={apresAction}
              onRefaire={(_raison, montant, arret) => setAction({
                quoi: 'rembourser', dealId: action.dealId, motif: 'refaire', montant, arret,
              })} />
          )}
          {action.quoi === 'cloturer' && (
            <Cloturer deal={dealDeLaction} onClose={() => setAction(null)} onDone={apresAction}
              onArreter={() => setAction({ quoi: 'arreter', dealId: action.dealId })} />
          )}
          {action.quoi === 'annuler' && (
            <Annuler deal={dealDeLaction} onClose={() => setAction(null)} onDone={apresAction}
              onRembourser={(montant, arret) => setAction({
                quoi: 'rembourser', dealId: action.dealId, motif: 'annulation', montant, arret,
              })} />
          )}
          {action.quoi === 'arreter' && (
            <ArreterPrelevements deal={dealDeLaction} detail={details[action.dealId]}
              onClose={() => setAction(null)} onDone={apresAction} />
          )}
          {action.quoi === 'inattendu' && (
            <PaiementInattendu deal={dealDeLaction} onClose={() => setAction(null)} onDone={apresAction}
              onRembourser={(montant, arret) => setAction({
                quoi: 'rembourser', dealId: action.dealId, motif: 'annulation', montant, arret,
              })} />
          )}
          {action.quoi === 'rembourser' && (
            <Rembourser deal={dealDeLaction} detail={details[action.dealId]}
              motif={action.motif} aRembourser={action.montant} arretRequis={action.arret}
              onClose={() => setAction(null)} onDone={apresAction} onRafraichir={onChange} />
          )}
        </>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   UN BLOC DE VENTE
   ══════════════════════════════════════════════════════════════════════════ */

function BlocVente({ deal, detail, isMobile, onAction, onChange }: {
  deal: DealRow;
  detail?: DealDetail;
  isMobile: boolean;
  onAction: (quoi: Action['quoi']) => void;
  onChange: () => Promise<unknown> | void;
}) {
  // Sur téléphone, Origine et Journal sont repliés : ils sont utiles quand on
  // les cherche, jamais au premier coup d'œil, et ils repoussent les boutons
  // hors de l'écran.
  const [ouvertes, setOuvertes] = useState({
    echeances: true, origine: !isMobile, journal: !isMobile,
  });

  const etat = etatDe(deal);
  const e = ETATS[etat];
  const precision = precisionEtat(deal);
  const mode = modeDe(deal);
  const echeances = detail?.installments ?? [];
  const paiements = detail?.payments ?? [];
  const journal = detail?.events ?? [];
  const terminee = estTerminee(deal);

  // Quand chaque échéance a-t-elle réellement été payée. Un plan par liens se
  // paie dans le désordre — la 2 avant la 1 — donc la date prévue ne dit rien
  // de la date reçue.
  const dateDePaiement = new Map<string, string>(
    paiements
      .filter(p => p.status === 'succeeded' && p.installment_id && p.paid_at)
      .map(p => [p.installment_id as string, p.paid_at as string]),
  );

  // En prélèvement automatique, l'échéancier vit chez Stripe : on va l'y lire
  // plutôt que d'afficher la seule ligne que la base connaît.
  const { lignes: prelevements } = useEcheancesAVenir(deal, detail);

  // ── Y a-t-il un lien à envoyer sur la vente elle-même ? ──────────────────
  // Le cas du comptant, et celui du prélèvement automatique PAS ENCORE
  // DÉMARRÉ : tant qu'aucun abonnement n'existe chez Stripe, il n'y a qu'un
  // lien, et c'est en le payant que le client saisit sa carte.
  const lienAEnvoyer = echeances.length === 0
    && !deal.stripeSubscriptionId
    && !!deal.shortUrl
    && !terminee
    && deal.collected < deal.amountTotal - 0.005;
  const pct = deal.amountTotal > 0 ? Math.min(100, Math.round((deal.collected / deal.amountTotal) * 100)) : 0;

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 12, marginBottom: 12,
      background: 'var(--surface)', overflow: 'hidden',
    }}>
      {/* ── Le bandeau de la vente ─────────────────────────────────────────
          Beige mat sur toute la largeur, et non un simple titre coloré : c'est
          la bande qui dit qu'un nouveau bloc de vente commence. Sur une fiche
          qui en empile trois, une étiquette seule se perd — la bande, non. */}
      <div style={{
        padding: '9px 14px', display: 'flex', gap: 10,
        background: 'var(--taupe-soft)',
        borderBottom: '1px solid var(--border-soft)',
        // Sur téléphone la pastille passe SOUS le titre : côte à côte, un état
        // long comme « Paiement inattendu » écrasait la date à deux caractères.
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'flex-start' : 'baseline',
      }}>
        <span className="mono" style={{ flex: 1, color: 'var(--taupe)' }}>
          Vente du {fmtDateLong(deal.signedAt)}
        </span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
          fontSize: 10.5, fontWeight: 600, padding: '3px 9px', borderRadius: 999,
          background: e.bg, color: e.color, whiteSpace: 'nowrap',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: e.color }} />
          {e.label}
        </span>
      </div>

      <div style={{ padding: '12px 14px' }}>
        <div className="tabular" style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.4px' }}>
          {fmtEurExact(deal.amountTotal)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{libelleModalites(deal)}</div>
        {precision && (
          <div style={{ fontSize: 11.5, color: e.color, marginTop: 5 }}>{precision}</div>
        )}

        <div style={{ marginTop: 11 }}>
          <Barre pct={pct} etat={etat}
            legende={`${fmtEurExact(deal.collected)} encaissés sur ${fmtEurExact(deal.amountTotal)} · ${pct} %`} />
        </div>

        {/* Ce que les totaux ne montrent pas : l'argent rendu ou repris. */}
        {(deal.refunded > 0.005 || deal.disputed > 0.005) && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 7, lineHeight: 1.6 }}>
            {deal.refunded > 0.005 && <div>{fmtEurExact(deal.refunded)} remboursés — déjà déduits ci-dessus.</div>}
            {deal.disputed > 0.005 && (
              <div style={{ color: 'var(--red)' }}>
                {fmtEurExact(deal.disputed)} contestés — Stripe a repris cet argent le temps du litige.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Les échéances ────────────────────────────────────────────────
          `lienAEnvoyer` fait partie de la condition : une vente toute neuve n'a
          ni échéance, ni paiement, ni prélèvement — la section disparaissait
          donc entièrement, et avec elle le seul lien qu'il y avait à envoyer. */}
      {(echeances.length > 0 || paiements.length > 0 || prelevements.length > 0 || lienAEnvoyer) && (
        <Repliable titre={echeances.length > 0
          ? `Les ${echeances.length} échéances`
          : prelevements.length > 0 ? `Les ${deal.installmentsCount ?? 1} échéances`
          : paiements.length > 1 ? `Les ${paiements.length} paiements`
          : paiements.length === 1 ? 'Le paiement'
          : 'Le lien à envoyer'}
          ouvert={ouvertes.echeances}
          onToggle={() => setOuvertes(o => ({ ...o, echeances: !o.echeances }))}>
          {echeances.length > 0
            ? echeances.map(i => (
                <LigneEcheance key={i.id} inst={i} total={echeances.length} mode={mode}
                  payeLe={dateDePaiement.get(i.id) ?? null} onChange={onChange} />
              ))
            /* ── Prélèvement automatique ──────────────────────────────────
               L'échéancier vit chez Stripe : la base ne connaît que les
               paiements déjà encaissés. Sans les prélèvements à venir, la
               fiche n'affichait qu'une ligne « encaissé le 20 août » et
               laissait deviner ce que le client paierait ensuite — soit
               exactement ce qu'on vient consulter. */
            : prelevements.length > 0
            ? (
              <>
                {paiements.filter(p => p.status === 'succeeded').map((p, i) => (
                  <LignePrelevement key={p.id} rang={i + 1} total={deal.installmentsCount ?? 1}
                    date={p.paid_at} montant={Number(p.amount)} passe />
                ))}
                {prelevements.map(l => (
                  <LignePrelevement key={l.rang} rang={l.rang} total={deal.installmentsCount ?? 1}
                    date={l.date} montant={l.montant} />
                ))}
                {/* Les remboursements et litiges gardent leur ligne à part :
                    ils ne sont pas des échéances. */}
                {paiements.filter(p => p.status !== 'succeeded').map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 0' }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: p.status === 'refunded' ? 'var(--taupe)' : 'var(--red)',
                    }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                      {p.status === 'refunded' ? 'Remboursé' : p.status === 'disputed' ? 'Contesté' : (p.failure_reason ?? 'Échec')}
                      {' '}<span style={{ color: 'var(--muted)' }}>{p.paid_at ? `le ${fmtDateLong(p.paid_at)}` : ''}</span>
                    </span>
                    <span className="tabular" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>
                      − {fmtEurExact(Number(p.amount))}
                    </span>
                  </div>
                ))}
              </>
            )
            : paiements.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 0' }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: p.status === 'succeeded' ? 'var(--green)'
                      : p.status === 'refunded' ? 'var(--taupe)' : 'var(--red)',
                  }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                    {p.status === 'refunded' ? 'Remboursé' : p.status === 'succeeded' ? 'Encaissé' : (p.failure_reason ?? 'Échec')}
                    {' '}<span style={{ color: 'var(--muted)' }}>{p.paid_at ? `le ${fmtDateLong(p.paid_at)}` : ''}</span>
                  </span>
                  <span className="tabular" style={{ fontSize: 12.5, fontWeight: 600, color: p.status === 'succeeded' ? 'var(--ink)' : 'var(--muted)' }}>
                    {p.status === 'refunded' ? '− ' : ''}{fmtEurExact(Number(p.amount))}
                  </span>
                </div>
              ))}

          {/* ── Le lien porté par la vente, faute d'échéance qui le porte ───
              En prélèvement automatique, TOUT dépend de l'existence des
              prélèvements :
               · pas encore de prélèvement → c'est justement ce lien qu'il faut
                 envoyer, c'est en le payant que le client saisit sa carte et
                 déclenche la mise en place ;
               · prélèvements en cours → le lien a fait son travail, l'afficher
                 « ouvert, pas payé » raconterait l'inverse de ce qui s'est passé.
              La distinction se fait sur l'abonnement, jamais sur le mode. */}
          {lienAEnvoyer && (
            <>
              {/* Le prélèvement automatique n'a rien d'automatique tant que la
                  carte n'est pas saisie : sans cette phrase, on cherche des
                  prélèvements qui ne peuvent pas encore exister. */}
              {deal.paymentPlan === 'installments_auto' && paiements.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, paddingBottom: 4 }}>
                  Les prélèvements ne démarreront qu’à la première échéance :
                  c’est en payant ce lien que {deal.buyerName.split(' ')[0]} saisit
                  sa carte, et Stripe met en place les suivants tout seul.
                </div>
              )}
              <LigneLien url={deal.shortUrl!} clics={detail?.clicks ?? 0} envoye={false}
                premierClic={detail?.firstClickAt} suivi={detail?.tracked !== false} />
            </>
          )}

          {/* Le garde-fou du bornage : une date de fin absente signifie que
              Stripe prélèverait indéfiniment. Les dates, elles, sont désormais
              dans l'échéancier ci-dessus. */}
          {mode === 'installments_auto' && !terminee && <BornageStripe dealId={deal.id} />}
        </Repliable>
      )}

      {/* ── Origine ────────────────────────────────────────────────────── */}
      <Repliable titre="Origine" ouvert={ouvertes.origine}
        onToggle={() => setOuvertes(o => ({ ...o, origine: !o.origine }))}>
        <Origine dealId={deal.id} deal={deal} />
      </Repliable>

      {/* ── Journal ────────────────────────────────────────────────────── */}
      {journal.length > 0 && (
        <Repliable titre="Journal de cette vente" ouvert={ouvertes.journal}
          onToggle={() => setOuvertes(o => ({ ...o, journal: !o.journal }))}>
          {journal.map(ev => (
            <div key={ev.id} style={{ display: 'flex', gap: 12, padding: '5px 0', alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, color: 'var(--faint)', flexShrink: 0, width: 62 }}>
                {fmtDateLong(ev.created_at)}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{ev.label}</span>
            </div>
          ))}
        </Repliable>
      )}

      {/* ── La barre d'actions ─────────────────────────────────────────── */}
      <BarreActions deal={deal} etat={etat} mode={mode} onAction={onAction} />
    </div>
  );
}

/**
 * Les boutons d'une vente — ce qui est proposé dépend de son état.
 *
 * Une vente terminée n'en affiche plus, sauf « Annuler » tant qu'elle compte
 * encore dans les chiffres : proposer de modifier le montant d'une vente close
 * offrirait une action sans effet visible.
 */
function BarreActions({ deal, etat, mode, onAction }: {
  deal: DealRow;
  etat: ReturnType<typeof etatDe>;
  mode: ReturnType<typeof modeDe>;
  onAction: (quoi: Action['quoi']) => void;
}) {
  const boutons: Array<[string, Action['quoi'], boolean?]> = [];

  if (etat === 'unexpected') {
    boutons.push(['De l’argent est arrivé', 'inattendu']);
  } else if (etat === 'canceled') {
    // Rien : la vente est sortie des chiffres, il n'y a plus rien à corriger.
  } else if (etat === 'ended') {
    boutons.push(['Annuler', 'annuler', true]);
  } else {
    boutons.push(['Montant', 'montant']);
    // ── Le même écran, deux situations, deux noms ──────────────────────────
    // « Modalités » suppose qu'il y en a : c'est le nom d'un réglage à ajuster.
    // Sur une vente où rien n'a été mis en place, il n'y a pas de réglage, il y
    // a une décision à prendre — et rien sur la fiche ne disait qu'elle
    // attendait. Un second bouton aurait fait doublon : c'est le libellé qui
    // change, pas l'écran.
    boutons.push([
      moyenDefini(deal) ? 'Modalités' : 'Choisir les modalités',
      'modalites',
    ]);
    if (mode === 'installments_auto' && deal.stripeSubscriptionId) {
      boutons.push(['Arrêter', 'arreter']);
    }
    // Une vente soldée n'a plus rien qu'on puisse cesser d'attendre.
    if (etat !== 'paid') boutons.push(['Clôturer', 'cloturer']);
    boutons.push(['Annuler', 'annuler', true]);
  }

  if (boutons.length === 0) return null;

  return (
    <div style={{
      borderTop: '1px solid var(--border-soft)', background: 'var(--surface-2)',
      padding: '10px 14px', display: 'flex', gap: 8,
      // Cinq boutons ne tiennent pas sur 390 px : plutôt que de les empiler sur
      // deux rangées — ce qui ferait perdre l'ordre de gravité — la barre défile.
      overflowX: 'auto', scrollbarWidth: 'none',
    }}>
      {boutons.map(([label, quoi, danger]) => (
        <button key={quoi + label} onClick={() => onAction(quoi)} style={{
          flexShrink: 0, fontSize: 12, padding: '6px 12px', borderRadius: 7, fontFamily: 'inherit',
          cursor: 'pointer', background: 'var(--surface)',
          border: `1px solid ${danger ? 'rgba(205,91,63,.35)' : 'var(--border)'}`,
          color: danger ? 'var(--red)' : 'var(--ink-2)',
          whiteSpace: 'nowrap',
        }}>{label}</button>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PIÈCES
   ══════════════════════════════════════════════════════════════════════════ */

function Repliable({ titre, ouvert, onToggle, children }: {
  titre: string; ouvert: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div style={{ borderTop: '1px solid var(--border-soft)' }}>
      <button onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none',
        border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '10px 14px', textAlign: 'left',
      }}>
        <span className="mono" style={{ flex: 1 }}>{titre}</span>
        <Icon name={ouvert ? 'chevron-up' : 'chevron-down'} size={14} color="var(--faint)" />
      </button>
      {ouvert && <div style={{ padding: '0 14px 12px' }}>{children}</div>}
    </div>
  );
}

/**
 * Une ligne d'échéance, avec son lien sur une ligne à part.
 *
 * Le lien dessous et non à côté : trois liens côte à côte sur 390 px seraient
 * illisibles, et c'est justement en mode « un lien par échéance » qu'il y en a
 * plusieurs à distinguer.
 */
function LigneEcheance({ inst, total, mode, payeLe, onChange }: {
  inst: DealDetail['installments'][number];
  total: number;
  mode: ReturnType<typeof modeDe>;
  /** Date réelle du paiement, quand elle est connue. */
  payeLe: string | null;
  onChange: () => Promise<unknown> | void;
}) {
  const [marque, setMarque] = useState(false);
  const payee = inst.status === 'paid';

  // Une échéance non payée dont la date est passée n'est pas « à payer
  // jusqu'au », c'est en retard. La formulation au futur sur une date dépassée
  // laissait croire qu'il restait du temps.
  const enRetard = !payee && !!inst.due_on
    && new Date(inst.due_on).getTime() < Date.now() - 86400_000;

  async function declarerRecu() {
    setMarque(true);
    try {
      const r = await fetch('/api/payments/installments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installmentId: inst.id, received: true, amount: Number(inst.amount) }),
      });
      if (r.ok) await onChange();
    } finally { setMarque(false); }
  }

  return (
    <div style={{ padding: '6px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: payee ? 'var(--green)' : enRetard ? 'var(--red)'
            : inst.sent_at ? 'var(--amber)' : '#d8d2c5',
        }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 12.5, color: payee ? 'var(--ink)' : 'var(--ink-2)' }}>
            {inst.rank}/{total}
            {'  '}
            <span style={{ color: enRetard ? 'var(--red)' : 'var(--muted)' }}>
              {/* ── La date d'un paiement est celle du PAIEMENT ──────────────
                  On affichait `due_on`, l'échéance prévue : une échéance payée
                  en avance annonçait donc « payée le 19 septembre » alors qu'on
                  était le 28 août. Sans date réelle connue — un virement déclaré
                  avant que la colonne existe — on ne date pas plutôt que
                  d'inventer. */}
              {payee
                ? (payeLe ? `payée le ${fmtDateLong(payeLe)}` : 'payée')
                : mode === 'installments_auto' ? `sera prélevée le ${fmtDateLong(inst.due_on)}`
                : enRetard ? `en retard depuis le ${fmtDateLong(inst.due_on)}`
                // « jusqu'au » et non « le » : le client peut payer avant, et
                // « le 14 août » se lit comme une date imposée.
                : `à payer jusqu’au ${fmtDateLong(inst.due_on)}`}
            </span>
          </span>
        </span>
        <span className="tabular" style={{ fontSize: 12.5, fontWeight: 600, color: payee ? 'var(--ink)' : 'var(--muted)' }}>
          {fmtEurExact(Number(inst.amount))}
        </span>
        {/* Hors Stripe : aucun webhook ne confirmera jamais ce virement. */}
        {!payee && !inst.short_url && (
          <button onClick={declarerRecu} disabled={marque} style={{
            fontSize: 11.5, flexShrink: 0, border: '1px solid var(--border)', borderRadius: 7,
            padding: '4px 9px', background: 'var(--surface)', cursor: marque ? 'default' : 'pointer',
            fontFamily: 'inherit', color: 'var(--ink-2)', opacity: marque ? .6 : 1,
          }}>{marque ? '…' : 'Reçu'}</button>
        )}
      </div>

      {!payee && inst.short_url && (
        <LigneLien url={inst.short_url} clics={inst.clicks ?? 0} envoye={!!inst.sent_at}
          premierClic={inst.firstClickAt} suivi={inst.tracked !== false}
          installmentId={inst.id} onChange={onChange} />
      )}
    </div>
  );
}

/**
 * Un lien, avec l'état de ce que Momentum SAIT de lui.
 *
 * Trois étiquettes seulement, et la règle qui les gouverne : tout ce que
 * Momentum peut constater, il le constate et ne le demande jamais. Un lien
 * ouvert est forcément un lien reçu — inutile de faire cocher « envoyé ».
 */
function LigneLien({ url, clics, envoye, premierClic, suivi = true, installmentId, onChange }: {
  url: string;
  clics: number;
  envoye: boolean;
  /** Jour de la première ouverture — « ouvert le 26 août » se relance, « ouvert » se discute. */
  premierClic?: string | null;
  /** Faux = le lien ne passe pas par Short.io, aucune ouverture n'est mesurable. */
  suivi?: boolean;
  installmentId?: string;
  onChange?: () => Promise<unknown> | void;
}) {
  const [copie, setCopie] = useState(false);
  const [marque, setMarque] = useState(envoye);

  const ouvert = clics > 0;
  // ⚠️ Sans suivi, zéro clic ne veut PAS dire « jamais ouvert » : il veut dire
  // qu'on ne sait pas. Le dire évite de conclure qu'un client ignore un lien
  // qu'il a peut-être déjà lu.
  const etiquette = ouvert
    ? {
        texte: premierClic ? `ouvert le ${fmtDateLong(premierClic)}, pas payé` : 'ouvert, pas payé',
        couleur: 'var(--amber-ink)', fond: 'var(--amber-soft)',
      }
    : marque ? { texte: 'envoyé', couleur: 'var(--accent-brand)', fond: 'var(--accent-brand-soft)' }
    : !suivi ? { texte: 'ouverture non suivie', couleur: 'var(--muted)', fond: 'var(--surface-2)' }
    : { texte: 'pas encore envoyé', couleur: 'var(--muted)', fond: 'var(--surface-2)' };

  async function marquerEnvoye() {
    if (!installmentId) return;
    setMarque(true);
    const r = await fetch('/api/payments/installments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installmentId, sent: true }),
    });
    if (!r.ok) setMarque(false); else await onChange?.();
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 18, marginTop: 3, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11.5, color: 'var(--muted)', fontFamily: 'var(--font-mono, monospace)' }}>
        {url.replace(/^https?:\/\//, '')}
      </span>
      <span style={{
        fontSize: 10, padding: '2px 7px', borderRadius: 999,
        background: etiquette.fond, color: etiquette.couleur, whiteSpace: 'nowrap',
      }}>{etiquette.texte}</span>

      <button onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopie(true);
        setTimeout(() => setCopie(false), 2000);
      }} aria-label="Copier ce lien"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, display: 'flex', flexShrink: 0 }}>
        <Icon name={copie ? 'check' : 'copy'} size={13} color={copie ? 'var(--green)' : 'var(--faint)'} />
      </button>

      {/* Proposé seulement quand Momentum ne peut PAS le déduire : un lien déjà
          ouvert a forcément été envoyé, le demander serait du bruit. */}
      {!ouvert && !marque && installmentId && (
        <button onClick={marquerEnvoye} style={{
          fontSize: 10.5, border: 'none', background: 'none', cursor: 'pointer',
          fontFamily: 'inherit', color: 'var(--accent-brand)', padding: '2px 0',
        }}>Marquer envoyé</button>
      )}
    </div>
  );
}

/**
 * Un prélèvement, passé ou à venir.
 *
 * Le mot « abonnement » n'apparaît jamais : ce que vend l'élève est un
 * accompagnement payé en plusieurs fois, pas une souscription reconductible.
 * L'employer laisserait croire à un renouvellement sans fin — l'inverse exact de
 * ce que garantit le bornage.
 */
function LignePrelevement({ rang, total, date, montant, passe }: {
  rang: number; total: number; date: string | null; montant: number; passe?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 0' }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        background: passe ? 'var(--green)' : '#d8d2c5',
      }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: passe ? 'var(--ink)' : 'var(--ink-2)' }}>
        {rang}/{total}
        {'  '}
        <span style={{ color: 'var(--muted)' }}>
          {passe
            ? `prélevée le ${fmtDateLong(date)}`
            : date ? `sera prélevée le ${fmtDateLong(date)}` : 'date à confirmer'}
        </span>
      </span>
      <span className="tabular" style={{
        fontSize: 12.5, fontWeight: 600, color: passe ? 'var(--ink)' : 'var(--muted)',
      }}>{fmtEurExact(montant)}</span>
    </div>
  );
}

/**
 * Le garde-fou du bornage.
 *
 * Les dates vivent désormais dans l'échéancier au-dessus ; ce bloc ne sert plus
 * qu'à une chose, mais elle est vitale : sans date de fin, Stripe prélèverait
 * indéfiniment. Le webhook coupe en secours au dernier versement, mais l'élève
 * doit pouvoir le constater lui-même avant d'y arriver — d'où un avertissement
 * qui n'apparaît QUE dans ce cas, et rien du tout quand tout va bien.
 */
function BornageStripe({ dealId }: { dealId: string }) {
  const [sched, setSched] = useState<{ status: string; endsAt: string | null; bounded: boolean } | null>(null);

  useEffect(() => {
    let vivant = true;
    fetch(`/api/payments/schedule?dealId=${dealId}`)
      .then(r => r.ok ? r.json() : { schedule: null })
      .then(d => { if (vivant) setSched(d.schedule); })
      .catch(() => {});
    return () => { vivant = false; };
  }, [dealId]);

  if (!sched || sched.status === 'canceled') return null;
  if (sched.bounded && sched.endsAt) return null;

  return (
    <div style={{
      marginTop: 10, padding: '9px 12px', borderRadius: 8,
      background: 'var(--red-soft)', border: '1px solid rgba(205,91,63,.28)',
      fontSize: 11.5, color: 'var(--red)', lineHeight: 1.5,
    }}>
      Aucune date de fin enregistrée chez Stripe — préviens le support avant la
      dernière échéance.
    </div>
  );
}

/** D'où vient ce client — lu à l'ouverture, seul endroit où la question se pose. */
function Origine({ dealId, deal }: { dealId: string; deal: DealRow }) {
  const [etapes, setEtapes] = useState<{ label: string; date: string }[] | null>(null);

  useEffect(() => {
    let vivant = true;
    fetch(`/api/payments/chain?dealId=${dealId}`)
      .then(r => r.ok ? r.json() : { steps: [] })
      .then(d => { if (vivant) setEtapes(d.steps ?? []); })
      .catch(() => { if (vivant) setEtapes([]); });
    return () => { vivant = false; };
  }, [dealId]);

  if (etapes === null) return <div style={{ fontSize: 12, color: 'var(--muted)' }}>Chargement…</div>;
  if (etapes.length === 0) {
    return (
      <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
        {deal.callId
          ? 'Vente conclue en appel, sans prospect rattaché au pipeline.'
          : 'Cette vente n’est rattachée à aucun prospect — créée à la main ou vente directe.'}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', paddingLeft: 22 }}>
      <div style={{ position: 'absolute', left: 4, top: 6, bottom: 9, width: 1, background: 'var(--border)' }} />
      {etapes.map((s, i) => {
        const dernier = i === etapes.length - 1;
        return (
          <div key={i} style={{ position: 'relative', paddingBottom: dernier ? 0 : 7 }}>
            <span style={{
              position: 'absolute', left: -22, top: 3, width: 10, height: 10, borderRadius: '50%',
              boxSizing: 'border-box',
              background: dernier ? 'var(--accent-brand)' : 'var(--surface)',
              border: `1.5px solid ${dernier ? 'var(--accent-brand)' : 'var(--border)'}`,
            }} />
            <div style={{ display: 'flex', gap: 12 }}>
              <span style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.4 }}>{s.label}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{s.date}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * La barre de progression, dont la couleur dit l'état.
 *
 * La légende vit SOUS la barre et CENTRÉE : au-dessus et alignée à gauche, elle
 * se lisait comme un titre de la section suivante plutôt que comme la mesure de
 * la barre. Sous elle et centrée, elle appartient visiblement à ce qu'elle
 * mesure.
 */
export function Barre({ pct, etat, legende }: { pct: number; etat: string; legende?: string }) {
  const couleur = etat === 'paid' ? 'var(--green)'
    : etat === 'ended' || etat === 'canceled' ? 'var(--taupe)'
    : etat === 'disputed' || etat === 'past_due' ? 'var(--red)'
    : etat === 'unexpected' ? 'var(--amber)'
    : 'var(--accent-brand)';

  return (
    <div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, background: couleur, borderRadius: 3 }} />
      </div>
      {legende && (
        <div className="tabular" style={{
          fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 6,
        }}>{legende}</div>
      )}
    </div>
  );
}

/** Terminée = plus rien à attendre. Le paiement inattendu, lui, appelle une décision. */
function estTerminee(d: DealRow): boolean {
  if (d.unexpectedPaymentAt) return false;
  return d.status === 'ended' || d.status === 'canceled' || d.status === 'paid';
}

export { fmtEur };
