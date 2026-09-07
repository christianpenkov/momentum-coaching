/**
 * « Quelle photo pour cette personne ? » — la question, posée une seule fois.
 *
 * ── CE QUI MANQUAIT ─────────────────────────────────────────────────────────
 *
 * La plateforme avait un composant de PRÉSENTATION partagé (`components/ui/Avatar`)
 * mais aucun résolveur : chaque écran redécidait où chercher la photo. Audit du
 * 2026-09-07 — sept stratégies différentes, et une seule appliquait la règle
 * complète, enfouie dans une route de la page Paiements.
 *
 * Conséquence directe, celle qui se voyait : la page Calls ne lisait que la photo
 * du compte Momentum. Or un prospect de call de vente n'a PAS de compte — il n'est
 * pas élève. Sa photo était donc systématiquement absente, alors qu'elle existe
 * en base dès qu'il est passé par un DM Instagram.
 *
 * ── LES DEUX SEULES SOURCES ─────────────────────────────────────────────────
 *
 *   1. `profiles.avatar_url`        — la photo qu'un utilisateur a téléversée.
 *                                     N'existe que pour un coach ou un élève.
 *   2. `instagram_leads.avatar_url` — sa photo de profil Instagram, recopiée
 *                                     dans notre bucket (l'URL de Meta expire).
 *
 * ⚠️ `clients.avatar_url` n'existe PAS en base : c'est un champ fabriqué en
 * mémoire depuis `profiles`, via `clients.profile_id`. Un élève invité mais pas
 * encore inscrit n'a donc pas de photo de compte — d'où l'importance du repli.
 *
 * ── L'ORDRE, ET POURQUOI ────────────────────────────────────────────────────
 *
 * Instagram d'abord. Une personne qui a les deux est un élève venu d'Instagram :
 * sa photo IG est celle sous laquelle on le connaît dans le pipeline et les
 * conversations. Prendre l'autre le ferait changer de visage d'un écran à l'autre.
 */

/** Tout ce dont un écran a besoin pour afficher quelqu'un. */
export interface IdentiteAffichee {
  nom: string;
  initiales: string;
  photo: string | null;
  /** Graine de couleur du repli — voir plus bas pourquoi c'est le nom. */
  graine: string;
}

/**
 * Initiales lisibles à partir d'un nom ou d'un handle Instagram.
 *
 * Le `@` initial est retiré et les séparateurs de handle (`.`, `_`, `-`) comptent
 * comme des espaces : `@marc_dupont` donne « MD » et non « ma ».
 */
export function initialesDe(nom: string | null | undefined): string {
  if (!nom) return '?';
  return nom
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .map(mot => mot[0] || '')
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

/**
 * L'identité d'affichage d'une personne.
 *
 * ── POURQUOI LA GRAINE EST LE NOM ───────────────────────────────────────────
 *
 * La couleur du repli doit suivre la personne, pas la ligne qui la mentionne.
 * `components/ui/Avatar.tsx` le documente déjà — mais la plupart des écrans
 * passaient un identifiant, et la page Calls passait carrément `call.id` : la
 * MÊME personne changeait de couleur à chaque appel de sa liste.
 *
 * Le nom est la seule clé que tous les écrans partagent : un prospect Calendly
 * n'a pas d'identifiant de lead, un lead Instagram pas d'identifiant de client.
 */
export function identiteDe(opts: {
  nom?: string | null;
  /** `profiles.avatar_url`, via `clients.profile_id` le cas échéant. */
  photoCompte?: string | null;
  /** `instagram_leads.avatar_url`. */
  photoInstagram?: string | null;
}): IdentiteAffichee {
  const nom = (opts.nom ?? '').trim() || '—';
  // Une chaîne vide en base ne vaut pas une photo : `?? ` la laisserait passer.
  const photo = vide(opts.photoInstagram) ? (vide(opts.photoCompte) ? null : opts.photoCompte!) : opts.photoInstagram!;
  return {
    nom,
    initiales: initialesDe(opts.nom),
    photo,
    graine: nom.toLowerCase(),
  };
}

function vide(v: string | null | undefined): boolean {
  return v == null || v.trim() === '';
}
