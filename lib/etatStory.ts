// ─────────────────────────────────────────────────────────────────────────────
// L'état d'une story, et celui de la séquence qui la contient.
//
// ── POURQUOI CETTE RÈGLE NE VIT PAS DANS LE COMPOSANT ────────────────────────
//
// C'est la TROISIÈME fois qu'`expired_at` piège quelqu'un sur cet écran.
//
// `ig_stories.expired_at` n'est pas la date d'expiration : c'est l'heure à
// laquelle le cron a CONSTATÉ la disparition. Or ce cron passe une fois par
// semaine. Mesuré en base le 2026-09-08 : sur 8 stories vivantes, 5 n'avaient
// aucun `expired_at` alors qu'elles étaient publiées depuis plus de 24 h — et
// les 3 qui en avaient un l'avaient reçu plus de 25 h après leur publication.
//
// La pastille affichait donc « Active » sur des stories mortes depuis deux
// jours, ce qui est exactement l'inverse de ce qu'elle sert à dire.
//
// La fenêtre de rattachement avait déjà tranché ce point de son côté (« on
// compte depuis postedAt, PAS depuis expiredAt »), sans que la pastille suive.
// D'où ce fichier : une règle, un endroit, des tests.
// ─────────────────────────────────────────────────────────────────────────────

/** Une story vit 24 h. C'est Instagram qui le décide, pas nous. */
export const DUREE_VIE_STORY_MS = 24 * 60 * 60 * 1000;

export interface StoryDatee {
  postedAt?: string | null;
  expiredAt?: string | null;
}

export type EtatStory = 'active' | 'expiree';

/**
 * Est-elle encore en ligne ?
 *
 * Deux sources, et il faut LES DEUX :
 *
 *   • `postedAt + 24 h` répond dans le cas normal, tout de suite, sans dépendre
 *     du passage d'un cron ;
 *   • `expiredAt`, quand il est posé, signale une story retirée AVANT ses 24 h.
 *     Le cron ne le voit que tardivement, mais tardivement vaut mieux que jamais
 *     — et il ne peut que confirmer une expiration, jamais l'infirmer.
 *
 * Une story sans `postedAt` lisible est dite active : on ne prononce pas une
 * mort qu'on ne sait pas dater. Elle sortira d'elle-même quand le cron posera
 * son `expiredAt`.
 */
export function etatStory(story: StoryDatee, maintenant: number = Date.now()): EtatStory {
  if (story.expiredAt) return 'expiree';

  const parution = new Date(story.postedAt || 0).getTime();
  if (!Number.isFinite(parution) || parution <= 0) return 'active';

  return maintenant - parution >= DUREE_VIE_STORY_MS ? 'expiree' : 'active';
}

export type EtatSequence = 'preparation' | 'active' | 'expiree';

/**
 * L'état d'une séquence, déduit de ses stories.
 *
 * `preparation` : aucune story encore rattachée. Le lien Calendly existe, les
 * stories ne sont pas publiées. C'est l'état où le coach vient chercher son
 * lien, donc celui qui doit se repérer le plus vite dans la liste.
 *
 * `active` : au moins une story est encore en ligne, donc le mot-clé peut encore
 * recevoir une réponse.
 *
 * `expiree` : toutes ses stories ont expiré. La séquence est RÉELLEMENT morte,
 * pas seulement vieille : le webhook exige un `reply_to.story.id` pour
 * reconnaître un mot-clé, et on ne peut pas répondre à une story disparue. Plus
 * aucun DM ne partira jamais de cette séquence.
 *
 * Le même mot que pour les stories, décidé par Chris le 2026-09-08 : une
 * séquence dont les stories ont expiré est expirée, et « Terminée » n'aurait
 * ajouté qu'un vocabulaire de plus pour la même idée.
 */
export function etatSequence(storiesDeLaSequence: StoryDatee[], maintenant: number = Date.now()): EtatSequence {
  if (storiesDeLaSequence.length === 0) return 'preparation';
  return storiesDeLaSequence.some(s => etatStory(s, maintenant) === 'active') ? 'active' : 'expiree';
}

/** Ce qu'on écrit dans la pastille. */
export const LIBELLE_ETAT: Record<EtatStory | EtatSequence, string> = {
  preparation: 'En préparation',
  active: 'Active',
  expiree: 'Expirée',
};
