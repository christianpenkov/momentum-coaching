// ─────────────────────────────────────────────────────────────────────────────
// Ce que le coach a déjà tranché quand on lui propose de rattacher des stories.
//
// ── LE PRINCIPE ──────────────────────────────────────────────────────────────
//
// Il n'y a RIEN à mémoriser d'un refus : l'acceptation le dit déjà. Au moment où
// le coach clique « Les rattacher », les stories qui lui étaient proposées et
// qu'il n'a pas cochées sont celles dont il ne veut pas.
//
// Une seule borne suffit donc — la parution la plus récente sur laquelle il a
// tranché — et elle vit en base, donc sur tous ses appareils.
//
// ── LA BORNE EST UNE PARUTION, JAMAIS UNE HEURE DE CLIC ──────────────────────
//
// C'est tout l'objet de ce fichier, et le piège qu'il ferme.
//
// Retenir `now()` au moment du clic paraît équivalent, et ne l'est pas : la
// publication d'une story est datée par INSTAGRAM, le clic par notre serveur, et
// le cron peut avoir jusqu'à une heure de retard entre les deux. Une story
// publiée depuis le téléphone pendant que l'écran est ouvert sur l'ordinateur
// n'est donc PAS affichée au moment du clic — mais sa parution précède l'heure
// du clic. Elle serait écartée à vie sans avoir jamais été montrée, et rien ne
// le signalerait.
//
// En bornant sur les parutions ARBITRÉES — les rattachées et les écartées
// réunies — on ne compare que des `posted_at` entre eux. Ce que le coach n'a pas
// pu voir est forcément publié après la dernière chose qu'il a vue, donc revient.
// Aucune horloge n'entre dans le calcul.
// ─────────────────────────────────────────────────────────────────────────────

export interface StoryLibre {
  id: string;
  postedAt?: string | null;
}

const ms = (d?: string | null): number => {
  const t = new Date(d || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

/**
 * Les stories encore à proposer pour une séquence, et celles qu'on retire.
 *
 * `libres` doit déjà être restreint aux stories dont CETTE séquence est
 * propriétaire (une story n'est proposée qu'à une seule séquence).
 *
 * `ecarteesLocalement` est la sélection en cours, celle des croix : elle ne vit
 * que le temps de la décision et n'a pas à survivre à un rechargement — recharger
 * sans avoir cliqué, c'est n'avoir rien décidé.
 */
export function storiesARattacher<T extends StoryLibre>(
  libres: T[],
  arbitreesJusqua: string | null | undefined,
  ecarteesLocalement: ReadonlySet<string> = new Set(),
): { proposees: T[]; ecartees: T[] } {
  const borne = ms(arbitreesJusqua);
  const parue = (s: T) => ms(s.postedAt);

  // On n'écarte que ce qu'on SAIT antérieur à la borne.
  //
  // Une story sans `posted_at` lisible — ça arrive à la détection — donne 0, et
  // 0 n'est postérieur à rien : la tester comme les autres la ferait disparaître
  // définitivement de l'écran. Or proposer à tort se rattrape d'un clic, tandis
  // qu'écarter à tort est sans retour. Elle reste donc proposée.
  //
  // `>` et non `>=` : la story qui a SERVI de borne est justement l'une des
  // arbitrées, elle ne doit pas revenir.
  const restantes = libres
    .filter(s => parue(s) === 0 || parue(s) > borne)
    .sort((a, b) => parue(a) - parue(b));

  return {
    proposees: restantes.filter(s => !ecarteesLocalement.has(s.id)),
    ecartees: restantes.filter(s => ecarteesLocalement.has(s.id)),
  };
}

/**
 * La nouvelle borne, après un rattachement.
 *
 * `parutionsArbitrees` = les `posted_at` de TOUT ce sur quoi le coach vient de
 * trancher : ce qu'il rattache et ce qu'il écarte. Les écartées sont
 * indispensables — sans elles, écarter la story la plus récente la ferait
 * revenir aussitôt, puisque la borne s'arrêterait à la dernière rattachée.
 *
 * La borne ne RECULE jamais : un vieil onglet qui rattache une story ancienne ne
 * doit pas rouvrir des refus déjà prononcés ailleurs.
 *
 * Retourne `null` quand il n'y a rien à retenir — la colonne n'est alors pas
 * touchée, plutôt que remise à zéro.
 */
export function bornerArbitrage(
  parutionsArbitrees: (string | null | undefined)[],
  bornePrecedente: string | null | undefined,
): string | null {
  const dates = parutionsArbitrees.filter(Boolean).map(d => ms(d)).filter(t => t > 0);
  if (dates.length === 0) return null;

  const nouvelle = Math.max(...dates);
  const precedente = ms(bornePrecedente);
  if (nouvelle <= precedente) return null;

  return new Date(nouvelle).toISOString();
}
