'use client';

// Couleur stable par personne — dérivée d'un hash de son identifiant (id si fourni,
// sinon les initiales en repli), jamais de sa position dans une liste. Sans ça, la
// même personne changeait de couleur selon la page (position différente dans chaque
// liste) ou en changeait carrément à chaque tri/filtre de la même liste. Centralise
// ici la logique qui était auparavant réinventée séparément dans AccessSheet.tsx,
// PagePipeline.tsx, PageStatsClients.tsx, ResourceCardCoach.tsx, PageClients.tsx.
const AVATAR_COLORS = ['#7C3AED', '#2563EB', '#059669', '#D97706', '#EA580C', '#DB2777', '#0891B2', '#65A30D'];

/**
 * La graine à utiliser pour UNE PERSONNE.
 *
 * ── Pourquoi le nom et pas un identifiant ──────────────────────────────────
 * La couleur d'un avatar sans photo est une aide à la reconnaissance : on
 * retrouve quelqu'un à sa pastille avant de lire son nom. Elle ne tient cette
 * promesse que si elle est la MÊME partout.
 *
 * Or chaque écran connaît la personne par un identifiant différent — id de
 * client ici, id de lead là, id de vente ailleurs — et trois écrans donnaient
 * donc trois couleurs au même client. Le nom est la seule chose que tous
 * affichent, par construction : c'est lui la graine.
 *
 * Deux homonymes partageront une couleur. C'est le prix, et il est juste : on
 * ne les distingue pas non plus à l'œil.
 */
export function seedForPerson(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

/** Exporté pour que la couleur d'une personne soit la MÊME partout : son avatar, sa
 *  courbe dans le graphe de Stats Clients, sa pastille de légende. Deux palettes
 *  auraient donné deux couleurs à la même personne sur le même écran. */
export function colorFromSeed(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// Repli canonique des initiales quand la colonne DB dédiée (clients.initials) est
// vide — 5 implémentations divergentes trouvées dans le repo avant centralisation
// (certaines sans repli du tout, '?' vs '??' selon le fichier). Gère les @handles
// (leads Instagram) en plus des noms classiques "Prénom Nom".
export function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const initials = name.replace(/^@/, '').split(/[\s._-]/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2);
  return initials || '?';
}

interface AvatarProps {
  initials: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
  /** Identifiant stable de la personne (id de préférence) — sert de graine à la
   * couleur de fond quand il n'y a pas de photo. Si absent, `initials` est utilisé. */
  seed?: string;
}

export default function Avatar({ initials, avatarUrl, size = 36, className, seed }: AvatarProps) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`avatar${className ? ' ' + className : ''}`}
        style={{ width: size, height: size, objectFit: 'cover', display: 'block', flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      className={`avatar${className ? ' ' + className : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.35, background: colorFromSeed(seed || initials), color: '#fff' }}
    >
      {initials}
    </div>
  );
}
