'use client';

import { useState } from 'react';
import ModaleAction, {
  CaseResponsabilite, Encart, Section, Ligne, LienACopier, Chip,
} from './ModaleAction';
import { moyenDe } from './etats';
import { fmtEurExact, fmtDateLong, type DealRow } from './types';

/**
 * « Ce remboursement était une erreur — je réclame cet argent. »
 *
 * ── Pourquoi cet écran existe ──────────────────────────────────────────────
 * Une vente soldée puis remboursée en partie reste soldée : Momentum ne peut pas
 * savoir POURQUOI l'argent est reparti. Geste commercial et rétractation ne se
 * réclament pas ; une erreur de saisie, si. Seul l'élève sait laquelle des trois.
 *
 * C'est donc le seul endroit de la plateforme où l'élève DÉCLARE une intention
 * que rien ne permet de deviner. D'où un écran, et pas un bouton discret : ce
 * qu'on déclenche ici, ce sont des relances vers un client à qui on vient de
 * rendre de l'argent. Se tromper de sens coûte une relation.
 *
 * ── La conséquence qui doit être lue AVANT de valider ──────────────────────
 * La vente repasse « en cours », donc elle rentre dans les relances et le client
 * recevra des rappels. C'est l'effet le plus lourd, et le moins évident depuis
 * cet écran : il est écrit en toutes lettres, pas déduit d'un changement d'état.
 */
export default function Reclamer({ deal, onClose, onDone }: {
  deal: DealRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const prenom = deal.buyerName.split(' ')[0];
  // Ce qu'il reste dû est déjà calculé par la fiche, remboursement déduit.
  const reste = Math.max(0, deal.amountTotal - deal.collected);

  const [encaissement, setEncaissement] = useState<'lien' | 'offline'>(
    () => (moyenDe(deal) === 'offline' ? 'offline' : 'lien'));
  const [coche, setCoche] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{ reste: number; lien: { url: string } | null } | null>(null);

  async function valider() {
    if (!coche || envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await fetch(`/api/payments/deals/${deal.id}/reclaim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ encaissement }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'La réclamation a échoué.');
      setResultat(d);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setEnvoi(false);
    }
  }

  // ── Écran de résultat ─────────────────────────────────────────────────────
  if (resultat) {
    return (
      <ModaleAction
        titre={`${fmtEurExact(resultat.reste)} de nouveau à encaisser`}
        onClose={onDone}
        pied={<button className="btn-primary-brand" style={{ fontSize: 12.5 }} onClick={onDone}>Terminé</button>}>

        <Encart ton="bien" titre="C’est fait">
          La vente est repassée <strong>en cours</strong>. Elle réapparaît dans tes
          relances, et {prenom} sera rappelé comme pour n’importe quelle échéance.
        </Encart>

        {resultat.lien ? (
          <>
            <Section>Le lien à envoyer à {prenom}</Section>
            <LienACopier url={resultat.lien.url} libelle={`Complément — ${prenom}`} />
          </>
        ) : (
          <Encart ton="attention" titre="Préviens-le toi-même">
            Tu encaisses hors Stripe : Momentum a créé l’échéance, mais ne peut
            prévenir personne. C’est à toi de dire à {prenom} ce qu’il doit virer,
            et de noter le virement ici quand il arrive.
          </Encart>
        )}
      </ModaleAction>
    );
  }

  // ── Écran de décision ─────────────────────────────────────────────────────
  return (
    <ModaleAction
      titre={`Réclamer les ${fmtEurExact(deal.refunded)} remboursés`}
      sousTitre={`Vente du ${fmtDateLong(deal.signedAt)} · ${fmtEurExact(deal.amountTotal)}`}
      onClose={onClose}
      bloque={envoi}
      pied={
        <>
          <button className="btn-primary-brand" style={{ fontSize: 12.5 }}
            disabled={!coche || envoi || reste <= 0.005} onClick={valider}>
            {envoi ? 'Un instant…' : `Réclamer ${fmtEurExact(reste)}`}
          </button>
          <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={onClose}>Annuler</button>
        </>
      }>

      {/* La règle expliquée là où elle surprend, sinon elle passe pour un bug. */}
      <Encart titre="Pourquoi cette vente est encore soldée">
        Un remboursement dit qu’un mouvement d’argent a eu lieu, jamais pourquoi.
        Un geste commercial et une rétractation ne se réclament pas — une erreur,
        si. Momentum ne peut pas trancher entre les trois, alors il ne réclame
        rien tant que tu ne l’as pas dit.
      </Encart>

      <div style={{ marginTop: 12 }}>
        <Section marge={0}>Ce que ça change</Section>
        <Ligne label="La vente repasse" valeur="En cours" />
        <Ligne label={`${prenom} sera relancé`} valeur="Oui" ton="fort" />
        <Ligne label="Cash encaissé" valeur={`${fmtEurExact(deal.collected)} — inchangé`} />
        <Ligne label="Cash contracté" valeur={`${fmtEurExact(deal.amountTotal)} — inchangé`} />
        <Ligne label="À encaisser" valeur={fmtEurExact(reste)} ton="fort" />
      </div>

      <div style={{ marginTop: 14 }}>
        <Section marge={0}>Comment veux-tu recevoir ces {fmtEurExact(reste)} ?</Section>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Chip on={encaissement === 'lien'} onClick={() => setEncaissement('lien')}>
            Par lien de paiement
          </Chip>
          <Chip on={encaissement === 'offline'} onClick={() => setEncaissement('offline')}>
            Hors Stripe — virement ou espèces
          </Chip>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 7, lineHeight: 1.6 }}>
          {encaissement === 'lien'
            ? `${prenom} repaie en ligne par carte, et Momentum constate le paiement tout seul.`
            : `Tu encaisses par le moyen de ton choix, et tu le notes toi-même sur la fiche.`}
        </div>
      </div>

      {/* Orange et non rouge : rien n'est définitif. Clôturer la vente annule
          l'effet, et aucun argent ne bouge — ce sont des relances qui partent. */}
      <div style={{ marginTop: 14 }}>
        <CaseResponsabilite niveau="orange" coche={coche} onChange={setCoche}
          texte={`Ce remboursement était une erreur : ${prenom} me doit toujours cette somme, et j’assume les relances qui vont lui être envoyées.`} />
      </div>

      {erreur && (
        <div style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 10, lineHeight: 1.6 }}>{erreur}</div>
      )}
    </ModaleAction>
  );
}
