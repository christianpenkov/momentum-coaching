'use client';

import { useEffect, useState } from 'react';
import { modeDe } from './etats';
import type { DealRow, DealDetail } from './types';
// Les dates de prélèvement suivent une règle qui appartient à Stripe : elle vit
// dans un seul module, verrouillée par lib/rythmeStripe.test.ts.
import { avancer, MS_JOUR } from '@/lib/rythmeStripe';

/**
 * Les échéances qui restent à encaisser, quel que soit le mode.
 *
 * ── Pourquoi ce n'est pas une simple lecture de `detail.installments` ──────
 * En prélèvement automatique, `deal_installments` est VIDE : l'échéancier vit
 * chez Stripe, et le recopier en base créerait deux sources de vérité qui
 * divergeraient au premier écart. Les écrans de correction ont pourtant besoin
 * de montrer chaque prélèvement à venir avec sa date — sinon ils annoncent « les
 * échéances seront recalculées » sans jamais dire lesquelles.
 *
 * On lit donc l'échéancier chez Stripe (`/api/payments/schedule`, qui l'interroge
 * en direct) et on déroule les dates depuis le prochain prélèvement.
 */

export interface EcheanceAVenir {
  /** Rang dans la vente entière, échéances déjà payées comprises. */
  rang: number;
  /** ISO, ou `null` quand la date n'est pas connue (un comptant n'en a pas). */
  date: string | null;
  montant: number;
}

export interface Echeancier {
  lignes: EcheanceAVenir[];
  /** Combien d'échéances sont déjà derrière — sert à numéroter les nouvelles. */
  dejaPayees: number;
  chargement: boolean;
}


export function useEcheancesAVenir(deal: DealRow, detail?: DealDetail): Echeancier {
  const mode = modeDe(deal);
  const enBase = (detail?.installments ?? []);
  const aVenirEnBase = enBase.filter(e => e.status !== 'paid');
  const payeesEnBase = enBase.filter(e => e.status === 'paid').length;

  // Le prélèvement automatique est le seul cas où il faut aller chercher ailleurs.
  const viaStripe = mode === 'installments_auto' && enBase.length === 0 && !!deal.stripeSubscriptionId;

  const [sched, setSched] = useState<{
    perPayment: number | null; interval: string | null; nextPaymentAt: string | null;
    // La fin du bornage, telle que Stripe la calcule. Lue ici pour une seule
    // raison : contrôler nos propres dates contre une date de sa main.
    endsAt: string | null;
  } | null>(null);
  const [chargement, setChargement] = useState(viaStripe);

  useEffect(() => {
    if (!viaStripe) { setChargement(false); return; }
    let vivant = true;
    setChargement(true);
    fetch(`/api/payments/schedule?dealId=${deal.id}`)
      .then(r => (r.ok ? r.json() : { schedule: null }))
      .then(d => { if (vivant) { setSched(d.schedule); setChargement(false); } })
      .catch(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
    // ⚠️ Les TERMES de la vente font partie des dépendances, et ce n'est pas
    // cosmétique. Avec `[deal.id, viaStripe]` seuls, l'échéancier était lu chez
    // Stripe une fois au montage et plus jamais : modifier le montant
    // rafraîchissait bien la vente (total, pourcentage, KPI) mais laissait les
    // lignes d'échéances sur leurs ANCIENS montants, jusqu'à un rechargement de
    // page. Constaté le 2026-09-02 — la fiche annonçait 1 500 € et 67 % encaissé
    // au-dessus de deux échéances à 100 €, qui valaient 250 € chez Stripe.
    //
    // Une mise à jour partielle est pire qu'une absence de mise à jour : rien ne
    // signale que la moitié de l'écran est périmée, et c'est la moitié qui porte
    // les chiffres qu'on vient de changer.
  }, [deal.id, viaStripe, deal.amountTotal, deal.installmentsCount,
      deal.installmentInterval, deal.collected]);

  if (!viaStripe) {
    return {
      lignes: aVenirEnBase.map(e => ({
        rang: e.rank,
        date: e.due_on,
        montant: Number(e.amount),
      })),
      dejaPayees: payeesEnBase,
      chargement: false,
    };
  }

  // ── Dérouler les dates depuis le prochain prélèvement ────────────────────
  // Stripe n'expose pas la liste des dates à venir : seulement la prochaine
  // (`current_period_end`) et le rythme. Aucun endpoint ne les rend toutes —
  // vérifié dans la doc le 2026-09-08, ce n'est pas une supposition héritée.
  //
  // Il documente en revanche la règle au mot près : l'ancre fixe le jour du
  // mois, et quand ce jour n'existe pas Stripe prend le dernier jour du mois
  // SANS que l'ancre dérive (« ancre au 31 janvier → 28 février, puis 31 mars,
  // puis 30 avril »). C'est ce que fait `avancer`.
  const dejaPayees = deal.paidCount;
  const restantes = Math.max(0, (deal.installmentsCount ?? 1) - dejaPayees);
  const depart = sched?.nextPaymentAt ? new Date(sched.nextPaymentAt) : null;
  const parEcheance = sched?.perPayment
    ?? (restantes > 0 ? arrondi(Math.max(0, deal.amountTotal - deal.collected) / restantes) : 0);

  // ── Faire vérifier notre calcul par Stripe ────────────────────────────────
  // Calculer une date, c'est réimplémenter une règle qui appartient à Stripe —
  // et une règle qui vit à deux endroits finit toujours par diverger. Sauf
  // qu'ici Stripe nous donne une SECONDE date de sa main : `cancel_at`, la fin
  // du bornage. Notre dernière échéance plus un intervalle doit tomber
  // exactement dessus.
  //
  // Si l'écart dépasse la journée, c'est que notre règle n'est plus la sienne.
  // On n'affiche alors AUCUNE date plutôt qu'une date fausse : « à confirmer »
  // envoie relire Stripe, un mauvais jour annoncé au client ne se rattrape pas.
  //
  // Le contrôle ne peut pas se faire quand `cancel_at` est absent — ce qui veut
  // dire que le bornage n'a pas pris, et c'est déjà remonté par ailleurs.
  const fin = sched?.endsAt ? new Date(sched.endsAt) : null;
  const calculAccorde = !depart || !fin
    || Math.abs(avancer(depart, sched?.interval ?? null, restantes).getTime() - fin.getTime()) < MS_JOUR;

  return {
    lignes: Array.from({ length: restantes }, (_, i) => ({
      rang: dejaPayees + i + 1,
      date: depart && calculAccorde ? avancer(depart, sched?.interval ?? null, i).toISOString() : null,
      montant: parEcheance,
    })),
    dejaPayees,
    chargement,
  };
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

