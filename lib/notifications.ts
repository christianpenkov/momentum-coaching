/**
 * Le catalogue des notifications push de la plateforme.
 *
 * ── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
 *
 * Chaque émetteur composait sa notification à la main, en ligne, dans son propre
 * fichier — six endroits, deux runtimes (Next.js et Deno). Trois conséquences,
 * toutes constatées le 2026-09-06 :
 *
 *   1. LE TAG OUBLIÉ PARTOUT. Aucun émetteur n'en passait, sauf les rappels
 *      d'échéance. Tous retombaient donc sur le tag par défaut du service
 *      worker, qui était PARTAGÉ — et deux notifications de même tag se
 *      remplacent. Trois nouveaux posts n'en laissaient qu'un visible, deux
 *      rapports à remplir qu'un seul, et une alerte pouvait effacer un message
 *      non lu.
 *
 *   2. DU TEXTE QUI DÉCRIT LA PLATEFORME, PAS L'ACTION. « Un nouveau post a été
 *      repéré sur ton compte » raconte ce que le cron vient de faire. L'élève
 *      sait déjà qu'il a publié ; ce qu'il ignore, c'est qu'il lui reste à
 *      associer un lead magnet.
 *
 *   3. DU FRANÇAIS ACCORDÉ À LA MAIN. Composer « ${n} nouveaux ${nom}s » produit
 *      « nouveaux publications ». Le genre et le nombre ne se concatènent pas.
 *
 * Ici, une notification est une DONNÉE, pas une chaîne fabriquée sur place. On
 * la lit, on la relit, on la teste.
 *
 * ── POURQUOI DANS `lib/` ────────────────────────────────────────────────────
 *
 * Ce fichier n'importe RIEN. C'est ce qui lui permet d'être lu par les deux
 * runtimes : Next.js via `@/lib/notifications`, les Edge Functions Deno via un
 * chemin relatif. Ne jamais y ajouter d'import — ni `@/…`, ni un module Node,
 * ni une URL esm.sh : la moitié des appelants cesserait de démarrer.
 *
 * Et `lib/` plutôt que `supabase/functions/_shared/` parce que c'est le seul
 * endroit qui soit à la fois :
 *   • typé   — `supabase/` est exclu du tsconfig ;
 *   • testé  — `npm test` lance `lib/*.test.ts` ;
 *   • couvert par `scripts/empreintes-edge.mjs`, dont la clôture d'imports suit
 *     les chemins relatifs hors de `supabase/functions/`. Une Edge Function
 *     déployée avec une vieille copie de ce fichier est donc DÉTECTABLE, ce qui
 *     est le mode de panne dominant du projet (cf. AGENTS.md).
 */

/** Ce que le service worker sait afficher. */
export interface NotifPush {
  title: string;
  body: string;
  url: string;
  /**
   * Regroupement. Deux notifications de MÊME tag se remplacent ; sans tag,
   * elles coexistent.
   *
   * À ne demander que pour un flux dont une seule doit rester visible. Le défaut
   * du service worker est désormais « pas de tag » : un émetteur distrait
   * produit une notification de trop, jamais une notification en moins.
   */
  tag?: string;
}

/**
 * Le service worker tronque le corps à 100 caractères (`sw.js`). Au-delà, la
 * phrase se coupe en plein milieu — et c'est la fin qui porte l'action.
 *
 * Vérifié par les tests sur CHAQUE notification du catalogue, y compris avec les
 * valeurs les plus longues (nom d'élève à rallonge, compteur à trois chiffres) :
 * une troncature ne se voit pas en développement, seulement sur le téléphone.
 */
export const CORPS_MAX = 100;

// ── Instagram : nouvelles publications ──────────────────────────────────────

/** Ce que l'API Instagram distingue et qui change la phrase. */
export type TypePublication = 'reel' | 'post' | 'mixte';

// Formes écrites en toutes lettres. Le français accorde le genre ET le nombre :
// « publication » est féminin, « post » et « reel » masculins. Toute tentative de
// les composer par concaténation finit par produire « nouvelles posts ».
const TITRES_PUBLICATION: Record<TypePublication, { un: string; plusieurs: (n: number) => string }> = {
  reel: { un: 'Nouveau reel publié', plusieurs: n => `${n} nouveaux reels publiés` },
  post: { un: 'Nouveau post publié', plusieurs: n => `${n} nouveaux posts publiés` },
  mixte: { un: 'Nouvelle publication', plusieurs: n => `${n} nouvelles publications` },
};

/**
 * De nouvelles publications Instagram ont été détectées.
 *
 * UNE notification pour le lot, jamais une par publication : le cron découvre
 * tout ce qui a été publié depuis son dernier passage, et réveiller le téléphone
 * trois fois pour dire trois fois la même chose n'apporte rien.
 *
 * `premierId` sert de tag : rejouer le même lot (relance du cron, réessai)
 * remplace la notification au lieu d'en empiler une seconde, alors qu'un lot
 * ultérieur en produit bien une nouvelle.
 */
export function nouvellesPublications(opts: {
  nombre: number;
  type: TypePublication;
  premierId: string;
}): NotifPush {
  const { nombre, type, premierId } = opts;
  const forme = TITRES_PUBLICATION[type];
  return {
    title: nombre > 1 ? forme.plusieurs(nombre) : forme.un,
    body: nombre > 1
      ? 'Associe un lead magnet à chacun dans Gérer mes liens pour capter les leads.'
      : 'Associe-lui un lead magnet dans Gérer mes liens pour capter les leads.',
    url: '/client/liens',
    tag: `nouvelle-publication-${premierId}`,
  };
}

/** Le type d'une publication, tel que l'API Instagram le rend. */
export function typePublication(media: { media_product_type?: string | null; media_type?: string | null }): 'reel' | 'post' {
  return media.media_product_type === 'REELS' || media.media_type === 'VIDEO' ? 'reel' : 'post';
}

// ── Instagram : stories ─────────────────────────────────────────────────────

/**
 * Le paramètre d'URL qui ouvre « Gérer mes liens » directement sur la création
 * d'une séquence, avec ces stories déjà sélectionnées.
 *
 * Nommé ici plutôt que dans la page, parce qu'il est écrit d'un côté (la
 * notification) et lu de l'autre (PageLiens) : une chaîne recopiée aux deux
 * bouts finit par diverger d'un côté seulement, et le lien tombe alors sur un
 * écran vide sans que rien ne le signale.
 */
export const PARAM_STORIES_A_GROUPER = 'grouper';

/**
 * Plusieurs stories viennent d'être publiées, et aucune n'est encore rattachée
 * à une séquence.
 *
 * POURQUOI UNE QUESTION, ET NON UN ORDRE : on ne sait pas si c'en est une.
 * Plusieurs stories dans le même créneau le sont souvent, pas toujours. Une
 * phrase affirmative (« associe-leur une séquence ») affirmerait quelque chose
 * de possiblement faux et se lirait comme une corvée assignée ; la question se
 * décline en l'ignorant, à coût nul, et quand la réponse est oui le travail est
 * déjà préparé de l'autre côté du clic.
 *
 * POURQUOI JAMAIS POUR UNE STORY SEULE (le seuil vit chez l'appelant) : c'est le
 * geste le plus quotidien de la plateforme. Alerter dessus tous les jours est
 * exactement ce qui fait couper les notifications — après quoi plus aucune n'est
 * lue, y compris celles qui comptent.
 */
export function nouvellesStories(opts: { storyIds: readonly string[] }): NotifPush {
  const n = opts.storyIds.length;
  return {
    // Toujours au pluriel : l'appelant ne notifie qu'à partir de deux.
    title: `${n} stories publiées`,
    body: "C'est une séquence ? Crée-la pour capter les leads qui répondent.",
    // Le clic remplace sept gestes (onglet, « Sélectionner », taper chaque
    // story, « Continuer ») par un seul.
    url: `/client/liens?${PARAM_STORIES_A_GROUPER}=${opts.storyIds.join(',')}`,
    tag: `nouvelles-stories-${opts.storyIds[0]}`,
  };
}

/** Le type d'un LOT : « mixte » dès que les deux cohabitent. */
export function typeDuLot(types: readonly ('reel' | 'post')[]): TypePublication {
  const distincts = new Set(types);
  if (distincts.size === 0) return 'mixte';
  return distincts.size > 1 ? 'mixte' : ([...distincts][0] as 'reel' | 'post');
}

// ── Calls ───────────────────────────────────────────────────────────────────

/**
 * Un rapport de call reste à remplir.
 *
 * Tag PAR CALL : le cron traite tous les rapports en attente d'un coup. Sans tag
 * propre, deux appels à reporter le même jour ne laissaient qu'un rappel
 * visible — et le coach en oubliait un.
 *
 * Le prénom est tronqué : un nom à rallonge poussait l'action hors des 100
 * caractères que le service worker garde.
 */
export function rapportDeCall(opts: { callId: string; inviteeName?: string | null }): NotifPush {
  const nom = (opts.inviteeName ?? '').trim();
  const avec = nom ? ` avec ${nom.length > 28 ? `${nom.slice(0, 27)}…` : nom}` : '';
  return {
    title: 'Rapport de call',
    body: `Comment s'est passé ton appel${avec} ? Remplis ton rapport.`,
    url: `/client/calls?rapport=${opts.callId}`,
    tag: `rapport-${opts.callId}`,
  };
}

/**
 * Une invitation de call attend une réponse.
 *
 * Tag par call ET par échéance : le rappel à 24 h ne doit pas effacer celui à
 * 2 h, et deux invitations en attente restent deux notifications.
 */
export function invitationCall(opts: {
  callId: string;
  coachPrenom?: string | null;
  heure: string;
  echeance: '2h' | '24h';
}): NotifPush {
  const qui = (opts.coachPrenom ?? '').trim() || 'Ton coach';
  return {
    title: 'Invitation de call en attente',
    body: `${qui} t'a proposé un call à ${opts.heure} — accepte ou refuse l'invitation.`,
    url: '/client/calls',
    tag: `invitation-${opts.callId}-${opts.echeance}`,
  };
}

// ── Messagerie ──────────────────────────────────────────────────────────────

/**
 * Un nouveau message.
 *
 * SEULE notification à tag partagé, et c'est voulu : un message remplace le
 * précédent pour ne laisser qu'un badge de conversation. C'était le défaut
 * implicite du service worker — donc hérité par tout le monde. Il est désormais
 * demandé ici, explicitement, et nulle part ailleurs.
 */
export const TAG_MESSAGERIE = 'momentum-msg';

// ── Exploitation ────────────────────────────────────────────────────────────

/**
 * Un envoi Instagram a été refusé (alerte destinée à l'exploitant).
 *
 * Tag par nature d'incident : la même panne qui se répète remplace son alerte —
 * le corps porte déjà le compteur « N fois en 24 h » — mais deux pannes
 * différentes restent deux alertes distinctes.
 */
export function envoiInstagramRefuse(opts: {
  etape: string;
  sousCode?: string | number | null;
  verdict: string;
  message?: string | null;
}): NotifPush {
  const code = opts.sousCode == null ? '' : ` · code ${opts.sousCode}`;
  return {
    title: 'Momentum — envoi Instagram refusé',
    body: `${opts.etape}${code} — ${opts.verdict}${opts.message ? `\n${opts.message}` : ''}`,
    url: '/client/pipeline',
    tag: `alerte-ig-${opts.etape}-${opts.sousCode ?? 'sans-code'}`,
  };
}
