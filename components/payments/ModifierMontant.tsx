'use client';

import { useMemo, useState } from 'react';
import ModaleAction, {
  CaseResponsabilite, Encart, Section, LienACopier, Chip,
  ChampMontant, ApercuEcheances,
} from './ModaleAction';
import { modeDe, libelleRythme } from './etats';
import { useEcheancesAVenir } from './useEcheances';
import { fmtEurExact, fmtDateLong, type DealRow, type DealDetail } from './types';

/**
 * Corriger le montant d'une vente.
 *
 * ── Un seul écran, qui change en direct ────────────────────────────────────
 * La saisie et ses conséquences vivent ensemble. Un écran de saisie puis un
 * écran de confirmation obligerait à revenir en arrière pour comprendre l'effet
 * d'un chiffre — alors que c'est justement en le tapant qu'on veut le savoir.
 *
 * Le bas de l'écran bascule pendant la frappe : au-dessus de l'encaissé il parle
 * de complément, en dessous de remboursement, et le bouton change de nom avec
 * lui. Personne ne devrait découvrir qu'il doit rembourser APRÈS avoir validé.
 *
 * ── La règle, en une phrase ────────────────────────────────────────────────
 * Nouveau montant au-dessus de l'encaissé → on refait ce qu'il faut pour
 * encaisser le reste. En dessous → on rembourse la différence. Vraie pour les
 * quatre modes ; ce qui change, c'est l'objet à refaire, jamais la logique.
 */

interface Resultat {
  montant: number;
  encaisse: number;
  aRembourser: number;
  resteAEncaisser: number;
  arretRequis: boolean;
  liens: Array<{ rank: number | null; url: string; amount: number }>;
}

export default function ModifierMontant({ deal, detail, onClose, onDone, onRembourser }: {
  deal: DealRow;
  detail?: DealDetail;
  onClose: () => void;
  onDone: () => void;
  /** Conduit au parcours de remboursement, sur cette vente. */
  onRembourser: (aRembourser: number, arretRequis: boolean) => void;
}) {
  const [saisie, setSaisie] = useState(String(deal.amountTotal));
  const [coche, setCoche] = useState(false);
  const [encaissement, setEncaissement] = useState<'lien' | 'offline'>('lien');
  const [nbEcheances, setNbEcheances] = useState(deal.installmentsCount ?? 1);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<Resultat | null>(null);

  const mode = modeDe(deal);
  const echeances = detail?.installments ?? [];
  const aVenir = echeances.filter(e => e.status !== 'paid');
  const payees = echeances.filter(e => e.status === 'paid');

  // L'échéancier réel, y compris en prélèvement automatique où il vit chez
  // Stripe et non en base.
  const { lignes: echeancierAvant, dejaPayees, chargement } = useEcheancesAVenir(deal, detail);

  const nouveau = Number(String(saisie).replace(',', '.'));
  const valide = Number.isFinite(nouveau) && nouveau > 0;
  const encaisse = deal.collected;

  const trop = valide ? Math.max(0, arrondi(encaisse - nouveau)) : 0;
  const reste = valide ? Math.max(0, arrondi(nouveau - encaisse)) : 0;
  const changed = valide && Math.abs(nouveau - deal.amountTotal) > 0.005;

  // ── L'ancien lien a-t-il été ouvert ? ────────────────────────────────────
  // Trois cas seulement : jamais ouvert (on n'affiche rien), ouvert sans payer
  // (on le dit, parce que le client va recevoir un second lien et ne comprendra
  // pas pourquoi le premier ne marche plus), ou payé (on est alors dans le cas
  // complément ou remboursement, et le clic n'apporte plus rien).
  const clicsSurLienMort = useMemo(() => {
    if (encaisse > 0) return 0;
    if (aVenir.length > 0) return aVenir.reduce((s, e) => s + (e.clicks ?? 0), 0);
    return detail?.clicks ?? 0;
  }, [aVenir, detail, encaisse]);

  // Le jour de la PREMIÈRE ouverture. « Il a ouvert sans payer » se discute ;
  // « il a ouvert le 26 août sans payer » se relance.
  const dateOuverture = useMemo(() => {
    const dates = [
      ...aVenir.map(e => e.firstClickAt),
      detail?.firstClickAt,
    ].filter(Boolean) as string[];
    return dates.sort()[0] ?? null;
  }, [aVenir, detail]);

  // ── Le saut sur la dernière échéance ─────────────────────────────────────
  // 1 000 € en 3 fois, 2 payées, corrigé à 4 000 € : il reste 3 334 € à prendre
  // sur une seule échéance, qui passe de 334 € à 3 334 €. Un montant multiplié
  // par dix dépasse souvent le plafond de la carte — le prélèvement échoue un
  // mois plus tard, et personne ne fait le lien avec la correction d'aujourd'hui.
  const nbRestantes = Math.max(1, echeancierAvant.length);
  const avantParEcheance = arrondi((deal.amountTotal - encaisse) / nbRestantes);

  // ── Le découpage d'après ──────────────────────────────────────────────────
  // `nbEcheances` peut avoir été relevé par l'avertissement de saut : dans ce
  // cas il y a plus de lignes après qu'avant, et les nouvelles portent les dates
  // suivantes au même rythme.
  const nbApres = Math.max(1, nbEcheances - dejaPayees);
  const apresParEcheance = arrondi(reste / nbApres);
  const saut = avantParEcheance > 0 && apresParEcheance / avantParEcheance >= 3;

  const echeancierApres = useMemo(() => {
    if (reste <= 0.005) return [];
    const pas = deal.installmentInterval === 'week' ? 7 : 30;
    const offset = echeancierAvant.length;
    const dernier = echeancierAvant[offset - 1];
    const base = dernier?.date ? new Date(dernier.date).getTime() : Date.now();
    // Le reliquat d'arrondi va sur la première : la somme doit faire exactement
    // le total, sinon la vente ne se solderait jamais.
    const premiere = arrondi(reste - apresParEcheance * (nbApres - 1));
    return Array.from({ length: nbApres }, (_, i) => ({
      rang: dejaPayees + i + 1,
      // Les échéances existantes gardent leur date — c'est la promesse faite au
      // client. Seules celles qu'on ajoute en reçoivent une nouvelle.
      // Même décalage qu'en modalités : sans échéance existante, la première
      // part d'aujourd'hui, comme la route l'écrit.
      date: echeancierAvant[i]?.date
        ?? new Date(base + (i - offset + (offset > 0 ? 1 : 0)) * pas * 86400_000).toISOString(),
      montant: i === 0 ? premiere : apresParEcheance,
    }));
  }, [reste, nbApres, apresParEcheance, echeancierAvant, dejaPayees, deal.installmentInterval]);

  const complement = reste > 0.005 && encaisse > 0.005 && mode === 'one_shot';
  const enBaisse = trop > 0.005;

  async function valider() {
    if (!valide || envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await fetch(`/api/payments/deals/${deal.id}/amount`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: nouveau }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'La modification a échoué.');

      // ── Le découpage se change APRÈS le montant ────────────────────────────
      // Deux appels et pas un : la route des modalités répartit ce qu'il reste
      // à encaisser, elle a donc besoin du nouveau montant déjà écrit. Dans
      // l'autre sens, elle aurait réparti l'ancien.
      if (nbEcheances !== (deal.installmentsCount ?? 1) && nbEcheances > 1) {
        await fetch(`/api/payments/deals/${deal.id}/terms`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            plan: mode === 'offline' ? 'offline' : mode,
            count: nbEcheances,
            interval: deal.installmentInterval ?? 'month',
          }),
        });
      }
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
        titre={`Montant modifié · ${fmtEurExact(deal.amountTotal)} → ${fmtEurExact(resultat.montant)}`}
        onClose={onDone}
        pied={
          resultat.aRembourser > 0.005 ? (
            <>
              <button className="btn-primary-brand" style={{ fontSize: 12.5 }}
                onClick={() => onRembourser(resultat.aRembourser, resultat.arretRequis)}>
                Rembourser {deal.buyerName.split(' ')[0]}
              </button>
              {/* « Fermer » et non « Annuler » : le montant EST déjà modifié.
                  « Annuler » laisserait croire qu'on peut encore revenir en
                  arrière, et que le remboursement est une étape à terminer. */}
              <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={onDone}>Fermer</button>
            </>
          ) : (
            <button className="btn-primary-brand" style={{ fontSize: 12.5 }} onClick={onDone}>Terminé</button>
          )
        }>

        {resultat.aRembourser > 0.005 ? (
          <Encart ton="attention" titre={`${fmtEurExact(resultat.aRembourser)} à rembourser à ${deal.buyerName.split(' ')[0]}`}>
            Le nouveau montant passe sous ce qui a déjà été encaissé. Tant que le
            remboursement n’est pas fait, la vente affiche cet écart.
            {resultat.arretRequis && (
              <div style={{ marginTop: 6, fontWeight: 600 }}>
                Ses prélèvements tournent encore — il faut aussi les arrêter.
              </div>
            )}
          </Encart>
        ) : (
          <Encart ton="bien" titre="C’est fait">
            {resultat.resteAEncaisser > 0.005
              ? <>Il reste {fmtEurExact(resultat.resteAEncaisser)} à encaisser.</>
              : <>Cette vente est soldée : il n’y a plus rien à encaisser.</>}
          </Encart>
        )}

        {resultat.liens.length > 0 && (
          <>
            <Section>
              {resultat.liens.length > 1 ? 'Les nouveaux liens à envoyer' : `Le nouveau lien à envoyer à ${deal.buyerName.split(' ')[0]}`}
            </Section>
            {resultat.liens.map(l => (
              <LienACopier key={l.url} url={l.url}
                libelle={l.rank
                  ? `Échéance ${l.rank} sur ${nbEcheances} · ${fmtEurExact(l.amount)}`
                  : encaisse > 0.005 ? `Complément · ${fmtEurExact(l.amount)}` : fmtEurExact(l.amount)} />
            ))}
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
              L’ancien lien de paiement ne fonctionne plus. Si ton client l’a
              gardé dans sa conversation, c’est celui-ci qu’il faut lui renvoyer.
            </div>
          </>
        )}

        {mode === 'installments_auto' && resultat.liens.length === 0 && resultat.resteAEncaisser > 0.005 && (
          <Encart>
            Rien n’a été prélevé aujourd’hui, et les dates n’ont pas bougé. Les
            prochains prélèvements passeront au nouveau montant.
          </Encart>
        )}

        {mode === 'offline' && resultat.resteAEncaisser > 0.005 && (
          <Encart ton="attention" titre="Préviens ton client toi-même">
            Cette vente s’encaisse hors Stripe : Momentum a mis l’échéancier à
            jour, mais ne peut prévenir personne. C’est à toi de dire à
            {' '}{deal.buyerName.split(' ')[0]} ce qu’il doit désormais virer.
          </Encart>
        )}
      </ModaleAction>
    );
  }

  // ── Écran de saisie ───────────────────────────────────────────────────────
  return (
    <ModaleAction
      titre={`Modifier le montant de la vente du ${fmtDateLong(deal.signedAt)}`}
      sousTitre={encaisse > 0.005
        ? `${fmtEurExact(encaisse)} déjà encaissé sur ${fmtEurExact(deal.amountTotal)}`
        : `Rien n’a encore été encaissé sur cette vente.`}
      onClose={onClose}
      bloque={envoi}
      pied={
        <>
          <button className="btn-primary-brand"
            style={{ fontSize: 12.5, opacity: changed && coche && !envoi ? 1 : .5 }}
            disabled={!changed || !coche || envoi} onClick={valider}>
            {envoi ? 'Modification…' : enBaisse ? 'Modifier et rembourser' : 'Modifier le montant'}
          </button>
          <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={onClose} disabled={envoi}>Annuler</button>
          {erreur && <span style={{ fontSize: 12, color: 'var(--red)', flexBasis: '100%' }}>{erreur}</span>}
        </>
      }>

      {/* Le champ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <ChampMontant valeur={saisie} onChange={setSaisie} autoFocus />
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          au lieu de <span className="tabular" style={{ textDecoration: 'line-through' }}>{fmtEurExact(deal.amountTotal)}</span>
        </span>
      </div>

      {/* ── Ce que ça change, en direct ──────────────────────────────────── */}
      {changed && (
        <div style={{ marginTop: 18 }}>
          {enBaisse ? (
            <Encart ton="attention" titre={`${fmtEurExact(trop)} à rembourser`}>
              Le nouveau montant passe sous les {fmtEurExact(encaisse)} déjà
              encaissés. Après la modification, l’écran te conduira au
              remboursement — Momentum ne rembourse jamais tout seul.
              {deal.stripeSubscriptionId && (
                <div style={{ marginTop: 6 }}>
                  Ses prélèvements devront aussi être arrêtés dans Stripe.
                </div>
              )}
            </Encart>
          ) : (
            <PreviewHausse
              deal={deal} mode={mode} reste={reste} encaisse={encaisse}
              aVenir={aVenir} payees={payees.length} nbRestantes={nbApres}
              apresParEcheance={apresParEcheance} avantParEcheance={avantParEcheance}
              complement={complement} />
          )}

          {/* ── L'échéancier, ligne par ligne ────────────────────────────────
              Ce que « les échéances seront recalculées » ne disait pas :
              lesquelles, pour combien, et à quelles dates. C'est le seul endroit
              où une faute de frappe se repère avant de valider. */}
          {(echeancierAvant.length > 1 || echeancierApres.length > 1) && (
            <div style={{ marginTop: 12 }}>
              <Section marge={0}>
                {enBaisse ? 'Ce qu’il advient des échéances' : 'Le nouvel échéancier'}
              </Section>
              {chargement ? (
                <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '8px 0' }}>
                  Lecture de l’échéancier chez Stripe…
                </div>
              ) : (
                <>
                  <ApercuEcheances
                    avant={echeancierAvant}
                    apres={enBaisse ? [] : echeancierApres}
                    total={enBaisse ? (deal.installmentsCount ?? 1) : dejaPayees + nbApres} />
                  {!enBaisse && mode === 'installments_auto' && (
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 7, lineHeight: 1.6 }}>
                      Les dates ne bougent pas, et rien n’est prélevé aujourd’hui.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Le saut de montant sur la dernière échéance */}
          {saut && !enBaisse && (
            <div style={{ marginTop: 12 }}>
              <Encart ton="attention" titre={`Cette échéance passe de ${fmtEurExact(avantParEcheance)} à ${fmtEurExact(apresParEcheance)}`}>
                Soit {Math.round(apresParEcheance / avantParEcheance)} fois plus.
                Un montant de cet ordre dépasse souvent le plafond de la carte, et
                le paiement serait refusé par sa banque — un mois plus tard, sans
                que rien ne rappelle cette correction.
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5 }}>Tu peux augmenter le nombre de fois :</span>
                  {[nbRestantes + payees.length, 4, 6, 8]
                    .filter((n, i, t) => n > (deal.installmentsCount ?? 1) - 1 && t.indexOf(n) === i)
                    .slice(0, 4)
                    .map(n => (
                      <Chip key={n} on={nbEcheances === n} onClick={() => setNbEcheances(n)}>{n} fois</Chip>
                    ))}
                </div>
              </Encart>
            </div>
          )}

          {/* Le complément n'est pas forcément un lien */}
          {complement && (
            <div style={{ marginTop: 12 }}>
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
                  ? `${deal.buyerName.split(' ')[0]} paie en ligne par carte, et Momentum constate le paiement tout seul.`
                  : `Tu encaisses par le moyen de ton choix, et tu le notes toi-même sur la fiche. Utile si ton client n’a pas de carte — un compte entreprise, par exemple.`}
              </div>
            </div>
          )}

          {/* L'ancien lien a été ouvert sans être payé */}
          {clicsSurLienMort > 0 && (
            <div style={{ marginTop: 12 }}>
              <Encart>
                {deal.buyerName.split(' ')[0]} a ouvert l’ancien lien
                {dateOuverture ? ` le ${fmtDateLong(dateOuverture)}` : ''}
                {' '}<strong>sans payer</strong>. Il ne fonctionnera plus après cette
                modification : pense à lui envoyer le nouveau.
              </Encart>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <CaseResponsabilite niveau="orange" coche={coche} onChange={setCoche} />
      </div>
    </ModaleAction>
  );
}

/**
 * Ce qui va se passer quand le montant monte — le texte change avec le mode.
 *
 * Chaque mode a sa phrase parce qu'ils n'agissent pas sur les mêmes objets : un
 * prélèvement s'ajuste, un lien se remplace, un virement se renégocie de vive
 * voix. Une phrase générique serait vraie et inutile.
 */
function PreviewHausse({
  deal, mode, reste, encaisse, aVenir, payees, nbRestantes,
  apresParEcheance, avantParEcheance, complement,
}: {
  deal: DealRow;
  mode: ReturnType<typeof modeDe>;
  reste: number;
  encaisse: number;
  aVenir: DealDetail['installments'];
  payees: number;
  nbRestantes: number;
  apresParEcheance: number;
  avantParEcheance: number;
  complement: boolean;
}) {
  const prenom = deal.buyerName.split(' ')[0];
  const rythme = libelleRythme(deal.installmentInterval);

  if (reste <= 0.005) {
    return (
      <Encart ton="bien" titre="Cette vente sera soldée">
        Le nouveau montant correspond exactement à ce qui a déjà été encaissé. Il
        n’y aura plus rien à réclamer, et plus rien à rendre.
      </Encart>
    );
  }

  if (mode === 'installments_auto' && deal.stripeSubscriptionId) {
    return (
      <Encart titre={`${prenom} sera prélevé ${nbRestantes} fois de ${fmtEurExact(apresParEcheance)}`}>
        <div style={{ marginTop: 2 }}>
          Au lieu de {fmtEurExact(avantParEcheance)}, puis plus rien.
        </div>
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <strong>Les dates ne changent pas.</strong> Le paiement déjà fait n’est
          pas touché, et <strong>rien n’est prélevé aujourd’hui</strong>.
        </div>
      </Encart>
    );
  }

  if (mode === 'offline') {
    return (
      <Encart titre={`${fmtEurExact(reste)} restent à encaisser`}>
        {aVenir.length > 1
          ? <>Réparti sur les {aVenir.length} échéances à venir, soit {fmtEurExact(apresParEcheance)} chacune.</>
          : <>En une fois.</>}
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          Cette vente s’encaisse hors Stripe : aucun lien ne sera créé, et
          Momentum ne préviendra personne. C’est à toi de dire à {prenom} ce
          qu’il doit virer.
        </div>
      </Encart>
    );
  }

  if (complement) {
    return (
      <Encart titre={`${fmtEurExact(reste)} à encaisser en complément`}>
        Cette vente est déjà payée à hauteur de {fmtEurExact(encaisse)}. Le
        paiement reçu n’est pas touché : {prenom} n’aura à régler que la
        différence.
      </Encart>
    );
  }

  if (nbRestantes > 1) {
    return (
      <Encart titre={`${nbRestantes} nouveaux liens de ${fmtEurExact(apresParEcheance)}`}>
        {payees > 0 && <>Les {payees} échéance{payees > 1 ? 's' : ''} déjà payée{payees > 1 ? 's' : ''} ne {payees > 1 ? 'sont' : 'est'} pas touchée{payees > 1 ? 's' : ''}. </>}
        Les échéances à venir gardent leurs dates, {rythme}, et passent au nouveau montant.
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          Leurs anciens liens cesseront de fonctionner — tu recevras les nouveaux
          à la fin de cet écran.
        </div>
      </Encart>
    );
  }

  return (
    <Encart titre={`Un nouveau lien de ${fmtEurExact(reste)}`}>
      L’ancien lien cessera de fonctionner. Tu recevras le nouveau à la fin de cet
      écran, à envoyer à {prenom}.
    </Encart>
  );
}

const arrondi = (n: number) => Math.round(n * 100) / 100;
