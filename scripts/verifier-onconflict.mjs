#!/usr/bin/env node
// Chaque `onConflict` du code doit viser un index unique COMPLET de la base.
//
// ── Pourquoi ce contrôle existe ────────────────────────────────────────────────────
//
// Le 2026-09-13 : aucun rendez-vous Calendly ne s'écrivait plus depuis le 2026-09-07. La
// migration d'isolation par élève avait posé un index unique PARTIEL (`where
// calendly_event_uuid is not null`), et Postgres ne sait pas inférer un index partiel dans
// `ON CONFLICT (coach_id, calendly_event_uuid)` sans son prédicat : erreur 42P10 à chaque
// écriture, jamais lue, rendez-vous compté « synchronisé ». Six jours de rendez-vous perdus.
//
// Aucun outil ne pouvait le voir : la divergence est entre une CHAÎNE du code et un INDEX
// de la base. Ce script lit les deux. Il tourne dans `npm test`.
//
// ⚠️ Même règle que `verifier-migrations.mjs` : sans base joignable, il le DIT et ne fait
// pas échouer les tests — un test rouge pour une coupure réseau est un test qu'on apprend
// à ignorer. « Pas vérifié » n'est jamais écrit comme un succès.
//
// ⚠️ On pose `process.exitCode`, jamais `process.exit()` (plantage libuv sous Windows après
// un fetch — voir l'en-tête de verifier-migrations.mjs).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIERS = ['app', 'lib', 'components', 'supabase/functions'];
const IGNORES = new Set(['node_modules', '.next', 'graphify-out']);

// Routes de TEST, hors de tout chemin de production. Chaque entrée dit pourquoi.
// ⚠️ Ne jamais y ajouter une route réelle pour faire passer le contrôle : la correction
// est d'écrire l'index complet, pas d'excuser l'appel.
const EXCEPTIONS = new Map([
  ['instagram_leads|profile_id,source,ig_user_id,keyword_matched,media_id',
    'app/api/instagram/test-full-workflow — route de test manuelle, jamais appelée en production'],
]);

function* fichiers(dossier) {
  for (const nom of readdirSync(dossier)) {
    if (IGNORES.has(nom)) continue;
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) yield* fichiers(chemin);
    else if (/\.(ts|tsx)$/.test(nom) && !/\.test\.ts$/.test(nom)) yield chemin;
  }
}

function variableEnv(nom) {
  let brut;
  try { brut = readFileSync(join(RACINE, '.env.local'), 'utf8'); } catch { return null; }
  for (const ligne of brut.split('\n')) {
    if (ligne.trimStart().startsWith('#')) continue;
    const i = ligne.indexOf('=');
    if (i < 0 || ligne.slice(0, i).trim() !== nom) continue;
    return ligne.slice(i + 1).trim().replace(/\r$/, '').replace(/^"|"$/g, '');
  }
  return null;
}

// ── Extraction : la table est le dernier `.from('…')` qui précède l'`onConflict` ──────
// Les lignes de commentaire sont retirées d'abord : un commentaire qui CITE un ancien
// `onConflict` (pour expliquer pourquoi on ne l'utilise plus) n'est pas un appel.
const paires = new Map();
for (const d of DOSSIERS) {
  let racine;
  try { racine = join(RACINE, d); statSync(racine); } catch { continue; }
  for (const f of fichiers(racine)) {
    const texte = readFileSync(f, 'utf8').split('\n').map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l)).join('\n');
    const re = /onConflict:\s*["'`]([^"'`]+)["'`]/g;
    let m;
    while ((m = re.exec(texte))) {
      const avant = texte.slice(Math.max(0, m.index - 2_500), m.index);
      const froms = [...avant.matchAll(/\.from\(\s*["']([a-z_]+)["']\s*\)/g)];
      if (!froms.length) continue;
      const cle = `${froms.at(-1)[1]}|${m[1].replace(/\s/g, '')}`;
      const ligne = texte.slice(0, m.index).split('\n').length;
      paires.set(cle, [...(paires.get(cle) ?? []), `${relative(RACINE, f).replace(/\\/g, '/')}:${ligne}`]);
    }
  }
}

class Inconcluant extends Error {}
try {
  const url = variableEnv('NEXT_PUBLIC_SUPABASE_URL');
  const cle = variableEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !cle) throw new Inconcluant('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente de .env.local');

  // Témoin positif : sans aucun couple extrait, l'extraction elle-même est cassée.
  if (paires.size < 10) throw new Inconcluant(`seulement ${paires.size} onConflict extraits du code — extraction douteuse`);

  let manquants;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/cibles_onconflict_sans_index`, {
      method: 'POST',
      headers: { apikey: cle, Authorization: `Bearer ${cle}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_paires: [...paires.keys()].map((k) => { const [tbl, cols] = k.split('|'); return { tbl, cols }; }) }),
    });
    if (!r.ok) throw new Inconcluant(`la base a répondu HTTP ${r.status} (la fonction cibles_onconflict_sans_index existe-t-elle ?)`);
    manquants = await r.json();
  } catch (e) {
    if (e instanceof Inconcluant) throw e;
    throw new Inconcluant(`base injoignable (${e?.message ?? 'erreur réseau'})`);
  }
  if (!Array.isArray(manquants)) throw new Inconcluant('réponse inattendue de la base');

  const vraisManquants = manquants.filter((x) => !EXCEPTIONS.has(`${x.tbl}|${x.cols}`));
  if (vraisManquants.length === 0) {
    console.log(`onConflict verifies (${paires.size} cibles) — chacune a son index unique complet`);
  } else {
    console.error('\n❌ Un `onConflict` vise des colonnes sans index unique COMPLET : chaque écriture échouera (42P10).\n');
    for (const x of vraisManquants) {
      console.error(`   ${x.tbl} (${x.cols})`);
      for (const ou of paires.get(`${x.tbl}|${x.cols}`) ?? []) console.error(`      ← ${ou}`);
    }
    console.error('\n   → Créer `create unique index … on <table> (<colonnes>)` SANS clause `where`.');
    console.error('     Un index partiel n\'est jamais inféré par ON CONFLICT (voir 20260913200000_calls_index_calendly_complet.sql).\n');
    process.exitCode = 1;
  }
} catch (e) {
  if (!(e instanceof Inconcluant)) throw e;
  console.log(`\n⚠️  onConflict : PAS VÉRIFIÉ — ${e.message}. Ce n'est pas un succès.`);
}
