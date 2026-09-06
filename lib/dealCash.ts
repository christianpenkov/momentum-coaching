/**
 * L'argent réellement encaissé sur une vente — règle unique, partagée.
 *
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║ COPIE 1 SUR 2 — l'autre est supabase/functions/_shared/dealCash.ts    ║
 * ║ Les deux fichiers DOIVENT rester identiques sous la ligne de garde.   ║
 * ║ `npm test` échoue si ce n'est plus le cas (lib/dealCash.test.ts).     ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * ── Pourquoi deux copies et pas un import ──────────────────────────────────
 * Ce calcul est lu par du code Next.js (Node) ET par une Edge Function (Deno).
 * Les deux mondes ne partagent aucun fichier aujourd'hui : `tsconfig.json`
 * exclut `supabase/`, et le bundle d'une Edge Function n'embarque pas de façon
 * garantie un fichier situé hors de `supabase/functions/`. Un import qui
 * casserait au déploiement rendrait muette la fonction qui enregistre les
 * paiements des comptes en clé restreinte — sans erreur visible.
 *
 * D'où deux copies, et un test qui les compare sur les mêmes jeux de chiffres.
 * Modifier l'une sans l'autre fait échouer `npm test` avant tout déploiement.
 *
 * ── Pourquoi ce fichier existe ─────────────────────────────────────────────
 * Le même calcul vivait recopié à trois endroits : le webhook Stripe, la route
 * de lecture de la page Paiements, et l'Edge Function qui lit les comptes en
 * clé restreinte. Les trois ignoraient les remboursements. Un deal remboursé
 * restait « payé » et son montant restait dans le cash collecté — faux, et
 * invisible.
 *
 * Trois copies d'une règle qui porte de l'argent, c'est trois occasions de
 * diverger en silence. Les trois appellent désormais la même fonction.
 *
 * ── Contraintes qui expliquent la forme du fichier ─────────────────────────
 * Il tourne sous Node ET sous Deno. D'où :
 *   • aucun import — ni `@/…`, ni `node:`, ni URL distante
 *   • aucun accès base ni réseau : on reçoit des lignes déjà lues
 *   • uniquement des fonctions pures, testables sans rien monter
 *
 * ⚠️ NE JAMAIS ajouter d'import ici : la copie Deno ne pourrait plus le
 * résoudre, et la fonction casserait au déploiement.
 */

/** Les statuts que la contrainte `deals_status_check` accepte aujourd'hui. */
export type StatutDeal =
  | 'open' | 'paid' | 'past_due' | 'canceled' | 'ended' | 'disputed'
  /**
   * Litige TRANCHÉ en faveur du client : l'argent est parti pour de bon.
   *
   * Distinct de `disputed`, qui décrit une instruction EN COURS. Sans lui, une
   * vente restait « Contestée » pour toujours après une défaite — la ligne
   * contestée devant rester (l'argent est réellement parti), le calcul
   * continuait d'en déduire un litige actif. Une pastille rouge d'alerte sur
   * une affaire close depuis des semaines est une alerte qu'on cesse de lire.
   */
  | 'dispute_lost';

/**
 * Une ligne de `deal_payments`, telle que Supabase la renvoie.
 * `amount` arrive en `numeric` — donc parfois en chaîne selon le client.
 */
export interface LignePaiement {
  amount: number | string | null;
  status: string | null;
}

export interface Cash {
  /** Somme des paiements réussis, remboursements NON déduits. */
  encaisse: number;
  /** Somme des remboursements. */
  rembourse: number;
  /**
   * Somme des montants contestés auprès d'une banque. Repris par Stripe le temps
   * de l'instruction — donc absents de la caisse, exactement comme un
   * remboursement. La différence n'est pas dans l'argent mais dans la suite :
   * un litige peut se gagner et les fonds revenir, un remboursement non.
   */
  conteste: number;
  /**
   * Somme des litiges PERDUS. L'argent est parti définitivement, comme un
   * remboursement — mais l'élève ne l'a pas rendu, la banque l'a repris.
   *
   * ⚠️ Compté à part de `rembourse`, et ce n'est pas cosmétique : la fiche
   * affiche « X € remboursés » avec la raison que l'élève a donnée (geste
   * commercial, rétractation…). Y verser un litige perdu ferait apparaître
   * comme un geste volontaire de l'argent qu'on n'a jamais choisi de rendre.
   */
  perduEnLitige: number;
  /**
   * Ce qui reste réellement dans la caisse :
   * encaissé − remboursé − contesté − perdu en litige.
   */
  net: number;
  /** Au moins un paiement en échec — sert à distinguer `past_due` de `open`. */
  aEchoue: boolean;
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║ LA SOURCE UNIQUE DES STATUTS DE PAIEMENT ET DE LEUR EFFET SUR LA CAISSE.  ║
 * ║ Ajouter un statut ICI et nulle part ailleurs : tout le reste en découle.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * `+1` entre en caisse, `-1` en sort, `0` ne la touche pas.
 *
 * ── Pourquoi une table et pas une suite de `else if` ────────────────────────
 *
 * La même règle vit dans DEUX runtimes : ici pour les écrans, et en SQL dans la
 * vue `ventes_cash_net` pour toute lecture directe de la base. Le 2026-09-06,
 * `dispute_lost` a été ajouté au code à 15 h 21 ; la vue l'ignorait encore à
 * 21 h et rendait 3 200 € là où les écrans affichaient 3 000 €. Les deux
 * implémentations étaient chacune cohérente avec elle-même — aucun test, aucun
 * type, aucune relecture ne compare deux runtimes.
 *
 * Cette table est ce que `scripts/verifier-cash-sql.mjs` compare à la
 * définition réelle de la vue en base, à chaque `npm test`. Un statut ajouté
 * ici sans l'être en SQL fait échouer la vérification AVANT qu'une seule ligne
 * de données ne porte ce statut — donc avant que le moindre chiffre ne soit
 * faux à l'écran.
 *
 * ⚠️ `failed` vaut `0` et ce n'est pas « rien » : c'est la preuve qu'on a
 * DÉCIDÉ qu'un paiement échoué ne bouge pas la caisse. Un statut absent de la
 * table est au contraire une omission, et la vérification le refuse.
 *
 * ── Les deux colonnes de la table ──────────────────────────────────────────
 *
 *   `signe` : l'effet sur le net. C'est ce que le SQL applique, via la table
 *             `cash_regles_statut` qu'il LIT — il n'en garde aucune copie.
 *   `champ` : où la somme atterrit dans `Cash`. `null` = on ne somme pas.
 *
 * `champ` n'est pas redondant avec `signe` : la vérification contrôle AUSSI
 * que les deux runtimes rangent la somme au même endroit, pas seulement qu'ils
 * tombent sur le même total.
 */
export const REGLES_CASH: Readonly<Record<string, {
  signe: -1 | 0 | 1;
  champ: 'encaisse' | 'rembourse' | 'conteste' | 'perduEnLitige' | null;
}>> = {
  succeeded:    { signe:  1, champ: 'encaisse'      },
  refunded:     { signe: -1, champ: 'rembourse'     },
  disputed:     { signe: -1, champ: 'conteste'      },
  dispute_lost: { signe: -1, champ: 'perduEnLitige' },
  // Un paiement échoué ne bouge pas la caisse ; il sert seulement à distinguer
  // `past_due` de `open`, via `aEchoue` plus bas. D'où `champ: null`.
  failed:       { signe:  0, champ: null            },
};

/** Les statuts connus, dans l'ordre de déclaration. */
export const STATUTS_CASH = Object.keys(REGLES_CASH);

/**
 * Tolérance d'un centime : un montant divisé en 3 laisse un écart d'arrondi
 * que la comparaison stricte ferait passer pour un impayé.
 */
const CENTIME = 0.01;

const nombre = (v: number | string | null): number => {
  const n = typeof v === 'string' ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
};

/**
 * Additionne les paiements d'une vente.
 *
 * ⚠️ POURQUOI `succeeded` ET `refunded` SONT DEUX LIGNES DISTINCTES ⚠️
 *
 * Un remboursement n'écrase pas le paiement qu'il annule : il crée sa propre
 * ligne. Ce n'est pas un choix, c'est une conséquence — `charge.refunded`
 * enregistre sous l'identifiant de la charge (`ch_…`) alors que le paiement
 * l'a été sous celui du PaymentIntent (`pi_…`), donc le delete+insert de
 * `recordPayment` ne retrouve pas la ligne d'origine et en ajoute une seconde.
 *
 * Cette divergence d'identifiants a l'air d'une incohérence à corriger. Elle
 * ne l'est pas : c'est elle qui rend la soustraction ci-dessous juste.
 * Harmoniser les deux ferait remplacer la ligne `succeeded` par la ligne
 * `refunded`, et le net partirait EN NÉGATIF sans que rien ne le signale.
 * Voir app/api/webhooks/stripe/route.ts, cases `charge.succeeded` et
 * `charge.refunded`.
 */
export function calculerCash(paiements: LignePaiement[] | null | undefined): Cash {
  let encaisse = 0;
  let rembourse = 0;
  let conteste = 0;
  let perduEnLitige = 0;
  let aEchoue = false;

  // Piloté par `REGLES_CASH`, jamais par une suite de `else if` : un statut
  // ajouté à la table est pris en compte ici SANS toucher à cette boucle, donc
  // il ne peut pas être oublié d'un côté. Un statut inconnu de la table est
  // ignoré — et c'est `ventes_sante_statut_paiement_inconnu` qui le signale,
  // parce qu'ici on ne peut ni lever ni écrire nulle part (fonction pure,
  // exécutée dans le rendu d'un écran).
  const sommes: Record<string, number> = {
    encaisse: 0, rembourse: 0, conteste: 0, perduEnLitige: 0,
  };

  for (const p of paiements ?? []) {
    const regle = REGLES_CASH[p.status ?? ''];
    if (!regle) continue;
    if (regle.champ) sommes[regle.champ] += nombre(p.amount);
    if (p.status === 'failed') aEchoue = true;
  }

  encaisse = sommes.encaisse;
  rembourse = sommes.rembourse;
  conteste = sommes.conteste;
  perduEnLitige = sommes.perduEnLitige;

  // Le net se recompose depuis les SIGNES de la table, pas depuis une formule
  // recopiée : `encaisse − rembourse − conteste − perduEnLitige` aurait dû être
  // réécrite à chaque statut ajouté, et c'est exactement l'oubli qu'on ferme.
  let net = 0;
  for (const [statut, regle] of Object.entries(REGLES_CASH)) {
    if (!regle.champ || regle.signe === 0) continue;
    net += regle.signe * sommes[regle.champ];
    void statut;
  }

  return { encaisse, rembourse, conteste, perduEnLitige, net, aEchoue };
}

/**
 * Le statut qu'une vente devrait porter, ou `null` s'il ne faut rien changer.
 *
 * Cinq règles, dans cet ordre — chacune corrige un cas réel :
 *
 * 1. Une vente ANNULÉE ou TERMINÉE ne se recalcule jamais. Ce sont des décisions
 *    humaines, et un paiement qui arrive après coup (lien retrouvé dans une
 *    conversation, dernier prélèvement en vol) ne doit pas les défaire. C'est
 *    le drapeau `unexpected_payment_at` qui signale cet argent, sans toucher à
 *    la façon dont la vente s'était terminée.
 *
 * 2. Un LITIGE prime sur tout le reste. La banque a repris l'argent, mais la
 *    vente n'est pas annulée : l'élève peut gagner et récupérer les fonds. La
 *    passer en « annulée » l'aurait figée là, puisque l'annulation ne se
 *    recalcule jamais.
 *
 * 3. Tout remboursé après avoir encaissé → `canceled`. Sans cette règle la
 *    vente retomberait en `open`, donc « en attente de paiement », et
 *    relancerait un client qu'on vient de rembourser.
 *
 * 4. Une vente déjà SOLDÉE reste soldée sur un remboursement PARTIEL. Un geste
 *    commercial — rendre 300 € sur 1 500 € — ne remet pas la vente en attente :
 *    ce serait relancer sur l'argent qu'on vient volontairement de rendre.
 *
 * 5. Sinon, le net décide : atteint le montant → `paid`, un échec en
 *    route → `past_due`, rien de particulier → `open`.
 */
export function statutDeal(
  cash: Cash,
  montantTotal: number | string | null,
  statutActuel: string | null,
): StatutDeal | null {
  if (statutActuel === 'canceled' || statutActuel === 'ended') return null;

  const total = nombre(montantTotal);

  if (cash.conteste > CENTIME) return 'disputed';
  // ⚠️ APRÈS le litige en cours, et AVANT la règle « tout reparti → annulée ».
  //
  // Après, parce qu'un second litige ouvert sur la même vente doit primer : lui
  // réclame une réponse sous quelques jours, celui-ci ne réclame plus rien.
  //
  // Avant, parce qu'une vente dont TOUT a été repris par la banque tomberait
  // sinon en « annulée » — or l'élève n'a rien annulé et n'a rien rendu. Il
  // s'est fait reprendre l'argent, ce qui n'est pas la même histoire et ne se
  // raconte pas pareil au client.
  if (cash.perduEnLitige > CENTIME) return 'dispute_lost';
  if (cash.encaisse > 0 && cash.net <= CENTIME) return 'canceled';
  if (cash.net >= total - CENTIME) return 'paid';
  if (statutActuel === 'paid' && cash.net > 0) return 'paid';
  if (cash.aEchoue) return 'past_due';
  return 'open';
}

/**
 * Ce qu'il reste à encaisser. Zéro si la vente est soldée ou en trop-perçu.
 */
export function resteAEncaisser(cash: Cash, montantTotal: number | string | null): number {
  const manque = nombre(montantTotal) - cash.net;
  return manque > CENTIME ? arrondi(manque) : 0;
}

/**
 * Le trop-perçu : ce qui a été encaissé au-delà du montant de la vente.
 * Apparaît quand on baisse un montant déjà payé, ou qu'un client paie deux fois.
 */
export function aRembourser(cash: Cash, montantTotal: number | string | null): number {
  const surplus = cash.net - nombre(montantTotal);
  return surplus > CENTIME ? arrondi(surplus) : 0;
}

/**
 * Ce qui compte comme RECOUVREMENT de cette vente : l'encaissé net, plafonné au
 * montant contracté.
 *
 * ── Pourquoi ce n'est pas `cash.net` ──────────────────────────────────────
 * Un client peut verser PLUS que sa vente : double prélèvement, ou montant
 * baissé après un encaissement. `cash.net` vaut alors 1 200 € sur une vente de
 * 1 000 €, et tout ratio bâti dessus dépasse 100 % — affiché en vert, donc lu
 * comme une performance, alors que c'est de l'argent DÛ au client.
 *
 * Pire, sur un total : le surplus d'un client vient soustraire la dette d'un
 * autre. Deux ventes de 1 000 €, l'une payée 1 200 €, l'autre rien : le reste
 * à encaisser calculé sur les nets bruts affiche 800 € au lieu de 1 000 €, sur
 * l'écran qui sert justement à savoir qui relancer. Plafonner VENTE PAR VENTE
 * avant de sommer supprime ce report.
 *
 * ── Quand utiliser l'une ou l'autre ───────────────────────────────────────
 *   `cash.net`          → « combien cette personne a versé ». Écrans d'action :
 *                         la ligne d'un client, le cash encaissé d'une période,
 *                         la ventilation par origine. Le surplus est un fait,
 *                         et c'est là qu'on va le rembourser.
 *   `encaisseRetenu()`  → « quelle part de cette vente est rentrée ». Écrans de
 *                         pilotage : taux de collecte, reste à encaisser, et
 *                         tout total destiné à être rapporté au contracté.
 *
 * Le surplus n'est pas perdu de vue pour autant : `aRembourser()` juste au-dessus
 * le nomme, et c'est lui qu'il faut afficher partout où l'on plafonne.
 * Décision de Chris, 2026-08-30.
 */
export function encaisseRetenu(cash: Cash, montantTotal: number | string | null): number {
  const total = nombre(montantTotal);
  return cash.net > total ? arrondi(total) : arrondi(cash.net);
}

/** Deux décimales — les sommes de `numeric` traînent des flottants imparfaits. */
const arrondi = (n: number): number => Math.round(n * 100) / 100;
