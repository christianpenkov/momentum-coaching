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

/** Une prise de lead magnet, telle que `instagram_lead_lm_history` l'enregistre. */
export interface PriseDeLeadMagnet {
  /** Le contenu d'où vient cette prise. `null` pour une story hors séquence. */
  media_id: string | null;
  /** Horodatage ISO de la prise. */
  detected_at: string;
  /** Faux quand la demande a été vue mais le lead magnet jamais parti. */
  lead_magnet_sent?: boolean | null;
}

/** Une réponse au message d'accroche, telle que `prospect_events` l'enregistre. */
export interface ReponseAccroche {
  /** Horodatage ISO de la réponse. */
  occurred_at: string;
}

/** Un call, pour le seul rôle Conversion. */
export interface CallPourConversion {
  /** Le contenu porté par le lien Calendly cliqué. Vide pour un lien de bio. */
  utm_content?: string | null;
}

/** Clé des lignes qui n'ont aucun contenu identifiable. */
export const ORIGINE_INCONNUE = '__origine_inconnue__';

/**
 * ACQUISITION — combien de fois chaque contenu a fait entrer quelqu'un.
 *
 * Une ligne du journal = un `+1` pour son contenu. Une même personne qui prend le
 * lead magnet de trois contenus fait donc `+1` à chacun des trois : les trois l'ont
 * bien fait entrer, à trois moments.
 *
 * Les prises dont le lead magnet n'est jamais parti sont exclues : le contenu a été
 * commenté, mais rien n'a été livré, donc personne n'est entré.
 */
export function acquisitionParContenu(historique: PriseDeLeadMagnet[]): Map<string, number> {
  const parContenu = new Map<string, number>();
  for (const prise of historique) {
    if (prise.lead_magnet_sent === false) continue;
    const cle = prise.media_id ?? ORIGINE_INCONNUE;
    parContenu.set(cle, (parContenu.get(cle) ?? 0) + 1);
  }
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
    const cle = contenuActivation(historique, reponse.occurred_at) ?? ORIGINE_INCONNUE;
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
 * `null` est un cas NORMAL et fréquent : un lien de bio ne vient d'aucun contenu, donc
 * `utm_content` est vide par nature (5 calls sur 19). Ces calls vont dans la ligne
 * « origine inconnue » — l'appelant ne doit jamais les faire disparaître, sinon le
 * total par contenu se lira comme une perte.
 */
export function contenuConversion(call: CallPourConversion): string | null {
  const brut = call.utm_content;
  if (typeof brut !== 'string') return null;
  const propre = brut.trim();
  return propre.length > 0 ? propre : null;
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
    if (contenu === ORIGINE_INCONNUE) continue;
    if (n > (acquisition.get(contenu) ?? 0)) sortie.push(contenu);
  }
  return sortie.sort();
}
