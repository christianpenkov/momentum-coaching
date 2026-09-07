#!/usr/bin/env node
/**
 * ⚠️ CE CONTRÔLE EXISTE POUR UN SEUL DÉFAUT, ET C'EST LE PLUS COÛTEUX DU PROJET.
 *
 * « Une règle posée d'un côté d'une partition, oubliée de l'autre. »
 *
 * Les 6 et 7 septembre 2026, il a été trouvé NEUF fois en deux jours, toujours
 * sur de l'argent ou sur un garde-fou :
 *
 *   · `modeDe` corrigé dans etats.ts, resté faux dans terms/route.ts
 *      → l'écran proposait une modification que le serveur refusait en réclamant
 *        700 € de remboursement
 *   · `refreshDealStatus` recopié dans installments/route.ts
 *      → un virement déclaré sur une vente clôturée ne levait aucun drapeau
 *   · `refreshDealStatus` recopié dans orphans/route.ts, sans même `calculerCash`
 *      → rattacher un paiement à une vente remboursée la passait « Soldée »
 *   · le garde « vente signée » lisant `deals` d'un côté, `calls.deal_closed` de
 *     l'autre → cinq ventes supprimables sans le moindre refus
 *   · `deal_closed` écrivable sans garde sur une seconde route
 *   · la règle du cash en SQL (`ventes_cash_net`) ignorant `dispute_lost`
 *   · `refund_reason` préservé dans le webhook, écrasé dans la copie Deno
 *   · le faux zéro Short.io, le `stops_at` fantôme…
 *
 * Aucun n'était visible à la relecture du fichier qu'on modifiait : ils vivaient
 * dans l'AUTRE fichier, celui qu'on n'ouvrait pas.
 *
 * ── Pourquoi un contrôle et pas de la vigilance ────────────────────────────
 * Parce que la vigilance a échoué neuf fois. Demande de Chris, 2026-09-08 :
 * « ton problème de règle posée d'un côté pas de l'autre, je veux plus jamais de
 * ma vie le voir ».
 *
 * ── Pourquoi il ne détecte que TROIS motifs ────────────────────────────────
 * Ce dépôt a déjà rejeté un contrôle statique qui criait sur du code juste
 * (710 faux positifs, voir docs/requetes-qui-echouent-en-silence.md). La leçon y
 * est écrite : « livrer un contrôle qui signale du code juste, c'est fabriquer
 * l'alerte qu'on n'ouvre plus ».
 *
 * Chaque motif ci-dessous a donc été MESURÉ sur le dépôt avant d'être retenu, et
 * ne rend aujourd'hui que zéro résultat ou des exceptions nommées une par une.
 * Un motif qui produirait un seul faux positif n'a pas sa place ici.
 *
 * ⚠️ Si ce contrôle échoue, la réponse n'est JAMAIS d'allonger la liste des
 * exceptions. C'est de supprimer la seconde implémentation — d'appeler la
 * fonction partagée. Une exception de plus signifie qu'on a renoncé, pas qu'on a
 * résolu.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RACINE = process.cwd();
const DOSSIERS = ['app', 'lib', 'components', 'supabase/functions'];

/** Les fichiers qui PORTENT la règle — ils ont le droit de l'écrire. */
const SOURCES = new Set([
  'lib/dealCash.ts',
  'supabase/functions/_shared/dealCash.ts',
  'lib/dealStatus.ts',
]);

const REGLES = [
  {
    nom: 'somme de paiements à la main',
    explication:
      "Un `filter` sur `succeeded` suivi d'un `reduce` est une seconde implémentation du cash.\n"
      + '  Elle ne déduira ni les remboursements, ni les litiges, ni ce que Stripe inventera.\n'
      + '  → appeler `calculerCash()` de lib/dealCash.ts.',
    // Signature exacte des sept copies trouvées le 2026-08-30 puis le 2026-09-07.
    test: (texte) => {
      const lignes = texte.split('\n');
      const coups = [];
      for (let i = 0; i < lignes.length; i++) {
        if (!/filter\([^)]*['"]succeeded['"]/.test(lignes[i])) continue;
        const fenetre = lignes.slice(i, i + 4).join('\n');
        if (/reduce\(/.test(fenetre)) coups.push(i + 1);
      }
      return coups;
    },
  },
  {
    nom: 'décision de statut à la main',
    explication:
      "Un ternaire qui rend `'paid'` décide du statut d'une vente hors de la règle unique.\n"
      + '  → appeler `statutDeal()` de lib/dealCash.ts.',
    test: (texte) => {
      const lignes = texte.split('\n');
      const coups = [];
      for (let i = 0; i < lignes.length; i++) {
        if (/\?\s*['"]paid['"]/.test(lignes[i])) coups.push(i + 1);
      }
      return coups;
    },
  },
  {
    nom: 'recalcul de statut recopié',
    explication:
      'Une fonction `refreshDealStatus` hors de lib/dealStatus.ts est une copie amputée :\n'
      + "  elle recalcule le statut sans les EFFETS — drapeau « paiement inattendu »,\n"
      + '  désactivation des liens, journal, notification.\n'
      + '  → appeler `refreshDealStatus()` de lib/dealStatus.ts, ou passer par\n'
      + '    /api/stripe/deal-effects depuis Deno.',
    test: (texte) => {
      const lignes = texte.split('\n');
      const coups = [];
      for (let i = 0; i < lignes.length; i++) {
        if (/(function|const)\s+refreshDealStatus\b/.test(lignes[i])) coups.push(i + 1);
      }
      return coups;
    },
    /**
     * ⚠️ UNE SEULE exception, et elle est motivée : la copie Deno ne recalcule
     * rien elle-même dès qu'un effet est en jeu — elle DÉLÈGUE à la route
     * partagée par HTTP. Elle porte le même nom pour que l'appelant ne se pose
     * pas la question, pas pour dupliquer la règle.
     */
    exceptions: new Set(['supabase/functions/sync-stripe-payments/index.ts']),
  },
];

function fichiers(dossier) {
  const out = [];
  const explorer = (d) => {
    let entrees;
    try { entrees = readdirSync(d); } catch { return; }
    for (const e of entrees) {
      if (e === 'node_modules' || e === '.next') continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) explorer(p);
      else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
    }
  };
  explorer(join(RACINE, dossier));
  return out;
}

const violations = [];

for (const dossier of DOSSIERS) {
  for (const chemin of fichiers(dossier)) {
    const rel = relative(RACINE, chemin).split('\\').join('/');
    if (SOURCES.has(rel)) continue;
    const texte = readFileSync(chemin, 'utf8');
    for (const regle of REGLES) {
      if (regle.exceptions?.has(rel)) continue;
      for (const ligne of regle.test(texte)) {
        violations.push({ rel, ligne, regle });
      }
    }
  }
}

if (violations.length === 0) {
  console.log('✓ regles uniques : aucune seconde implementation');
  process.exit(0);
}

console.error('\n✖ UNE REGLE EST IMPLEMENTEE A DEUX ENDROITS\n');
for (const v of violations) {
  console.error(`  ${v.rel}:${v.ligne}  — ${v.regle.nom}`);
  console.error(`  ${v.regle.explication}\n`);
}
console.error(
  '  ⚠️ Ne PAS ajouter d\'exception pour faire passer ce controle.\n'
  + '     La correction est de supprimer la copie, pas de la declarer legitime.\n'
);
process.exit(1);
