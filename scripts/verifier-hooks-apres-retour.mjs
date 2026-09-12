#!/usr/bin/env node
/**
 * Interdit un hook React posé APRÈS un `return` anticipé, au premier niveau d'un
 * composant.
 *
 * ── Pourquoi ce script existe ────────────────────────────────────────────────
 * Un hook situé après un `if (!x) return …` n'est pas appelé au premier rendu et
 * l'est au suivant. React voit le nombre de hooks changer entre deux rendus et
 * refuse de rendre la page ENTIÈRE — écran blanc, pas une erreur locale.
 *
 * Ni `tsc` ni `next build` ne l'attrapent : les deux compilent parfaitement, le
 * défaut n'existe qu'au rendu. Le dépôt n'a pas d'ESLint, donc
 * `react-hooks/rules-of-hooks` ne tourne nulle part.
 *
 * PageClientDetail.tsx est tombé dedans le 2026-09-04. Une garde a été écrite dans
 * le fichier, en majuscules, avec le récit de l'incident. Le 2026-09-12 le même
 * fichier est retombé dedans, à cinquante lignes de cette garde. Un commentaire ne
 * bloque rien — il faut un vérificateur, c'est le rôle de celui-ci.
 *
 * ── Ce qu'il détecte, et comment ─────────────────────────────────────────────
 * L'indentation fait le travail : dans ce dépôt, le corps d'un composant est à deux
 * espaces, et tout ce qui vit dans une fonction imbriquée (callback, sous-composant,
 * gestionnaire d'événement) est plus profond. On ne regarde donc QUE la colonne 2 :
 *
 *   1. le premier `return` de premier niveau ouvre la zone interdite ;
 *   2. tout appel de hook de premier niveau rencontré après est signalé.
 *
 * Conséquence assumée : un composant sans `return` anticipé n'est jamais inspecté,
 * et un hook dans une fonction imbriquée est ignoré. Le script vise UN défaut, celui
 * qui a cassé la production deux fois, et préfère ne rien dire à crier faux.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RACINE = process.cwd();
const DOSSIERS = ['components', 'app'];

/** Un appel de hook au premier niveau : `const x = useY(` ou `useY(` seul. */
const APPEL_DE_HOOK = /^ {2}(?:const |let )?[\w{}[\],\s:]*=?\s*use[A-Z]\w*\s*\(/;
/** `use client` n'est pas un hook, et `useRouter` hors composant non plus — mais les
 *  deux vivent avant le premier `return`, donc la question ne se pose jamais. */
const RETOUR_PREMIER_NIVEAU = /^ {2}(?:if\s*\(.*\)\s*)?return[\s(;]/;
/** Un `return` de premier niveau qui ferme la fonction : plus rien après ne compte. */
const FIN_DE_FONCTION = /^\}/;

function fichiersTsx(dossier) {
  const trouves = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) {
      if (nom === 'node_modules' || nom === '.next') continue;
      trouves.push(...fichiersTsx(chemin));
    } else if (nom.endsWith('.tsx')) {
      trouves.push(chemin);
    }
  }
  return trouves;
}

const anomalies = [];

for (const dossier of DOSSIERS) {
  let chemins;
  try { chemins = fichiersTsx(join(RACINE, dossier)); } catch { continue; }

  for (const chemin of chemins) {
    const lignes = readFileSync(chemin, 'utf8').split('\n');
    // Ligne du `return` qui a ouvert la zone interdite, ou null hors zone.
    let retourOuvrant = null;

    for (let i = 0; i < lignes.length; i++) {
      const ligne = lignes[i];

      // Une accolade en colonne 0 ferme la fonction en cours : la zone se referme,
      // le composant suivant repart de zéro.
      if (FIN_DE_FONCTION.test(ligne)) { retourOuvrant = null; continue; }

      if (retourOuvrant === null && RETOUR_PREMIER_NIVEAU.test(ligne)) {
        retourOuvrant = i + 1;
        continue;
      }

      if (retourOuvrant !== null && APPEL_DE_HOOK.test(ligne)) {
        anomalies.push({
          fichier: relative(RACINE, chemin).replace(/\\/g, '/'),
          ligneHook: i + 1,
          ligneRetour: retourOuvrant,
          extrait: ligne.trim().slice(0, 90),
        });
        // Un seul signalement par zone : les suivants diraient la même chose.
        retourOuvrant = null;
      }
    }
  }
}

if (anomalies.length === 0) {
  console.log('✓ hooks : aucun appel apres un return anticipe');
  process.exit(0);
}

console.error(`\n✗ ${anomalies.length} hook(s) appele(s) apres un return anticipe.\n`);
console.error('  React voit le nombre de hooks changer entre deux rendus et refuse de');
console.error('  rendre la page entiere. Deplacez le hook AVANT le premier return, ou');
console.error('  remplacez-le par un calcul simple.\n');
for (const a of anomalies) {
  console.error(`  ${a.fichier}:${a.ligneHook}`);
  console.error(`    return anticipe ligne ${a.ligneRetour} · ${a.extrait}`);
}
console.error('');
process.exit(1);
