#!/usr/bin/env node
// Vercel garde TOUS les déploiements, et le plan Hobby n'a pas de rétention réglable.
//
// ── Pourquoi ce script existe ──────────────────────────────────────────────────────
//
// Le 2026-09-08, deux alertes Vercel sont tombées le même soir : « Function Storage
// 100 % » et « Deployment Storage 100 % » — les deux plafonds de 10 Go du plan gratuit.
//
// Ce n'était ni du trafic, ni un bundle trop lourd, ni un fichier commité par erreur
// (dépôt vérifié : 9,9 Mo, aucun fichier versionné au-dessus d'1 Mo). C'était le NOMBRE
// de déploiements retenus : **1 227**, dont 467 sur la seule semaine écoulée. Chaque
// `git push` en crée un, et Vercel les conserve indéfiniment.
//
// ⚠️ Les DEUX alertes ont la même cause. Chaque déploiement conservé embarque ses
// fonctions serverless : c'est exactement ce que compte le « Function Storage ». Purger
// les déploiements vide les deux compteurs, il n'y a rien de séparé à faire.
//
// ⚠️ Et il n'y a rien à régler dans l'interface : la rétention automatique
// (`deploymentsToKeep`, expiration par catégorie) n'est pas exposée sur Hobby — comme
// `vercel rollback`, documenté « Pro ou Enterprise ». D'où ce script, à relancer quand
// l'alerte revient. Le jour du passage en Pro, il devient inutile : régler la rétention
// dans les paramètres du projet et supprimer ce fichier.
//
// ── Usage ──────────────────────────────────────────────────────────────────────────
//
//   node scripts/purger-deploiements-vercel.mjs            → ESSAI À BLANC (ne supprime rien)
//   node scripts/purger-deploiements-vercel.mjs --executer → supprime pour de bon
//
// Nécessite une CLI Vercel authentifiée (`npx vercel whoami` doit répondre).

import { execSync } from 'node:child_process';

const PROJET = 'prj_bJsNTFxTelIqO7DWcgd6E8J5rDTx';
const EQUIPE = 'team_AXapxwtsI8F9IFjU8hWhE0Xo';
const A_GARDER = 30;
const EXECUTER = process.argv.includes('--executer');

/** Un déploiement dans un de ces états ne bougera plus : lui seul est supprimable. */
const ETATS_TERMINAUX = new Set(['READY', 'ERROR', 'CANCELED']);

// ⚠️ L'URL est entre guillemets : sous Windows, `&` sépare deux commandes, et
// `...&teamId=...` faisait exécuter « teamId » comme un programme.
function api(chemin) {
  const brut = execSync(`npx vercel api "${chemin}"`, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(brut);
}

// ── 1. Lister TOUS les déploiements ────────────────────────────────────────────────
function listerTous() {
  const liste = [];
  let until = null;
  for (let page = 0; page < 60; page++) {
    let c = `/v6/deployments?projectId=${PROJET}&teamId=${EQUIPE}&limit=100`;
    if (until) c += `&until=${until}`;
    const d = api(c);
    const lot = d.deployments ?? [];
    liste.push(...lot);
    const suite = d.pagination?.next;
    if (!lot.length || !suite) break;
    until = suite;
  }
  return liste.sort((a, b) => b.created - a.created);
}

const tous = listerTous();
console.log(`${tous.length} deploiements trouves`);

// ── 2. Quel déploiement sert RÉELLEMENT le site ────────────────────────────────────
//
// ⚠️ NE PAS se fier à `aliasAssigned`. Ce champ dit qu'un alias a été assigné UN JOUR,
// pas qu'il l'est encore : s'en servir comme garde protégeait 1 157 déploiements sur
// 1 227, et la purge n'aurait presque rien libéré — en donnant l'impression d'avoir
// fonctionné. La seule vérité est l'identifiant que le PROJET déclare comme cible de
// production.
const projet = api(`/v9/projects/${PROJET}?teamId=${EQUIPE}`);
const PROD_ID = projet.targets?.production?.id ?? projet.latestDeployment?.id;
if (!PROD_ID) {
  console.error('Impossible de determiner le deploiement de production — on arrete.');
  process.exitCode = 1;
  process.exit();
}

// ── 3. Trier ───────────────────────────────────────────────────────────────────────
const aSupprimer = [];
let gardes = 0;
tous.forEach((d, i) => {
  const etat = d.readyState ?? d.state;
  if (d.uid === PROD_ID) gardes++;                    // sert le site
  else if (i < A_GARDER) gardes++;                    // rollback récent
  else if (!ETATS_TERMINAUX.has(etat)) gardes++;      // build en cours
  else aSupprimer.push(d);
});

const date = ms => new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
console.log(`gardes      : ${gardes} (dont la production ${PROD_ID})`);
console.log(`a supprimer : ${aSupprimer.length}`);
if (aSupprimer.length) {
  console.log(`              du ${date(aSupprimer.at(-1).created)} au ${date(aSupprimer[0].created)}`);
}

if (!EXECUTER) {
  console.log('\nESSAI A BLANC — rien supprime. Relancer avec --executer.');
  process.exit();
}

// ── 4. Supprimer, par lots ─────────────────────────────────────────────────────────
//
// ⚠️ On ne passe JAMAIS le NOM du projet à `vercel remove` : avec un nom, il supprime
// TOUS les déploiements, production comprise. Uniquement des identifiants, et
// uniquement ceux calculés ci-dessus — d'où les deux assertions.
const LOT = 40;

/** Renvoie null si la CLI a rendu la main sans erreur, sinon son message. */
function retirer(ids) {
  if (!ids.every(u => u.startsWith('dpl_'))) throw new Error('identifiant suspect dans le lot');
  if (ids.includes(PROD_ID)) throw new Error('la production est dans le lot — on arrete tout');
  try {
    execSync(`npx vercel remove ${ids.join(' ')} --yes`, {
      encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], timeout: 900_000,
    });
    return null;
  } catch (e) {
    return String(e.stderr ?? e.message).replace(/\s+/g, ' ').slice(0, 160);
  }
}

for (let i = 0; i < aSupprimer.length; i += LOT) {
  const lot = aSupprimer.slice(i, i + LOT).map(d => d.uid);
  const erreur = retirer(lot);
  // ⚠️ `vercel remove` fait échouer le LOT ENTIER dès qu'UN seul identifiant lui
  // déplaît — par exemple un déploiement déjà supprimé entre-temps. Sans cette
  // reprise, un identifiant périmé emportait ses 39 voisins : le 2026-09-08, deux
  // purges lancées en parallèle se sont ainsi mutuellement fait rater 302 suppressions.
  if (erreur) {
    console.error(`  lot en echec, reprise un par un : ${erreur}`);
    for (const id of lot) retirer([id]);
  }
  console.log(`  ${Math.min(i + LOT, aSupprimer.length)}/${aSupprimer.length} traites`);
}

// ── 5. Bilan MESURÉ ────────────────────────────────────────────────────────────────
//
// ⚠️ On ne compte PAS les succès annoncés par la CLI : on relit la liste et on regarde
// ce qui reste vraiment. Le 2026-09-08, le bilan déduit des codes de retour annonçait
// « 62 en echec » alors que les 62 étaient bel et bien supprimés.
const cibles = new Set(aSupprimer.map(d => d.uid));
const restants = listerTous().filter(d => cibles.has(d.uid));
console.log(`\nTermine : ${cibles.size - restants.length}/${cibles.size} supprimes, ${gardes} gardes.`);
if (restants.length) {
  console.error(`${restants.length} n'ont pas pu etre supprimes — relancer le script.`);
  process.exitCode = 1;
}
