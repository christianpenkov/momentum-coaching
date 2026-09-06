#!/usr/bin/env node
// Reclasse `analytics_yt_videos_history.is_short` avec la source AUTORITAIRE.
//
// ── Pourquoi ce script existe ─────────────────────────────────────────────────
//
// Jusqu'au 2026-09-06, deux chemins classaient les videos par une heuristique de
// duree, avec un seuil de 60 s perime (YouTube autorise 3 min depuis fin 2024) et
// une divergence a 60 s pile entre les deux. Mesure sur la chaine de test :
// 10 videos sur 32 mal classees, toutes des Shorts etiquetes « video longue ».
//
// Corriger le code ne suffit pas : le cron n'ecrit qu'une ligne par video et par
// jour, donc les 3 475 lignes deja ecrites resteraient fausses, et l'ecran de
// stats continuerait de les afficher en mode historique. C'est la regle du
// projet : apres un correctif d'ecriture fausse, on backfille les lignes deja
// ecrites avec la valeur que le nouveau code aurait produite.
//
// ── Ce qu'il fait ─────────────────────────────────────────────────────────────
//
// Pour chaque profil ayant une integration YouTube : rafraichit le jeton,
// demande a l'API Analytics la liste des videos par format (deux requetes
// filtrees, cf. lib/youtubeShorts.ts), et corrige les lignes qui divergent.
//
// La regle est IMPORTEE, jamais recopiee : ce script doit donner exactement le
// meme verdict que le cron et que la route en direct.
//
// ⚠️ Un profil SANS integration YouTube (chaine deconnectee) ne peut pas etre
// classe de facon autoritaire. Ses lignes sont laissees telles quelles : les
// corriger a la duree seule reintroduirait l'heuristique qu'on vient de retirer,
// et elle se trompe (mesure : 3 fois sur 32 meme avec le seuil correct).
//
// ── Usage ─────────────────────────────────────────────────────────────────────
//
//   node scripts/reclasser-shorts-youtube.mjs            # simulation (defaut)
//   node scripts/reclasser-shorts-youtube.mjs --appliquer # ecrit en base

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estUnShort, parametresClassification, MAX_RESULTS_CLASSIFICATION } from '../lib/youtubeShorts.ts';

// ⚠️ `fileURLToPath` et non `new URL(...).pathname` : le chemin du projet contient
// une espace, que `pathname` rend encodee en `%20`.
const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPLIQUER = process.argv.includes('--appliquer');

function lireEnv() {
  const env = {};
  for (const l of readFileSync(join(RACINE, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    // Les guillemets autour d'une valeur .env sont des delimiteurs, pas du contenu.
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = lireEnv();
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const enTetes = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };

async function rest(chemin, options = {}) {
  const r = await fetch(`${SB}/rest/v1/${chemin}`, { headers: enTetes, ...options });
  if (!r.ok) throw new Error(`${chemin} -> HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.status === 204 ? null : r.json();
}

/**
 * Lecture PAGINEE.
 *
 * ⚠️ PostgREST plafonne une reponse a 1000 lignes SANS LE DIRE — ni erreur, ni
 * indicateur de troncature. Une premiere version de ce script lisait donc 1000
 * des 1868 lignes d'un profil et ne voyait que 22 de ses 32 videos : les
 * manquantes n'auraient jamais ete corrigees, et rien ne l'aurait signale.
 *
 * Le meme piege est documente dans supabase/functions/_shared/ig-posts.ts, ou il
 * avait deja tronque une lecture en silence.
 */
async function lireTout(construireChemin) {
  const PAS = 1000;
  const tout = [];
  for (let debut = 0; ; debut += PAS) {
    const lot = await rest(`${construireChemin}&offset=${debut}&limit=${PAS}`);
    tout.push(...lot);
    if (lot.length < PAS) return tout;
  }
}

async function jetonFrais(refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
    }),
  });
  return (await r.json())?.access_token ?? null;
}

async function verdictPour(token) {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const verdict = { shorts: new Set(), longues: new Set() };
  for (const [format, cible] of [['shorts', verdict.shorts], ['videoOnDemand', verdict.longues]]) {
    const r = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?${parametresClassification(format, '2020-01-01', aujourdhui)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) throw new Error(`analytics ${format} -> HTTP ${r.status}`);
    for (const row of (await r.json())?.rows || []) cible.add(row[0]);
  }
  if (verdict.shorts.size >= MAX_RESULTS_CLASSIFICATION || verdict.longues.size >= MAX_RESULTS_CLASSIFICATION) {
    console.warn(`  ⚠️ plafond de ${MAX_RESULTS_CLASSIFICATION} atteint — des videos peuvent manquer.`);
  }
  return verdict;
}

const integrations = await rest('integrations?provider=eq.youtube&select=profile_id,refresh_token');
console.log(`${integrations.length} integration(s) YouTube.${APPLIQUER ? '' : '  (SIMULATION — rien ne sera ecrit)'}\n`);

let totalLignes = 0;
for (const { profile_id, refresh_token } of integrations) {
  console.log(`profil ${profile_id}`);
  if (!refresh_token) { console.log('  pas de refresh_token — ignore.\n'); continue; }

  const token = await jetonFrais(refresh_token);
  if (!token) { console.log('  rafraichissement du jeton refuse — ignore.\n'); continue; }

  const verdict = await verdictPour(token);
  console.log(`  API : ${verdict.shorts.size} shorts, ${verdict.longues.size} longues.`);

  // Une ligne par (video, date). On corrige par VIDEO, pas ligne a ligne : le
  // format d'une video ne change pas d'un jour a l'autre.
  const lignes = await lireTout(`analytics_yt_videos_history?profile_id=eq.${profile_id}&select=video_id,is_short,duration_sec&order=video_id`);
  const parVideo = new Map();
  for (const l of lignes) {
    if (!parVideo.has(l.video_id)) parVideo.set(l.video_id, { dur: l.duration_sec, actuel: !!l.is_short, lignes: 0 });
    parVideo.get(l.video_id).lignes++;
  }

  const aCorriger = [];
  for (const [videoId, v] of parVideo) {
    const attendu = estUnShort(videoId, v.dur, verdict);
    if (attendu !== v.actuel) aCorriger.push({ videoId, attendu, ...v });
  }

  console.log(`  ${parVideo.size} videos, ${lignes.length} lignes — ${aCorriger.length} video(s) mal classee(s).`);
  for (const c of aCorriger) {
    console.log(`    ${c.videoId}  dur=${c.dur}s  ${c.actuel} -> ${c.attendu}  (${c.lignes} lignes)`);
    totalLignes += c.lignes;
    if (APPLIQUER) {
      await rest(`analytics_yt_videos_history?profile_id=eq.${profile_id}&video_id=eq.${c.videoId}`, {
        method: 'PATCH',
        headers: { ...enTetes, Prefer: 'return=minimal' },
        body: JSON.stringify({ is_short: c.attendu }),
      });
    }
  }
  console.log('');
}

console.log(APPLIQUER
  ? `✓ ${totalLignes} ligne(s) corrigee(s).`
  : `${totalLignes} ligne(s) seraient corrigees. Relancer avec --appliquer.`);
