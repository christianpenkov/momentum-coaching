'use client';

import { couleurDeGraine, graineDe, initialesDe } from '@/lib/avatars';

// Couleur stable par personne — dérivée d'un hash de son identifiant (id si fourni,
// sinon les initiales en repli), jamais de sa position dans une liste. Sans ça, la
// même personne changeait de couleur selon la page (position différente dans chaque
// liste) ou en changeait carrément à chaque tri/filtre de la même liste. Centralise
// ici la logique qui était auparavant réinventée séparément dans AccessSheet.tsx,
// PagePipeline.tsx, PageStatsClients.tsx, ResourceCardCoach.tsx, PageClients.tsx.
// ⚠️ La palette, la graine et les initiales ne vivent PLUS ici : elles sont dans
// `lib/avatars.ts`, avec la règle de résolution de la photo. Raison : elles
// existaient en cinq copies dans le dépôt (ici, PagePipeline, ResourceCardCoach,
// AccessSheet, primitivesInstagram) — même hash, mêmes huit couleurs, mais
// semées différemment, donc la même personne changeait de couleur d'un écran à
// l'autre. Un module sans React est aussi le seul endroit testable.
//
// Réexportées pour ne casser aucun des imports existants — la vingtaine de
// fichiers qui font `import { getInitials } from '@/components/ui/Avatar'`
// continue de fonctionner.
export { graineDe as seedForPerson, couleurDeGraine as colorFromSeed, initialesDe as getInitials, couleurDe } from '@/lib/avatars';

interface AvatarProps {
  initials: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
  /**
   * Le NOM de la personne. C'est lui qui donne la couleur, et c'est la bonne
   * façon d'appeler ce composant.
   *
   * Il prime sur `seed` : le nom est la seule clé que tous les écrans partagent,
   * donc la seule qui donne la MÊME couleur partout.
   */
  nom?: string | null;
  /**
   * @deprecated Passer `nom`.
   *
   * Cette prop recevait un identifiant — de client ici, de lead là, de CALL
   * ailleurs — et chaque écran connaissant la personne par un identifiant
   * différent, la même personne avait une couleur par écran. Conservée le temps
   * que les derniers appelants migrent.
   */
  seed?: string;
}

export default function Avatar({ initials, avatarUrl, size = 36, className, nom, seed }: AvatarProps) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`avatar${className ? ' ' + className : ''}`}
        style={{ width: size, height: size, objectFit: 'cover', display: 'block', flexShrink: 0 }}
        // Une URL morte (bucket purgé, 404) cassait l'image à l'écran au lieu de
        // retomber sur les initiales — le pipeline le gérait déjà, pas le
        // composant partagé. On retire simplement la source : le rendu bascule
        // alors sur le repli coloré au re-rendu suivant.
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return (
    <div
      className={`avatar${className ? ' ' + className : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.35, background: couleurDeGraine(nom ? graineDe(nom) : (seed || initials)), color: '#fff' }}
    >
      {initials}
    </div>
  );
}
