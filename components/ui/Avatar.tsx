'use client';

// Couleur stable par personne — dérivée d'un hash de son identifiant (id si fourni,
// sinon les initiales en repli), jamais de sa position dans une liste. Sans ça, la
// même personne changeait de couleur selon la page (position différente dans chaque
// liste) ou en changeait carrément à chaque tri/filtre de la même liste. Centralise
// ici la logique qui était auparavant réinventée séparément dans AccessSheet.tsx,
// PagePipeline.tsx, PageAnalytics.tsx, ResourceCardCoach.tsx, PageClients.tsx.
const AVATAR_COLORS = ['#7C3AED', '#2563EB', '#059669', '#D97706', '#EA580C', '#DB2777', '#0891B2', '#65A30D'];

function colorFromSeed(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
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
