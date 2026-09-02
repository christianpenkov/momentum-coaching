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

  // ⚠️ On explique l'ÉCART, pas une transaction. Un remboursement de trop-perçu
  // porte une ligne `refunded` sans rien laisser d'inexpliqué ; et après un
  // trop-perçu PUIS un geste commercial, deux lignes sont muettes — désigner
  // « la première » tombait sur la mauvaise. Le montant à justifier est donc ce
  // qui a été rendu moins ce qui a déjà été justifié, calculé côté serveur.
  const montant = deal.refundInexplique;
  // Sert seulement à dater la question à l'écran.
  const dernier = (detail?.payments ?? [])
    .filter(p => p.status === 'refunded')
    .sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? ''))[0];

  const [etape, setEtape] = useState<Etape>('raison');
  const [raison, setRaison] = useState<RaisonRemboursement | null>(null);
  const [note, setNote] = useState('');
  const [encoreDu, setEncoreDu] = useState<boolean | null>(null);
  const [encaissement, setEncaissement] = useState<'lien' | 'offline'>(
    () => (moyenDe(deal) === 'offline' ? 'offline' : 'lien'));
  // Présélectionné sur « ça continue » : c'est l'option qui ne ferme rien. Un
  // défaut qui clôturerait la vente à l'insu de l'élève serait le pire des deux.
  const [continue_, setContinue] = useState(true);
  const [coche, setCoche] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<
    { encoreDu: boolean; avant?: number; apres?: number; cloture?: boolean; lien: { url: string } | null } | null>(null);

  // « Autre » est la seule qui ne porte pas son sort : on le demande.
  const duFinal = raison === 'autre' ? encoreDu : raison === 'erreur';
  const nouveauMontant = Math.max(0, Math.round((deal.amountTotal - montant) * 100) / 100);
  // ⚠️ Baisser le montant ne solde PAS toujours la vente. Sur une vente encore
  // en cours (1 000 € vendus, 300 € encaissés, 100 € rendus), elle vaut 900 € et
  // il reste 700 € à encaisser. Promettre « soldée à 100 % » y serait faux — et
  // c'est le genre de phrase qu'on croit sur parole au moment de valider.
  const seraSoldee = deal.collected >= nouveauMontant - 0.005;
  const resteApres = Math.max(0, Math.round((nouveauMontant - deal.collected) * 100) / 100);

  async function valider() {
    if (!raison || !coche || envoi || duFinal === null) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await fetch(`/api/payments/deals/${deal.id}/refund-reason`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          raison, note, encoreDu: duFinal, encaissement,
          cloturer: !duFinal && !seraSoldee && !continue_,
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
  if (montant <= 0.005) {
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
            <strong>{fmtEurExact(resultat.apres ?? nouveauMontant)}</strong>
            {seraSoldee
              ? <>, et elle est <strong>soldée à 100 %</strong>.</>
              : resultat.cloture
                ? <>, et elle est <strong>clôturée</strong> : tu n’attends plus
                  les {fmtEurExact(resteApres)} restants.</>
                : <>, et il reste <strong>{fmtEurExact(resteApres)}</strong> à encaisser.</>}
            {' '}Le montant d’origine ({fmtEurExact(resultat.avant ?? deal.amountTotal)})
            reste inscrit au journal de la vente.
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
        sousTitre={`Vente du ${fmtDateLong(deal.signedAt)} · remboursement du ${fmtDateLong(dernier?.paid_at ?? null)}`}
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
            Son montant est ramené à cette somme.
            {seraSoldee
              ? <> Elle redevient <strong>soldée à 100 %</strong> — il n’y a
                effectivement plus rien à encaisser.</>
              : continue_
                ? <> Il restera <strong>{fmtEurExact(resteApres)}</strong> à
                  encaisser sur ce nouveau montant.</>
                : <> Et comme tu n’attends plus le reste, elle sera{' '}
                  <strong>clôturée</strong> : les {fmtEurExact(resteApres)} restants
                  ne seront jamais réclamés.</>}
          </Encart>
          <div style={{ marginTop: 12 }}>
            <Ligne label="Cash contracté" barre={fmtEurExact(deal.amountTotal)}
              valeur={fmtEurExact(nouveauMontant)} ton="fort" />
            <Ligne label="Cash encaissé" valeur={`${fmtEurExact(deal.collected)} — inchangé`} />
            <Ligne label="Encaissé sur contracté"
              barre={`${Math.round((deal.collected / (deal.amountTotal || 1)) * 100)} %`}
              valeur={`${Math.round((deal.collected / (nouveauMontant || 1)) * 100)} %`} ton="fort" />
            {/* « Non » n'est vrai que si plus rien n'est attendu. Sur une vente
                qui continue, le client SERA relancé pour le reste — l'annoncer
                autrement serait la promesse la plus facile à démentir. */}
            <Ligne label={`${prenom} sera relancé`}
              valeur={seraSoldee || !continue_ ? 'Non' : `Oui, pour les ${fmtEurExact(resteApres)} restants`} />
          </div>
          {/* ── La question que baisser le montant ne pose pas ──────────────
              Rendre 100 € ne dit rien du reste. Une rétractation partielle en
              pleine série d'échéances peut vouloir dire deux choses opposées :
              le plan continue à un montant plus bas, ou l'accompagnement
              s'arrête là. Sans la question, le second cas laissait la vente en
              cours et relançait le client pour ce à quoi il venait de renoncer.

              Elle ne se pose pas sur une vente soldée : il n'y a plus rien à ne
              plus attendre — c'est déjà pourquoi « Clôturer » y est masqué. */}
          {!seraSoldee && (
            <div style={{ marginTop: 14 }}>
              <Section marge={0}>Attends-tu encore les {fmtEurExact(resteApres)} restants ?</Section>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Chip on={continue_} onClick={() => setContinue(true)}>
                  Oui, l’accompagnement continue
                </Chip>
                <Chip on={!continue_} onClick={() => setContinue(false)}>
                  Non, ça s’arrête là
                </Chip>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 7, lineHeight: 1.6 }}>
                {continue_
                  ? `${prenom} reste dans tes relances pour ce qui reste dû.`
                  : `La vente passe en clôturée : elle sort des relances, et ces ${fmtEurExact(resteApres)} ne seront jamais réclamés. Le cash déjà encaissé, lui, reste compté.`}
              </div>
            </div>
          )}

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
