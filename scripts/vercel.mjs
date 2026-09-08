#!/usr/bin/env node
// Vercel, mais SEULEMENT pour ce projet.
//
//   npm run vercel -- env ls production
//   npm run vercel -- link
//
// ── Le problème ───────────────────────────────────────────────────────────────────
//
// `vercel login` n'écrit RIEN dans le dossier : il écrit dans
// `%APPDATA%/com.vercel.cli/Data/auth.json`, global à la machine. Mesuré le 2026-09-04 :
// depuis `C:/Users/chris`, un dossier sans aucun rapport, `vercel whoami` répond déjà
// le compte connecté.
//
// Conséquence, le jour où ce projet vit sur le compte de quelqu'un d'autre : se
// connecter avec SES identifiants ferait basculer **tous les dossiers de la machine**
// sur son compte — y compris les autres projets, qui n'ont rien demandé. Et l'inverse
// est vrai aussi : une session ouverte pour un autre projet piloterait celui-ci.
//
// ── La parade ─────────────────────────────────────────────────────────────────────
//
// Un JETON, porté par ce dossier, au lieu d'une session portée par la machine.
//
//   1. Le propriétaire du projet le crée UNE fois, limité à ce projet :
//        npx vercel tokens add "chris-momentum" --project momentum-plateforme
//   2. On le range dans `.vercel-token` à la racine (ignoré par git).
//   3. Toutes les commandes passent par `npm run vercel --`.
//
// Le jeton étant créé avec `--project`, il ne peut RIEN toucher d'autre que ce projet,
// même utilisé par erreur ailleurs. La portée est donc garantie des deux côtés : par le
// dossier ici, et par le jeton chez Vercel.
//
// ⚠️ Sans jeton, on ne bloque pas : on retombe sur la session globale, en DISANT
// laquelle. Un repli silencieux ferait exactement ce que ce script existe pour empêcher
// — agir sous une identité que personne n'a choisie.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigerBonneCible } from './verifier-cible.mjs';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Le dossier doit désigner le bon projet AVANT qu'une commande parte.
exigerBonneCible('La commande Vercel');

const declare = JSON.parse(readFileSync(join(RACINE, 'PROJET.json'), 'utf8'));

/** Jeton : variable d'environnement d'abord, puis le fichier local. */
function lireJeton() {
  const parEnv = (process.env.VERCEL_TOKEN || '').trim();
  if (parEnv) return { jeton: parEnv, source: 'variable VERCEL_TOKEN' };

  const fichier = join(RACINE, '.vercel-token');
  if (existsSync(fichier)) {
    // Tolère un fichier écrit en `VERCEL_TOKEN=...` comme un fichier ne contenant que la valeur.
    const brut = readFileSync(fichier, 'utf8').trim();
    const jeton = (brut.match(/^(?:VERCEL_TOKEN\s*=\s*)?(.+)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
    if (jeton) return { jeton, source: '.vercel-token' };
  }
  return { jeton: null, source: null };
}

const { jeton, source } = lireJeton();
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('usage : npm run vercel -- <commande vercel>   (ex. env ls production)');
  process.exit(1);
}

console.log(`\n▸ projet   : ${declare.nom} (${declare.vercel_project_name})`);
if (jeton) {
  // Jamais la valeur : de quoi la reconnaître, pas de quoi la réutiliser.
  console.log(`▸ identite : jeton de ${source} (…${jeton.slice(-4)}), portee limitee a ce projet`);
} else {
  console.log('▸ identite : ⚠️  SESSION GLOBALE de la machine — aucun jeton local.');
  console.log('             C\'est valable si vous etes membre de l\'equipe avec VOTRE compte.');
  console.log('             Ca ne l\'est PAS si vous utilisez le compte d\'un tiers : posez');
  console.log('             alors un jeton dans .vercel-token (voir l\'en-tete de ce script).');
}
console.log(`▸ commande : vercel ${args.join(' ')}\n`);

// ── `env pull` écrase .env.local, et emporte ce que Vercel ne connaît pas ──────────
//
// `MOMENTUM_REDIRECT_ORIGIN` a été ajoutée à la main sous la ligne « Created by Vercel
// CLI » : un `env pull` la fait disparaître SANS RIEN DIRE, et le script de réécriture
// des liens Short.io n'écrit alors plus rien vers nulle part. On sauvegarde d'abord, et
// on dit ce qui a disparu — plutôt que de découvrir l'absence trois semaines plus tard.
if (args[0] === 'env' && args[1] === 'pull') {
  const envLocal = join(RACINE, '.env.local');
  if (existsSync(envLocal)) {
    const avant = readFileSync(envLocal, 'utf8');
    const sauvegarde = join(RACINE, `.env.local.avant-pull`);
    writeFileSync(sauvegarde, avant);
    console.log(`▸ sauvegarde : .env.local -> .env.local.avant-pull\n`);
    process.on('exit', () => {
      let apres = '';
      try { apres = readFileSync(envLocal, 'utf8'); } catch { return; }
      const cles = t => new Set([...t.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)].map(m => m[1]));
      const perdues = [...cles(avant)].filter(c => !cles(apres).has(c));
      if (perdues.length) {
        console.log(`\n⚠️  ${perdues.length} variable(s) presente(s) avant et ABSENTE(S) apres :`);
        for (const c of perdues) console.log(`      ${c}`);
        console.log('    Elles ne viennent pas de Vercel — les remettre a la main.');
        console.log('    Copie intacte : .env.local.avant-pull\n');
      }
    });
  }
}

const r = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vercel', ...args],
  {
    cwd: RACINE,
    stdio: 'inherit',
    // Le jeton ne passe QUE par l'environnement du processus fils : il n'apparaît ni
    // dans la ligne de commande, ni dans l'historique du terminal, ni dans la liste
    // des processus.
    env: jeton ? { ...process.env, VERCEL_TOKEN: jeton } : process.env,
  },
);

process.exit(r.status ?? 1);
