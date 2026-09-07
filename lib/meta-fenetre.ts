/**
 * Quelles fenêtres l'API Insights d'Instagram accepte-t-elle réellement ?
 *
 * Ce module ne contient AUCUNE hypothèse. Chaque règle a été mesurée contre l'API
 * réelle le 2026-09-07, sur trois comptes, et la mesure est rejouée dans
 * `meta-fenetre.test.ts`. La documentation officielle ne suffisait pas : elle annonce
 * « User Metrics data is stored for up to 90 days » alors que l'API en sert 729.
 *
 * ── LA SEULE BORNE DURE : 729 JOURS, SUR `since` ────────────────────────────
 *
 *        J-726 … J-729 → ACCEPTÉ
 *        J-730 …       → HTTP 400, code 100
 *                        « since param is not valid. Metrics data is available
 *                          for the last 2 years »
 *
 * Testé jour par jour de J-726 à J-732. C'est la seule condition qui fasse ÉCHOUER
 * l'appel, et donc la seule qui mérite d'être évitée avant d'appeler : un HTTP 400
 * est rejoué indéfiniment par un appelant qui réessaie.
 *
 * Il n'y a PAS de longueur maximale de fenêtre : testé jusqu'à 500 jours, HTTP 200,
 * valeur dédupliquée (elle ne croît pas linéairement, donc elle n'est pas tronquée
 * en silence).
 *
 * ── ⚠️ CE QUI N'EST **PAS** UNE RÈGLE, ET QUI L'A SEMBLÉ ────────────────────
 *
 * Première mesure du 2026-09-07 au matin, sur les trois comptes :
 *
 *        [hier        → hier]        → total_value PRÉSENT
 *        [aujourd'hui → aujourd'hui] → total_value ABSENT
 *        [hier        → aujourd'hui] → total_value PRÉSENT
 *
 * On en a conclu « une fenêtre sans journée TERMINÉE ne rend rien ». **C'est faux.**
 * Quelques heures plus tard, le même appel `[aujourd'hui → aujourd'hui]`, sur le même
 * compte, rend `valeur = 0`. Un balayage de `until` seconde par seconde (de 00:00:00 à
 * J+2) donne exactement la même réponse partout : ce n'est donc ni `until`, ni la
 * taille de la fenêtre, ni la présence d'une journée terminée.
 *
 * **C'est l'HEURE.** Meta ne sert le seau du jour en cours qu'une fois qu'il a traité
 * quelque chose pour ce jour ; avant, il rend un jeu de données vide. Sa propre doc le
 * dit, pour une raison qu'on croyait sans rapport : « If insights data you are
 * requesting does not exist or is currently unavailable the API will return an empty
 * data set instead of 0 ».
 *
 * Conséquence, et c'est elle qui compte : **une réponse vide n'est pas une panne et
 * n'est pas non plus définitive.** On ne peut pas prédire quand elle cessera. Le code
 * ne doit donc ni la traiter comme une erreur, ni s'abstenir d'appeler « parce que ça
 * ne marchera pas » — il doit savoir stocker « pas encore mesuré ».
 *
 * C'est pourquoi ce module NE porte PAS de règle « journée terminée ». Une telle garde
 * a existé quelques heures, et elle aurait retardé d'un jour entier la mesure de la
 * semaine en cours, pour un appel qui aboutit en réalité dans la journée.
 *
 * Pas d'import : ce fichier doit rester lisible côté Node comme côté Deno.
 */

/** Dernier `since` accepté, en jours avant aujourd'hui. Mesuré : J-729 passe, J-730 non. */
export const META_RETENTION_JOURS = 729;

/**
 * Marge d'un jour sur la rétention.
 *
 * La borne se déplace à chaque minuit. Un passage qui calcule ses dates à 23h59 et
 * dont l'appel part à 00h00 raisonnerait sur la borne de la veille — et prendrait un
 * HTTP 400 qu'il rejouerait indéfiniment. Un jour de marge supprime ce cas ; il ne
 * coûte qu'une journée d'historique, sur deux ans.
 */
export const META_RETENTION_MARGE_JOURS = 728;

export type VerdictFenetre =
  | { mesurable: true }
  | { mesurable: false; raison: 'anterieure_a_la_retention' };

/** Nombre de jours entiers entre deux dates ISO (`AAAA-MM-JJ`). */
export function ecartEnJours(depuis: string, jusqua: string): number {
  const a = Date.parse(`${depuis}T00:00:00Z`);
  const b = Date.parse(`${jusqua}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86400000);
}

/**
 * Meta acceptera-t-il seulement de répondre à cette fenêtre ?
 *
 * ⚠️ Ce prédicat ne dit PAS que la mesure existe — seulement que l'appel ne sera pas
 * refusé. Une fenêtre parfaitement valide peut rendre un jeu vide si Meta n'a pas
 * encore traité la période (voir l'en-tête). Les deux cas se traitent à des endroits
 * différents : ici on évite un HTTP 400 qui bouclerait, là-bas on stocke « pas encore
 * mesuré ».
 *
 * `debut` est une date calendaire Paris (`AAAA-MM-JJ`), `aujourdhui` la date du jour.
 * Seul `debut` décide : la borne porte sur `since`, et `until` n'a jamais fait échouer
 * un appel dans aucune des mesures.
 */
export function fenetreMesurable(debut: string, aujourdhui: string): VerdictFenetre {
  const age = ecartEnJours(debut, aujourdhui);
  // `!Number.isFinite` d'abord : une date illisible rend NaN, et `NaN > 728` étant
  // faux, l'omettre déclarerait la fenêtre acceptable — une panne silencieuse.
  if (!Number.isFinite(age) || age > META_RETENTION_MARGE_JOURS) {
    return { mesurable: false, raison: 'anterieure_a_la_retention' };
  }
  return { mesurable: true };
}
