'use client';

import { useState } from 'react';
import Icon from '@/components/ui/Icon';
import ModaleAction, {
  BoutonFin, Rondelle,
  CaseResponsabilite, Encart, Ligne, Section, VersStripe, champStyle,
} from './ModaleAction';
import { modeDe, libelleRythme } from './etats';
import { useEcheancesAVenir } from './useEcheances';
import { fmtEurExact, fmtDateLong, type DealRow, type DealDetail } from './types';

/**
 * Les écrans de fin de vie d'une vente.
 *
 * ── Clôturer et Annuler ne sont PAS deux mots pour la même chose ───────────
 * Clôturer garde tout : la vente a eu lieu, elle s'arrête avant la fin, l'argent
 * versé reste compté et le manquant ne sera jamais réclamé.
 * Annuler efface : la vente sort du cash contracté ET du cash encaissé, et
 * l'appel cesse de compter comme une vente conclue.
 *
 * Deux gestes voisins, deux effets opposés. D'où une case à cocher sur le second
 * seulement — la mettre sur les deux la banaliserait là où elle protège.
 */

const URL_STRIPE = 'https://dashboard.stripe.com/payments';

/* ══════════════════════════════════════════════════════════════════════════
   CLÔTURER
   ══════════════════════════════════════════════════════════════════════════ */

export function Cloturer({ deal, onClose, onDone, onArreter }: {
  deal: DealRow;
  onClose: () => void;
  onDone: () => void;
  /** Le bouton du refus : les deux actions se rejoignent sur ce mode. */
  onArreter: () => void;
}) {
  const [raison, setRaison] = useState('');
  const [envoi, setEnvoi] = useState(false);
  // ⚠️ Le refus s'affiche À L'OUVERTURE, pas après validation.
  //
  // Le serveur refusait déjà (`code: 'prelevement_actif'`), mais seulement une
  // fois « Clôturer la vente » cliqué. Entre-temps l'écran affichait « Rien à
  // faire dans Stripe — aucun argent ne bouge », ce qui est FAUX sur une vente
  // dont Stripe prélèvera encore 250 € le mois suivant. On lisait une promesse,
  // on cliquait, et le refus arrivait après coup : l'écran s'était contredit.
  //
  // ⚠️ Ce n'est PAS une garde — le serveur reste seul juge, lui interroge Stripe
  // pour savoir si l'abonnement est réellement annulé. C'est un affichage : ne
  // pas promettre ce qu'on va refuser.
  //
  // Un deal encore `open` portant un abonnement a presque toujours un abonnement
  // vivant : une annulation constatée par le webhook l'aurait déjà passé en
  // `ended`, où le bouton « Clôturer » n'existe plus.
  const [refus, setRefus] = useState<string | null>(
    () => (deal.stripeSubscriptionId ? 'prelevement_actif' : null));
  const [fait, setFait] = useState(false);

  const prenom = deal.buyerName.split(' ')[0];
  const manquant = Math.max(0, arrondi(deal.amountTotal - deal.collected));

  async function valider() {
    setEnvoi(true);
    try {
      const r = await fetch(`/api/payments/deals/${deal.id}/end`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: raison.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.code === 'prelevement_actif') { setRefus(d.error); return; }
        throw new Error(d.error);
      }
      setFait(true);
    } catch {
      setRefus('La clôture a échoué. Réessaie dans un instant.');
    } finally {
      setEnvoi(false);
    }
  }

  if (fait) {
    return (
      <ModaleAction titre="Vente clôturée" onClose={onDone}
        pied={<BoutonFin onDone={onDone} />}>
        <Encart ton="bien" titre="C’est fait">
          Cette vente n’attend plus rien. Elle reste comptée pour
          {' '}{fmtEurExact(deal.collected)} encaissés, et sort des relances.
          <div style={{ marginTop: 6 }}>Tu peux la rouvrir d’un clic si tu changes d’avis.</div>
        </Encart>
      </ModaleAction>
    );
  }

  // ── Refus : des prélèvements tournent encore ──────────────────────────────
  if (refus) {
    return (
      <ModaleAction titre="Cette vente a des prélèvements en cours" onClose={onClose}
        pied={
          <>
            <button className="btn-primary-brand" style={{ fontSize: 12.5 }} onClick={onArreter}>
              Arrêter les prélèvements
            </button>
            <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={onClose}>Fermer</button>
          </>
        }>
        <Encart ton="attention" titre="Clôturer maintenant afficherait un mensonge">
          La vente dirait « terminée » pendant que Stripe continuerait de prélever
          {' '}{prenom} tous les {libelleRythme(deal.installmentInterval) === 'mensuel' ? 'mois' : 'semaines'}.
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(181,128,37,.28)' }}>
            Les deux actions se rejoignent sur ce mode de paiement : arrête d’abord
            les prélèvements, et Momentum clôturera la vente tout seul dès qu’il
            l’aura constaté.
          </div>
        </Encart>
      </ModaleAction>
    );
  }

  return (
    <ModaleAction
      titre={`Clôturer la vente du ${fmtDateLong(deal.signedAt)}`}
      sousTitre="Tu n’attends plus rien sur cette vente."
      onClose={onClose}
      bloque={envoi}
      pied={
        <>
          <button className="btn-primary-brand" style={{ fontSize: 12.5, opacity: envoi ? .5 : 1 }}
            disabled={envoi} onClick={valider}>
            {envoi ? 'Clôture…' : 'Clôturer la vente'}
          </button>
          <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={onClose} disabled={envoi}>Annuler</button>
        </>
      }>

      <Encart>
        C’est le cas quand l’accompagnement s’arrête en cours de route et que
        {' '}{prenom} ne paiera pas la suite. Ce qu’il a versé lui reste dû à toi ;
        le reste ne lui sera jamais réclamé.
      </Encart>

      <Section>Ce que ça change</Section>
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
        <Ligne label="Cash encaissé — inchangé" valeur={fmtEurExact(deal.collected)} ton="fort" />
        <Ligne label="Cash contracté — inchangé" valeur={fmtEurExact(deal.amountTotal)} />
        <Ligne label="Ne sera jamais réclamé" valeur={fmtEurExact(manquant)} ton="eteint" />
        <div style={{ borderTop: '1px solid var(--border-soft)', marginTop: 7, paddingTop: 8, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          La vente sort des relances, et ses liens de paiement cessent de
          fonctionner — sans quoi {prenom} pourrait payer une vente que tu
          considères close.
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Encart ton="bien" titre="Rien à faire dans Stripe">
          Aucun argent ne bouge, et rien n’est modifié chez Stripe. C’est une
          étiquette, pas une opération — tu peux revenir en arrière d’un clic.
        </Encart>
      </div>

      <Section>Pourquoi ? <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--faint)' }}>(facultatif)</span></Section>
      <input value={raison} onChange={e => setRaison(e.target.value)} maxLength={200}
        placeholder="Accompagnement arrêté d’un commun accord…" style={champStyle} />
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
        Enregistré au journal de la vente — utile dans six mois, quand personne ne
        se souviendra du contexte.
      </div>
    </ModaleAction>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ANNULER
   ══════════════════════════════════════════════════════════════════════════ */

export function Annuler({ deal, onClose, onDone, onRembourser }: {
  deal: DealRow;
  onClose: () => void;
  onDone: () => void;
  onRembourser: (aRembourser: number, arretRequis: boolean) => void;
}) {
  const [coche, setCoche] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<{ liensDesactives: number; contracteRetire: number; appelDeclasse: boolean } | null>(null);

  const prenom = deal.buyerName.split(' ')[0];
  const encaisse = deal.collected;

  async function valider() {
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await fetch(`/api/payments/deals/${deal.id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      const d = await r.json();
      // La vente ne s'annule qu'une fois l'argent rendu : la route a désactivé
      // les liens et conduit au remboursement.
      if (r.status === 409 && d.enAttenteRemboursement) {
        onRembourser(d.aRembourser, !!d.arretRequis);
        return;
      }
      if (!r.ok) throw new Error(d.error || "L'annulation a échoué.");
      setFait(d);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setEnvoi(false);
    }
  }

  if (fait) {
    return (
      <ModaleAction titre="Vente annulée" onClose={onDone}
        pied={<BoutonFin onDone={onDone}>J’ai compris</BoutonFin>}>
        {/* ── Conditionnel, jamais générique ────────────────────────────────
            Annoncer « prélèvements arrêtés » quand il n'y en avait aucun, ou
            « liens désactivés » quand il n'y en avait pas, ferait douter du
            reste — et c'est le reste qui compte. */}
        <Encart ton="bien" titre="C’est fait">
          <div>{fmtEurExact(fait.contracteRetire)} retirés du cash contracté.</div>
          {encaisse > 0.005 && <div>{fmtEurExact(encaisse)} retirés du cash encaissé.</div>}
          {fait.liensDesactives > 0 && (
            <div>{fait.liensDesactives} lien{fait.liensDesactives > 1 ? 's' : ''} de paiement désactivé{fait.liensDesactives > 1 ? 's' : ''}.</div>
          )}
          {fait.appelDeclasse && <div>L’appel est passé en perdu, sans objection.</div>}
        </Encart>

        <div style={{ marginTop: 12 }}>
          <Encart>
            Si de l’argent arrivait malgré tout sur cette vente, tu en seras
            prévenu, et conduit aux étapes pour le lui rendre.
          </Encart>
        </div>
      </ModaleAction>
    );
  }

  return (
    <ModaleAction
      titre={`Annuler la vente du ${fmtDateLong(deal.signedAt)}`}
      sousTitre={`${fmtEurExact(deal.amountTotal)} · ${deal.buyerName}`}
      onClose={onClose}
      bloque={envoi}
      pied={
        <>
          <button className="btn-primary-brand"
            style={{ fontSize: 12.5, opacity: coche && !envoi ? 1 : .5, background: coche ? 'var(--red)' : undefined, borderColor: coche ? 'var(--red)' : undefined }}
            disabled={!coche || envoi} onClick={valider}>
            {envoi ? 'Annulation…' : encaisse > 0.005 ? 'Annuler et rembourser' : 'Annuler la vente'}
          </button>
          <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={onClose} disabled={envoi}>Revenir</button>
          {erreur && <span style={{ fontSize: 12, color: 'var(--red)', flexBasis: '100%' }}>{erreur}</span>}
        </>
      }>

      <Encart ton="grave" titre="Annuler efface cette vente de tes chiffres">
        Ce n’est pas la même chose que clôturer : clôturer garde la vente et
        arrête simplement d’attendre la suite.
      </Encart>

      <Section>Ce que ça change</Section>
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
        <Ligne label="Retiré du cash contracté" valeur={`− ${fmtEurExact(deal.amountTotal)}`} ton="fort" />
        {encaisse > 0.005 && (
          <Ligne label="Retiré du cash encaissé" valeur={`− ${fmtEurExact(encaisse)}`} ton="fort" />
        )}
        {deal.callId && (
          <div style={{ borderTop: '1px solid var(--border-soft)', marginTop: 7, paddingTop: 8, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            L’appel passera en <strong>perdu, sans objection</strong> dans tes
            statistiques, et sortira de ton taux de closing.
          </div>
        )}
      </div>

      {encaisse > 0.005 && (
        <div style={{ marginTop: 12 }}>
          <Encart ton="attention" titre={`${fmtEurExact(encaisse)} à rendre à ${prenom}`}>
            La vente ne sera pas annulée tout de suite : tant que l’argent est
            encore chez toi, l’effacer des chiffres les rendrait faux dans l’autre
            sens.
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(181,128,37,.28)' }}>
              Ses liens de paiement seront désactivés immédiatement, et l’écran
              suivant te conduira au remboursement.
              {deal.stripeSubscriptionId && <> Ses prélèvements devront aussi être arrêtés.</>}
              {' '}Tu peux fermer et revenir : la vente t’attendra en
              «&nbsp;annulation en attente&nbsp;».
            </div>
          </Encart>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <CaseResponsabilite niveau="rouge" coche={coche} onChange={setCoche}
          texte="J’ai vérifié cette vente et mon client en est informé. Je reste responsable de ce retrait dans mes chiffres, et j’en assume les conséquences en cas d’erreur de ma part." />
      </div>
    </ModaleAction>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ARRÊTER LES PRÉLÈVEMENTS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Momentum n'arrête jamais un prélèvement lui-même : chez Stripe, un abonnement
 * annulé ne se réactive JAMAIS. Une erreur de clic ici obligerait à refaire
 * saisir sa carte au client. L'élève le fait, Momentum constate.
 *
 * L'écran traduit donc les deux options de Stripe en dates et montants réels sur
 * CETTE vente — « immédiatement » et « à la fin de la période » ne veulent rien
 * dire tant qu'on ne sait pas ce que chacune coûte.
 */
export function ArreterPrelevements({ deal, detail, onClose, onDone }: {
  deal: DealRow;
  detail?: DealDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const prenom = deal.buyerName.split(' ')[0];
  const nb = deal.installmentsCount ?? 1;
  const passees = deal.paidCount;
  const restantes = Math.max(0, nb - passees);
  const parEcheance = restantes > 0
    ? arrondi((deal.amountTotal - deal.collected) / restantes)
    : 0;

  // ⚠️ `detail.installments` est VIDE en prélèvement automatique — l'échéancier
  // vit chez Stripe, pas en base. Or c'est le seul mode où cet écran existe : la
  // date n'apparaissait donc jamais, et les deux options disaient « l'échéance
  // suivante » là où le plan demandait « l'échéance du 20 septembre ».
  //
  // Traduire les deux choix en DATES et en MONTANTS réels est toute la raison
  // d'être de cet écran : sans la date, on doit aller la chercher ailleurs pour
  // décider, c'est-à-dire au moment où l'on est le moins disposé à chercher.
  //
  // `useEcheancesAVenir` est la source que la fiche utilise déjà, et elle sait
  // interroger Stripe pour ce mode.
  const { lignes: aVenirReel } = useEcheancesAVenir(deal, detail);
  const prochaine = (detail?.installments ?? []).find(e => e.status !== 'paid');
  const dateProchaine = prochaine?.due_on ?? aVenirReel[0]?.date ?? null;

  return (
    <ModaleAction
      titre="Arrêter les prélèvements"
      sousTitre={`${prenom} a été prélevé ${passees} fois sur ${nb}.`}
      onClose={onClose}
      largeur={600}
      pied={<BoutonFin onDone={onDone} discret>Fermer</BoutonFin>}>

      <Encart>
        Momentum ne peut pas arrêter des prélèvements à ta place : chez Stripe,
        des prélèvements annulés <strong>ne se réactivent jamais</strong>. Une
        erreur obligerait {prenom} à ressaisir sa carte.
      </Encart>

      <Section>Les deux choix que Stripe te proposera</Section>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Immédiatement</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            L’échéance {dateProchaine ? `du ${fmtDateLong(dateProchaine)}` : 'suivante'}
            {' '}<strong>ne sera pas prélevée</strong>.
            {' '}{prenom} aura versé {fmtEurExact(deal.collected)} en tout.
          </div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>À la fin de la période</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            L’échéance {dateProchaine ? `du ${fmtDateLong(dateProchaine)}` : 'suivante'}
            {' '}<strong>sera prélevée</strong>, puis plus rien.
            {' '}{prenom} aura versé {fmtEurExact(arrondi(deal.collected + parEcheance))} en tout.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <VersStripe titre="Comment faire, dans Stripe" url={URL_STRIPE} etapes={[
          <>Ouvre la page de {prenom} dans Stripe.</>,
          <>Le bouton s’appelle <strong>« Annuler l’abonnement »</strong> — c’est le bon,
            même si le mot ne correspond pas à ce que tu vends.</>,
          <>Choisis l’une des deux options ci-dessus.</>,
        ]} />
      </div>

      <div style={{ marginTop: 14 }}>
        <Encart ton="bien" titre="Tu peux fermer cette fenêtre">
          Momentum détecte l’arrêt tout seul, en quelques secondes. La vente se
          mettra à jour d’elle-même — rien n’est verrouillé en attendant.
        </Encart>
      </div>
    </ModaleAction>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PAIEMENT INATTENDU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * De l'argent est arrivé sur une vente terminée.
 *
 * Momentum ne devine pas si le client a repris ses paiements ou s'est trompé :
 * les deux arrivent, et les conclusions sont opposées. Il pose la question.
 *
 * Sur une vente ANNULÉE, « Réouvrir » n'est pas proposé : la vente est sortie des
 * chiffres, l'appel a été déclassé, et la remettre en cours d'un clic
 * reconstruirait un état que personne n'a demandé.
 */
export function PaiementInattendu({ deal, onClose, onDone, onRembourser }: {
  deal: DealRow;
  onClose: () => void;
  onDone: () => void;
  onRembourser: (aRembourser: number, arretRequis: boolean) => void;
}) {
  const [envoi, setEnvoi] = useState(false);
  const prenom = deal.buyerName.split(' ')[0];
  const annulee = deal.status === 'canceled';

  async function reouvrir() {
    setEnvoi(true);
    try {
      const r = await fetch(`/api/payments/deals/${deal.id}/end`, { method: 'DELETE' });
      if (r.ok) onDone();
    } finally { setEnvoi(false); }
  }

  async function cEtaitUneErreur() {
    await fetch(`/api/payments/deals/${deal.id}/unexpected`, { method: 'DELETE' });
    onRembourser(deal.collected, false);
  }

  return (
    <ModaleAction
      titre={`${prenom} a payé après la fin de la vente`}
      sousTitre={deal.unexpectedPaymentAt ? `Signalé le ${fmtDateLong(deal.unexpectedPaymentAt)}` : undefined}
      onClose={onClose}
      bloque={envoi}
      pied={
        <>
          {!annulee && (
            <button className="btn-primary-brand" style={{ fontSize: 12.5, opacity: envoi ? .5 : 1 }}
              disabled={envoi} onClick={reouvrir}>
              Réouvrir la vente
            </button>
          )}
          <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={cEtaitUneErreur} disabled={envoi}>
            Rembourser — c’était une erreur
          </button>
        </>
      }>

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
        <Ligne label={annulee ? 'Vente annulée le' : 'Vente terminée le'}
          valeur={deal.endedAt ? fmtDateLong(deal.endedAt) : '—'} />
        <Ligne label="Encaissé au total" valeur={fmtEurExact(deal.collected)} ton="fort" />
        <Ligne label="Montant de la vente" valeur={fmtEurExact(deal.amountTotal)} />
      </div>

      <div style={{ marginTop: 14 }}>
        <Encart ton="attention" titre={`${prenom} a-t-il repris ses paiements, ou s’est-il trompé ?`}>
          Momentum ne peut pas le savoir : il voit l’argent, pas l’intention. Il
          n’a donc rien rouvert tout seul — le faire à tort remettrait la vente
          dans tes relances et réclamerait un argent qui n’est pas dû.
          {annulee && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(181,128,37,.28)' }}>
              Cette vente est <strong>annulée</strong> : elle est sortie de tes
              chiffres et l’appel a été déclassé. Elle ne se rouvre pas d’un clic —
              si le paiement était légitime, crée une nouvelle vente.
            </div>
          )}
        </Encart>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, display: 'flex', gap: 8 }}>
        <Icon name="info" size={14} color="var(--faint)" />
        <span>
          L’argent reste compté tant qu’il n’est pas rendu : il est bien sur ton
          compte Stripe.
        </span>
      </div>
    </ModaleAction>
  );
}

const arrondi = (n: number) => Math.round(n * 100) / 100;
