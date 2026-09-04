#!/usr/bin/env node
// Un changement de schéma appliqué sans fichier n'existe QUE dans la base.
//
// ── Pourquoi ce contrôle-ci, alors que `migrations_sante` existe déjà ──────────────
//
// La vue `migrations_sante` fait la même comparaison, mais elle la fait LE LENDEMAIN
// MATIN, par e-mail, et contre `migrations_du_depot` — table alimentée par le build
// Vercel déployé. Deux conséquences :
//
//   • le signal arrive après coup, quand la session qui a créé l'écart est fermée et
//     que personne ne sait plus ce qui a été appliqué ni pourquoi ;
//   • avant un push, `migrations_du_depot` est en retard : la vue ne peut pas servir
//     de contrôle local, elle crierait au faux positif sur toute migration qu'on vient
//     d'écrire.
//
// Ce script confronte donc les FICHIERS DU DISQUE à la liste réellement appliquée, sans
// passer par le pont Vercel. Il déplace la découverte du lendemain matin vers la session
// elle-même — c'est-à-dire au seul moment où la corriger coûte deux minutes.
//
// ⚠️ Il ne REMPLACE pas `migrations_sante` : celle-ci reste le filet, pour le cas où
// personne ne lance les tests. Les deux vérifient la même règle à deux instants
// différents, et c'est voulu.
//
// ── Ce qu'il ne fait jamais ────────────────────────────────────────────────────────
//
// Il n'échoue PAS quand il ne peut pas conclure. Sans clé de service, sans réseau, ou
// si la base refuse, il le DIT et rend la main : `npm test` doit rester utilisable hors
// ligne, et un test rouge pour une coupure réseau est un test qu'on apprend à ignorer —
// exactement le défaut que ce projet traque partout ailleurs.
//
// Un silence n'est donc jamais un succès : le message distingue « vérifié » de
// « pas pu vérifier ».

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath` et non `new URL(...).pathname` : le chemin du projet contient une
// espace, que `pathname` rendrait encodée en `%20`.
const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIER = join(RACINE, 'supabase', 'migrations');

// ── Les deux bornes ────────────────────────────────────────────────────────────────
//
// ⚠️ ELLES SONT COPIÉES DE `supabase/migrations/20260903180000_migrations_sante.sql`,
// qui les justifie par la mesure. Si elles changent là-bas, elles doivent changer ici :
// les deux contrôles doivent dire la même chose, sinon l'un rassure quand l'autre alerte.
//
//   • 185 migrations antérieures n'ont aucun fichier et aucune clé fiable ne permet de
//     les rapprocher : les confronter produirait 185 fausses alertes.
//   • La seconde borne démarre à la première migration écrite APRÈS la mise en place de
//     la surveillance ; avant elle, des fichiers légitimes n'ont jamais été appliqués
//     sous leur nom.
const BORNE_APPLIQUEE_SANS_FICHIER = '20260901000000';
const BORNE_FICHIER_JAMAIS_APPLIQUE = '20260903200000';

// ⚠️ On n'appelle JAMAIS `process.exit()` dans ce script, on pose `process.exitCode`.
// Sous Windows, un `process.exit()` juste après un `fetch` coupe la boucle d'événements
// avant la fermeture du handle : Node meurt sur
//   « Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) »
// et rend 127. `npm test` s'arrêterait alors là, en permanence, sur un contrôle qui
// vient pourtant de réussir. Constaté en vrai le 2026-09-04, sur la première version
// de ce fichier.
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
    // ⚠️ Les valeurs sont entre guillemets dans ce fichier, et les fins de ligne en
    // CRLF. Les laisser produirait un en-tête d'autorisation invalide, et la base
    // répondrait « Invalid API key » — une panne de LECTURE qui ressemblerait à une
    // absence d'anomalie. Piège rencontré en vrai le 2026-08-31.
    return ligne.slice(i + 1).trim().replace(/\r$/, '').replace(/^"|"$/g, '');
  }
  return null;
}

try {
  const url = variableEnv('NEXT_PUBLIC_SUPABASE_URL');
  const cle = variableEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !cle) sansConclure('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente de .env.local');

  // ── Les fichiers du disque ───────────────────────────────────────────────────────
  // Même expression que `manifeste-migrations.mjs` : l'horodatage est ce que Supabase
  // enregistre, le nom est la clé de rapprochement.
  const fichiers = new Map();
  for (const f of readdirSync(DOSSIER)) {
    if (!f.endsWith('.sql')) continue;
    const m = /^(\d{14})_(.+)\.sql$/.exec(f);
    if (!m) {
      console.error(`\n❌ Nom de fichier de migration invalide : ${f}`);
      console.error("   Attendu : <14 chiffres>_<nom>.sql — c'est l'horodatage que Supabase enregistre.");
      process.exitCode = 1;
      sansConclure('nom de fichier invalide, comparaison abandonnée');
    }
    fichiers.set(m[2], m[1]);
  }

  // ── La liste appliquée ───────────────────────────────────────────────────────────
  let appliquees;
  try {
    const r = await fetch(`${url}/rest/v1/migrations_appliquees?select=version,nom`, {
      headers: { apikey: cle, Authorization: `Bearer ${cle}` },
    });
    if (!r.ok) sansConclure(`la base a répondu HTTP ${r.status} (la vue migrations_appliquees existe-t-elle ?)`);
    appliquees = await r.json();
  } catch (e) {
    if (e instanceof Inconcluant) throw e;
    sansConclure(`base injoignable (${e?.message ?? 'erreur réseau'})`);
  }
  if (!Array.isArray(appliquees)) sansConclure('réponse inattendue de la base');

  // TÉMOIN POSITIF. Une liste vide ne prouve rien : elle se lit comme « aucun écart »
  // alors qu'elle peut signifier « la vue est vide » ou « la lecture a échoué en
  // silence ». On exige de voir au moins une migration avant de conclure.
  if (appliquees.length === 0) sansConclure("la base ne renvoie AUCUNE migration appliquée — lecture douteuse");

  const nomsAppliques = new Map(appliquees.map(m => [m.nom, m.version]));

  const sansFichier = [...nomsAppliques.entries()]
    .filter(([nom, version]) => version >= BORNE_APPLIQUEE_SANS_FICHIER && !fichiers.has(nom))
    .sort((a, b) => a[1].localeCompare(b[1]));

  const jamaisAppliques = [...fichiers.entries()]
    .filter(([nom, version]) => version >= BORNE_FICHIER_JAMAIS_APPLIQUE && !nomsAppliques.has(nom))
    .sort((a, b) => a[1].localeCompare(b[1]));

  if (sansFichier.length === 0 && jamaisAppliques.length === 0) {
    console.log(`migrations verifiees (${nomsAppliques.size} appliquees, ${fichiers.size} fichiers) — aucun ecart`);
  } else {
    console.error('\n❌ Base et dépôt divergent sur les migrations.\n');

    if (sansFichier.length) {
      console.error("  APPLIQUÉE SANS FICHIER — le changement n'existe QUE dans la base :");
      for (const [nom, version] of sansFichier) console.error(`    ${version}  ${nom}`);
      console.error('    → Lire l\'état réel (pg_get_viewdef, pg_get_functiondef, information_schema)');
      console.error('      et écrire le fichier manquant, en le marquant comme reconstitution.');
      console.error("      Ne jamais inventer une étape intermédiaire qu'on ne peut pas retrouver.\n");
    }

    if (jamaisAppliques.length) {
      console.error('  FICHIER JAMAIS APPLIQUÉ SOUS SON NOM :');
      for (const [nom, version] of jamaisAppliques) console.error(`    ${version}  ${nom}`);
      console.error('    ⚠️ Cela ne dit RIEN du contenu : il peut très bien être déjà en base,');
      console.error("       posé par `execute_sql` ou depuis le dashboard, sans laisser de ligne.");
      console.error("       AVANT d'appliquer, comparer les DEUX définitions normalisées");
      console.error("       (commentaires et espaces retirés) — « l'objet existe » ne prouve pas");
      console.error('       qu\'il dit la même chose, et réappliquer changerait le comportement.\n');
    }

    console.error('  Cause la plus fréquente : un nom différent des deux côtés. Renommer suffit alors.');
    console.error('  Contexte complet : supabase/migrations/20260903180000_migrations_sante.sql\n');
    process.exitCode = 1;
  }
} catch (e) {
  if (!(e instanceof Inconcluant)) throw e;
  console.log(`\n⚠️  Migrations : PAS VÉRIFIÉ — ${e.message}.`);
  console.log('   Ce n\'est pas un succès. La vue `migrations_sante` reste le filet,');
  console.log('   et l\'écart partirait par e-mail le lendemain matin.');
}
