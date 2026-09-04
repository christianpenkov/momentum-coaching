'use client';

import { useState } from 'react';
import ModaleAction, {
  BoutonFin, Rondelle,
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

/**
 * ⚠️ Chaque raison PORTE sa conséquence, au lieu d'une seconde question.
 *
 * Une version précédente demandait ensuite « l'accompagnement s'est-il arrêté ? »
 * dans tous les cas. Après « un geste commercial », la question tombait à plat :
 * en choisissant ce mot on vient justement de dire que l'accompagnement n'est pas
 * le sujet. Une question dont la réponse est déjà donnée fait douter d'avoir
 * répondu à la précédente.
 *
 * Les deux premières se distinguent donc par ce qu'elles font, pas par la nuance
 * juridique entre remise et rétractation : l'une baisse le prix, l'autre arrête
 * l'accompagnement. Le sous-titre le dit avant qu'on clique.
 *
 * « Autre » reste la seule à poser des questions, parce qu'elle est la seule à
 * ne rien affirmer.
 */
const RAISONS: { cle: RaisonRemboursement; titre: string; sous: string }[] = [
  { cle: 'geste_commercial', titre: 'Un geste commercial',
    sous: 'Remise ou dédommagement — tu as choisi de rendre cet argent, et l’accompagnement suit son cours.' },
  { cle: 'retractation', titre: 'L’accompagnement s’est arrêté',
    sous: 'Il s’est rétracté, tu l’as remboursé, et ça s’arrête là. La vente sera clôturée.' },
  { cle: 'erreur', titre: 'C’était une erreur',
    sous: 'Ce remboursement n’aurait pas dû partir. Il te doit toujours cette somme.' },
  { cle: 'autre', titre: 'Autre raison', sous: 'Tu précises, et tu dis ce que ça change.' },
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
  // Présélectionné d'après la raison, parce qu'elle le dit presque : une
  // rétractation est un arrêt, un geste commercial ne l'est pas. Rien n'est
  // décidé pour autant — la question reste posée et visible.
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
          cloturer: !duFinal && !continue_,
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
          : resultat.cloture ? 'Vente clôturée'
          : `Vente ramenée à ${fmtEurExact(resultat.apres ?? nouveauMontant)}`}
        onClose={onDone}
        pied={<BoutonFin onDone={onDone} />}>

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
                doit régler et par quel moyen, puis de le noter ici quand il arrive.
              </Encart>
            )}
          </>
        ) : (
          resultat.cloture ? (
            <Encart ton="bien" titre="C’est fait">
              La vente est <strong>clôturée</strong> : l’accompagnement s’est
              arrêté avant la fin. Elle reste comptée{' '}
              <strong>{fmtEurExact(resultat.apres ?? deal.amountTotal)}</strong> —
              c’est ce que tu avais vendu — et les {fmtEurExact(montant)} rendus
              restent visibles comme tels. Elle sort des relances.
            </Encart>
          ) : (
            <Encart ton="bien" titre="C’est fait">
              Cette vente vaut désormais{' '}
              <strong>{fmtEurExact(resultat.apres ?? nouveauMontant)}</strong>
              {seraSoldee
                ? <>, et elle est <strong>soldée à 100 %</strong>.</>
                : <>, et il reste <strong>{fmtEurExact(resteApres)}</strong> à encaisser.</>}
              {' '}Le montant d’origine ({fmtEurExact(resultat.avant ?? deal.amountTotal)})
              reste inscrit au journal de la vente.
            </Encart>
          )
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
            <button key={r.cle} onClick={() => {
              setRaison(r.cle);
              // Une rétractation EST un arrêt ; un geste commercial ne l'est pas.
              // Le défaut suit donc la raison — la question reste posée et visible.
              setContinue(r.cle !== 'retractation');
            }} style={{
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
      // Le titre suit la branche RÉELLEMENT choisie. Il annonçait « Ramener la
      // vente à 800,00 € » alors que l'arrêt ne baisse aucun montant — l'en-tête
      // contredisait le corps de l'écran, sur la seule ligne qu'on lit en premier.
      titre={duFinal ? `Réclamer ${fmtEurExact(montant)} à ${prenom}`
        : continue_ ? `Ramener la vente à ${fmtEurExact(nouveauMontant)}`
        : 'Clôturer cette vente'}
      sousTitre={`Vente du ${fmtDateLong(deal.signedAt)}`}
      onClose={onClose}
      bloque={envoi}
      pied={
        <>
          <button className="btn-primary-brand"
            style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 8 }}
            disabled={!coche || envoi} onClick={valider}>
            {envoi && <Rondelle />}{envoi ? 'Un instant…' : 'Confirmer'}
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
          {/* ── La question qui sépare les deux histoires ────────────────────
              Rendre de l'argent ne dit pas POURQUOI la vente s'arrête là. Deux
              faits que rien ne rapproche se cachaient derrière le même geste :

               · l'accompagnement va à son terme et tu as rendu de l'argent → tu
                 as vendu moins cher, le montant baisse, la vente est soldée ;
               · l'accompagnement S'ARRÊTE en route → tu avais bien vendu
                 1 000 €, le montant ne bouge pas, la vente est clôturée, et
                 l'écart reste visible parce qu'il raconte exactement ça.

              Le second cas est celui d'un plan interrompu, où l'élève clôture. Il
              arrive juste par un autre chemin quand tout avait été payé d'avance,
              et doit donner le MÊME état — sinon deux clients qui ont décroché
              pareil se lisent différemment dans la liste. */}
          {/* Seule « Autre raison » l'affiche : les trois autres ont déjà
              répondu en étant choisies. */}
          {raison === 'autre' && (
            <div style={{ marginBottom: 14 }}>
              <Section marge={0}>L’accompagnement s’est-il arrêté ?</Section>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Chip on={continue_} onClick={() => setContinue(true)}>
                  Non — il continue, ou il est allé au bout
                </Chip>
                <Chip on={!continue_} onClick={() => setContinue(false)}>
                  Oui — il s’est arrêté avant la fin
                </Chip>
              </div>
            </div>
          )}

          {continue_ ? (
            <>
              {/* Sans cette phrase, baisser le montant se lit comme une
                  correction cachée des chiffres. */}
              <Encart ton="bien" titre="Ce que ça veut dire">
                Tu as vendu {fmtEurExact(deal.amountTotal)} et rendu {fmtEurExact(montant)} :
                cette vente valait en réalité <strong>{fmtEurExact(nouveauMontant)}</strong>.
                Son montant est ramené à cette somme.
                {seraSoldee
                  ? <> Elle est <strong>soldée à 100 %</strong> — il n’y a
                    effectivement plus rien à encaisser.</>
                  : <> Il restera <strong>{fmtEurExact(resteApres)}</strong> à
                    encaisser sur ce nouveau montant.</>}
              </Encart>
              <div style={{ marginTop: 12 }}>
                <Ligne label="Cash contracté" barre={fmtEurExact(deal.amountTotal)}
                  valeur={fmtEurExact(nouveauMontant)} ton="fort" />
                <Ligne label="Cash encaissé" valeur={`${fmtEurExact(deal.collected)} — inchangé`} />
                <Ligne label="Encaissé sur contracté"
                  barre={`${Math.round((deal.collected / (deal.amountTotal || 1)) * 100)} %`}
                  valeur={`${Math.round((deal.collected / (nouveauMontant || 1)) * 100)} %`} ton="fort" />
                <Ligne label={`${prenom} sera relancé`}
                  valeur={seraSoldee ? 'Non' : `Oui, pour les ${fmtEurExact(resteApres)} restants`} />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
                Le montant d’origine ({fmtEurExact(deal.amountTotal)}) reste inscrit au
                journal : rien n’est effacé, la vente est simplement enregistrée pour
                ce qu’elle a réellement valu.
              </div>
            </>
          ) : (
            <>
              <Encart ton="bien" titre="Ce que ça veut dire">
                Tu avais bien vendu <strong>{fmtEurExact(deal.amountTotal)}</strong>,
                et ce montant ne bouge pas. La vente passe en{' '}
                <strong>Clôturée</strong> : tu n’attends plus rien dessus, elle
                sort des relances, et les {fmtEurExact(montant)} rendus restent
                visibles comme de l’argent rendu.
              </Encart>
              <div style={{ marginTop: 12 }}>
                <Ligne label="Cash contracté" valeur={`${fmtEurExact(deal.amountTotal)} — inchangé`} />
                <Ligne label="Cash encaissé" valeur={`${fmtEurExact(deal.collected)} — inchangé`} />
                {/* La question qui restait sans réponse à l'écran : le
                    pourcentage. Ne pas la traiter laissait croire à un chiffre
                    en suspens, alors que 80 % est ici la bonne valeur. */}
                <Ligne label="Encaissé sur contracté"
                  valeur={`${Math.round((deal.collected / (deal.amountTotal || 1)) * 100)} % — inchangé`} />
                <Ligne label="La vente passe en" valeur="Clôturée" ton="fort" />
                <Ligne label={`${prenom} sera relancé`} valeur="Non" />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
                Cette vente ne sera donc <strong>jamais à 100 %</strong>, et c’est
                voulu : les {fmtEurExact(montant)} manquants sont l’argent que tu
                as rendu parce que l’accompagnement s’est arrêté. C’est ce que
                l’écart raconte.
              </div>
            </>
          )}
        </>
      )}

      <div style={{ marginTop: 14 }}>
        <CaseResponsabilite niveau="orange" coche={coche} onChange={setCoche}
          texte={duFinal
            ? `Ce remboursement était une erreur : ${prenom} me doit toujours cette somme, et j’assume les rappels qui vont lui être envoyés.`
            : continue_
              ? `Cet argent n’est plus dû. J’accepte que cette vente soit désormais comptée pour ${fmtEurExact(nouveauMontant)} dans mes statistiques.`
              : `Cet argent n’est plus dû et l’accompagnement s’est arrêté. J’accepte que cette vente soit clôturée, et qu’elle reste comptée pour ${fmtEurExact(deal.amountTotal)}.`} />
      </div>

      {erreur && (
        <div style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 10, lineHeight: 1.6 }}>{erreur}</div>
      )}
    </ModaleAction>
  );
}
