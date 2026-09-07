'use client';

import Icon from '@/components/ui/Icon';

/**
 * Recherche d'un call par le nom de la personne.
 *
 * Composant partagé par les deux pages Calls (coach et élève) : c'est la même
 * recherche, elle doit se présenter et se comporter pareil des deux côtés.
 *
 * ── CE QU'ELLE FILTRE ───────────────────────────────────────────────────────
 *
 * L'onglet COURANT, pas toute la plateforme. Taper « Leroy » dans Historique ne
 * montre que ses calls passés. C'est ce qu'on attend d'une barre posée sous les
 * onglets — et ça évite de se demander pourquoi un call à venir apparaît dans
 * l'historique.
 *
 * Les compteurs des onglets suivent la recherche : « Historique (3) » pendant
 * qu'on cherche dit combien de calls de cette personne s'y trouvent. C'est ce qui
 * permet de voir d'un coup d'œil dans quel onglet elle apparaît.
 *
 * La règle de correspondance (nom seul, insensible aux accents) vit dans
 * `lib/rechercheCalls.ts`, avec ses tests.
 */
export default function BarreRechercheCalls({
  valeur,
  onChange,
  resultats,
}: {
  valeur: string;
  onChange: (v: string) => void;
  /** Nombre de calls trouvés, pour dire franchement quand il n'y en a aucun. */
  resultats: number;
}) {
  const cherche = valeur.trim().length > 0;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ position: 'relative', maxWidth: 340 }}>
        <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', display: 'flex' }}>
          <Icon name="search" size={15} />
        </span>
        <input
          type="search"
          value={valeur}
          onChange={e => onChange(e.target.value)}
          placeholder="Rechercher une personne"
          aria-label="Rechercher un call par le nom de la personne"
          style={{
            width: '100%',
            // 34 à gauche pour la loupe, 34 à droite pour la croix d'effacement
            // que le navigateur ajoute sur un `type="search"`.
            padding: '9px 34px 9px 34px',
            fontSize: 13,
            fontFamily: 'inherit',
            color: 'var(--ink)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            outline: 'none',
          }}
        />
      </div>

      {/* Un « aucun résultat » explicite : sans lui, une liste vide se confond
          avec un onglet réellement vide, et on croit avoir perdu ses calls. */}
      {cherche && resultats === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>
          Aucun call à ce nom dans cet onglet.
        </div>
      )}
    </div>
  );
}
