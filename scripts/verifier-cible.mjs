#!/usr/bin/env node
// Verifie que ce poste est branche sur LE bon projet, et pas sur un autre.
//
//   npm run verifier-cible
//
// ── Le probleme qu'il resout ──────────────────────────────────────────────────────
//
// Les outils en ligne de commande gardent leur session dans le compte, pas dans le
// dossier : une seule connexion Supabase, une seule connexion Vercel, valables pour
// TOUS les projets du compte. Le dossier ne porte qu'un pointeur — `.vercel/project.json`,
// `supabase/.temp/project-ref`, `.env.local`, le remote git — et rien ne garantit que ces
// quatre pointeurs designent le meme projet.
//
// Un pointeur qui designe un AUTRE projet ne produit aucune erreur : la commande reussit,
// et elle reussit ailleurs. C'est le pire mode de panne possible — un deploiement qui part
// dans le mauvais projet, ou une reecriture de liens qui touche le compte d'un autre.
//
// Le risque grandit avec le nombre de projets ouverts sur le poste, et il devient certain
// le jour d'un transfert de compte : les pointeurs sont alors TOUS a repointer, et il
// suffit d'en oublier un.
//
// ── Le choix ──────────────────────────────────────────────────────────────────────
//
// L'identite est DECLAREE une fois dans PROJET.json, versionnee, et tout le reste est
// verifie contre elle. Un desaccord arrete la commande au lieu de la laisser reussir
// ailleurs.
//
// ⚠️ Un pointeur ABSENT n'est pas une erreur — il veut dire « pas encore relie », ce qui
// echoue tout seul et bruyamment au moment de s'en servir. Seul un pointeur PRESENT et
// DIFFERENT est une contamination, et c'est la seule chose que ce script refuse. Exiger
// une installation locale complete ferait echouer la verification chez quelqu'un qui ne
// deploie pas, donc ferait desactiver la verification.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function lireJson(chemin) {
  try {
    return JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    return null;
  }
}

function lireTexte(chemin) {
  try {
    return readFileSync(chemin, 'utf8').trim();
  } catch {
    return null;
  }
}

/** Valeur d'une variable dans un fichier .env, guillemets retires. */
function lireEnv(chemin, cle) {
  const contenu = lireTexte(chemin);
  if (!contenu) return null;
  for (const ligne of contenu.split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m || m[1] !== cle) continue;
    return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

/**
 * Compare chaque pointeur local a l'identite declaree.
 * Rend { ecarts, controles } : `ecarts` vide = rien de contamine.
 */
export function verifierCible({ racine = RACINE } = {}) {
  const declare = lireJson(join(racine, 'PROJET.json'));
  if (!declare) {
    return {
      declare: null,
      controles: [],
      ecarts: [{
        quoi: 'PROJET.json',
        attendu: 'un fichier lisible a la racine du depot',
        trouve: 'absent ou illisible',
        pourquoi: "c'est la seule declaration d'identite du projet ; sans elle rien ne peut etre verifie",
      }],
    };
  }

  const controles = [];
  const ecarts = [];

  /** absent → on n'en parle pas ; present et different → ecart. */
  const comparer = (quoi, trouve, attendu, pourquoi, contient = false) => {
    if (trouve === null || trouve === undefined || trouve === '') return;
    const ok = contient ? trouve.includes(attendu) : trouve === attendu;
    controles.push({ quoi, ok, trouve });
    if (!ok) ecarts.push({ quoi, attendu, trouve, pourquoi });
  };

  // 1. Le lien du CLI Supabase — gouverne `supabase functions deploy`, `db dump`…
  comparer(
    'supabase/.temp/project-ref',
    lireTexte(join(racine, 'supabase', '.temp', 'project-ref')),
    declare.supabase_ref,
    'un deploiement d\'Edge Function ou un dump partirait vers un autre projet',
  );

  // 2. L'URL Supabase de .env.local — gouverne tous les scripts locaux qui lisent la base.
  comparer(
    '.env.local → NEXT_PUBLIC_SUPABASE_URL',
    lireEnv(join(racine, '.env.local'), 'NEXT_PUBLIC_SUPABASE_URL'),
    declare.supabase_ref,
    'les scripts locaux liraient et ecriraient dans une autre base',
    true,
  );

  // 3. Le lien du CLI Vercel — gouverne `vercel env`, `vercel deploy`, `vercel link`.
  const vercel = lireJson(join(racine, '.vercel', 'project.json'));
  comparer(
    '.vercel/project.json → projectId',
    vercel?.projectId ?? null,
    declare.vercel_project_id,
    'les variables d\'environnement lues ou posees viseraient un autre projet',
  );
  comparer(
    '.vercel/project.json → orgId',
    vercel?.orgId ?? null,
    declare.vercel_org_id,
    'le projet serait cherche dans une autre equipe',
  );

  // 4. Le remote git — gouverne le deploiement, puisque Vercel deploie sur push.
  let remote = null;
  try {
    remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    remote = null; // pas un depot git, ou pas de remote : rien a verifier
  }
  // .git est tolere a la fin, GitHub sert les deux formes.
  comparer(
    'git remote origin',
    remote ? remote.replace(/\.git$/, '') : null,
    String(declare.git_remote).replace(/\.git$/, ''),
    'un `git push` irait dans un autre depot, donc deploierait un autre projet',
  );

  return { declare, controles, ecarts };
}

/** Version bloquante, a appeler au debut de toute commande qui ECRIT quelque part. */
export function exigerBonneCible(quoi = 'cette commande') {
  const { declare, ecarts } = verifierCible();
  if (ecarts.length === 0) return;

  console.error(`\n🛑 ${quoi} est ANNULEE : ce dossier n'est pas branche sur le bon projet.\n`);
  console.error(`   Projet declare dans PROJET.json : ${declare?.nom ?? '(inconnu)'}\n`);
  for (const e of ecarts) {
    console.error(`   ✗ ${e.quoi}`);
    console.error(`       attendu : ${e.attendu}`);
    console.error(`       trouve  : ${e.trouve}`);
    console.error(`       risque  : ${e.pourquoi}\n`);
  }
  console.error('   Deux causes possibles, et une seule bonne reponse a chacune :\n');
  console.error('   • le poste a ete relie a un autre projet   → relier celui-ci :');
  console.error('       npx vercel link          (choisir l\'equipe puis le projet declare)');
  console.error('       npx supabase link --project-ref <ref declare>');
  console.error('       git remote set-url origin <remote declare>\n');
  console.error('   • le projet a VRAIMENT change de compte    → mettre PROJET.json a jour,');
  console.error('     et suivre docs/transfert-de-compte.md.\n');
  console.error('   ⚠️ Ne jamais contourner ce controle en modifiant PROJET.json « pour que ca');
  console.error('      passe » : c\'est la declaration d\'identite, pas un parametre de confort.\n');
  process.exit(1);
}

// ── Execution directe ───────────────────────────────────────────────────────────────

const executeDirectement = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (executeDirectement) {
  const { declare, controles, ecarts } = verifierCible();
  console.log(`\nProjet declare : ${declare?.nom ?? '(PROJET.json illisible)'}\n`);
  if (controles.length === 0 && ecarts.length === 0) {
    console.log('  (aucun pointeur local present — rien a verifier)\n');
  }
  for (const c of controles) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.quoi}`);
  }
  if (ecarts.length === 0) {
    console.log('\n✅ Tous les pointeurs presents designent le projet declare.\n');
    process.exit(0);
  }
  exigerBonneCible('la verification');
}
