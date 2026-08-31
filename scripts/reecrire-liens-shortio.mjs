#!/usr/bin/env node
/**
 * Réécrit la destination des liens Short.io PARTAGÉS pour qu'ils passent par la
 * route qui pose le Click ID.
 *
 *   avant :  https://calendly.com/coach/30min?utm_source=ig&utm_medium=bio&…
 *   après :  https://<domaine>/r/bio-calendly-ig?utm_source=ig&utm_medium=bio&…&d=coach/30min&p=<profil>
 *
 * ⚠️ **La route `/r/` doit être en production ET vérifiée avant de lancer ce
 * script avec `--appliquer`.** Sinon les liens de bio pointent vers un 404
 * pendant la fenêtre de déploiement. Non négociable.
 *
 * Usage :
 *   node scripts/reecrire-liens-shortio.mjs                 # simulation, n'écrit rien
 *   node scripts/reecrire-liens-shortio.mjs --limite 5      # simulation, 5 liens
 *   node scripts/reecrire-liens-shortio.mjs --limite 5 --appliquer
 *   node scripts/reecrire-liens-shortio.mjs --profil <uuid> --appliquer
 *
 * Idempotent et rejouable : un lien déjà réécrit est ignoré (la fonction partagée
 * `construireDestinationShortio` le détecte à l'origine de sa destination). Le
 * script LISTE toujours ce qu'il va faire avant de le faire.
 *
 * Réécrire par lots, en vérifiant entre chaque :
 *   select * from clics_sante_redirection where etat like 'ALERTE%';
 * La vue divergera pendant la migration — les liens pas encore réécrits ne
 * produisent aucune ligne de clic. Ce n'est une anomalie que si la divergence
 * persiste une fois tous les lots passés.
 *
 * Voir docs/click-id.md.
 */

import { readFileSync } from 'node:fs';
import { construireDestinationShortio } from '../lib/click-redirect.ts';

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
    // Les valeurs de .env.local sont entre guillemets : les retirer, sinon
    // l'URL de base contiendrait un guillemet et toutes les requêtes échoueraient.
    env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = { ...chargerEnv(new URL('../.env.local', import.meta.url)), ...process.env };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGINE = env.MOMENTUM_REDIRECT_ORIGIN;

// ── Arguments ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const appliquer = args.includes('--appliquer');
const limite = Number(args[args.indexOf('--limite') + 1]) || Infinity;
const profilCible = args.includes('--profil') ? args[args.indexOf('--profil') + 1] : null;
// Restreint le lot a un canal (`bio`, `description`, `story`). Sert au deroule
// progressif : on demontre la chaine complete sur un canal avant d'ouvrir les
// autres. Sans ce filtre, le decoupage en lots depend de l'ORDRE de listage de
// Short.io — donc du hasard, et « la bio attend » ne serait pas une garantie.
const mediumCible = args.includes('--medium') ? args[args.indexOf('--medium') + 1] : null;

// ── Accès Supabase (REST, pas de dépendance à installer) ────────────────────

async function supa(chemin) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${chemin} → HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Accès Short.io ──────────────────────────────────────────────────────────

const pause = ms => new Promise(r => setTimeout(r, ms));

/**
 * Liste TOUS les liens d'un domaine, en paginant.
 *
 * `limit=150` couvre la majorité des comptes, mais s'arrêter là ferait manquer
 * silencieusement les liens au-delà — exactement le genre de trou qu'on ne voit
 * jamais. On pagine donc jusqu'à épuisement.
 */
async function listerLiens(domainId, apiKey) {
  const liens = [];
  for (let offset = 0; ; offset += 150) {
    const res = await fetch(
      `https://api.short.io/api/links?domain_id=${domainId}&limit=150&offset=${offset}`,
      { headers: { authorization: apiKey, accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`Short.io liens domaine ${domainId} → HTTP ${res.status}`);
    const data = await res.json();
    const lot = data?.links ?? [];
    liens.push(...lot);
    if (lot.length < 150) return liens;
    await pause(150);
  }
}

async function ecrireDestination(linkId, apiKey, url) {
  const res = await fetch(`https://api.short.io/links/${linkId}`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ originalURL: url }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`);
}

// ── Programme ───────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('✖ NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis (.env.local).');
    process.exit(1);
  }
  if (!ORIGINE) {
    console.error('✖ MOMENTUM_REDIRECT_ORIGIN n’est pas défini.');
    console.error('  C’est le domaine qui sert la route /r/. Sans lui il n’y a rien à écrire.');
    console.error('  Pour tester : MOMENTUM_REDIRECT_ORIGIN=https://momentum-plateforme.vercel.app node scripts/reecrire-liens-shortio.mjs');
    process.exit(1);
  }
  console.log(`Domaine de redirection : ${ORIGINE}`);
  console.log(appliquer ? 'Mode : APPLICATION\n' : 'Mode : simulation — rien ne sera écrit\n');

  const filtreProfil = profilCible ? `&profile_id=eq.${profilCible}` : '';
  const integrations = await supa(
    `integrations?provider=eq.shortio&select=profile_id,api_key,metadata${filtreProfil}`,
  );

  // ── À qui appartient un lien ? ───────────────────────────────────────────
  //
  // ⚠️ Deux profils peuvent partager le même domaine Short.io (docs/shortio-api.md,
  // piège n°2). L'API rend alors les MÊMES liens aux deux, et le script écrirait
  // `p=<profil>` deux fois de suite sur le même lien : le dernier passage gagne,
  // donc les clics seraient attribués à un profil pris au hasard. Silencieusement.
  //
  // Les liens de description et de story ont un propriétaire écrit en base : on le
  // suit. Les liens de bio n'en ont aucun — un conflit sur l'un d'eux est signalé
  // et le lien n'est PAS réécrit. `--profil <uuid>` permet alors de trancher.
  const proprietaire = new Map();
  for (const [table, colonne] of [
    ['content_links', 'desc_calendly_short_url'],
    ['story_sequences', 'calendly_short_url'],
  ]) {
    for (const l of await supa(`${table}?select=profile_id,${colonne}`)) {
      const url = l[colonne];
      if (url) proprietaire.set(url.split('/').pop().toLowerCase(), l.profile_id);
    }
  }

  const aFaire = [];
  const ignores = { dejaFait: 0, horsPerimetre: 0, dm: 0, autreProprietaire: 0, autreCanal: 0 };

  for (const integ of integrations) {
    if (!integ.api_key) continue;
    const meta = integ.metadata || {};
    // Un élève peut avoir PLUSIEURS domaines : les liens de l'ancien restent
    // actifs, toujours en description des posts déjà publiés, et continuent
    // d'être cliqués. N'interroger que le domaine actif les rendrait invisibles,
    // silencieusement (docs/shortio-api.md, piège n°1).
    const domaines = (meta.all_domains?.length ? meta.all_domains : [{ id: meta.domain_id, hostname: meta.domain }])
      .filter(d => d?.id);

    // Les liens de DM sont déjà instrumentés (prospect_links.first_click_at et
    // l'événement link_clicked). Le filtre sur `utm_medium` les écarte déjà, mais
    // cette liste rend la règle structurelle plutôt qu'accidentelle.
    const liensDm = new Set(
      (await supa(`prospect_links?profile_id=eq.${integ.profile_id}&select=short_url`))
        .map(l => (l.short_url || '').split('/').pop().toLowerCase())
        .filter(Boolean),
    );

    for (const domaine of domaines) {
      let liens;
      try {
        liens = await listerLiens(domaine.id, integ.api_key);
      } catch (e) {
        console.error(`✖ ${integ.profile_id} / domaine ${domaine.hostname ?? domaine.id} : ${e.message}`);
        continue;
      }
      for (const lien of liens) {
        const chemin = lien.path || '';
        if (liensDm.has(chemin.toLowerCase())) { ignores.dm++; continue; }
        const cible = construireDestinationShortio(
          ORIGINE, chemin, lien.originalURL || '', integ.profile_id,
        );
        if (!cible) {
          if ((lien.originalURL || '').startsWith(ORIGINE)) ignores.dejaFait++;
          else ignores.horsPerimetre++;
          continue;
        }
        const proprio = proprietaire.get(chemin.toLowerCase());
        if (proprio && proprio !== integ.profile_id) { ignores.autreProprietaire++; continue; }
        const medium = /utm_medium=([a-z]+)/.exec(lien.originalURL || '')?.[1] ?? null;
        if (mediumCible && medium !== mediumCible) { ignores.autreCanal++; continue; }
        aFaire.push({
          profileId: integ.profile_id,
          apiKey: integ.api_key,
          linkId: lien.idString || lien.id,
          hostname: domaine.hostname ?? domaine.id,
          chemin,
          medium,
          avant: lien.originalURL,
          apres: cible,
        });
      }
      await pause(150);
    }
  }

  // ── Écarter les liens qu'aucune base ne départage ────────────────────────
  const parLien = new Map();
  for (const t of aFaire) {
    const cle = `${t.hostname}/${t.chemin}`;
    if (!parLien.has(cle)) parLien.set(cle, []);
    parLien.get(cle).push(t);
  }
  const conflits = [];
  const retenus = [];
  for (const [cle, candidats] of parLien) {
    if (candidats.length === 1) { retenus.push(candidats[0]); continue; }
    conflits.push(`${cle} — réclamé par ${candidats.length} profils : ${candidats.map(c => c.profileId).join(', ')}`);
  }


  // ── Lister AVANT d'agir ───────────────────────────────────────────────────
  const lot = retenus.slice(0, limite === Infinity ? undefined : limite);

  console.log(`Déjà réécrits          : ${ignores.dejaFait}`);
  console.log(`Hors périmètre         : ${ignores.horsPerimetre}  (lead magnet, paiement, lien manuel…)`);
  console.log(`Liens de DM protégés   : ${ignores.dm}`);
  console.log(`Appartiennent à un autre profil : ${ignores.autreProprietaire}`);
  if (mediumCible) console.log(`Hors du canal « ${mediumCible} »            : ${ignores.autreCanal}`);
  console.log(`À réécrire             : ${retenus.length}${lot.length < retenus.length ? ` (ce lot : ${lot.length})` : ''}`);
  if (conflits.length) {
    console.log(`
⚠ ${conflits.length} lien(s) NON réécrit(s), propriétaire indéterminé :`);
    for (const c of conflits) console.log(`    ${c}`);
    console.log('  Relancer avec --profil <uuid> pour trancher.');
  }
  console.log('');

  if (lot.length === 0) {
    console.log('Rien à faire.');
    return;
  }

  for (const t of lot) {
    console.log(`  ${t.hostname}/${t.chemin}  [${t.medium ?? 'canal inconnu'}]`);
    console.log(`    avant : ${t.avant}`);
    console.log(`    après : ${t.apres}`);
  }
  console.log('');

  if (!appliquer) {
    console.log('Simulation terminée. Relancer avec --appliquer pour écrire.');
    return;
  }

  let ok = 0;
  const echecs = [];
  for (const t of lot) {
    try {
      await ecrireDestination(t.linkId, t.apiKey, t.apres);
      ok++;
      console.log(`  ✓ ${t.hostname}/${t.chemin}`);
    } catch (e) {
      // Tracer et continuer : un lien qui échoue ne doit pas empêcher les autres,
      // et le script est rejouable — la reprise ne refera que les manquants.
      echecs.push(`${t.hostname}/${t.chemin} : ${e.message}`);
      console.error(`  ✖ ${t.hostname}/${t.chemin} : ${e.message}`);
    }
    await pause(150);
  }

  console.log(`\n${ok} lien(s) réécrit(s), ${echecs.length} échec(s).`);
  if (echecs.length) {
    console.log('Relancer le script rejouera uniquement les liens restants.');
    process.exitCode = 1;
  }
  console.log('\nVérifier avant le lot suivant :');
  console.log("  select * from clics_sante_redirection where etat like 'ALERTE%';");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
