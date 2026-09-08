#!/usr/bin/env node
// Cree un compte COACH complet.
//
//   npm run creer-coach -- --email quennel@exemple.com --nom "Quennel"
//   npm run creer-coach -- --email … --nom … --mot-de-passe "…"   (sinon genere)
//
// ── Pourquoi un script, et pas deux clics ─────────────────────────────────────────
//
// Un compte coach vit a DEUX endroits, et rien ne les relie :
//
//   auth.users   l'identite (e-mail, mot de passe)
//   profiles     le role, le nom, le fuseau
//
// ⚠️ Mesure du 2026-09-04 : il n'existe AUCUN declencheur sur `auth.users`. Creer
// l'utilisateur depuis le tableau de bord ne cree donc pas son profil — le compte se
// connecte, et l'application ne sait pas qui il est. Le defaut ne se voit qu'a la
// premiere connexion, et il ressemble a un bug de l'application.
//
// ⚠️ Et `/signup` cree un ELEVE (`role: 'client'`), jamais un coach. Il n'existe aucun
// parcours d'inscription coach : c'est ce script, ou rien.
//
// ── Ce qu'il garantit ─────────────────────────────────────────────────────────────
//
// - refuse si l'e-mail existe deja (jamais d'ecrasement silencieux) ;
// - `email_confirm: true` : AUCUN e-mail n'est envoye. Indispensable avec une adresse
//   de reserve — des rebonds repetes abiment la reputation d'envoi du projet ;
// - cree le profil dans la foulee, et RELIT les deux pour verifier ;
// - n'affiche le mot de passe qu'une fois, et seulement s'il l'a genere.
//
// ⚠️ L'e-mail et le mot de passe se changent APRES coup sans rien casser : pour un
// coach, l'adresse ne vit que dans `auth.users`, `profiles` n'en porte pas. (Pour un
// ELEVE, `clients.email` en garde une copie d'affichage qui ne suivrait pas.)

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigerBonneCible } from './verifier-cible.mjs';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// On ne cree pas un compte dans la base d'un autre projet.
exigerBonneCible('La creation du compte coach');

function lireEnv(cle) {
  const t = readFileSync(join(RACINE, '.env.local'), 'utf8');
  const m = t.match(new RegExp(`^${cle}\\s*=\\s*(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

// ⚠️ Aucun `process.exit()` apres un `fetch` : sous Windows, tuer le processus pendant
// qu'une connexion reste ouverte fait echouer une assertion de libuv, et le script se
// termine par un plantage APRES avoir affiche son resultat. Un outil qui plante a la
// sortie, on finit par ne plus lire ce qu'il dit. On rend donc un code, et on laisse
// Node se fermer proprement.
async function main() {
const args = process.argv.slice(2);
const lire = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const email   = lire('--email');
const nom     = lire('--nom');
const fuseau  = lire('--fuseau') ?? 'Europe/Paris';
let   motDePasse = lire('--mot-de-passe');
const genere  = !motDePasse;
if (genere) motDePasse = randomBytes(12).toString('base64url');

if (!email || !nom) {
  console.error('usage : npm run creer-coach -- --email <adresse> --nom "<nom affiche>" [--mot-de-passe <mdp>] [--fuseau <zone>]');
  return 1;
}

const URL_SUPABASE = lireEnv('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY  = lireEnv('SUPABASE_SERVICE_ROLE_KEY');
if (!URL_SUPABASE || !SERVICE_KEY) {
  console.error('.env.local : NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquante.');
  return 1;
}

const entetes = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

async function appeler(chemin, options = {}) {
  const r = await fetch(`${URL_SUPABASE}${chemin}`, { ...options, headers: { ...entetes, ...(options.headers ?? {}) } });
  const corps = await r.text();
  let json = null;
  try { json = corps ? JSON.parse(corps) : null; } catch { /* corps non JSON */ }
  return { ok: r.ok, statut: r.status, json, corps };
}

console.log(`\n▸ projet : ${JSON.parse(readFileSync(join(RACINE, 'PROJET.json'), 'utf8')).nom}`);
console.log(`▸ coach  : ${nom} <${email}>\n`);

// 1. Refuser si l'adresse est deja prise — jamais d'ecrasement silencieux.
const existant = await appeler(`/auth/v1/admin/users?filter=${encodeURIComponent(email)}`);
if (existant.ok && Array.isArray(existant.json?.users) && existant.json.users.length > 0) {
  console.error(`🛑 Un compte existe deja pour ${email} (id ${existant.json.users[0].id}).`);
  console.error('   Rien n\'a ete cree. Pour changer son mot de passe ou son adresse, passer par');
  console.error('   le tableau de bord Supabase — ce script ne modifie jamais un compte existant.');
  return 1;
}

// 2. L'utilisateur. email_confirm: true => aucun e-mail envoye.
const creation = await appeler('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({ email, password: motDePasse, email_confirm: true }),
});
if (!creation.ok || !creation.json?.id) {
  console.error(`🛑 Creation de l'utilisateur refusee (HTTP ${creation.statut}) : ${creation.corps}`);
  return 1;
}
const id = creation.json.id;
console.log(`  ✓ utilisateur cree — ${id}`);

// 3. Le profil. Sans lui, le compte se connecte et l'application ne sait pas qui il est.
const profil = await appeler('/rest/v1/profiles', {
  method: 'POST',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ id, role: 'coach', full_name: nom, timezone: fuseau, onboarding_step: 'in_progress' }),
});
if (!profil.ok) {
  console.error(`\n🛑 L'utilisateur est cree mais son PROFIL a echoue (HTTP ${profil.statut}) : ${profil.corps}`);
  console.error('   Le compte est INUTILISABLE en l\'etat. Creer la ligne profiles a la main :');
  console.error(`   insert into profiles (id, role, full_name, timezone, onboarding_step)`);
  console.error(`   values ('${id}', 'coach', '${nom}', '${fuseau}', 'in_progress');`);
  return 1;
}
console.log('  ✓ profil cree — role coach');

// 4. Relire : ce qui compte, c'est ce que la base contient, pas ce que l'API a repondu.
const verif = await appeler(`/rest/v1/profiles?id=eq.${id}&select=id,role,full_name,timezone`);
const ligne = verif.json?.[0];
if (!ligne || ligne.role !== 'coach') {
  console.error('🛑 Relecture : le profil n\'est pas conforme.', verif.corps);
  return 1;
}

console.log(`\n✅ Compte coach operationnel.`);
console.log(`   identifiant : ${id}`);
console.log(`   e-mail      : ${email}`);
if (genere) {
  console.log(`   mot de passe: ${motDePasse}`);
  console.log(`                 ↑ affiche UNE SEULE fois. A transmettre par un canal sur,`);
  console.log(`                   et a faire changer a la premiere connexion.`);
}
console.log(`\n   L'e-mail et le mot de passe restent modifiables ensuite, sans rien casser :`);
console.log(`   pour un coach, l'adresse ne vit que dans auth.users.\n`);
return 0;
}

main()
  .then(code => { process.exitCode = code; })
  .catch(err => {
    console.error('🛑 Erreur inattendue :', err?.message ?? err);
    process.exitCode = 1;
  });
