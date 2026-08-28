'use client';

import { useState } from 'react';
import ModaleAction, {
  CaseResponsabilite, Encart, Section, LienACopier, Chip,
} from './ModaleAction';
import { modeDe, libelleMode, libelleRythme, type Mode } from './etats';
import { fmtEurExact, fmtDateLong, type DealRow, type DealDetail } from './types';

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
  const echeances = detail?.installments ?? [];
  const payees = echeances.filter(e => e.status === 'paid').length;

  const nbEffectif = mode === 'one_shot' ? 1 : nb;
  const changeMode = mode !== modeActuel;
  const changeRythme = nbEffectif > 1 && rythme !== rythmeActuel;
  const changeNb = nbEffectif !== nbActuel;
  const changed = changeMode || changeRythme || changeNb;

  // Ce qui rend le choix courant impossible en place — calculé pendant la
  // sélection, pas au moment de valider.
  const refaireRequis = encaisse > 0.005 && (changeMode || changeRythme);
  const raison: 'rythme' | 'mode' = changeRythme ? 'rythme' : 'mode';

  const aCreer = Math.max(0, nbEffectif - payees);
  const parEcheance = aCreer > 0 ? arrondi(reste / aCreer) : 0;
  const parEcheanceAvant = nbActuel - payees > 0 ? arrondi(reste / (nbActuel - payees)) : 0;

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
            ? <>Il reste {fmtEurExact(reste)} à encaisser, désormais {resultat.echeances > 1 ? `en ${aCreer} fois de ${fmtEurExact(parEcheance)}` : 'en une fois'}.</>
            : <>Cette vente est soldée : le découpage a été mis à jour, mais il n’y a plus rien à encaisser.</>}
          {payees > 0 && (
            <div style={{ marginTop: 6 }}>
              {payees === 1 ? 'L’échéance déjà payée n’a pas été touchée.' : `Les ${payees} échéances déjà payées n’ont pas été touchées.`}
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
            style={{ fontSize: 12.5, opacity: changed && (coche || refaireRequis) && !envoi ? 1 : .5 }}
            disabled={!changed || (!coche && !refaireRequis) || envoi} onClick={valider}>
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
            {m === 'one_shot' ? 'Comptant' : libelleMode(m)}
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
              <div>Au lieu de {fmtEurExact(parEcheanceAvant)} pendant {nbActuel - payees} fois, puis plus rien.</div>
            )}
            {payees > 0 && (
              <div style={{ marginTop: 6 }}>
                {payees === 1 ? 'L’échéance déjà payée n’est pas touchée.' : `Les ${payees} échéances déjà payées ne sont pas touchées.`}
              </div>
            )}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <strong>Rien n’est prélevé aujourd’hui.</strong>
              {mode !== 'installments_auto' && mode !== 'offline' && reste > 0.005 && (
                <> Les anciens liens cesseront de fonctionner, et tu recevras les nouveaux.</>
              )}
            </div>
          </Encart>
        </div>
      )}

      {!refaireRequis && (
        <div style={{ marginTop: 18 }}>
          <CaseResponsabilite niveau="orange" coche={coche} onChange={setCoche} />
        </div>
      )}
    </ModaleAction>
  );
}

function libelleAvant(mode: Mode, nb: number, rythme: string): string {
  const m = libelleMode(mode);
  return nb > 1 ? `${nb} fois ${libelleRythme(rythme)}, ${m}` : `comptant, ${m}`;
}

const arrondi = (n: number) => Math.round(n * 100) / 100;
