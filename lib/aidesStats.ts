// Les regles de comptage du funnel de vente, ecrites UNE fois pour tous les ecrans.
//
// Elles decrivent des GRAINS, pas des emplacements : le meme texte doit apparaitre
// partout ou le meme nombre est compte de la meme facon, sinon les libelles se
// remettent a diverger. Ce fichier existe parce qu'ils ont diverge : « Calls bookes »
// comptait des opportunites dans « Mes stats » et des rendez-vous sur la fiche client,
// sous le meme libelle et sans que rien ne le dise (corrige le 2026-09-12).
//
// ⚠️ Rediges a la TROISIEME personne, deliberement. Ces textes sont lus par deux
// publics : l'eleve sur ses propres stats, et le coach sur la fiche de son eleve. Un
// « vos ventes » juste sous le nom d'un eleve designerait la mauvaise personne. Ne pas
// les repasser en « vous » en croyant les rechauffer.
//
// Le calcul correspondant vit dans lib/salesCallStats.ts et lib/callSeries.ts ; les
// regles de perimetre dans docs/perimetre-stats-referentiel.md.

export const AIDE_CALLS_BOOKES =
  "Un deuxième rendez-vous qui prolonge la même vente ne compte pas deux fois. "
  + "Ce compteur mesure ce que le contenu produit, pas le nombre de créneaux tenus — "
  + "la page Calls, elle, les affiche tous. Si la même personne reprend rendez-vous plus "
  + "tard pour une nouvelle demande, elle compte à nouveau. C'est le rapport de call "
  + "qui fait la différence : le second rendez-vous n'est écarté que s'il a été déclaré "
  + "comme une suite.";

export const AIDE_CALLS_HONORES =
  "Parmi les calls bookés, ceux qui ont eu lieu. Même règle : un deuxième rendez-vous qui "
  + "prolonge la même vente n'est pas recompté. Ce nombre ne peut donc jamais dépasser les "
  + "calls bookés.";

// La plateforme n'affiche plus que la PRESENCE, jamais l'absence : un seul sens de
// lecture, plus c'est haut mieux c'est. Le texte du grain est isole parce qu'il serait
// le meme pour un no-show — si un ecran devait le reafficher un jour, il compose ce
// bloc plutot que d'en reecrire une variante.
const GRAIN_RENDEZ_VOUS =
  "Ce taux parle en RENDEZ-VOUS et non en opportunités : un créneau posé puis manqué "
  + "est un créneau perdu, même s'il prolongeait une vente déjà en cours. On mesure ici "
  + "la fiabilité d'un créneau, pas ce que le contenu a produit — d'où ce grain "
  + "différent, assumé.\n\n"
  + "Son dénominateur n'est donc pas celui de « Calls bookés ». C'est pourquoi il est "
  + "écrit sous le taux, « 9 sur 11 rendez-vous », et pas seulement ici.\n\n"
  + "Ce dénominateur ne compte que les rendez-vous dont l'issue est TRANCHÉE : la "
  + "personne est venue, ou elle ne s'est pas présentée. Un créneau encore à venir, ou "
  + "passé mais dont le rapport n'est pas rempli, n'entre ni au numérateur ni au "
  + "dénominateur — sinon un rendez-vous simplement pas encore tenu se lirait comme une "
  + "absence.";

export const AIDE_SHOW_UP =
  "La part des rendez-vous où la personne s'est présentée.\n\n" + GRAIN_RENDEZ_VOUS;

export const AIDE_CLOSING =
  "Les ventes rapportées aux calls honorés.\n\n"
  + "Le dénominateur compte des PERSONNES, pas des rendez-vous. Quelqu'un vu "
  + "deux fois pour la même vente compte pour UN seul call honoré, pas deux.\n\n"
  + "Exemple : un prospect vu le 12, qui veut réfléchir, revu le 19 et qui signe. Cela "
  + "fait 1 call honoré et 1 vente, donc 100 %. Si les deux rendez-vous comptaient, on "
  + "lirait 50 % — et bien mener une vente en deux temps ferait BAISSER le taux.\n\n"
  + "Deux rendez-vous ne sont regroupés que si cela a été déclaré : c'est la réponse "
  + "« 2ème call » du rapport qui les relie. Un prospect qui revient de lui-même des "
  + "mois plus tard compte bien pour une nouvelle opportunité.\n\n"
  + "La vente est comptée dans la période du PREMIER rendez-vous, celui qui a créé "
  + "l'opportunité — pas dans celle où elle a été signée.";

export const AIDE_REV_PAR_CALL =
  "Le revenu de la période divisé par les calls bookés. Un deuxième rendez-vous qui "
  + "prolonge la même vente n'entre pas au dénominateur, comme dans la colonne « Calls "
  + "bookés ». Un deal signé lors d'un second rendez-vous reste au numérateur : il compte "
  + "là où il a été signé.";

/**
 * L'aide « Calls bookes », prefixee des deux nombres quand ils different.
 *
 * Voir un « 8 » quand on comptait 10 rendez-vous est exactement le moment ou l'aide est
 * lue. Le texte partage reste la regle, le prefixe ne fait que la rendre concrete —
 * c'est pour ca que cette fonction existe plutot qu'un troisieme texte ecrit a la main.
 */
export function aideCallsBookes(callsBookes: number, rendezVous: number): string {
  return callsBookes !== rendezVous
    ? `${callsBookes} calls bookés, mais ${rendezVous} rendez-vous. ${AIDE_CALLS_BOOKES}`
    : AIDE_CALLS_BOOKES;
}
