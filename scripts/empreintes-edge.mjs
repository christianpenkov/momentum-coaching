#!/usr/bin/env node
// Empreinte du code source de chaque Edge Function, pour rendre un DEPLOIEMENT EN
// RETARD detectable.
//
// ── Le probleme ────────────────────────────────────────────────────────────────────
//
// Une Edge Function ne part PAS avec `git push` : elle demande une commande a part.
// Constate le 2026-09-03 : `poll-leads` tournait avec du code du 1er septembre, huit
// commits en retard, dont un correctif qui empechait l'origine d'un lead d'etre ecrasee
// toutes les cinq minutes. Personne ne l'a vu pendant deux jours.
//
// Ce qui existait ne pouvait pas le voir :
//   * `crons_passages` prouve qu'un cron TOURNE, jamais qu'il tourne le BON code ;
//   * `updated_at` du tableau de bord Supabase MENT (prouve sur `refresh-ig-posts` :
//     date au 02/08, contenu du 20/08) ;
//   * chercher un marqueur a la main se trompe dans les deux sens — ma propre sonde
//     « maxResults=500 absent » etait un faux negatif, cette chaine n'ayant jamais
//     existe dans ce fichier.
//
// ── Pourquoi une empreinte de la SOURCE, et pas un identifiant de commit ───────────
//
// Un identifiant de commit change a chaque commit, meme sans rapport : l'alerte
// crierait en permanence, donc on cesserait de l'ouvrir. L'empreinte ne change que
// quand le code de CETTE fonction change reellement. C'est ce qui rend l'alerte
// signifiante.
//
// ⚠️ La cloture des imports LOCAUX en fait partie, et c'est le point essentiel. Le mode
// de panne dominant du projet est documente dans AGENTS.md : « chaque deploiement fige
// sa propre copie des modules partages, donc une fonction perime sans que son dossier
// bouge ». Une empreinte du seul `index.ts` aurait laisse passer exactement ce cas.
//
// ── Pourquoi pas l'API de gestion Supabase ─────────────────────────────────────────
//
// Comparer le bundle en ligne au depot serait plus direct, mais demanderait de poser un
// jeton d'acces personnel dans les variables Vercel — un secret aux pouvoirs tres
// larges, ajoute pour une commodite de surveillance. Ecarte le 2026-09-03, verifie
// qu'aucun jeton de ce type n'existe cote Vercel.
//
// ── Comment la boucle se ferme ──────────────────────────────────────────────────────
//
//   1. Ce script ecrit `lib/empreintes-edge.generated.ts` depuis la COPIE DE TRAVAIL.
//   2. Chaque Edge Function importe ce fichier et remonte SON empreinte a chaque
//      passage, via `marquer_passage_cron`. Le bundle deploye FIGE donc la valeur qu'il
//      portait au moment du deploiement — c'est-a-dire l'empreinte de ce qui a
//      reellement ete envoye.
//   3. Cote attendu, `npm run prebuild` rejoue ce script a CHAQUE construction Vercel :
//      la valeur attendue vient donc du depot pousse, sans que personne ne la mette a
//      jour a la main.
//   4. `/api/sante/alerte-vues` inscrit les empreintes attendues en base a chaque
//      passage, et la vue `edge_sante_version` compare. L'alerte part par le meme
//      e-mail quotidien que les autres.
//
// ⚠️ La seule etape qui demande un geste est le deploiement, et elle est faite pour
// n'en demander qu'un :
//
//   npm run deployer-edge <nom>
//
// Cette commande regenere puis deploie, dans cet ordre. Si quelqu'un deploie sans
// regenerer, la fonction remonte l'ancienne empreinte et l'alerte part le lendemain :
// **le mode de panne est de CRIER quand tout va bien**, jamais de se taire quand ca va
// mal. C'est le sens choisi delibrement — voir `docs/checklist-scalabilite.md`.
//
// ── Usage ──────────────────────────────────────────────────────────────────────────
//
//   node scripts/empreintes-edge.mjs              # ecrit le fichier genere
//   node scripts/empreintes-edge.mjs --verifier    # ne rien ecrire, sortir 1 si perime

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠️ `fileURLToPath` et non `new URL(...).pathname` : le chemin du projet contient une
// espace (« Projet Quennel Momentum »), que `pathname` rend encodee en `%20` — le script
// cherchait alors un dossier inexistant.
const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIER_FONCTIONS = join(RACINE, 'supabase', 'functions');
const FICHIER_GENERE = join(RACINE, 'lib', 'empreintes-edge.generated.ts');

// ⚠️ Exclu de l'empreinte, sinon elle se contient elle-meme : l'ecrire changerait la
// valeur qu'on vient de calculer, indefiniment.
const CHEMIN_GENERE = 'lib/empreintes-edge.generated.ts';

/** Chemins relatifs a la racine, en `/`, pour que l'empreinte ne depende pas de l'OS. */
function normaliserChemin(absolu) {
  return relative(RACINE, absolu).split('\\').join('/');
}

// `--depuis-head` : lire le code COMMITE au lieu de la copie de travail.
//
// ⚠️ Les deux lectures repondent a deux questions differentes, et confondre les deux
// produit un fichier faux.
//
//   * defaut (copie de travail)  → « qu'est-ce que je DEPLOIE ? »   Utilise par
//     `deployer-edge` juste avant l'envoi : la valeur figee dans le bundle doit decrire
//     ce que le bundle contient.
//   * `--depuis-head` (code commite) → « qu'est-ce que le DEPOT contient ? »  Utilise
//     pour ecrire le fichier qu'on commite, et par la porte de `npm test`.
//
// Sans ce second mode, regenerer le fichier dans un depot ou une AUTRE session a du
// travail non commite y inscrirait les empreintes de son travail en cours — et le
// commit publierait des valeurs qui ne correspondent a aucune version du depot. Le cas
// n'est pas theorique : trois Edge Functions sur onze etaient dans cet etat le
// 2026-09-03.
const DEPUIS_HEAD = process.argv.includes('--depuis-head');

/**
 * Le contenu vient de la COPIE DE TRAVAIL par defaut, delibrement.
 *
 * ⚠️ C'est ce qui donne son sens a l'alerte : `npx supabase functions deploy` envoie le
 * disque, pas `HEAD`. Une empreinte calculee sur le code commite decrirait donc quelque
 * chose que le deploiement n'a pas forcement envoye — et un deploiement fait depuis un
 * arbre sale, qui embarque le travail en cours de quelqu'un d'autre, passerait pour
 * conforme. C'est precisement l'accident que la session Pipeline a evite le 2026-09-03
 * en deployant depuis un arbre de travail propre : ici, s'il ne l'avait pas fait,
 * l'ecart aurait ete visible le lendemain matin.
 *
 * Cote attendu, Vercel recalcule a chaque construction (`prebuild`) depuis le depot
 * pousse. Comparer les deux repond donc exactement a « la fonction en ligne execute-t-elle
 * le code du depot ».
 *
 * ⚠️ Les fins de ligne sont normalisees en LF AVANT le hachage. Sans ca, l'empreinte
 * dependrait de la copie locale : Git convertit en CRLF sous Windows (`git add` le
 * signale a chaque commit de ce depot), donc deux machines calculeraient deux empreintes
 * pour un code identique, et l'alerte crierait sans qu'une ligne ait bouge. Un BOM
 * eventuel part pour la meme raison.
 */
function normaliser(texte) {
  if (texte.charCodeAt(0) === 0xfeff) texte = texte.slice(1);
  return texte.split('\r\n').join('\n');
}

function contenuNormalise(chemin) {
  if (DEPUIS_HEAD) {
    try {
      return normaliser(execFileSync('git', ['show', `HEAD:${normaliserChemin(chemin)}`], {
        cwd: RACINE, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      }));
    } catch {
      // Absent de HEAD : fichier nouveau, pas encore commite. On retombe sur le disque —
      // il n'est de toute facon pas encore deploye.
    }
  }
  return normaliser(readFileSync(chemin, 'utf8'));
}

/**
 * Cloture transitive des imports LOCAUX d'un fichier (`./`, `../`).
 *
 * Les imports distants (`https:`, `jsr:`, `npm:`) sont volontairement exclus : ils sont
 * epingles par version dans l'URL, donc leur changement passe forcement par une
 * modification du fichier qui les importe — deja couverte.
 */
function cloture(entree) {
  const vus = new Set();
  const aFaire = [entree];
  while (aFaire.length) {
    const fichier = aFaire.pop();
    const cle = normaliserChemin(fichier);
    if (vus.has(cle) || cle === CHEMIN_GENERE) continue;
    if (!existsSync(fichier)) {
      throw new Error(`import introuvable : ${cle} (depuis ${normaliserChemin(entree)})`);
    }
    vus.add(cle);
    const texte = contenuNormalise(fichier);
    // `from '…'`, `import '…'` et `await import('…')` — les trois formes presentes.
    for (const m of texte.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      aFaire.push(resolve(dirname(fichier), spec));
    }
  }
  return [...vus].sort();
}

/** SHA-256 sur « chemin\ncontenu\n » de chaque fichier, dans l'ordre des chemins. */
function empreinte(fichiers) {
  const h = createHash('sha256');
  for (const rel of fichiers) {
    h.update(rel, 'utf8');
    h.update('\n', 'utf8');
    h.update(contenuNormalise(join(RACINE, rel)), 'utf8');
    h.update('\n', 'utf8');
  }
  // 16 caracteres : assez pour qu'une collision soit hors de portee, assez court pour
  // etre lisible dans une colonne de table et dans un e-mail.
  return h.digest('hex').slice(0, 16);
}

function calculer() {
  const resultat = {};
  for (const nom of readdirSync(DOSSIER_FONCTIONS, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== '_shared')
    .map(e => e.name)
    .sort()) {
    const entree = join(DOSSIER_FONCTIONS, nom, 'index.ts');
    if (!existsSync(entree)) continue;
    const fichiers = cloture(entree);
    resultat[nom] = { empreinte: empreinte(fichiers), fichiers: fichiers.length };
  }
  return resultat;
}

function rendre(empreintes) {
  const lignes = Object.entries(empreintes)
    .map(([nom, { empreinte, fichiers }]) =>
      `  '${nom}': '${empreinte}',${' '.repeat(Math.max(1, 26 - nom.length - empreinte.length))}// ${fichiers} fichier${fichiers > 1 ? 's' : ''}`);
  return `// GENERE — ne pas modifier a la main.
//
// Reecrit par \`npm run empreintes-edge\`, et automatiquement par \`npm run prebuild\`
// (donc a chaque construction Vercel) et par \`npm run deployer-edge <nom>\` juste avant
// l'envoi. Aucun test ne garde ce fichier : il n'a pas a etre a jour dans le depot, il
// a a etre a jour AU MOMENT DU DEPLOIEMENT — c'est la valeur qu'il portait alors que le
// bundle fige, et c'est elle qu'on compare.
//
// Le motif complet est dans l'en-tete de \`scripts/empreintes-edge.mjs\` : une Edge
// Function ne part pas avec \`git push\`, et rien ne savait dire qu'une fonction en ligne
// etait plus vieille que le code. L'empreinte couvre \`index.ts\` ET la cloture de ses
// imports locaux, parce qu'un deploiement fige sa propre copie des modules partages.
//
// ⚠️ Chaque valeur ne change que si le code de CETTE fonction change. Ce n'est pas un
// identifiant de commit : un identifiant de commit bougerait a chaque commit et
// l'alerte crierait en permanence.

export const EMPREINTES_EDGE: Record<string, string> = {
${lignes.join('\n')}
};

/** L'empreinte d'une fonction, ou \`null\` si elle n'est pas dans le depot. */
export function empreinteDe(nom: string): string | null {
  return EMPREINTES_EDGE[nom] ?? null;
}
`;
}

const empreintes = calculer();
const attendu = rendre(empreintes);
const verifier = process.argv.includes('--verifier');

if (verifier) {
  // ⚠️ Le fichier genere se lit sur le DISQUE meme en `--depuis-head` : c'est la copie
  // qu'on s'apprete a commiter qu'on verifie, pas celle deja commitee.
  const actuel = existsSync(FICHIER_GENERE)
    ? normaliser(readFileSync(FICHIER_GENERE, 'utf8'))
    : '';
  if (actuel !== attendu) {
    console.error('lib/empreintes-edge.generated.ts est PERIME'
      + (DEPUIS_HEAD ? ' par rapport au code COMMITE.' : ' par rapport a la copie de travail.'));
    console.error('Rejouer puis commiter le fichier :');
    console.error('  npm run empreintes-edge -- --depuis-head');
    console.error('');
    console.error("Une Edge Function a ete modifiee sans que le fichier d'empreintes suive.");
    console.error('Sans ca, un deploiement fait autrement que par `npm run deployer-edge`');
    console.error("embarquerait une empreinte perimee, et l'alerte partirait le lendemain.");
    process.exit(1);
  }
  console.log(`empreintes a jour (${Object.keys(empreintes).length} fonctions)`);
} else {
  writeFileSync(FICHIER_GENERE, attendu, 'utf8');
  for (const [nom, { empreinte, fichiers }] of Object.entries(empreintes)) {
    console.log(`${nom.padEnd(24)} ${empreinte}  (${fichiers} fichier${fichiers > 1 ? 's' : ''})`);
  }
  console.log(`\necrit : ${normaliserChemin(FICHIER_GENERE)}`);
}
