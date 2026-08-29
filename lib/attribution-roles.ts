/**
 * Attribution d'un contenu par RÔLE — acquisition, activation, conversion.
 *
 * Trois questions différentes, trois réponses différentes, **jamais additionnées**.
 * Un même parcours crédite légitimement trois contenus distincts :
 *
 *   Acquisition — quel contenu fait ENTRER des gens   (il a produit un lead)
 *   Activation  — quel contenu les fait PARLER        (son hook a fait répondre)
 *   Conversion  — quel contenu fait RÉSERVER          (son lien a produit le call)
 *
 * Cas réel qui a motivé ce fichier (profil de test, vente de 500 € du 08/07/2026) :
 * le prospect entre par le post A le 28/06, prend le lead magnet de GUIDE le 05/07,
 * reprend celui de A le 06/07, répond enfin au hook de A le 08/07, puis réserve en
 * rouvrant l'ancien lien Calendly de GUIDE qui traînait dans la conversation.
 * A a fait parler, GUIDE a fait réserver. Aucun des deux ne mérite le crédit de l'autre.
 *
 * ── POURQUOI CES FONCTIONS N'ACCEPTENT JAMAIS UNE FICHE `instagram_leads` ──────
 *
 * `instagram_leads` porte **une seule ligne par personne et par élève**
 * (`unique (profile_id, ig_user_id)`), et trois de ses champs sont ÉCRASÉS à chaque
 * nouvelle interaction :
 *
 *   `media_id`       — écrasé par le dernier post commenté
 *   `keyword_matched`— écrasé de même
 *   `hook_replied`   — remis à `false` par une réponse de story ou un Cold DM
 *
 * Mesuré le 2026-08-29 : GUIDE affichait 1 call et 500 € avec 0 commentaire et
 * 0 conversation, parce que le commentaire du 06/07 sur A avait effacé GUIDE de la
 * fiche. Et le journal `prospect_events` portait 6 réponses là où les fiches n'en
 * montraient que 4.
 *
 * Ce n'est pas un bug de ces champs : ils décrivent un ÉTAT COURANT, dont le pipeline
 * a besoin. Le bug est de s'en servir pour une statistique CUMULÉE. Ces fonctions ne
 * lisent donc que des journaux immuables — `instagram_lead_lm_history` et
 * `prospect_events` — où rien n'est jamais écrasé.
 */

/**
 * Une prise de lead magnet, telle que `instagram_lead_lm_history` l'enregistre.
 *
 * ⚠️ `detected_at` arrive de PostgREST au format Postgres — `2026-07-06 11:42:34.51+00`,
 * avec une ESPACE et non un `T`, et un décalage `+00` sans minutes. Ce n'est pas de
 * l'ISO 8601 strict. `Date.parse` de V8 l'accepte et rend le même instant que l'ISO
 * (vérifié, et épinglé par un test) — mais ne jamais supposer ce format, le tester.
 */
export interface PriseDeLeadMagnet {
  /** Le contenu d'où vient cette prise. `null` pour une story hors séquence. */
  media_id: string | null;
  /** Horodatage de la prise, au format Postgres ou ISO. */
  detected_at: string;
  /** Faux quand la demande a été vue mais le lead magnet jamais parti. */
  lead_magnet_sent?: boolean | null;
  /** La personne. Indispensable : le journal contient plusieurs lignes par personne. */
  ig_user_id?: string | null;
}

/** Une réponse au message d'accroche, telle que `prospect_events` l'enregistre. */
export interface ReponseAccroche {
  /** Horodatage ISO de la réponse. */
  occurred_at: string;
}

/** Un call, pour le seul rôle Conversion. */
export interface CallPourConversion {
  /** Identifiant du call — sert à écarter les continuations. */
  id?: string;
  /** Le contenu porté par le lien Calendly cliqué. Vide pour un lien de bio. */
  utm_content?: string | null;
  /**
   * Repli LÉGITIME : le contenu du lien prospect par lequel ce call est arrivé,
   * c'est-à-dire `prospect_links.content_id`, résolu par le chemin du lien court.
   *
   * À ne pas confondre avec le repli INTERDIT sur `instagram_leads.media_id`, qui est
   * écrasé par le dernier post commenté. Celui-ci est posé à la création du lien et
   * n'est jamais réécrit : il décrit le contenu d'où vient CE lien-là, définitivement.
   *
   * L'appelant fait la jointure ; cette fonction reste pure.
   */
  prospect_link_content_id?: string | null;
}

/** Clé des évènements qui ne se rattachent à AUCUN contenu.

 * Ne PAS lire « origine inconnue » : l'origine est toujours connue. Mesuré le
 * 2026-08-29 sur les 19 calls de vente — zéro call sans `source`. Ce qui manque est
 * le CONTENU, ce qui est très différent, et le gros du lot est parfaitement normal :
 *
 *   5 calls depuis la BIO — un lien en bio ne vient d'aucun contenu, par nature,
 *     donc `utm_content` est vide par construction. Ces calls ont deja leur ligne
 *     dans « Breakdown par source », ou ils sont correctement comptes.
 *   1 call en DM dont le lien Calendly n'etait pas trace — le seul vrai orphelin.
 *
 * Consequence pour l'affichage : « Performance par contenu » est un tableau PAR
 * CONTENU. Un call de bio n'y a pas sa place et ne doit pas y creer une ligne
 * mysterieuse. Une note de bas de tableau suffit a reconcilier le total, en renvoyant
 * vers le tableau qui, lui, les porte. */
export const SANS_CONTENU = '__sans_contenu__';

/**
 * ACQUISITION — combien de PERSONNES chaque contenu a fait entrer.
 *
 * Une personne compte **une seule fois par contenu**, quel que soit le nombre de fois
 * qu'elle en redemande le lead magnet. Elle compte en revanche pour CHACUN des contenus
 * dont elle a pris le lead magnet : les trois l'ont bien fait entrer, à trois moments.
 *
 * ── POURQUOI LA DÉDUPLICATION EST OBLIGATOIRE ─────────────────────────────────
 *
 * Première version de cette fonction : un `+1` par ligne de journal. Confrontée aux
 * vraies données le 2026-08-29, elle donnait **4 à GUIDE pour une seule personne** —
 * `rdjdkzjd` avait recommenté le mot-clé quatre fois en une heure (13h51, 14h02,
 * 14h14, 14h40). La colonne « Commentaires LM » compte des personnes, pas des
 * commentaires ; sans déduplication, un prospect insistant gonfle un contenu.
 *
 * Ce défaut ne venait pas du calcul mais de la FORME des données : la fixture écrite
 * à la main avait trois lignes propres là où la base en a sept. C'est la raison d'être
 * des fixtures figées extraites du réel dans le fichier de test.
 *
 * Les prises dont le lead magnet n'est jamais parti sont exclues : le contenu a été
 * commenté, mais rien n'a été livré, donc personne n'est entré. Cas réel : la ligne du
 * 28/06 21h39 est à `false`, suivie deux minutes plus tard de la même à `true`.
 *
 * Une prise sans `ig_user_id` est comptée comme une personne distincte : on ne peut pas
 * la rapprocher d'une autre, et la fondre dans une voisine inventerait un regroupement.
 */
export function acquisitionParContenu(historique: PriseDeLeadMagnet[]): Map<string, number> {
  // Un Set de personnes PAR contenu, plutot qu'une cle concatenee : deux identifiants
  // colles par un separateur peuvent toujours fusionner deux couples distincts si ce
  // separateur apparait un jour dans l'un des deux. Ici la question ne se pose pas.
  const personnesParContenu = new Map<string, Set<string>>();
  let anonymes = 0;
  for (const prise of historique) {
    if (prise.lead_magnet_sent === false) continue;
    const cle = prise.media_id ?? SANS_CONTENU;
    const personne = prise.ig_user_id ?? `__anonyme_${anonymes++}__`;
    let personnes = personnesParContenu.get(cle);
    if (!personnes) { personnes = new Set<string>(); personnesParContenu.set(cle, personnes); }
    personnes.add(personne);
  }
  const parContenu = new Map<string, number>();
  for (const [cle, personnes] of personnesParContenu) parContenu.set(cle, personnes.size);
  return parContenu;
}

/**
 * ACTIVATION, pour UNE réponse — quel contenu a fait parler cette personne.
 *
 * C'est le contenu du **dernier lead magnet pris avant la réponse**. Le prospect vient
 * de recevoir ce message d'accroche-là ; c'est lui qui l'a remis en mouvement, pas
 * celui d'il y a trois mois ni celui qu'il prendra la semaine prochaine.
 *
 * Renvoie `null` si aucune prise ne précède la réponse — cas réel : deux des six
 * réponses journalisées le 2026-08-29 n'ont aucun contenu rattachable. Un `null`
 * doit se lire « on ne sait pas », jamais se replier sur un contenu au hasard.
 */
export function contenuActivation(
  historique: PriseDeLeadMagnet[],
  dateReponse: string,
): string | null {
  const t = Date.parse(dateReponse);
  if (!Number.isFinite(t)) return null;

  let meilleur: { ms: number; media_id: string | null } | null = null;
  for (const prise of historique) {
    if (prise.lead_magnet_sent === false) continue;
    const ms = Date.parse(prise.detected_at);
    // `<=` et non `<` : le webhook peut horodater la prise et la réponse à la même
    // milliseconde sur une séquence automatique.
    if (!Number.isFinite(ms) || ms > t) continue;
    if (!meilleur || ms > meilleur.ms) meilleur = { ms, media_id: prise.media_id };
  }
  return meilleur?.media_id ?? null;
}

/**
 * ACTIVATION — combien de CONVERSATIONS chaque contenu a déclenchées.
 *
 * On compte des conversations, pas des personnes (décision du 2026-08-29). Une
 * personne dont la discussion s'éteint puis redémarre grâce à un autre lead magnet
 * compte deux fois, et chaque reprise est créditée au contenu qui l'a déclenchée.
 *
 * C'est le cœur du problème d'origine : c'est souvent la DEUXIÈME conversation qui
 * mène à la vente, et un compteur de personnes l'efface. Mesuré le 2026-08-29 :
 * incogniton.734 a répondu les 25/07, 28/07 et 30/07 ; l'écran n'en montrait qu'une.
 *
 * Conséquence assumée : ce nombre PEUT dépasser le nombre de leads du contenu. Ce
 * n'est pas une anomalie, c'est le signal recherché — un contenu qui réactive
 * beaucoup et acquiert peu est bon en relance, pas en acquisition. L'écran doit le
 * dire ; sans infobulle, ce chiffre se lit spontanément comme un nombre de personnes.
 */
export function activationParContenu(
  historique: PriseDeLeadMagnet[],
  reponses: ReponseAccroche[],
): Map<string, number> {
  const parContenu = new Map<string, number>();
  for (const reponse of reponses) {
    const cle = contenuActivation(historique, reponse.occurred_at) ?? SANS_CONTENU;
    parContenu.set(cle, (parContenu.get(cle) ?? 0) + 1);
  }
  return parContenu;
}

/**
 * CONVERSION — quel contenu a produit la réservation.
 *
 * `utm_content`, et **rien d'autre**. Pas de repli sur le contenu du lead.
 *
 * Le repli existait (`PageClientStats.tsx`, `matchesContent`) et faisait basculer la
 * colonne sur la clé d'ACQUISITION dès que `utm_content` manquait : les mêmes colonnes
 * mesuraient donc deux rôles selon les lignes, sans le dire. Mesuré le 2026-08-29 :
 * 1 call sur 19. Supprimé — un contenu de juin ne doit pas récolter une vente d'août
 * qu'il n'a pas déclenchée.
 *
 * Un repli reste légitime, et un seul : `prospect_links.content_id`. Mesuré le
 * 2026-08-29, l'unique call DM sans `utm_content` (`af9d5898`, 15/08) portait bien
 * `utm_medium`, `utm_campaign` et `utm_term` — seul le contenu manquait, parce que son
 * lien datait du 7 juin, avant le correctif du 19/08. Son contenu n'était pas perdu
 * pour autant : `prospect_links.content_id` valait GUIDE.
 *
 * Après ce repli, `null` ne concerne plus que les liens de BIO, qui ne viennent
 * d'aucun contenu par nature (5 calls sur 19). Ces calls ne doivent pas disparaître :
 * ils ont leur ligne dans « Breakdown par source », et une note de bas de tableau
 * réconcilie le total de « Performance par contenu ».
 */
export function contenuConversion(call: CallPourConversion): string | null {
  return nettoyer(call.utm_content) ?? nettoyer(call.prospect_link_content_id);
}

/** Une chaîne exploitable, ou `null`. Une chaîne d'espaces ne vaut pas un contenu. */
function nettoyer(valeur: string | null | undefined): string | null {
  if (typeof valeur !== 'string') return null;
  const propre = valeur.trim();
  return propre.length > 0 ? propre : null;
}


/**
 * CONVERSION par contenu — un crédit par OPPORTUNITÉ, jamais par rendez-vous.
 *
 * Une **continuation** (2e rendez-vous d'un prospect déjà ouvert) reçoit **zéro**
 * crédit. Raison : elle n'est produite par aucun contenu, elle est produite par le
 * premier appel. Le contenu a déjà été crédité.
 *
 * C'est devenu indispensable depuis le commit `7da4b53` de la session parallèle : le
 * 2e call hérite désormais du `utm_content` de son parent. Un modèle qui compterait un
 * crédit par call donnerait donc **deux crédits au même contenu pour un seul
 * prospect** — un défaut né avec la correction, puisque avant, le 2e call n'avait
 * aucun `utm_content` et ne se rattachait à rien.
 *
 * `idsDeContinuation` est IMPORTÉ de `lib/callSeries.ts` et jamais redérivé ici :
 * c'est le seul endroit qui décide ce qu'est une continuation, il est testé, et deux
 * définitions du même fait finissent toujours par diverger.
 *
 * ⚠️ Appariement : passer le jeu de calls LE PLUS LARGE à `idsDeContinuation`, puis
 * filtrer par période ensuite. Une paire à cheval sur deux périodes serait sinon
 * invisible, et le 2e call recompterait comme une opportunité neuve — c'est le cas le
 * plus banal, un 2e rendez-vous calé le mois suivant.
 *
 * ⚠️ L'INVARIANT à tenir, et le test qui le rend exécutable : sur une période donnée,
 * la somme des crédits de Conversion doit égaler le nombre d'opportunités. Si les deux
 * divergent, l'un des deux est faux. « Opportunité » et « Conversion » restent deux
 * mots distincts — une unité de comptage et un rôle d'attribution — et c'est cet
 * invariant, pas un vocabulaire unifié, qui les tient ensemble.
 */
export function conversionParContenu(
  calls: CallPourConversion[],
  idsContinuation: ReadonlySet<string>,
): Map<string, number> {
  const parContenu = new Map<string, number>();
  for (const call of calls) {
    if (call.id && idsContinuation.has(call.id)) continue;
    const cle = contenuConversion(call) ?? SANS_CONTENU;
    parContenu.set(cle, (parContenu.get(cle) ?? 0) + 1);
  }
  return parContenu;
}

/**
 * L'invariant, exécutable : crédits de Conversion contre nombre d'opportunités.
 *
 * Renvoie `null` si tout va bien, sinon l'écart constaté. À appeler dans un test, et
 * idéalement en garde de développement à l'écran : une divergence signifie qu'un des
 * deux comptages est faux, et aucun des deux ne le signalerait seul.
 */
export function ecartConversionOpportunites(
  creditsParContenu: Map<string, number>,
  nombreOpportunites: number,
): { credits: number; opportunites: number } | null {
  let credits = 0;
  for (const n of creditsParContenu.values()) credits += n;
  return credits === nombreOpportunites ? null : { credits, opportunites: nombreOpportunites };
}

/**
 * Garde-fou exécutable : deux rôles ne s'additionnent jamais.
 *
 * Renvoie la liste des contenus dont les compteurs seraient incohérents SI on lisait
 * ces colonnes comme un entonnoir. Ce n'est PAS une erreur de calcul — c'est le
 * rappel qu'un contenu peut légitimement avoir plus de conversations que de leads.
 * Sert à documenter l'invariant et à le tester, pas à corriger quoi que ce soit.
 */
export function contenusOuActivationDepasseAcquisition(
  acquisition: Map<string, number>,
  activation: Map<string, number>,
): string[] {
  const sortie: string[] = [];
  for (const [contenu, n] of activation) {
    if (contenu === SANS_CONTENU) continue;
    if (n > (acquisition.get(contenu) ?? 0)) sortie.push(contenu);
  }
  return sortie.sort();
}
