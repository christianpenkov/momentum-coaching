#!/usr/bin/env node
/**
 * Redate `deals.signed_at` sur la règle qui vaut depuis le 2026-09-01 : la date de
 * TENUE du PREMIER rendez-vous de la chaîne d'opportunité.
 *
 * Les ventes créées AVANT cette règle portent l'instant de saisie du rapport. Le
 * chemin d'écriture (`app/api/payments/links/route.ts`) applique la règle depuis, donc
 * seules les anciennes lignes sont concernées et ce script n'a pas vocation à
 * resservir — sauf si une correction manuelle en base réintroduit une date fausse,
 * ce que `ventes_sante_date` signale.
 *
 * ⚠️ Il appelle la MÊME fonction que l'écriture et que les écrans : `dateDeVente`
 * (`lib/callSeries.ts`). Réécrire la règle en SQL pour l'occasion créerait une
 * troisième version de la même règle, et c'est exactement ce qu'on cherche à éviter.
 * Il constitue aussi le lot de rendez-vous de la même façon que la route d'écriture :
 * par `prospect_id`, avec repli sur l'e-mail.
 *
 * Usage :
 *   node scripts/redater-ventes.mjs               # simulation, n'écrit rien
 *   node scripts/redater-ventes.mjs --appliquer   # écrit
 *
 * Le script LISTE toujours ce qu'il va faire avant de le faire.
 *
 * Voir docs/perimetre-stats-referentiel.md, règle 7.
 */

import { readFileSync } from 'node:fs';
import { dateDeVente } from '../lib/callSeries.ts';

// ── Environnement ───────────────────────────────────────────────────────────

function chargerEnv(fichier) {
  let contenu;
  try {
    contenu = readFileSync(fichier, 'utf8');
  } catch {
    return {};
  }
  const env = {};
  for (const ligne of contenu.split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = { ...chargerEnv(new URL('../.env.local', import.meta.url)), ...process.env };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.');
  process.exit(1);
}

const APPLIQUER = process.argv.includes('--appliquer');

async function api(chemin, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`${r.status} ${chemin} — ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// ── Lecture ─────────────────────────────────────────────────────────────────

const deals = await api('deals?select=id,profile_id,call_id,signed_at,amount_total,buyer_name,status&call_id=not.is.null&order=signed_at');
const calls = await api('calls?select=id,coach_id,prospect_id,invitee_email,invitee_name,scheduled_at,booked_at,outcome,ignored');
const parId = new Map(calls.map(c => [c.id, c]));

// ── Le mois et la semaine Paris, pour savoir si un écran bougera ────────────

const moisParis = iso => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).format(new Date(iso));
const jourParis = iso => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', dateStyle: 'short' }).format(new Date(iso));
// Le lundi de la semaine Paris — les fenêtres de `lib/period.ts` sont calendaires.
function semaineParis(iso) {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const lundi = new Date(d);
  lundi.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return lundi.toISOString().slice(0, 10);
}

const MAINTENANT = new Date();
const REPLI = MAINTENANT.toISOString();

const aChanger = [];
const inchanges = [];
const replis = [];

for (const d of deals) {
  const call = parId.get(d.call_id);
  if (!call) { inchanges.push({ d, motif: 'rendez-vous introuvable' }); continue; }

  // Le lot, constitué comme dans la route d'écriture : la fiche persistante d'abord,
  // l'e-mail seulement si elle n'existe pas.
  const critere = call.prospect_id
    ? c => c.prospect_id === call.prospect_id
    : (call.invitee_email ? c => c.invitee_email === call.invitee_email : null);
  let lot = [call];
  if (critere) {
    const fratrie = calls.filter(c => c.coach_id === call.coach_id && c.ignored !== true && critere(c));
    if (fratrie.length) lot = fratrie.some(c => c.id === d.call_id) ? fratrie : [...fratrie, call];
  }

  const neuf = dateDeVente(lot, d.call_id, MAINTENANT);
  if (neuf === REPLI) { replis.push({ d, motif: 'aucun rendez-vous tenu — la règle replierait sur aujourd hui' }); continue; }
  // Comparer les INSTANTS, jamais les chaînes : Postgres rend
  // `2026-06-15 16:10:00+00` là où `toISOString()` produit
  // `2026-06-15T16:10:00.000Z`. Le même moment, deux écritures — une comparaison
  // textuelle déclarait « à redater » quatre lignes déjà justes, avec 0 h d'écart.
  if (new Date(neuf).getTime() === new Date(d.signed_at).getTime()) {
    inchanges.push({ d, motif: 'déjà conforme' });
    continue;
  }

  aChanger.push({
    d, neuf,
    heures: (new Date(d.signed_at).getTime() - new Date(neuf).getTime()) / 3_600_000,
    changeDeMois: moisParis(d.signed_at) !== moisParis(neuf),
    changeDeSemaine: semaineParis(d.signed_at) !== semaineParis(neuf),
    changeDeJour: jourParis(d.signed_at) !== jourParis(neuf),
  });
}

// ── Rapport ─────────────────────────────────────────────────────────────────

console.log(`\n${deals.length} ventes rattachées à un rendez-vous.\n`);

if (replis.length) {
  console.log(`⚠️  ${replis.length} écartée(s) : la règle replierait sur aujourd hui, ce qui`);
  console.log('    remplacerait une date fausse par une autre. Laissées telles quelles.');
  for (const { d, motif } of replis) console.log(`    ${d.id}  ${d.signed_at}  ${motif}`);
  console.log('');
}

console.log(`${inchanges.length} déjà conforme(s) ou sans rendez-vous exploitable.`);
console.log(`${aChanger.length} à redater :\n`);

if (aChanger.length) {
  console.log('  vente                                 ancien signed_at          nouveau                   écart      bouge un écran ?');
  for (const l of aChanger) {
    const bouge = l.changeDeMois ? 'OUI — MOIS' : l.changeDeSemaine ? 'oui — semaine' : l.changeDeJour ? 'jour seulement' : 'non';
    console.log(`  ${l.d.id}  ${l.d.signed_at.slice(0, 19)}  →  ${l.neuf.slice(0, 19)}  ${String(Math.round(l.heures)).padStart(5)} h   ${bouge}`);
    console.log(`      ${String(l.d.buyer_name ?? '—').padEnd(28)} ${Number(l.d.amount_total).toFixed(0)} EUR   ${l.d.status}`);
  }
  const mois = aChanger.filter(l => l.changeDeMois);
  const sem = aChanger.filter(l => l.changeDeSemaine && !l.changeDeMois);
  console.log(`\n  Franchissent un MOIS    : ${mois.length}${mois.length ? ' — ' + mois.map(l => l.d.id.slice(0, 8)).join(', ') : ''}`);
  console.log(`  Franchissent une SEMAINE: ${sem.length}${sem.length ? ' — ' + sem.map(l => l.d.id.slice(0, 8)).join(', ') : ''}`);
  console.log('\n  Un écran ne bouge QUE si la vente change de fenêtre. Un décalage de quelques');
  console.log('  heures dans la même journée ne déplace aucun chiffre — il rend seulement la');
  console.log('  colonne conforme à la règle, et la surveillance silencieuse.');
}

if (!APPLIQUER) {
  console.log('\nSimulation. Rien n a été écrit. Relancer avec --appliquer.\n');
  process.exit(0);
}

for (const l of aChanger) {
  await api(`deals?id=eq.${l.d.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ signed_at: l.neuf }),
  });
  console.log(`  écrit  ${l.d.id}  →  ${l.neuf}`);
}
console.log(`\n${aChanger.length} vente(s) redatée(s).\n`);
