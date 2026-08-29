'use client';

import { useMemo, useState } from 'react';
import ModaleAction, {
  CaseResponsabilite, Encart, Section, LienACopier, Chip, ApercuEcheances,
} from './ModaleAction';
import { modeDe, libelleMode, libelleRythme, type Mode } from './etats';
import { useEcheancesAVenir } from './useEcheances';
import { fmtEurExact, fmtDateLong, type DealRow, type DealDetail } from './types';

/**
 * Le texte de la case, adapté à ce qu'on engage réellement.
 *
 * « J'ai vérifié ce montant » sur un écran où aucun montant ne se saisit fait
 * cocher une phrase qui ne correspond à rien — et une case qu'on coche sans
 * qu'elle décrive le geste ne protège plus personne.
 */
const CASE_MODALITES =
  'J’ai vérifié ces modalités et mon client en est informé. Je reste responsable du rythme et du nombre de prélèvements qui en découlent, et j’en assume les conséquences en cas d’erreur de ma part.';

const CASE_REFAIRE =
  'Je comprends qu’il faudra rembourser mon client, puis recréer la vente aux nouvelles conditions. Je reste responsable de ces mouvements d’argent, et j’en assume les conséquences en cas d’erreur de ma part.';

/**
 * Modifier les modalités : le mode, le nombre de fois, le rythme.
 *
 * ── L'avertissement arrive au MOMENT DU CHOIX ──────────────────────────────
 * Pas après validation. Apprendre qu'il faut rembourser et tout refaire une
 * fois le bouton pressé transformerait une correction anodine en chantier
 * imprévu — et donnerait envie de renoncer là où un autre choix, une ligne plus
 * haut, n'aurait rien coûté.
 *
 * ── Les deux seuls cas qui obligent à refaire ──────────────────────────────
 * Changer le RYTHME remet à zéro la date de facturation chez Stripe, qui tente
 * alors un prélèvement immédiat. Changer le MODE met en jeu des objets Stripe
 * incompatibles. Et seulement si de l'argent a déjà été encaissé : tant que rien
 * n'est payé, tout se refait sans conséquence.
 *
 * Le NOMBRE DE FOIS se modifie toujours en place, sans jamais rien rembourser.
 */

export default function ModifierModalites({ deal, detail, onClose, onDone, onRefaire }: {
  deal: DealRow;
  detail?: DealDetail;
  onClose: () => void;
  onDone: () => void;
  /** Conduit au parcours « rembourser puis refaire la vente ». */
  onRefaire: (raison: 'rythme' | 'mode', aRembourser: number, arretRequis: boolean) => void;
}) {
  const modeActuel = modeDe(deal);
  const nbActuel = deal.installmentsCount ?? 1;
  const rythmeActuel = (deal.installmentInterval ?? 'month') as 'month' | 'week';

  const [mode, setMode] = useState<Mode>(modeActuel);
  const [nb, setNb] = useState(nbActuel);
  const [rythme, setRythme] = useState(rythmeActuel);
  const [coche, setCoche] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{ liens: Array<{ rank: number; url: string; amount: number }>; echeances: number } | null>(null);
  const [confirmeAbandon, setConfirmeAbandon] = useState(false);

  const prenom = deal.buyerName.split(' ')[0];
  const encaisse = deal.collected;
  const reste = Math.max(0, arrondi(deal.amountTotal - encaisse));

  const nbEffectif = mode === 'one_shot' ? 1 : nb;
  const changeMode = mode !== modeActuel;
  const changeRythme = nbEffectif > 1 && rythme !== rythmeActuel;
  const changeNb = nbEffectif !== nbActuel;
  const changed = changeMode || changeRythme || changeNb;

  // Ce qui rend le choix courant impossible en place — calculé pendant la
  // sélection, pas au moment de valider.
  const refaireRequis = encaisse > 0.005 && (changeMode || changeRythme);
  const raison: 'rythme' | 'mode' = changeRythme ? 'rythme' : 'mode';

  // L'échéancier réel — lu chez Stripe en prélèvement automatique, où la base
  // est vide.
  const { lignes: echeancierAvant, dejaPayees, chargement } = useEcheancesAVenir(deal, detail);

  const aCreer = Math.max(0, nbEffectif - dejaPayees);
  const parEcheance = aCreer > 0 ? arrondi(reste / aCreer) : 0;
  const parEcheanceAvant = echeancierAvant.length > 0 ? arrondi(reste / echeancierAvant.length) : 0;

  // ── Le nouvel échéancier, ligne par ligne ────────────────────────────────
  // Les échéances qui existaient gardent leur date : c'est la promesse faite au
  // client, et la déplacer sans le dire serait le pire des recalculs silencieux.
  // Seules celles qu'on ajoute reçoivent une date, déroulée au nouveau rythme.
  const echeancierApres = useMemo(() => {
    if (reste <= 0.005 || aCreer === 0) return [];
    const pas = rythme === 'week' ? 7 : 30;
    const offset = echeancierAvant.length;
    const dernier = echeancierAvant[offset - 1];
    const base = dernier?.date ? new Date(dernier.date).getTime() : Date.now();
    const premiere = arrondi(reste - parEcheance * (aCreer - 1));
      // ⚠️ `+ (offset > 0 ? 1 : 0)` et non `+ 1` : quand AUCUNE échéance
      // n'existe encore, la première part d'aujourd'hui — c'est ce que la route
      // écrit (`depart + i * pas`, donc i=0 = aujourd'hui). Avec un `+ 1`
      // inconditionnel, l'aperçu décalait tout d'un cran et promettait des dates
      // que la validation ne produisait pas.
    return Array.from({ length: aCreer }, (_, i) => ({
      rang: dejaPayees + i + 1,
      date: (!changeRythme && echeancierAvant[i]?.date)
        ? echeancierAvant[i].date
        : new Date(base + (i - offset + (offset > 0 ? 1 : 0)) * pas * 86400_000).toISOString(),
      montant: i === 0 ? premiere : parEcheance,
    }));
  }, [reste, aCreer, parEcheance, echeancierAvant, dejaPayees, rythme, changeRythme]);

  async function valider() {
    if (!changed || envoi) return;
    if (refaireRequis) {
      onRefaire(raison, encaisse, !!deal.stripeSubscriptionId);
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await fetch(`/api/payments/deals/${deal.id}/terms`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: mode, count: nbEffectif, interval: rythme }),
      });
      const d = await r.json();
      if (!r.ok) {
        // La route refait le même calcul côté serveur et peut refuser même si
        // l'écran croyait le geste possible — les paiements ont pu bouger entre
        // l'ouverture de la fenêtre et le clic.
        if (d.refaireRequis) {
          onRefaire(d.raison ?? 'mode', d.aRembourser ?? encaisse, !!d.arretRequis);
          return;
        }
        throw new Error(d.error || 'La modification a échoué.');
      }
      setResultat(d);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setEnvoi(false);
    }
  }

  /**
   * Fermer après avoir touché aux réglages sans valider.
   *
   * On ne se contente pas de fermer : la fenêtre a montré des chiffres qui
   * n'existent pas encore, et refermer sans un mot laisse croire qu'ils sont
   * appliqués. On redit donc l'état réel de la vente.
   */
  function tenterFermeture() {
    if (!changed || confirmeAbandon) { onClose(); return; }
    setConfirmeAbandon(true);
  }

  if (confirmeAbandon) {
    return (
      <ModaleAction titre="Abandonner la modification ?" onClose={() => setConfirmeAbandon(false)}
        pied={
          <>
            <button className="btn-primary-brand" style={{ fontSize: 12.5 }} onClick={onClose}>Abandonner</button>
            <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setConfirmeAbandon(false)}>Revenir</button>
          </>
        }>
        <Encart ton="bien" titre="Rien n’a encore été modifié">
          La vente reste comme aujourd’hui : {fmtEurExact(deal.amountTotal)}
          {nbActuel > 1
            ? <> en {nbActuel} fois {libelleRythme(rythmeActuel)}, {libelleMode(modeActuel)}.</>
            : <> comptant, {libelleMode(modeActuel)}.</>}
        </Encart>
      </ModaleAction>
    );
  }

  if (resultat) {
    return (
      <ModaleAction
        titre="Modalités modifiées"
        sousTitre={`${libelleAvant(modeActuel, nbActuel, rythmeActuel)} → ${libelleAvant(mode, nbEffectif, rythme)}`}
        onClose={onDone}
        pied={<button className="btn-primary-brand" style={{ fontSize: 12.5 }} onClick={onDone}>Terminé</button>}>

        <Encart ton="bien" titre="C’est fait">
          {reste > 0.005
            ? mode === 'installments_auto'
              ? <>Stripe prélèvera {aCreer} fois {fmtEurExact(parEcheance)}, aux mêmes dates. Rien n’a été prélevé aujourd’hui, et aucun lien n’est à envoyer — c’est Stripe qui encaisse.</>
              : <>Il reste {fmtEurExact(reste)} à encaisser, désormais {resultat.echeances > 1 ? `en ${aCreer} fois de ${fmtEurExact(parEcheance)}` : 'en une fois'}.</>
            : <>Cette vente est soldée : le découpage a été mis à jour, mais il n’y a plus rien à encaisser.</>}
          {dejaPayees > 0 && (
            <div style={{ marginTop: 6 }}>
              {dejaPayees === 1 ? 'L’échéance déjà payée n’a pas été touchée.' : `Les ${dejaPayees} échéances déjà payées n’ont pas été touchées.`}
            </div>
          )}
        </Encart>

        {resultat.liens.length > 0 && (
          <>
            <Section>Les nouveaux liens à envoyer</Section>
            {resultat.liens.map(l => (
              <LienACopier key={l.url} url={l.url}
                libelle={`Échéance ${l.rank} sur ${resultat.echeances} · ${fmtEurExact(l.amount)}`} />
            ))}
          </>
        )}

        {mode === 'offline' && (
          <div style={{ marginTop: 12 }}>
            <Encart ton="attention" titre="Préviens ton client toi-même">
              Hors Stripe, aucun lien n’est créé et Momentum ne prévient personne.
              L’échéancier est là pour que tu coches les virements à leur arrivée.
            </Encart>
          </div>
        )}
      </ModaleAction>
    );
  }

  return (
    <ModaleAction
      titre={`Modifier les modalités de la vente du ${fmtDateLong(deal.signedAt)}`}
      sousTitre={`${fmtEurExact(deal.amountTotal)} · aujourd’hui ${libelleAvant(modeActuel, nbActuel, rythmeActuel)}`}
      onClose={tenterFermeture}
      bloque={envoi}
      pied={
        <>
          <button className="btn-primary-brand"
            style={{ fontSize: 12.5, opacity: changed && coche && !envoi ? 1 : .5 }}
            disabled={!changed || !coche || envoi} onClick={valider}>
            {envoi ? 'Modification…' : refaireRequis ? 'Refaire la vente' : 'Modifier les modalités'}
          </button>
          <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={tenterFermeture} disabled={envoi}>Annuler</button>
          {erreur && <span style={{ fontSize: 12, color: 'var(--red)', flexBasis: '100%' }}>{erreur}</span>}
        </>
      }>

      <Section marge={0}>Comment ton client paie-t-il ?</Section>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(['one_shot', 'installments_auto', 'installments_manual', 'offline'] as Mode[]).map(m => (
          <Chip key={m} on={mode === m} onClick={() => setMode(m)}>
            {/* `libelleMode` est écrit pour le milieu d'une phrase (« … en 3 fois
                mensuel, prélèvement automatique »). Sur un bouton, une minuscule
                à côté de « Comptant » se lit comme une faute. */}
            {majuscule(m === 'one_shot' ? 'Comptant' : libelleMode(m))}
          </Chip>
        ))}
      </div>

      {mode !== 'one_shot' && (
        <>
          <Section>En combien de fois ?</Section>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {[2, 3, 4, 6, 8, 12].map(n => (
              <Chip key={n} on={nb === n} onClick={() => setNb(n)}>{n}×</Chip>
            ))}
            {nbActuel > 1 && (
              <span style={{ fontSize: 12, color: 'var(--faint)', marginLeft: 4 }}>
                au lieu de <span style={{ textDecoration: 'line-through' }}>{nbActuel}×</span>
              </span>
            )}
          </div>

          <Section>Tous les combien ?</Section>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Chip on={rythme === 'month'} onClick={() => setRythme('month')}>Mensuel</Chip>
            <Chip on={rythme === 'week'} onClick={() => setRythme('week')}>Hebdomadaire</Chip>
          </div>
        </>
      )}

      {/* ── L'avertissement, ici et pas après ────────────────────────────── */}
      {refaireRequis && (
        <div style={{ marginTop: 18 }}>
          <Encart ton="attention" titre="Ce changement oblige à refaire la vente">
            {raison === 'rythme' ? (
              <>
                Chez Stripe, passer de {libelleRythme(rythmeActuel)} à
                {' '}{libelleRythme(rythme)} remet à zéro la date de facturation, et
                {' '}<strong>déclencherait un prélèvement immédiat</strong> sur la carte
                de {prenom}.
              </>
            ) : (
              <>
                Un paiement déjà encaissé ne se convertit pas d’un mode à l’autre
                chez Stripe : {libelleMode(modeActuel)} et {libelleMode(mode)}
                {' '}reposent sur des mécanismes différents.
              </>
            )}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(181,128,37,.28)' }}>
              Il faudra rembourser les {fmtEurExact(encaisse)} déjà encaissés
              {deal.stripeSubscriptionId && <>, arrêter ses prélèvements dans Stripe,</>}
              {' '}puis recréer la vente aux nouvelles conditions. L’écran te guidera.
            </div>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              Si tu voulais seulement changer le nombre de fois, reviens au
              {raison === 'rythme' ? ' rythme ' : ' mode '}
              d’origine : ce changement-là se fait sans rien rembourser.
            </div>
          </Encart>
        </div>
      )}

      {/* ── Ce que ça donne, quand c'est possible en place ───────────────── */}
      {changed && !refaireRequis && (
        <div style={{ marginTop: 18 }}>
          <Encart titre={reste > 0.005
            ? aCreer > 1
              ? `${fmtEurExact(parEcheance)} ${rythme === 'month' ? 'par mois' : 'par semaine'} pendant ${aCreer} fois`
              : `${fmtEurExact(reste)} en une fois`
            : 'Rien de plus à encaisser'}>
            {reste > 0.005 && aCreer > 1 && parEcheanceAvant > 0 && nbActuel > 1 && (
              <div>Au lieu de {fmtEurExact(parEcheanceAvant)} pendant {echeancierAvant.length} fois, puis plus rien.</div>
            )}
            {dejaPayees > 0 && (
              <div style={{ marginTop: 6 }}>
                {dejaPayees === 1 ? 'L’échéance déjà payée n’est pas touchée.' : `Les ${dejaPayees} échéances déjà payées ne sont pas touchées.`}
              </div>
            )}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <strong>Rien n’est prélevé aujourd’hui.</strong>
              {/* ⚠️ « Les anciens liens cesseront de fonctionner » suppose qu'il
                  y en avait. Sur une vente encaissée hors Stripe — celle qu'on
                  vient justement mettre en place — il n'y en a aucun, et la
                  phrase annonçait la mort de quelque chose qui n'existe pas. */}
              {mode !== 'installments_auto' && mode !== 'offline' && reste > 0.005 && (
                deal.hasLinks
                  ? <> Les anciens liens cesseront de fonctionner, et tu recevras les nouveaux.</>
                  : <> Tu recevras {aCreer > 1 ? 'les liens' : 'le lien'} à envoyer à {prenom}.</>
              )}
            </div>
          </Encart>

          {/* ── Le détail, ligne par ligne ──────────────────────────────────
              Annoncer « 3 fois 400 € » sans montrer les dates ni ce que chaque
              échéance valait avant oblige à croire sur parole au moment précis
              où on veut vérifier. */}
          {/* Deux lignes au moins : sur un comptant, « les échéances à venir »
              suivi d'un unique « 1/1 » ne dit rien que l'encart n'ait déjà dit. */}
          {(echeancierAvant.length > 1 || echeancierApres.length > 1) && (
            <div style={{ marginTop: 12 }}>
              <Section marge={0}>
                {mode === 'installments_auto' ? 'Les prélèvements à venir' : 'Les échéances à venir'}
              </Section>
              {chargement ? (
                <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '8px 0' }}>
                  Lecture de l’échéancier chez Stripe…
                </div>
              ) : (
                <ApercuEcheances
                  avant={echeancierAvant}
                  apres={echeancierApres}
                  total={nbEffectif > 1 ? nbEffectif : 1}
                  rythmeChange={changeRythme} />
              )}
            </div>
          )}
        </div>
      )}

      {/* ── La case, toujours ────────────────────────────────────────────────
          Elle disparaissait dès que l'avertissement « refaire la vente »
          s'affichait — c'est-à-dire au moment le plus engageant de tout l'écran.
          Son texte suit ce qu'on engage vraiment : des modalités, ou un
          remboursement suivi d'une recréation. */}
      <div style={{ marginTop: 18 }}>
        <CaseResponsabilite
          niveau={refaireRequis ? 'rouge' : 'orange'}
          coche={coche} onChange={setCoche}
          texte={refaireRequis ? CASE_REFAIRE : CASE_MODALITES} />
      </div>
    </ModaleAction>
  );
}

function libelleAvant(mode: Mode, nb: number, rythme: string): string {
  const m = libelleMode(mode);
  return nb > 1 ? `${nb} fois ${libelleRythme(rythme)}, ${m}` : `comptant, ${m}`;
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
