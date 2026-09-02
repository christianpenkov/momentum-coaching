'use client';

import { useState } from 'react';
import ModaleAction, {
  CaseResponsabilite, Encart, Section, Ligne, LienACopier, Chip,
} from './ModaleAction';
import { moyenDe } from './etats';
import {
  fmtEurExact, fmtDateLong,
  type DealRow, type DealDetail, type RaisonRemboursement,
} from './types';

/**
 * « Pourquoi cet argent est-il reparti ? »
 *
 * ── Pourquoi cette question, et pourquoi ici ───────────────────────────────
 * Momentum ne rembourse jamais : l'élève le fait dans Stripe, le webhook le
 * constate. Il enregistre donc un mouvement d'argent sans savoir POURQUOI — or
 * c'est cette raison, et elle seule, qui décide si le client doit encore quelque
 * chose.
 *
 * Faute de la demander, la vente affichait « Soldée » à côté de « 80 % encaissé »
 * sans que rien ne relie les deux, et on lisait « il me manque 200 € ».
 *
 * ── Une seule question, posée une seule fois ───────────────────────────────
 * Une première version proposait un bouton « Réclamer le remboursement » sur la
 * fiche. Deux défauts : le libellé se lit à l'envers (on croit réclamer d'être
 * remboursé), et surtout il demandait de reconstituer une intention des semaines
 * plus tard. La question se pose maintenant à la détection, quand le fait est
 * frais, et une fois répondue elle ne revient plus.
 *
 * ── Ce que chaque réponse fait ─────────────────────────────────────────────
 * Trois réponses sur quatre disent « cet argent n'est plus dû » : la vente vaut
 * alors moins, son montant baisse d'autant, et elle redevient soldée à 100 %.
 * C'est la seule lecture où chaque chiffre affiché est vrai sans note de bas de
 * page. Le montant d'origine n'est pas perdu, il vit au journal.
 *
 * « Par erreur » est la seule qui relance le client — et c'est écrit avant de
 * valider, parce que c'est l'effet le plus lourd et le moins visible.
 */

type Etape = 'raison' | 'consequence';

const RAISONS: { cle: RaisonRemboursement; titre: string; sous: string }[] = [
  { cle: 'geste_commercial', titre: 'Un geste commercial',
    sous: 'Remise, dédommagement, arrangement — tu as choisi de rendre cet argent.' },
  { cle: 'retractation', titre: 'Il s’est rétracté en partie',
    sous: 'Il a renoncé à une partie de l’accompagnement, et tu l’as remboursé.' },
  { cle: 'erreur', titre: 'C’était une erreur',
    sous: 'Ce remboursement n’aurait pas dû partir. Il te doit toujours cette somme.' },
  { cle: 'autre', titre: 'Autre raison', sous: 'Tu précises, et tu dis si l’argent reste dû.' },
];

export default function RaisonRemboursement({ deal, detail, onClose, onDone }: {
  deal: DealRow;
  detail?: DealDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const prenom = deal.buyerName.split(' ')[0];

  // Le premier remboursement sans raison. Il y en a rarement plusieurs, et les
  // traiter un par un vaut mieux qu'un écran qui en mélange deux.
  const ligne = (detail?.payments ?? [])
    .filter(p => p.status === 'refunded' && !p.refund_reason)
    .sort((a, b) => (a.paid_at ?? '').localeCompare(b.paid_at ?? ''))[0];

  const montant = ligne ? Math.abs(Number(ligne.amount)) : 0;

  const [etape, setEtape] = useState<Etape>('raison');
  const [raison, setRaison] = useState<RaisonRemboursement | null>(null);
  const [note, setNote] = useState('');
  const [encoreDu, setEncoreDu] = useState<boolean | null>(null);
  const [encaissement, setEncaissement] = useState<'lien' | 'offline'>(
    () => (moyenDe(deal) === 'offline' ? 'offline' : 'lien'));
  const [coche, setCoche] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<
    { encoreDu: boolean; avant?: number; apres?: number; lien: { url: string } | null } | null>(null);

  // « Autre » est la seule qui ne porte pas son sort : on le demande.
  const duFinal = raison === 'autre' ? encoreDu : raison === 'erreur';
  const nouveauMontant = Math.max(0, Math.round((deal.amountTotal - montant) * 100) / 100);

  async function valider() {
    if (!raison || !coche || envoi || duFinal === null) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await fetch(`/api/payments/deals/${deal.id}/refund-reason`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paymentId: ligne!.stripe_payment_id,
          raison, note, encoreDu: duFinal, encaissement,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'L’enregistrement a échoué.');
      setResultat(d);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setEnvoi(false);
    }
  }

  // ── Aucun remboursement en attente ────────────────────────────────────────
  if (!ligne) {
    return (
      <ModaleAction titre="Rien à expliquer" onClose={onClose}
        pied={<button className="btn-primary-brand" style={{ fontSize: 12.5 }} onClick={onClose}>Fermer</button>}>
        <Encart ton="bien" titre="Tous les remboursements sont expliqués">
          Chaque remboursement de cette vente porte déjà sa raison.
        </Encart>
      </ModaleAction>
    );
  }

  // ── Résultat ──────────────────────────────────────────────────────────────
  if (resultat) {
    return (
      <ModaleAction
        titre={resultat.encoreDu
          ? `${fmtEurExact(montant)} de nouveau à encaisser`
          : `Vente ramenée à ${fmtEurExact(resultat.apres ?? nouveauMontant)}`}
        onClose={onDone}
        pied={<button className="btn-primary-brand" style={{ fontSize: 12.5 }} onClick={onDone}>Terminé</button>}>

        {resultat.encoreDu ? (
          <>
            <Encart ton="bien" titre="C’est fait">
              La vente est repassée <strong>en cours</strong>. Elle réapparaît dans
              tes relances, et {prenom} sera rappelé comme pour n’importe quelle
              échéance.
            </Encart>
            {resultat.lien ? (
              <>
                <Section>Le lien à envoyer à {prenom}</Section>
                <LienACopier url={resultat.lien.url} libelle={`Complément — ${prenom}`} />
              </>
            ) : (
              <Encart ton="attention" titre="Préviens-le toi-même">
                Tu encaisses hors Stripe : l’échéance est créée, mais Momentum ne
                peut prévenir personne. C’est à toi de dire à {prenom} ce qu’il
                doit virer, et de le noter ici quand il arrive.
              </Encart>
            )}
          </>
        ) : (
          <Encart ton="bien" titre="C’est fait">
            Cette vente vaut désormais{' '}
            <strong>{fmtEurExact(resultat.apres ?? nouveauMontant)}</strong>, et elle
            est <strong>soldée à 100 %</strong>. Le montant d’origine
            ({fmtEurExact(resultat.avant ?? deal.amountTotal)}) reste inscrit au
            journal de la vente.
          </Encart>
        )}
      </ModaleAction>
    );
  }

  // ── Étape 1 : la raison ───────────────────────────────────────────────────
  if (etape === 'raison') {
    const suivantPossible = raison !== null
      && (raison !== 'autre' || (note.trim().length > 1 && encoreDu !== null));

    return (
      <ModaleAction
        titre={`Pourquoi ces ${fmtEurExact(montant)} sont-ils repartis ?`}
        sousTitre={`Vente du ${fmtDateLong(deal.signedAt)} · remboursement du ${fmtDateLong(ligne.paid_at)}`}
        onClose={onClose}
        pied={
          <>
            <button className="btn-primary-brand" style={{ fontSize: 12.5 }}
              disabled={!suivantPossible} onClick={() => setEtape('consequence')}>
              Continuer
            </button>
            <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={onClose}>Plus tard</button>
          </>
        }>

        <Encart titre="Momentum ne peut pas le deviner">
          Stripe dit qu’un remboursement a eu lieu, jamais pourquoi. Or c’est la
          raison qui décide si {prenom} te doit encore cette somme — et c’est ce
          qui explique pourquoi ta vente n’affiche pas 100 % encaissé.
        </Encart>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {RAISONS.map(r => (
            <button key={r.cle} onClick={() => setRaison(r.cle)} style={{
              textAlign: 'left', width: '100%', cursor: 'pointer', fontFamily: 'inherit',
              background: raison === r.cle ? 'var(--surface-2)' : 'var(--surface)',
              border: `1px solid ${raison === r.cle ? 'var(--accent-brand)' : 'var(--border)'}`,
              borderRadius: 10, padding: '11px 14px',
            }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{r.titre}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>{r.sous}</div>
            </button>
          ))}
        </div>

        {raison === 'autre' && (
          <div style={{ marginTop: 12 }}>
            <Section marge={0}>Précise, pour toi et pour plus tard</Section>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={300}
              placeholder="Par exemple : erreur de montant sur la facture"
              autoFocus
              style={{
                width: '100%', padding: '10px 12px', fontSize: 13, borderRadius: 9,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--ink)', fontFamily: 'inherit',
              }} />

            {/* La seule information dont le système a besoin. Les trois autres
                raisons la portent en elles ; celle-ci ne dit rien, on demande. */}
            <div style={{ marginTop: 12 }}>
              <Section marge={0}>{prenom} te doit-il encore ces {fmtEurExact(montant)} ?</Section>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Chip on={encoreDu === false} onClick={() => setEncoreDu(false)}>
                  Non, c’est réglé
                </Chip>
                <Chip on={encoreDu === true} onClick={() => setEncoreDu(true)}>
                  Oui, il me doit toujours cette somme
                </Chip>
              </div>
            </div>
          </div>
        )}
      </ModaleAction>
    );
  }

  // ── Étape 2 : la conséquence, écrite avant de valider ─────────────────────
  return (
    <ModaleAction
      titre={duFinal ? `Réclamer ${fmtEurExact(montant)} à ${prenom}` : `Ramener la vente à ${fmtEurExact(nouveauMontant)}`}
      sousTitre={`Vente du ${fmtDateLong(deal.signedAt)}`}
      onClose={onClose}
      bloque={envoi}
      pied={
        <>
          <button className="btn-primary-brand" style={{ fontSize: 12.5 }}
            disabled={!coche || envoi} onClick={valider}>
            {envoi ? 'Un instant…' : 'Confirmer'}
          </button>
          <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setEtape('raison')}>
            Revenir
          </button>
        </>
      }>

      {duFinal ? (
        <>
          <Encart ton="attention" titre="Ce que ça déclenche">
            La vente repasse <strong>en cours</strong> et rentre dans tes relances :
            {' '}{prenom} <strong>recevra des rappels</strong> pour ces {fmtEurExact(montant)}.
          </Encart>
          <div style={{ marginTop: 12 }}>
            <Ligne label="Cash contracté" valeur={`${fmtEurExact(deal.amountTotal)} — inchangé`} />
            <Ligne label="Cash encaissé" valeur={`${fmtEurExact(deal.collected)} — inchangé`} />
            <Ligne label="À encaisser" valeur={fmtEurExact(montant)} ton="fort" />
          </div>
          <div style={{ marginTop: 14 }}>
            <Section marge={0}>Comment veux-tu récupérer ces {fmtEurExact(montant)} ?</Section>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Chip on={encaissement === 'lien'} onClick={() => setEncaissement('lien')}>
                Par lien de paiement
              </Chip>
              <Chip on={encaissement === 'offline'} onClick={() => setEncaissement('offline')}>
                Hors Stripe — virement ou espèces
              </Chip>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Le point qui doit être limpide : la vente ne « perd » pas d'argent,
              elle en valait moins. Sans cette phrase, baisser le montant se lit
              comme une correction cachée des chiffres. */}
          <Encart ton="bien" titre="Ce que ça veut dire">
            Tu as vendu {fmtEurExact(deal.amountTotal)} et rendu {fmtEurExact(montant)} :
            cette vente valait en réalité <strong>{fmtEurExact(nouveauMontant)}</strong>.
            Son montant est ramené à cette somme, et elle redevient{' '}
            <strong>soldée à 100 %</strong> — parce qu’il n’y a effectivement plus
            rien à encaisser.
          </Encart>
          <div style={{ marginTop: 12 }}>
            <Ligne label="Cash contracté" barre={fmtEurExact(deal.amountTotal)}
              valeur={fmtEurExact(nouveauMontant)} ton="fort" />
            <Ligne label="Cash encaissé" valeur={`${fmtEurExact(deal.collected)} — inchangé`} />
            <Ligne label="Encaissé sur contracté" barre={`${Math.round((deal.collected / (deal.amountTotal || 1)) * 100)} %`} valeur="100 %" ton="fort" />
            <Ligne label={`${prenom} sera relancé`} valeur="Non" />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
            Le montant d’origine ({fmtEurExact(deal.amountTotal)}) reste inscrit au
            journal de la vente : rien n’est effacé, la vente est simplement
            enregistrée pour ce qu’elle a réellement valu.
          </div>
        </>
      )}

      <div style={{ marginTop: 14 }}>
        <CaseResponsabilite niveau="orange" coche={coche} onChange={setCoche}
          texte={duFinal
            ? `Ce remboursement était une erreur : ${prenom} me doit toujours cette somme, et j’assume les rappels qui vont lui être envoyés.`
            : `Cet argent n’est plus dû. J’accepte que cette vente soit désormais comptée pour ${fmtEurExact(nouveauMontant)} dans mes statistiques.`} />
      </div>

      {erreur && (
        <div style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 10, lineHeight: 1.6 }}>{erreur}</div>
      )}
    </ModaleAction>
  );
}
