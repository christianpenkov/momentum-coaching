#!/usr/bin/env node
// Liste des migrations PRÉSENTES DANS LE DÉPÔT, pour que la base puisse dire ce qui lui
// a été appliqué sans jamais avoir été versionné.
//
// ── Le problème ────────────────────────────────────────────────────────────────────
//
// Appliquer un changement de schéma sans écrire le fichier ne laisse AUCUNE trace : la
// base l'enregistre, le dépôt l'ignore, et rien ne les confronte. Mesuré le 2026-09-03 :
// **sept migrations des 1ᵉʳ au 3 septembre étaient dans ce cas**, venues de quatre
// sessions différentes, dont celle qui crée toute la surveillance des crons. Personne ne
// l'avait vu.
//
// Le coût n'est pas théorique : deux migrations ultérieures agissaient sur une table
// qu'aucun fichier ne créait, et auraient échoué au rejeu.
//
// ⚠️ Ce n'est PAS un problème de discipline qu'une consigne réglerait. Une consigne
// existait déjà en substance, et sept migrations sont passées à côté en trois jours,
// sans qu'aucune erreur ne se produise jamais. C'est exactement la forme de panne que ce
// projet traque : **une divergence qui ne produit aucun symptôme**.
//
// ── Comment la boucle se ferme ─────────────────────────────────────────────────────
//
//   1. Ce script écrit `lib/migrations-depot.generated.ts` depuis `supabase/migrations/`.
//   2. `npm run prebuild` le rejoue à CHAQUE construction Vercel : la liste vient donc
//      toujours du dépôt poussé, sans que personne ne l'entretienne.
//   3. `/api/sante/alerte-vues` l'inscrit dans `migrations_du_depot`.
//   4. La vue `migrations_sante` compare avec `supabase_migrations.schema_migrations`,
//      et l'alerte part par le même e-mail quotidien que les autres.
//
// ⚠️ La base ne peut pas lire le dépôt, et le dépôt ne peut pas lire la base : la seule
// façon de les confronter est de faire passer l'un chez l'autre. C'est le même pont que
// pour `edge_sante_version`, et il est fait de la même matière.

import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠️ `fileURLToPath` et non `new URL(...).pathname` : le chemin du projet contient une
// espace, que `pathname` rendrait encodée en `%20`.
const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIER = join(RACINE, 'supabase', 'migrations');
const SORTIE = join(RACINE, 'lib', 'migrations-depot.generated.ts');

// Le nom d'un fichier de migration commence par son horodatage : `20260903180000_nom.sql`.
// C'est cet horodatage que Supabase enregistre dans `schema_migrations.version`.
const fichiers = readdirSync(DOSSIER)
  .filter(f => f.endsWith('.sql'))
  .map(f => {
    const m = /^(\d{14})_(.+)\.sql$/.exec(f);
    if (!m) {
      // ⚠️ On refuse plutôt que d'ignorer : un fichier hors convention ne serait jamais
      // rapproché de sa ligne en base, et apparaîtrait à tort comme « appliquée sans
      // fichier ». Une alerte permanente est une alerte qu'on n'ouvre plus.
      throw new Error(
        `nom de migration hors convention : ${f}\n`
        + 'Attendu : <14 chiffres>_<nom>.sql — c\'est l\'horodatage que Supabase enregistre.',
      );
    }
    return { version: m[1], nom: m[2] };
  })
  .sort((a, b) => a.version.localeCompare(b.version));

const contenu = `// GENERE — ne pas modifier a la main.
//
// Reecrit par \`npm run manifeste-migrations\`, et automatiquement par \`npm run prebuild\`
// (donc a chaque construction Vercel). Le motif est dans l'en-tete de
// \`scripts/manifeste-migrations.mjs\` : la base ne peut pas lire le depot, cette liste
// est le pont qui permet a \`migrations_sante\` de signaler une migration appliquee sans
// fichier.

export const MIGRATIONS_DEPOT: { version: string; nom: string }[] = [
${fichiers.map(f => `  { version: '${f.version}', nom: '${f.nom}' },`).join('\n')}
];
`;

writeFileSync(SORTIE, contenu, 'utf8');
console.log(`${fichiers.length} migrations listees -> lib/migrations-depot.generated.ts`);
console.log(`plus ancienne : ${fichiers[0]?.version}   plus recente : ${fichiers.at(-1)?.version}`);
