#!/usr/bin/env node
// La règle du cash vit dans deux runtimes. Ce script refuse qu'ils divergent.
//
// ── Ce qu'il empêche, et pourquoi ça a coûté cher ──────────────────────────────────
//
// `lib/dealCash.ts` calcule le cash pour les écrans ; la vue SQL `ventes_cash_net` le
// calcule pour toute lecture directe de la base. Le 2026-09-06, `dispute_lost` a été
// ajouté au code à 15 h 21. La vue l'ignorait encore à 21 h et rendait 3 200 € là où
// les écrans affichaient 3 000 €.
//
// ⚠️ RIEN n'aurait pu le voir. Les deux implémentations étaient chacune cohérente avec
// elle-même : `tsc` ne lit pas le SQL, les tests unitaires ne lisent pas la base, et
// aucune relecture ne compare deux runtimes. Il a fallu ouvrir la page dans un
// navigateur et tomber sur l'écart par hasard.
//
// ── Comment la divergence devient impossible ───────────────────────────────────────
//
// La liste des statuts et leurs signes n'est plus écrite deux fois :
//
//   • TypeScript la porte dans `REGLES_CASH` (lib/dealCash.ts, deux copies identiques) ;
//   • SQL la porte dans la TABLE `cash_regles_statut`, que la vue LIT — la vue elle-même
//     ne contient plus aucune formule de statut, donc il n'y a plus rien à y oublier.
//
// Ce script compare les deux, statut par statut et signe par signe. Ajouter un statut
// d'un seul côté rend `npm test` rouge AVANT qu'une seule ligne de données ne le porte,
// donc avant que le moindre chiffre ne soit faux à l'écran.
//
// ── Ce qu'il ne fait jamais ────────────────────────────────────────────────────────
//
// Il n'échoue PAS quand il ne peut pas conclure. Sans clé de service, sans réseau, ou
// si la base refuse, il le DIT et rend la main : `npm test` doit rester utilisable hors
// ligne, et un test rouge pour une coupure réseau est un test qu'on apprend à ignorer.
// Même règle que `verifier-migrations.mjs`, et pour la même raison.
//
// Un silence n'est donc jamais un succès : le message distingue « vérifié » de
// « pas pu vérifier ».

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath` et non `new URL(...).pathname` : le chemin du projet contient une
// espace, que `pathname` rendrait encodée en `%20`.
const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ⚠️ On n'appelle JAMAIS `process.exit()` ici, on pose `process.exitCode`. Sous Windows,
// un `process.exit()` juste après un `fetch` coupe la boucle d'événements avant la
// fermeture du handle et Node meurt sur une assertion libuv — `npm test` s'arrêterait
// alors en permanence sur un contrôle qui vient pourtant de réussir.
class Inconcluant extends Error {}
const sansConclure = motif => { throw new Inconcluant(motif); };

/** Lit une variable de `.env.local` sans dépendance. */
function variableEnv(nom) {
  let brut;
  try {
    brut = readFileSync(join(RACINE, '.env.local'), 'utf8');
  } catch {
    return null;
  }
  for (const ligne of brut.split('\n')) {
    if (ligne.trimStart().startsWith('#')) continue;
    const i = ligne.indexOf('=');
    if (i < 0) continue;
    if (ligne.slice(0, i).trim() !== nom) continue;
    // Guillemets et CRLF retirés : les laisser produirait un en-tête d'autorisation
    // invalide, et la base répondrait « Invalid API key » — une panne de LECTURE qui
    // ressemblerait à une absence d'anomalie.
    return ligne.slice(i + 1).trim().replace(/\r$/, '').replace(/^"|"$/g, '');
  }
  return null;
}

try {
  const url = variableEnv('NEXT_PUBLIC_SUPABASE_URL');
  const cle = variableEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !cle) sansConclure('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente de .env.local');

  // ── Le côté TypeScript ───────────────────────────────────────────────────────────
  //
  // Les DEUX copies sont chargées, pas seulement celle de `lib/`. Le test unitaire
  // compare déjà leurs RÉSULTATS, mais une table de statuts divergente peut produire
  // les mêmes résultats sur les jeux testés tout en différant sur un statut qu'aucun
  // jeu ne couvre — exactement le cas qu'on ferme ici.
  const { REGLES_CASH: ici } = await import('../lib/dealCash.ts');
  const { REGLES_CASH: laBas } = await import('../supabase/functions/_shared/dealCash.ts');

  const enTexte = r => Object.entries(r)
    .map(([s, v]) => `${s}:${v.signe}:${v.champ ?? '-'}`)
    .sort()
    .join(' | ');

  if (enTexte(ici) !== enTexte(laBas)) {
    console.error('\n❌ Les deux copies de REGLES_CASH diffèrent.');
    console.error(`   lib/dealCash.ts                        : ${enTexte(ici)}`);
    console.error(`   supabase/functions/_shared/dealCash.ts : ${enTexte(laBas)}`);
    console.error('   Les deux fichiers doivent rester identiques sous la ligne de garde.\n');
    process.exitCode = 1;
    sansConclure('copies TypeScript divergentes, comparaison SQL abandonnée');
  }

  // ── Le côté SQL ──────────────────────────────────────────────────────────────────
  let regles;
  try {
    const r = await fetch(`${url}/rest/v1/cash_regles_appliquees?select=statut,signe,champ_ts`, {
      headers: { apikey: cle, Authorization: `Bearer ${cle}` },
    });
    if (!r.ok) sansConclure(`la base a répondu HTTP ${r.status} (la vue cash_regles_appliquees existe-t-elle ?)`);
    regles = await r.json();
  } catch (e) {
    if (e instanceof Inconcluant) throw e;
    sansConclure(`base injoignable (${e?.message ?? 'erreur réseau'})`);
  }
  if (!Array.isArray(regles)) sansConclure('réponse inattendue de la base');

  // TÉMOIN POSITIF. Une liste vide se lirait comme « rien à signaler » alors qu'elle
  // peut signifier « la vue est vide » ou « la lecture a échoué en silence ». On exige
  // de voir au moins une règle avant de conclure quoi que ce soit.
  if (regles.length === 0) sansConclure('la base ne renvoie AUCUNE règle de cash — lecture douteuse');

  // ── La comparaison ───────────────────────────────────────────────────────────────
  const cotesql = new Map(regles.map(r => [r.statut, { signe: Number(r.signe), champ: r.champ_ts ?? null }]));
  const ecarts = [];

  for (const [statut, attendu] of Object.entries(ici)) {
    const trouve = cotesql.get(statut);
    if (!trouve) {
      ecarts.push(`« ${statut} » est déclaré en TypeScript mais ABSENT de cash_regles_statut — son montant ne serait ni compté ni déduit côté SQL`);
      continue;
    }
    if (trouve.signe !== attendu.signe) {
      ecarts.push(`« ${statut} » : signe ${attendu.signe} en TypeScript contre ${trouve.signe} en SQL`);
    }
    if (trouve.champ !== (attendu.champ ?? null)) {
      ecarts.push(`« ${statut} » : champ « ${attendu.champ ?? '(aucun)'} » en TypeScript contre « ${trouve.champ ?? '(aucun)'} » en SQL`);
    }
  }
  for (const statut of cotesql.keys()) {
    if (!(statut in ici)) {
      ecarts.push(`« ${statut} » est déclaré en SQL mais ABSENT de REGLES_CASH — les écrans l'ignoreraient`);
    }
  }

  if (ecarts.length) {
    console.error('\n❌ La règle du cash diverge entre TypeScript et SQL.\n');
    for (const e of ecarts) console.error(`    ${e}`);
    console.error('\n  À corriger AUX DEUX endroits, jamais un seul :');
    console.error('    • lib/dealCash.ts et supabase/functions/_shared/dealCash.ts → REGLES_CASH');
    console.error('    • la table cash_regles_statut, par une migration');
    console.error('\n  ⚠️ La vue ventes_cash_net n\'a AUCUNE formule à modifier : elle lit la table.');
    console.error('  Contexte : supabase/migrations/20260906210000_cash_regles_statut.sql\n');
    process.exitCode = 1;
  } else {
    console.log(`règle du cash vérifiée (${regles.length} statuts, TypeScript ≡ SQL) — aucun écart`);
  }
} catch (e) {
  if (!(e instanceof Inconcluant)) throw e;
  console.log(`\n⚠️  Règle du cash : PAS VÉRIFIÉ — ${e.message}.`);
  console.log("   Ce n'est pas un succès. `ventes_sante_statut_paiement_inconnu` reste le filet,");
  console.log("   mais elle ne voit qu'un statut DÉJÀ arrivé en données.");
}
