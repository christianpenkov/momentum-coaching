/**
 * Conversations Instagram — les quatre décisions pures.
 *
 * Tout ce qui, dans ce chantier, peut se tromper en silence est ici, isolé et
 * testé. Le reste (requêtes, rendu) échoue bruyamment ; ces quatre-là non.
 *
 * Doc complète, mesures et motifs : docs/conversations-instagram.md
 */

/**
 * Les DEUX formes sous lesquelles Meta désigne le compte d'un élève.
 *
 * ⚠️ C'est LE piège de ce chantier, et il frappe à deux endroits différents :
 *
 *   webhook messaging   → sender.id vaut parfois `entry.id`, pas `ig_account_id`
 *   API /conversations  → le participant « soi » est rendu sous forme `entry.id`
 *
 * Mesuré le 2026-09-04 : le compte `26886602587671296` (metadata.ig_account_id)
 * apparaît comme `17841410050226823` dans `participants`. Comparer à une seule
 * des deux formes fait classer l'élève comme son propre interlocuteur — chaque
 * conversation crée alors un fil « avec soi-même » et le sens des messages
 * s'inverse.
 *
 * La correspondance entre les deux vit dans `ig_entry_id_mapping`. Ici on ne
 * fait que consommer les deux valeurs, sans jamais en supposer une seule.
 */
export type FormesDuCompte = {
  igAccountId: string;
  /** `entry.id` du webhook. Peut être identique à `igAccountId`, ou non. */
  entryId?: string | null;
};

/** Cet identifiant désigne-t-il le compte de l'élève, sous l'une ou l'autre forme ? */
export function estLeCompte(id: string | null | undefined, formes: FormesDuCompte): boolean {
  if (!id) return false;
  return id === formes.igAccountId || (!!formes.entryId && id === formes.entryId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Direction d'un message
// ─────────────────────────────────────────────────────────────────────────────

type EvenementMessaging = {
  sender?: { id?: string } | null;
  recipient?: { id?: string } | null;
  message?: { is_echo?: boolean; is_deleted?: boolean } | null;
};

/**
 * Cet événement annonce-t-il qu'un message a été RETIRÉ d'Instagram ?
 *
 * ⚠️ Il n'existe PAS de champ d'abonnement dédié aux suppressions. Meta les
 * livre dans le champ `messages`, avec `is_deleted: true` sur le message. Le
 * projet y est abonné depuis le début : l'événement arrivait déjà, il était
 * simplement ignoré.
 *
 * ⚠️ Le plan de ce chantier a affirmé pendant plusieurs heures qu'« aucun
 * webhook ne signale un message annulé », sur la foi d'une page qui énumérait
 * les champs d'abonnement sans détailler leurs charges utiles. Une limitation
 * crue sur une seule lecture ne produit aucun symptôme : on ne construit
 * simplement pas la chose qu'elle interdit.
 *
 * Test strict à `true` : Meta envoie parfois `is_deleted: false` sur un message
 * ordinaire, et une comparaison souple ferait alors supprimer un message vivant.
 */
export function estSuppression(ev: EvenementMessaging): boolean {
  return ev?.message?.is_deleted === true;
}

/**
 * Le message part-il du compte de l'élève ?
 *
 * Deux signaux, dans cet ordre :
 *  1. `is_echo` — Meta le pose sur tout message envoyé par le compte, y compris
 *     depuis l'application Instagram sur le téléphone de l'élève.
 *  2. l'expéditeur EST le compte, sous l'une ou l'autre de ses deux formes.
 *
 * Le second n'est pas redondant : `is_echo` est absent de certaines charges
 * utiles, et c'est précisément là que le piège `entry.id` se referme.
 */
export function estSortant(ev: EvenementMessaging, formes: FormesDuCompte): boolean {
  if (ev?.message?.is_echo === true) return true;
  return estLeCompte(ev?.sender?.id, formes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Qui est l'interlocuteur ?
// ─────────────────────────────────────────────────────────────────────────────

export type Participant = { id?: string; username?: string };

/**
 * Dans une conversation rendue par l'API, lequel des participants est l'autre ?
 *
 * Rend `null` plutôt que de lever : un fil sans autre participant (compte
 * supprimé, fil de groupe non géré) n'est pas une erreur de programmation, c'est
 * un fil qu'on ignore.
 */
export function interlocuteur(
  participants: Participant[] | null | undefined,
  formes: FormesDuCompte,
): Participant | null {
  const autres = (participants ?? []).filter(p => p?.id && !estLeCompte(p.id, formes));
  return autres.length === 1 ? autres[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Nature d'une pièce jointe
// ─────────────────────────────────────────────────────────────────────────────

type MessageMeta = {
  text?: string;
  attachments?: { type?: string }[] | null;
  reply_to?: { story?: { id?: string } | null } | null;
};

/**
 * Le marqueur à afficher à la place du média, ou `null` pour un message texte.
 *
 * ⚠️ On ne stocke JAMAIS le média : 14 % des messages en portent un, et
 * ré-héberger remplirait le gigaoctet gratuit en neuf jours. L'URL est
 * redemandée à Meta au moment où quelqu'un clique — d'où la nécessité de garder
 * le `mid` brut pour ces messages-là, et seulement pour eux.
 *
 * ⚠️ Un type inconnu rend `'autre'`, jamais une exception. Meta ajoute des types
 * sans prévenir ; un message qui casserait le worker arrêterait aussi les DM1.
 */
export function typePieceJointe(message: MessageMeta | null | undefined): string | null {
  if (!message) return null;

  // Une réponse à une story est une pièce jointe même quand elle porte du texte :
  // sans le marqueur, le fil affiche une phrase sans son contexte.
  if (message.reply_to?.story?.id) return 'story_reply';

  const brut = message.attachments?.[0]?.type;
  if (!brut) return null;

  switch (brut) {
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
    case 'share':
      return brut;
    case 'ig_reel':
    case 'reel':
      return 'share';
    case 'story_mention':
      return 'story_reply';
    default:
      return 'autre';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lien vers la discussion Instagram
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le préfixe des identifiants de conversation rendus par l'API.
 *
 * ⚠️ Meta ne documente NULLE PART ce format. Il a donc été vérifié sur
 * l'intégralité des conversations des trois comptes connectés le 2026-09-04 :
 * 170 examinées, 170 décodées en nombre pur, un seul préfixe, 39 chiffres sans
 * exception. Un échantillon n'aurait rien prouvé d'un format.
 */
const PREFIXE_CONVERSATION = 'aWdfZAG06';

/**
 * Où envoyer quelqu'un qui veut répondre à ce prospect.
 *
 * L'identifiant que rend l'API contient, en base64, le numéro de fil interne
 * d'Instagram. Décodé, il ouvre DIRECTEMENT la bonne discussion :
 *
 *   aWdfZAG06MzQwMjgyMzY2ODQxNzEwMzAxMjQ0MjU5MDcyODQwODUzNzU5NDMw
 *      └ préfixe ┘└──────────── base64 du numéro ─────────────────┘
 *   → 340282366841710301244259072840853759430
 *   → https://www.instagram.com/direct/t/3402823668417103012442590728408537594.../
 *
 * Vérifié en session connectée : le lien tombe sur la bonne conversation.
 *
 * ⚠️ Le repli n'est PAS une précaution de style — c'est ce qui rend acceptable
 * de dépendre d'un format non documenté. Si Meta change le préfixe ou l'encodage,
 * on retombe sur `ig.me`, jamais sur un lien fabriqué qui mènerait ailleurs.
 * **Ne pas le supprimer en constatant qu'il ne se déclenche jamais** : son
 * inutilité actuelle est exactement sa raison d'être.
 *
 * @param surMobile `ig.me` ouvre le fil dans l'application ; sur le web desktop
 *   Meta le dégrade en page de profil, sans champ de saisie. D'où les deux
 *   destinations.
 */
export function lienDiscussion(
  conversationId: string | null | undefined,
  peerUsername: string | null | undefined,
  surMobile = false,
): string | null {
  if (!surMobile && conversationId?.startsWith(PREFIXE_CONVERSATION)) {
    const numero = decodeBase64(conversationId.slice(PREFIXE_CONVERSATION.length));
    if (numero && /^\d+$/.test(numero)) {
      return `https://www.instagram.com/direct/t/${numero}/`;
    }
  }
  if (peerUsername) return `https://ig.me/m/${peerUsername}`;
  // Ni numéro décodable, ni pseudo : mieux vaut aucun bouton qu'un bouton mort.
  return null;
}

/** Décodage tolérant : une chaîne non-base64 rend `null` au lieu de lever. */
function decodeBase64(s: string): string | null {
  try {
    if (typeof atob === 'function') return atob(s);
    // Node : pas d'atob dans les runtimes anciens.
    return Buffer.from(s, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Par où ce lead est entré
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le libellé et la pastille d'une `instagram_leads.source`.
 *
 * L'en-tête d'un fil affichait la valeur BRUTE — « comment », « cold_dm ». Ce
 * n'est pas un libellé, c'est une clé de base de données : elle ne veut rien
 * dire pour un coach, et « comment » se lit même comme un mot français tronqué.
 *
 * ⚠️ Les couleurs sont celles d'`IG_STAGES` dans `components/pipeline/PagePipeline.tsx`,
 * délibérément : le coach voit déjà ces deux pastilles dans Pipeline Leads, et
 * deux codes couleur pour la même notion seraient pires que pas de couleur du
 * tout. Un test les confronte au fichier du pipeline — sans quoi ce serait une
 * copie que personne ne relit, c'est-à-dire une copie qui finira par mentir.
 *
 * ⚠️ Une source INCONNUE rend `null`, et l'en-tête n'affiche alors rien. Un
 * repli sur la valeur brute réintroduirait exactement le défaut corrigé ici, et
 * un repli sur « Cold DM » affirmerait une origine qu'on ne connaît pas.
 */
export function sourceDuLead(
  source: string | null | undefined
): { libelle: string; couleur: string } | null {
  switch (source) {
    // Le commentaire mot-clé sous une publication : la porte d'entrée du lead magnet.
    case 'comment':     return { libelle: 'Commentaire LM', couleur: '#7C3AED' };
    // Le coach est allé chercher la personne.
    case 'cold_dm':     return { libelle: 'Cold DM',        couleur: '#0891B2' };
    // Réponse à une story : le déclencheur est un contenu daté, pas un commentaire.
    case 'story_reply': return { libelle: 'Réponse story',  couleur: '#D97706' };
    // Les deux réponses possibles à la question posée à la création d'un lien
    // manuel (voir `lib/canalDm.ts`) : elles disent qui a fait le premier pas.
    case 'dm_entrant':  return { libelle: 'DM entrant',     couleur: '#7C3AED' };
    case 'dm_sortant':  return { libelle: 'DM sortant',     couleur: '#0891B2' };
    default:            return null;
  }
}
