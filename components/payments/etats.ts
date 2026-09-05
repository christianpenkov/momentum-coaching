import type { DealRow } from './types';

/**
 * Les six états d'une vente — un seul endroit pour leur nom et leur couleur.
 *
 * ── Pourquoi ce fichier existe ─────────────────────────────────────────────
 * « Arrêté » et « Clôturé » décrivent le même résultat vu de deux côtés : l'un
 * constaté chez Stripe, l'autre déclaré par l'élève. Deux mots proches qui
 * dérivent facilement d'un écran à l'autre — s'ils se contredisent, l'élève ne
 * sait plus lequel croire, et c'est précisément dans ces moments-là qu'il a
 * besoin d'être sûr.
 *
 * ── Le mot « abonnement » n'apparaît nulle part ────────────────────────────
 * Ce que vend l'élève est un accompagnement payé en plusieurs fois, pas une
 * souscription reconductible. Seule exception, assumée : quand un écran renvoie
 * vers Stripe, il nomme le bouton tel qu'il s'y appelle.
 */

export type EtatVente =
  | 'open' | 'paid' | 'past_due' | 'ended' | 'canceled' | 'disputed' | 'unexpected';

interface Etat {
  label: string;
  /** Couleur du texte et de la pastille. */
  color: string;
  /** Fond de la pastille — toujours la même teinte, très diluée. */
  bg: string;
}

export const ETATS: Record<EtatVente, Etat> = {
  open:       { label: 'En cours',           color: 'var(--accent-brand)', bg: 'var(--accent-brand-soft)' },
  paid:       { label: 'Soldée',             color: 'var(--green)',        bg: 'var(--green-soft)' },
  past_due:   { label: 'Impayée',            color: 'var(--red)',          bg: 'var(--red-soft)' },
  // Ocre : ni un succès, ni un incident. La vente a eu lieu, elle s'est
  // simplement arrêtée avant la fin — le vert mentirait, le rouge alarmerait.
  ended:      { label: 'Arrêtée',            color: 'var(--taupe)',        bg: 'var(--taupe-soft)' },
  // `--amber-ink` et non `--amber` : en 11 px, l'ambre vif tombe à 3,4:1 de
  // contraste. Bon pour une pastille ronde, illisible pour un libellé.
  unexpected: { label: 'Paiement inattendu', color: 'var(--amber-ink)',    bg: 'var(--amber-soft)' },
  canceled:   { label: 'Annulée',            color: 'var(--red)',          bg: 'var(--red-soft)' },
  disputed:   { label: 'Contestée',          color: 'var(--red)',          bg: 'var(--red-soft)' },
};

/**
 * L'état à AFFICHER, qui n'est pas toujours celui stocké.
 *
 * Un paiement inattendu et un échec de prélèvement se lisent sur d'autres
 * colonnes que `status`, et priment sur lui : une vente clôturée qui vient de
 * recevoir de l'argent doit crier « paiement inattendu », pas « terminée ».
 */
export function etatDe(d: DealRow): EtatVente {
  if (d.status === 'disputed') return 'disputed';
  if (d.unexpectedPaymentAt) return 'unexpected';
  if (d.status === 'canceled') return 'canceled';
  if (d.status === 'ended') return 'ended';
  if (d.status === 'paid') return 'paid';
  // Une échéance dont la date est passée est un impayé, au même titre qu'un
  // prélèvement refusé : dans les deux cas on attendait cet argent.
  if (d.overdue > 0 || d.hasFailure) return 'past_due';
  return 'open';
}

/**
 * Le sous-titre de la pastille : ce que l'état ne dit pas à lui seul.
 *
 * « Terminée » ne dit pas si c'est l'élève qui l'a décidé ou Stripe qui l'a
 * constaté — or c'est cette nuance qui détermine si la vente peut être rouverte.
 */
export function precisionEtat(d: DealRow): string | null {
  if (d.status === 'disputed' && d.disputeDueBy) {
    return `réponse à donner avant le ${jour(d.disputeDueBy)}`;
  }
  if (d.unexpectedPaymentAt) return 'de l’argent est arrivé après la fin';
  if (d.status === 'ended') {
    return d.endedBy === 'stripe'
      ? 'prélèvements arrêtés dans Stripe'
      : d.endedReason || 'clôturée à la main';
  }
  // Un arrêt programmé n'est pas encore un arrêt : la vente est toujours en
  // cours, et la prochaine échéance sera bien prélevée.
  if (d.stopsAt) return `s’arrête après le ${jour(d.stopsAt)}`;

  // ⚠️ Rien ici sur les remboursements, volontairement. Une première version
  // affichait « soldée avant remboursement — rien n'est réclamé », faute de
  // savoir POURQUOI l'argent était reparti. La raison est désormais demandée
  // (RaisonRemboursement.tsx), et elle change le fait lui-même : un geste
  // commercial ramène le montant de la vente, qui redevient vraiment soldée à
  // 100 %. La phrase serait donc fausse au moment précis où elle s'appliquerait.
  //
  // `precisionEtat` ne voit que DealRow, sans les lignes de paiement : elle ne
  // PEUT pas connaître la raison. C'est la fiche qui l'affiche, à côté du
  // montant remboursé — là où elle explique quelque chose.
  return null;
}

/**
 * Un lien a-t-il été envoyé au client ?
 *
 * ── Pourquoi ce n'est pas simplement `sent_at` ─────────────────────────────
 * Momentum ne PEUT pas savoir qu'un lien a été envoyé : l'élève le colle dans
 * son DM, hors de la plateforme. D'où la déclaration manuelle.
 *
 * Mais il peut le DÉDUIRE : un lien qui a été ouvert a forcément été reçu. La
 * règle de tout le chantier — tout ce que Momentum peut constater, il le
 * constate et ne le demande jamais — s'applique ici.
 *
 * Sans cette fonction, deux écrans se contredisaient sur la même échéance : la
 * fiche disait « ouvert, pas payé » pendant que Relances réclamait de l'envoyer.
 */
export function estEnvoye(inst: { sent_at?: string | null; clicks?: number }): boolean {
  return !!inst.sent_at || (inst.clicks ?? 0) > 0;
}

/** L'ordre d'urgence — sert à choisir l'état d'une personne qui a plusieurs ventes. */
export const URGENCE: EtatVente[] =
  ['disputed', 'unexpected', 'past_due', 'open', 'ended', 'paid', 'canceled'];

/** Une vente annulée est sortie des chiffres : elle ne compte plus nulle part. */
export const compteDansLesTotaux = (d: DealRow) => d.status !== 'canceled';

/**
 * Le mode de paiement réel, déduit des objets Stripe plutôt que du seul plan.
 *
 * `payment_plan` dit « en 3 fois » sans dire par quel moyen : un plan encaissé
 * par virements et un plan prélevé automatiquement portent la même valeur, alors
 * qu'aucune de leurs actions ne se ressemble.
 */
export type Mode = 'one_shot' | 'installments_auto' | 'installments_manual' | 'offline';

export function modeDe(d: DealRow): Mode {
  if (d.stripeSubscriptionId) return 'installments_auto';
  if (!d.hasLinks) return 'offline';
  return d.paymentPlan === 'installments_auto' ? 'installments_auto'
    : d.paymentPlan === 'installments_manual' ? 'installments_manual'
    : 'one_shot';
}

/**
 * Le MOYEN d'encaisser, indépendant du nombre de fois.
 *
 * `payment_plan` mélange les deux axes : « comptant » y répond à « combien de
 * fois », les autres à « par quel moyen ». Les séparer est ce qui rend le
 * virement unique représentable — il ne l'était pas.
 */
export type Moyen = 'lien' | 'auto' | 'offline';

export function moyenDe(d: DealRow): Moyen {
  if (d.stripeSubscriptionId) return 'auto';
  if (d.hasLinks) return 'lien';
  return 'offline';
}

/**
 * Quelque chose a-t-il été MIS EN PLACE pour encaisser cette vente ?
 *
 * ── Pourquoi ce n'est pas `moyenDe(d) !== 'offline'` ───────────────────────
 * « Hors Stripe » est à la fois un choix délibéré — l'élève encaisse par
 * virement et coche les versements — et ce qu'il reste quand personne n'a rien
 * décidé. Les deux se ressemblent trait pour trait : ni lien, ni prélèvement.
 *
 * Ce qui les sépare est l'échéancier : un hors Stripe choisi en a un, une vente
 * abandonnée n'a rien. Sans cette distinction, l'écran proposerait « Modalités »
 * — un réglage à ajuster — là où il faut proposer « Choisir les modalités », une
 * décision à prendre.
 */
export function moyenDefini(d: DealRow): boolean {
  // ⚠️ Le CHOIX d'abord, la deduction ensuite — et jamais l'inverse.
  //
  // Cette fonction ne regardait que les OUTILS en place (abonnement, liens,
  // echeancier). « Hors Stripe » n'en cree aucun : une vente dont l'eleve venait
  // de choisir ce moyen repondait donc « non defini », et la fiche reclamait
  // indefiniment une decision deja prise. La cause etait en base — `terms` ne
  // stockait pas `offline` — et est fermee par `deals.moyen_encaissement`.
  //
  // La deduction reste en second : une vente creee par le rapport de vente porte
  // ses liens sans etre jamais passee par l'ecran des modalites, et son moyen est
  // pourtant evident.
  if (d.moyenChoisi !== null && d.moyenChoisi !== undefined) return true;
  return !!d.stripeSubscriptionId || d.hasLinks || d.hasSchedule;
}

/**
 * Le mot affiché sur la pastille — pas toujours celui du tableau ETATS.
 *
 * ⚠️ Un seul état stocké (`ended`), DEUX mots : « Arrêtée » quand Stripe l'a
 * constaté, « Clôturée » quand l'élève l'a déclaré. Le plan a délibérément gardé
 * les deux, et l'implémentation les avait fondus en « Arrêtée » — au point qu'un
 * écran promettant « la vente passe en Clôturée » affichait ensuite « Arrêtée »,
 * ce qui fait douter de tout le reste de la promesse.
 *
 * La nuance n'est pas cosmétique : l'une est subie (les prélèvements ont cessé
 * chez Stripe), l'autre est décidée (« je n'attends plus rien »). Elles n'appellent
 * ni la même vérification, ni la même suite.
 */
export function libelleEtat(d: DealRow): string {
  const e = etatDe(d);
  if (e === 'ended') return d.endedBy === 'user' ? 'Clôturée' : 'Arrêtée';
  return ETATS[e].label;
}

export function libelleMode(m: Mode): string {
  return m === 'installments_auto' ? 'prélèvement automatique'
    : m === 'installments_manual' ? 'un lien par échéance'
    : m === 'offline' ? 'hors Stripe'
    : 'comptant';
}

export const libelleRythme = (i: string | null) =>
  i === 'week' ? 'hebdomadaire' : 'mensuel';

/**
 * Le MOYEN d'encaisser, en toutes lettres.
 *
 * ⚠️ Distinct du mode. `libelleMode` répond à « combien de fois » pour un
 * comptant et à « par quel moyen » pour les autres — c'est le mélange des deux
 * axes hérité de `payment_plan`. Utilisé tel quel dans la ligne des modalités,
 * il produisait « comptant · comptant » sur une vente payée en une fois par lien.
 */
export function libelleMoyen(d: DealRow): string {
  const m = moyenDe(d);
  if (m === 'auto') return 'prélèvement automatique';
  if (m === 'offline') return 'hors Stripe';
  return (d.installmentsCount ?? 1) > 1 ? 'un lien par échéance' : 'par lien de paiement';
}

/** « 3 fois mensuel · prélèvement automatique » — la ligne sous le montant. */
export function libelleModalites(d: DealRow): string {
  const moyen = libelleMoyen(d);
  if (!d.installmentsCount || d.installmentsCount < 2) return `comptant · ${moyen}`;
  return `${d.installmentsCount} fois ${libelleRythme(d.installmentInterval)} · ${moyen}`;
}

const jour = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
