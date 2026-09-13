#!/usr/bin/env node
// Relevé des versions d'API ÉCRITES DANS LE CODE, pour que la base puisse prévenir avant
// qu'elles expirent.
//
// ── Le problème ────────────────────────────────────────────────────────────────────
//
// Meta retire chaque version de la Graph API environ deux ans après sa sortie. Mesuré le
// 2026-09-13 sur l'API réelle : une requête vers une version expirée N'ÉCHOUE PAS, Meta la
// sert avec la plus ancienne version encore active (v19.0 demandée, en-tête
// `facebook-api-version: v20.0` rendu). Le comportement change donc en silence — une
// métrique disparaît, un champ change de forme — exactement le mode de panne qu'aucun
// test ni aucune erreur ne signale.
//
// Le 2026-09-13, trois versions coexistaient dans le code (v21.0, v22.0, v23.0), et la
// plus ancienne expire le 21 janvier 2027.
//
// ── Comment la boucle se ferme ─────────────────────────────────────────────────────
//
//   1. Ce script écrit `lib/versions-api-depot.generated.ts` depuis le code source
//      (Next ET Edge Functions : les deux appellent Meta).
//   2. `npm run prebuild` le rejoue à chaque construction Vercel.
//   3. `/api/sante/dispatch` l'inscrit dans `versions_api_depot`.
//   4. La vue `versions_api_sante` croise avec les dates publiées
//      (`versions_api_expirations`) et alerte à 90 jours.
//
// ⚠️ Même pont que `manifeste-migrations.mjs`, pour la même raison : la base ne lit pas
// le dépôt.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = join(RACINE, 'lib', 'versions-api-depot.generated.ts');
const DOSSIERS = ['app', 'lib', 'components', 'supabase/functions'];
const IGNORES = new Set(['node_modules', '.next', 'graphify-out']);

// Une seule famille d'API versionnée par URL sur ce projet. Stripe se fixe par une date
// que Stripe ne retire pas (docs.stripe.com/upgrades) ; YouTube, Calendly et Short.io ne
// datent pas leurs versions.
const MOTIFS = [
  { fournisseur: 'meta-graph', regex: /graph\.(?:facebook|instagram)\.com\/(v\d+\.\d+)/g },
];

function* fichiersSource(dossier) {
  for (const nom of readdirSync(dossier)) {
    if (IGNORES.has(nom)) continue;
    const chemin = join(dossier, nom);
    const st = statSync(chemin);
    if (st.isDirectory()) yield* fichiersSource(chemin);
    else if (/\.(ts|tsx|js|mjs)$/.test(nom) && !nom.endsWith('.generated.ts') && !/\.test\.ts$/.test(nom)) yield chemin;
  }
}

const releve = new Map(); // clé fournisseur|version → { occurrences, fichiers:Set }
for (const d of DOSSIERS) {
  let racine;
  try { racine = join(RACINE, d); statSync(racine); } catch { continue; }
  for (const f of fichiersSource(racine)) {
    const texte = readFileSync(f, 'utf8');
    for (const { fournisseur, regex } of MOTIFS) {
      for (const m of texte.matchAll(regex)) {
        const cle = `${fournisseur}|${m[1]}`;
        const e = releve.get(cle) ?? { fournisseur, version: m[1], occurrences: 0, fichiers: new Set() };
        e.occurrences++;
        e.fichiers.add(relative(RACINE, f).replace(/\\/g, '/'));
        releve.set(cle, e);
      }
    }
  }
}

const lignes = [...releve.values()]
  .sort((a, b) => a.fournisseur.localeCompare(b.fournisseur) || a.version.localeCompare(b.version, undefined, { numeric: true }))
  .map((e) => ({ fournisseur: e.fournisseur, version: e.version, occurrences: e.occurrences, fichiers: [...e.fichiers].sort() }));

const contenu = `// GENERE — ne pas modifier a la main.
//
// Reecrit par \`node scripts/manifeste-versions-api.mjs\`, et automatiquement par
// \`npm run prebuild\` (donc a chaque construction Vercel). Le motif est dans l'en-tete du
// script : la base ne lit pas le depot, cette liste est le pont qui permet a
// \`versions_api_sante\` de prevenir avant qu'une version d'API expire.

export const VERSIONS_API_DEPOT: { fournisseur: string; version: string; occurrences: number; fichiers: string[] }[] = ${JSON.stringify(lignes, null, 2)};
`;

writeFileSync(SORTIE, contenu, 'utf8');
console.log(`${lignes.length} versions d'API relevees -> lib/versions-api-depot.generated.ts`);
for (const l of lignes) console.log(`  ${l.fournisseur} ${l.version} : ${l.occurrences} occurrence(s) dans ${l.fichiers.length} fichier(s)`);
