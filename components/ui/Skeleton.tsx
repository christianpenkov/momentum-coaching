/**
 * Formes de chargement qui reproduisent la structure de la page à venir.
 *
 * Un loader centré dit « attends » ; un squelette dit « voilà ce qui arrive ».
 * La page paraît déjà présente, et le contenu remplace des formes de mêmes
 * dimensions plutôt que de surgir dans le vide — pas de saut de mise en page.
 *
 * Le balayage (et non un clignotement d'opacité) est le motif retenu par les
 * apps natives : il suggère un chargement en cours plutôt qu'un élément qui
 * apparaît et disparaît. Il s'arrête sous prefers-reduced-motion.
 */

export function Skeleton({
  width = '100%',
  height = 14,
  radius = 6,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="skeleton"
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}

/**
 * Bloc de texte : plusieurs lignes dont la dernière est plus courte, comme un
 * vrai paragraphe. Sans ça, un empilement de barres identiques se lit comme un
 * tableau plutôt que comme du texte.
 */
export function SkeletonText({ lines = 3, gap = 8 }: { lines?: number; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '62%' : '100%'} />
      ))}
    </div>
  );
}

/** Carte : reprend le padding et le rayon de .card pour que rien ne bouge. */
export function SkeletonCard({ children }: { children?: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      {children ?? (
        <>
          <Skeleton width="40%" height={16} style={{ marginBottom: 14 }} />
          <SkeletonText lines={2} />
        </>
      )}
    </div>
  );
}
