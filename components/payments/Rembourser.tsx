'use client';

import { useEffect, useState } from 'react';
import { jourCourantIci } from '@/lib/timezone';
import Icon from '@/components/ui/Icon';
import ModaleAction, {
  BoutonFin,
  CaseResponsabilite, Encart, Ligne, Section, VersStripe, champStyle, ChampMontant,
} from './ModaleAction';
import { modeDe } from './etats';
import { fmtEurExact, fmtDateLong, type DealRow, type DealDetail } from './types';

/**
 * Rembourser — quatre situations, un seul composant.
 *
 * ── Ce que Momentum ne fait jamais ─────────────────────────────────────────
 * Il ne rembourse pas. Le remboursement est irréversible chez Stripe, et les
 * frais du paiement initial ne reviennent pas : ce geste appartient à l'élève.
 * Momentum dit quoi faire, où, pour combien — puis constate.
 *
 * ── Pourquoi rien n'est verrouillé ─────────────────────────────────────────
 * L'écran peut être fermé à tout moment. La fiche continue d'afficher ce qu'il
 * reste à rembourser, et l'élève revient quand il veut. Un parcours qu'on ne
 * peut pas quitter, dans un moment de stress, est un parcours qu'on abandonne.
 */

const URL_STRIPE = 'https://dashboard.stripe.com/payments';

export type MotifRemboursement =
  /** Le montant a baissé sous l'encaissé — un remboursement PARTIEL. */
  | 'surplus'
  /** La vente s'annule — tout ce qui a été encaissé doit repartir. */
  | 'annulation'
  /** Le rythme ou le mode change — rembourser puis refaire la vente. */
  | 'refaire';

export default function Rembourser({
  deal, detail, motif, aRembourser, arretRequis, onClose, onDone, onRafraichir,
}: {
  deal: DealRow;
  detail?: DealDetail;
  motif: MotifRemboursement;
  aRembourser: number;
  /** Des prélèvements tournent encore : il faut les arrêter avant de rendre. */
  arretRequis: boolean;
  onClose: () => void;
  onDone: () => void;
  /** Relit les données — sert à constater que le remboursement est arrivé. */
  onRafraichir: () => Promise<unknown> | void;
}) {
  const mode = modeDe(deal);
  const horsStripe = mode === 'offline';
  const prenom = deal.buyerName.split(' ')[0];

  // ── Hors Stripe : rien à constater, tout à déclarer ───────────────────────
  if (horsStripe) {
    return <DeclarerRemboursement deal={deal} motif={motif} aRembourser={aRembourser}
      onClose={onClose} onDone={onDone} />;
  }

  return <AttendreStripe deal={deal} detail={detail} motif={motif} aRembourser={aRembourser}
    arretRequis={arretRequis} prenom={prenom} onClose={onClose} onDone={onDone}
    onRafraichir={onRafraichir} />;
}

/* ══════════════════════════════════════════════════════════════════════════
   REMBOURSER DANS STRIPE, PUIS ATTENDRE LA CONSTATATION
   ══════════════════════════════════════════════════════════════════════════ */

function AttendreStripe({
  deal, detail, motif, aRembourser, arretRequis, prenom, onClose, onDone, onRafraichir,
}: {
  deal: DealRow;
  detail?: DealDetail;
  motif: MotifRemboursement;
  aRembourser: number;
  arretRequis: boolean;
  prenom: string;
  onClose: () => void;
  onDone: () => void;
  onRafraichir: () => Promise<unknown> | void;
}) {
  const [verifie, setVerifie] = useState(false);
  // La sortie de secours n'apparaît qu'au bout de deux minutes : la proposer
  // tout de suite ferait cliquer avant même que Stripe ait pu envoyer quoi que
  // ce soit, et ferait croire à une panne là où il n'y a qu'une seconde d'attente.
  const [secours, setSecours] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSecours(true), 120_000);
    return () => clearTimeout(t);
  }, []);

  // ── Ce qui reste à rendre se relit, il ne se retient pas ──────────────────
  // On ne décompte pas depuis `aRembourser` : c'est la valeur au moment où
  // l'écran s'est ouvert, et elle ne bougerait plus. En repartant de
  // `deal.collected` — que le rafraîchissement met à jour — un remboursement
  // partiel fait descendre le chiffre, et un remboursement complet ferme
  // l'écran tout seul.
  const restant = motif === 'surplus'
    ? Math.max(0, arrondi(deal.collected - deal.amountTotal))
    : deal.collected;
  const fait = restant <= 0.005;

  // ── Le cas « plusieurs échéances » ────────────────────────────────────────
  // Stripe ne rembourse pas un plan en un geste : un remboursement par paiement,
  // et jamais groupé au-delà de remboursements TOTAUX. Les lister évite de croire
  // qu'un seul suffit — et de laisser la moitié de l'argent chez soi.
  const aRendre = (detail?.payments ?? [])
    .filter(p => p.status === 'succeeded')
    .map(p => ({ id: p.id, montant: Number(p.amount), date: p.paid_at }));
  const partiel = motif === 'surplus';

  if (fait) {
    return (
      <ModaleAction titre="Remboursement constaté" onClose={onDone}
        pied={<BoutonFin onDone={onDone} />}>
        <Encart ton="bien" titre="C’est fait">
          Momentum a constaté le remboursement, et les chiffres sont à jour.
          {motif === 'annulation' && <div style={{ marginTop: 6 }}>La vente est annulée.</div>}
          {motif === 'refaire' && <div style={{ marginTop: 6 }}>Tu peux maintenant recréer la vente aux nouvelles conditions.</div>}
        </Encart>
      </ModaleAction>
    );
  }

  return (
    <ModaleAction
      titre={titrePour(motif, prenom)}
      sousTitre={`${fmtEurExact(restant)} en attente de remboursement`}
      onClose={onClose}
      largeur={600}
      pied={
        <>
          <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={onClose}>Fermer</button>
          {secours && (
            <button className="btn-ghost" style={{ fontSize: 12.5, marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={async () => { setVerifie(true); await onRafraichir(); setTimeout(() => setVerifie(false), 1500); }}>
              <Icon name="refresh-cw" size={13} color="var(--muted)" />
              {verifie ? 'Vérification…' : 'Vérifier maintenant'}
            </button>
          )}
        </>
      }>

      {/* ── L'arrêt d'abord, quand il y en a un ──────────────────────────── */}
      {arretRequis && (
        <div style={{ marginBottom: 16 }}>
          <Encart ton="attention" titre="Arrête d’abord ses prélèvements">
            Sans ça, {prenom} continuerait d’être prélevé pendant que tu le
            rembourses. Dans Stripe, le bouton s’appelle
            {' '}<strong>« Annuler l’abonnement »</strong> — c’est le bon, même si le mot
            ne correspond pas à ce que tu vends.
          </Encart>
        </div>
      )}

      {/* ── Ce qu'il faut rendre, exactement ─────────────────────────────── */}
      {partiel ? (
        <Encart ton="attention" titre={`Saisis ${fmtEurExact(restant)}, pas le montant total`}>
          Stripe pré-remplit la fenêtre de remboursement avec le
          {' '}<strong>montant total du paiement</strong>. Ici il ne faut rendre que la
          différence — valider sans corriger rendrait tout.
        </Encart>
      ) : (
        <>
          <Section marge={0}>
            {aRendre.length > 1
              ? `Les ${aRendre.length} paiements déjà encaissés vont être remboursés en entier`
              : 'Le paiement à rembourser'}
          </Section>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
            {aRendre.map(p => (
              <Ligne key={p.id} label={fmtDateLong(p.date)} valeur={fmtEurExact(p.montant)} />
            ))}
            <div style={{ borderTop: '1px solid var(--border-soft)', marginTop: 7, paddingTop: 8 }}>
              <Ligne label="Total à rendre" valeur={fmtEurExact(restant)} ton="fort" />
            </div>
          </div>
          {aRendre.length > 1 && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>
              Stripe permet de cocher plusieurs paiements d’un coup, à condition de
              les rembourser <strong>en entier</strong> — c’est bien le cas ici.
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 16 }}>
        <VersStripe titre={`Ouvrir dans Stripe les paiements de ${prenom}`} url={URL_STRIPE} etapes={[
          <>Ouvre le paiement à rembourser.</>,
          <>En haut à droite, le bouton s’appelle <strong>« Remboursement »</strong> (avec une flèche ↩).</>,
          partiel
            ? <>Remplace le montant proposé par <strong>{fmtEurExact(restant)}</strong>.</>
            : <>Laisse le montant total proposé — c’est bien tout qu’on rend.</>,
          <>Stripe demande un motif : n’importe lequel convient.</>,
        ]} />
      </div>

      <div style={{ marginTop: 14 }}>
        <Encart ton="bien" titre="Tu peux fermer cette fenêtre">
          Momentum détecte les remboursements tout seul, <strong>en quelques
          secondes</strong>. La vente se mettra à jour d’elle-même, et la fiche
          continuera d’afficher ce qu’il reste à rendre en attendant.
        </Encart>
      </div>

      <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7 }}>
        {prenom} verra l’argent revenir sous 5 à 10 jours ouvrés — c’est le délai
        de sa banque, pas le tien. Les frais Stripe du paiement initial ne seront
        pas remboursés.
      </div>

      {secours && (
        <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.6 }}>
          Ça fait plus de deux minutes ? « Vérifier maintenant » interroge Stripe
          directement — ça ne sert qu’à <strong>forcer l’actualisation</strong>, le
          remboursement arriverait de toute façon.
        </div>
      )}
    </ModaleAction>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   DÉCLARER UN REMBOURSEMENT FAIT HORS STRIPE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Hors Stripe, aucun événement ne viendra jamais confirmer le remboursement.
 * Sans cette déclaration, la vente resterait indéfiniment « en attente » alors
 * que le client a été remboursé depuis des semaines.
 *
 * L'élève n'est jamais forcé de déclarer sur-le-champ : la vente reste en
 * « annulation en attente » et il revient quand il veut.
 */
function DeclarerRemboursement({ deal, motif, aRembourser, onClose, onDone }: {
  deal: DealRow;
  motif: MotifRemboursement;
  aRembourser: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [montant, setMontant] = useState(String(aRembourser));
  const [date, setDate] = useState(jourCourantIci());
  const [coche, setCoche] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<{ annulee: boolean; resteARembourser: number } | null>(null);

  const prenom = deal.buyerName.split(' ')[0];
  const valeur = Number(String(montant).replace(',', '.'));
  const valide = Number.isFinite(valeur) && valeur > 0 && valeur <= deal.collected + 0.005;

  async function valider() {
    if (!valide || envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await fetch(`/api/payments/deals/${deal.id}/declare-refund`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: valeur, date, confirmed: true,
          finaliserAnnulation: motif === 'annulation',
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'La déclaration a échoué.');
      setFait(d);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setEnvoi(false);
    }
  }

  if (fait) {
    return (
      <ModaleAction titre="Remboursement enregistré" onClose={onDone}
        pied={<BoutonFin onDone={onDone} />}>
        <Encart ton="bien" titre="C’est noté">
          {fmtEurExact(valeur)} déduits du cash encaissé.
          {fait.annulee && <div style={{ marginTop: 6 }}>La vente est annulée.</div>}
          {!fait.annulee && fait.resteARembourser > 0.005 && (
            <div style={{ marginTop: 6 }}>
              Il reste {fmtEurExact(fait.resteARembourser)} encaissés sur cette vente.
            </div>
          )}
        </Encart>
      </ModaleAction>
    );
  }

  return (
    <ModaleAction
      titre={`Déclarer un remboursement à ${prenom}`}
      sousTitre="Cette vente s’encaisse hors Stripe : Momentum ne peut rien constater tout seul."
      onClose={onClose}
      bloque={envoi}
      pied={
        <>
          <button className="btn-primary-brand" style={{ fontSize: 12.5, opacity: valide && coche && !envoi ? 1 : .5 }}
            disabled={!valide || !coche || envoi} onClick={valider}>
            {envoi ? 'Enregistrement…' : 'Enregistrer le remboursement'}
          </button>
          <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={onClose} disabled={envoi}>Plus tard</button>
          {erreur && <span style={{ fontSize: 12, color: 'var(--red)', flexBasis: '100%' }}>{erreur}</span>}
        </>
      }>

      <Encart>
        Rembourse {prenom} par le moyen de ton choix — virement, espèces — puis
        note-le ici. C’est cette déclaration qui met les chiffres à jour.
      </Encart>

      <Section>Combien lui as-tu rendu ?</Section>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <ChampMontant valeur={montant} onChange={setMontant} autoFocus largeur={180} />
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ ...champStyle, width: 165 }} />
      </div>
      {!valide && montant !== '' && (
        <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 7 }}>
          Cette vente n’a encaissé que {fmtEurExact(deal.collected)} — tu ne peux
          pas déclarer davantage.
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <Encart>
          {/* L'état est composé en une seule expression, et non à cheval sur
              plusieurs lignes de JSX : coupée après « en attente », l'espace qui
              précédait le montant disparaissait au rendu et l'écran affichait
              « 500,00 €à rembourser ». Le séparateur « · » est celui du plan. */}
          Tu n’es pas obligé de le faire maintenant. Si tu fermes, la vente
          t’attendra en{' '}
          <strong>{`« annulation en attente · ${fmtEurExact(aRembourser)} à rembourser »`}</strong>
          , et tu reviendras quand ce sera fait.
        </Encart>
      </div>

      <div style={{ marginTop: 18 }}>
        <CaseResponsabilite niveau="rouge" coche={coche} onChange={setCoche}
          texte="Je déclare avoir réellement remboursé cette somme. Personne ne peut le vérifier à ma place : je reste responsable de cette déclaration, et j’en assume les conséquences en cas d’erreur de ma part." />
      </div>
    </ModaleAction>
  );
}

function titrePour(motif: MotifRemboursement, prenom: string): string {
  return motif === 'surplus' ? `Rembourser le surplus à ${prenom}`
    : motif === 'refaire' ? `Rembourser ${prenom} avant de refaire la vente`
    : `Rembourser ${prenom}`;
}

const arrondi = (n: number) => Math.round(n * 100) / 100;
