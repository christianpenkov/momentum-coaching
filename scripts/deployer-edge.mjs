#!/usr/bin/env node
// Deploiement d'une Edge Function : verification de types, empreinte, envoi.
//
//   npm run deployer-edge <nom> [-- <flags supabase supplementaires>]
//
// ── Pourquoi une commande et pas trois ─────────────────────────────────────────────
//
// AGENTS.md demande deja `npx deno check` avant tout deploiement, parce que ni `tsc` ni
// `npm run build` ne couvrent `supabase/functions/`. Et depuis le 2026-09-03, il faut en
// plus regenerer `lib/empreintes-edge.generated.ts` pour que la fonction remonte
// l'empreinte de ce qu'on lui envoie.
//
// Trois gestes a tenir, c'est un geste oublie. Un seul, c'est un seul.
//
// ⚠️ L'ORDRE compte : l'empreinte est regeneree AVANT l'envoi, sinon la fonction
// remonterait la valeur precedente et l'alerte partirait le lendemain pour rien.
//
// ⚠️ `--no-verify-jwt` est deduit du code, pas suppose. Une fonction appelee par
// cron-job.org porte son propre secret (`CRON_SECRET`) : elle ne peut pas exiger un JWT
// Supabase, sinon le planificateur recoit un 401 et le cron meurt en silence — panne
// deja rencontree sur ce projet. Une fonction qui ne lit aucun secret de cron garde la
// verification du JWT ; l'ajouter « au cas ou » ouvrirait un endpoint public.
//
// ⚠️ La copie de travail est envoyee telle quelle. Si elle porte le travail en cours
// d'une autre session, ce travail PART EN PRODUCTION. Le script le dit avant d'envoyer,
// et la marche a suivre pour deployer le code commite seulement est rappelee ci-dessous
// (arbre de travail temporaire).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigerBonneCible } from './verifier-cible.mjs';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ⚠️ La reference du projet vient de PROJET.json, jamais d'une constante ici. Une
// constante en dur et un lien CLI peuvent designer deux projets differents sans que
// rien ne le dise : le deploiement reussit, ailleurs. `exigerBonneCible` refuse de
// partir tant que les pointeurs locaux ne designent pas tous le projet declare.
exigerBonneCible('Le deploiement');
const REF_PROJET = JSON.parse(readFileSync(join(RACINE, 'PROJET.json'), 'utf8')).supabase_ref;

const [nom, ...flagsSupplementaires] = process.argv.slice(2);
if (!nom) {
  console.error('usage : npm run deployer-edge <nom-de-la-fonction>');
  process.exit(1);
}

const entree = join(RACINE, 'supabase', 'functions', nom, 'index.ts');
if (!existsSync(entree)) {
  console.error(`fonction inconnue : ${nom} (pas de supabase/functions/${nom}/index.ts)`);
  process.exit(1);
}

const lancer = (cmd, args, quoi) => {
  console.log(`\n▸ ${quoi}\n  ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: RACINE, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`\n✗ ${quoi} a echoue — rien n'a ete deploye.`);
    process.exit(r.status ?? 1);
  }
};

// ── 1. La copie de travail porte-t-elle du travail non commite ? ────────────────────
let sale = [];
try {
  sale = execFileSync('git', ['status', '--porcelain', '--', `supabase/functions/${nom}`, 'supabase/functions/_shared', 'lib'], {
    cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).split('\n').map(l => l.trim()).filter(Boolean)
    // Le fichier genere est reecrit par ce script lui-meme : le signaler serait du bruit.
    .filter(l => !l.endsWith('lib/empreintes-edge.generated.ts'));
} catch { /* hors depot git : on continue, ce n'est pas bloquant */ }

if (sale.length) {
  console.log('\n⚠️  La copie de travail n\'est pas propre sur le perimetre de cette fonction :');
  for (const l of sale) console.log(`     ${l}`);
  console.log('\n   Ce code PARTIRA en production, y compris le travail en cours d\'une autre session.');
  console.log('   Pour n\'envoyer que le code commite, deployer depuis un arbre de travail temporaire :');
  console.log('     git worktree add --detach /tmp/wt HEAD');
  console.log(`     cd /tmp/wt && npm run deployer-edge ${nom}`);
  console.log('     git worktree remove --force /tmp/wt');
}

// ── 2. Verification de types (ni tsc ni next build ne couvrent ce dossier) ──────────
//
// ⚠️ AUCUNE echappatoire, et c'est le fruit d'une lecon du 2026-09-03.
//
// Ce script a porte pendant deux heures un flag `--ignorer-deno-check`, ajoute parce que
// `installment-reminders` echouait la verification « a cause d'une dependance distante,
// pas de son code » — un diagnostic exact, et une conclusion fausse. La session Paiements
// a corrige la cause en DEUX lignes : l'import `jsr:@supabase/functions-js/edge-runtime.d.ts`
// n'apportait rien (Deno type deja `Deno.serve`) et `jsr:@supabase/supabase-js@2` tirait
// `npm:@supabase/realtime-js` sur le meme mur. Les neuf autres fonctions importaient
// deja `https://esm.sh/@supabase/supabase-js@2`, qui embarque ses dependances : la vraie
// anomalie etait qu'il restait DEUX sources differentes pour onze fonctions.
//
// Les onze passent desormais. Un contournement pose « pour le cas connu » aurait donc
// masque une dette de divergence, et surtout il aurait survecu a sa raison d'etre — le
// jour ou quelqu'un le rejoue sur une vraie erreur de types, personne ne s'en apercoit.
//
// Regle qui en sort : quand une verification obligatoire echoue, corriger la cause. Une
// verification qu'on peut desactiver n'est plus une verification, c'est une formalite.
lancer('npx', ['deno', 'check', `supabase/functions/${nom}/index.ts`], 'deno check');

const flagsPourSupabase = flagsSupplementaires;

// ── 3. Empreinte, AVANT l'envoi ─────────────────────────────────────────────────────
lancer('node', ['scripts/empreintes-edge.mjs'], 'empreintes du code source');

const genere = readFileSync(join(RACINE, 'lib', 'empreintes-edge.generated.ts'), 'utf8');
const trouvee = genere.match(new RegExp(`'${nom}':\\s*'([0-9a-f]+)'`));
if (!trouvee) {
  console.error(`\n✗ aucune empreinte generee pour ${nom} — le script d'empreintes ne l'a pas vue.`);
  process.exit(1);
}
console.log(`\n  empreinte deployee : ${trouvee[1]}`);

// ── 4. Envoi ────────────────────────────────────────────────────────────────────────
const litSecretDeCron = /CRON_SECRET/.test(readFileSync(entree, 'utf8'));
const flags = [
  'supabase', 'functions', 'deploy', nom,
  '--project-ref', REF_PROJET,
  ...(litSecretDeCron ? ['--no-verify-jwt'] : []),
  ...flagsPourSupabase,
];
if (litSecretDeCron) {
  console.log('  --no-verify-jwt : la fonction lit CRON_SECRET, elle porte donc son propre controle.');
} else {
  console.log('  verification du JWT conservee : aucun CRON_SECRET dans le code.');
}
lancer('npx', flags, `deploiement de ${nom}`);

console.log(`\n✓ ${nom} deploye avec l'empreinte ${trouvee[1]}.`);
console.log('  Verifier demain matin : select * from edge_sante_version;  (aucune ligne ALERTE%)');
console.log('  Ou tout de suite, apres un passage du cron : la colonne `empreinte_en_ligne` doit valoir cette valeur.');

// ── Le fichier d'empreintes reste-t-il a commiter ? ─────────────────────────────────
//
// ⚠️ Ce rappel existe parce que le cas s'est produit des le premier usage : la session
// Crons a instrumente deux Edge Functions, deploye correctement (donc regenere), et
// commite les fichiers modifies SANS le fichier d'empreintes — que rien ne lui demandait
// de commiter. Le depot a alors porte deux empreintes perimees pendant une heure.
//
// Sans consequence ce jour-la (Vercel recalcule a chaque construction, et cette commande
// aussi), mais c'est un mensonge dans le depot : le premier deploiement fait autrement
// embarquerait la valeur perimee, et l'alerte partirait le lendemain matin.
//
// Le rappel est pose ICI, au moment ou le fichier vient d'etre reecrit et ou la personne
// est encore devant son terminal — pas dans une documentation qu'elle lira plus tard.
// `npm test` porte la meme garde en filet, en mode `--depuis-head`.
try {
  const modifie = execFileSync('git', ['status', '--porcelain', '--', 'lib/empreintes-edge.generated.ts'], {
    cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (modifie) {
    console.log('\n⚠️  `lib/empreintes-edge.generated.ts` a ete reecrit et n\'est PAS commite.');
    console.log('   A commiter avec votre changement, sinon le depot porte une empreinte perimee :');
    console.log('     npm run empreintes-edge -- --depuis-head');
    console.log('     git add lib/empreintes-edge.generated.ts');
    console.log('\n   ⚠️ Bien avec `--depuis-head` : sans lui, la regeneration inscrirait aussi');
    console.log('      les empreintes du travail NON COMMITE des autres sessions.');
  }
} catch { /* hors depot git : rien a rappeler */ }
