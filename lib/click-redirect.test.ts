import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assainirChemin,
  construireDestination,
  construireDestinationShortio,
  resolveClickId,
  genererClickId,
  estRobotApercu,
  empreinteIp,
  champsDuClic,
  estIdContenu,
  PARAM_CLICK_ID,
} from './click-redirect.ts';

const CALENDLY_BIO = 'https://calendly.com/christianpenkov/30min?utm_source=ig&utm_medium=bio&utm_campaign=bio-instagram';
const CALENDLY_DESC = 'https://calendly.com/christianpenkov/30min?utm_source=ig&utm_medium=description&utm_campaign=calendly&utm_content=18056185901693457';
const ORIGINE = 'https://liens.momentum.test';
const PROFIL = 'a02e5927-0000-4000-8000-000000000001';

// ── assainirChemin ──────────────────────────────────────────────────────────

test('assainirChemin accepte un vrai chemin Calendly', () => {
  assert.equal(assainirChemin('christianpenkov/30min'), 'christianpenkov/30min');
  assert.equal(assainirChemin('/christianpenkov/30min'), 'christianpenkov/30min');
  assert.equal(assainirChemin('mon_coach/appel-decouverte'), 'mon_coach/appel-decouverte');
});

test('assainirChemin refuse tout ce qui pourrait faire sortir de l’hôte', () => {
  // Le cas décisif : `new URL('//exemple.test', 'https://calendly.com')` donnerait
  // `https://exemple.test/`. Deux gardes se recouvrent ici — les barres initiales
  // sont retirées, et un nom de domaine échoue de toute façon sur le point.
  assert.equal(assainirChemin('//exemple.test'), null);
  assert.equal(assainirChemin('..%2F..%2Fexemple'), null);
  assert.equal(assainirChemin('../evasion'), null);
  assert.equal(assainirChemin('https://exemple.test'), null);
  assert.equal(assainirChemin('chemin?x=1'), null);
  assert.equal(assainirChemin('chemin#ancre'), null);
  assert.equal(assainirChemin('chemin@exemple.test'), null);
  assert.equal(assainirChemin(''), null);
  assert.equal(assainirChemin(null), null);
  assert.equal(assainirChemin('a'.repeat(201)), null);
});

// ── construireDestination ───────────────────────────────────────────────────

test('construireDestination transmet NOS valeurs et pose le Click ID', () => {
  // Les utm_* transmis à Calendly sont reconstruits depuis m/s/k/c, jamais recopiés
  // depuis la requête — c'est toute la parade contre la réécriture par un tiers.
  const p = new URLSearchParams('m=bio&s=ig&k=bio-instagram&d=christianpenkov/30min');
  const url = new URL(construireDestination(p, 'c0ffee00-0000-4000-8000-000000000000')!);
  assert.equal(url.origin, 'https://calendly.com');
  assert.equal(url.pathname, '/christianpenkov/30min');
  assert.equal(url.searchParams.get('utm_source'), 'ig');
  assert.equal(url.searchParams.get('utm_medium'), 'bio');
  assert.equal(url.searchParams.get('utm_campaign'), 'bio-instagram');
  assert.equal(url.searchParams.get(PARAM_CLICK_ID), 'c0ffee00-0000-4000-8000-000000000000');
});

test('construireDestination ne peut jamais sortir de la liste blanche', () => {
  // Même en fabriquant l'URL à la main, aucun `d` ne mène ailleurs que sur
  // calendly.com : l'hôte n'est pas dans l'URL, il est écrit en dur.
  for (const d of ['//exemple.test/piege', 'https://exemple.test', '../../exemple', '\\\\exemple.test']) {
    const p = new URLSearchParams({ d });
    const resultat = construireDestination(p, null);
    if (resultat !== null) {
      assert.equal(new URL(resultat).origin, 'https://calendly.com', `d=${d}`);
    }
  }
});

test('construireDestination refuse un hôte hors liste blanche', () => {
  const p = new URLSearchParams('d=christianpenkov/30min&h=inconnu');
  assert.equal(construireDestination(p, null), null);
});

test('construireDestination sans `d` renvoie null — l’appelant gère le repli', () => {
  assert.equal(construireDestination(new URLSearchParams('utm_source=ig'), null), null);
});

test('une campagne hors forme n’est pas transmise du tout', () => {
  // Champ vide plutôt que champ faux : tronquer une valeur aberrante à 255 caractères
  // produirait une campagne inventée, qui aurait l'air d'une vraie.
  const trop = new URLSearchParams({ d: 'x/y', m: 'bio', k: 'c'.repeat(400) });
  assert.equal(new URL(construireDestination(trop, null)!).searchParams.get('utm_campaign'), null);

  const sale = new URLSearchParams({ d: 'x/y', m: 'bio', k: 'campagne avec espaces' });
  assert.equal(new URL(construireDestination(sale, null)!).searchParams.get('utm_campaign'), null);

  // Les vraies valeurs de campagne du projet passent toutes.
  for (const k of ['bio-instagram', 'bio-youtube', 'calendly', 's-quence-test-webhook', 'lm-guide']) {
    const p = new URLSearchParams({ d: 'x/y', m: 'bio', k });
    assert.equal(new URL(construireDestination(p, null)!).searchParams.get('utm_campaign'), k, k);
  }
});

// ── construireDestinationShortio ────────────────────────────────────────────

test('construireDestinationShortio réécrit un lien de bio en conservant les UTM', () => {
  const resultat = construireDestinationShortio(ORIGINE, 'bio-calendly-ig', CALENDLY_BIO, PROFIL)!;
  const url = new URL(resultat);
  assert.equal(url.origin, ORIGINE);
  assert.equal(url.pathname, '/r/bio-calendly-ig');
  assert.equal(url.searchParams.get('utm_source'), 'ig');
  assert.equal(url.searchParams.get('utm_medium'), 'bio');
  assert.equal(url.searchParams.get('utm_campaign'), 'bio-instagram');
  assert.equal(url.searchParams.get('d'), 'christianpenkov/30min');
  assert.equal(url.searchParams.get('p'), PROFIL);
  assert.equal(url.searchParams.get('h'), null, 'h est omis pour l’hôte par défaut');
});

test('construireDestinationShortio conserve utm_content d’un lien de description', () => {
  const url = new URL(construireDestinationShortio(ORIGINE, 'prendre-rdv-3457', CALENDLY_DESC, PROFIL)!);
  assert.equal(url.searchParams.get('utm_content'), '18056185901693457');
  assert.equal(url.searchParams.get('utm_medium'), 'description');
});

test('construireDestinationShortio est idempotente — rejouer le script ne change rien', () => {
  const une = construireDestinationShortio(ORIGINE, 'bio-calendly-ig', CALENDLY_BIO, PROFIL)!;
  assert.equal(construireDestinationShortio(ORIGINE, 'bio-calendly-ig', une, PROFIL), null);
});

test('construireDestinationShortio laisse tranquilles les liens hors périmètre', () => {
  const cas: [string, string][] = [
    ['lien de DM prospect — déjà instrumenté par prospect_links',
      'https://calendly.com/christianpenkov/30min?utm_source=ig&utm_medium=dm&utm_campaign=prospect'],
    ['lead magnet — hôte hors liste blanche',
      'https://ubizenai.com/?utm_source=ig&utm_medium=bio&utm_campaign=lm-bio-ig'],
    ['paiement Stripe — hôte hors liste blanche',
      'https://buy.stripe.com/test_9B6?utm_source=ig&utm_medium=payment'],
    ['lien créé à la main, sans UTM',
      'https://drive.google.com/file/d/1nJ/view'],
  ];
  for (const [libelle, url] of cas) {
    assert.equal(construireDestinationShortio(ORIGINE, 'x', url, PROFIL), null, libelle);
  }
});

test('construireDestinationShortio sans origine configurée ne réécrit rien', () => {
  // Le domaine Momentum n'est pas encore branché : les liens continuent de
  // pointer droit sur Calendly, exactement comme aujourd'hui. Pas de Click ID,
  // mais aucune régression non plus.
  assert.equal(construireDestinationShortio(null, 'bio-calendly-ig', CALENDLY_BIO, PROFIL), null);
  assert.equal(construireDestinationShortio('', 'bio-calendly-ig', CALENDLY_BIO, PROFIL), null);
});

test('construireDestinationShortio refuse une destination illisible', () => {
  assert.equal(construireDestinationShortio(ORIGINE, 'x', 'pas-une-url', PROFIL), null);
  assert.equal(construireDestinationShortio(ORIGINE, 'x', CALENDLY_BIO, ''), null);
});

// ── Click ID ────────────────────────────────────────────────────────────────

test('resolveClickId n’écrit jamais une valeur non conforme', () => {
  const vrai = genererClickId();
  assert.equal(resolveClickId(vrai), vrai);
  assert.equal(resolveClickId(vrai.toUpperCase()), vrai);
  // Calendly renvoie `salesforce_uuid` tel qu'il l'a figé : n'importe qui peut y
  // avoir mis n'importe quoi en fabriquant une URL à la main.
  assert.equal(resolveClickId('incogniton.734'), undefined);
  assert.equal(resolveClickId('0000'), undefined);
  assert.equal(resolveClickId(''), undefined);
  assert.equal(resolveClickId(null), undefined);
  assert.equal(resolveClickId('<script>'), undefined);
});

test('un Click ID tient très largement sous la limite Calendly de 255 caractères', () => {
  assert.ok(genererClickId().length <= 255);
  assert.notEqual(genererClickId(), genererClickId());
});

// ── Robots ──────────────────────────────────────────────────────────────────

test('estRobotApercu marque les robots d’aperçu de lien', () => {
  const robots = [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0 A',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Twitterbot/1.0',
    'Mozilla/5.0 (compatible; Discordbot/2.0)',
    'LinkedInBot/1.0',
    'curl/8.4.0',
  ];
  for (const ua of robots) assert.equal(estRobotApercu(ua), true, ua);
});

test('le navigateur intégré d’Instagram est un HUMAIN, pas un robot', () => {
  // Le piège : « Instagram » apparaît dans l'UA du navigateur intégré de
  // l'application. Le marquer robot effacerait la quasi-totalité des vrais clics.
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 329.0.0.41.93';
  assert.equal(estRobotApercu(ua), false);
  assert.equal(estRobotApercu('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'), false);
});

test('estRobotApercu marque un pré-chargement et une requête sans User-Agent', () => {
  assert.equal(estRobotApercu('Mozilla/5.0 Chrome/126.0', 'prefetch'), true);
  assert.equal(estRobotApercu('Mozilla/5.0 Chrome/126.0', 'prefetch;prerender'), true);
  assert.equal(estRobotApercu(''), true);
  assert.equal(estRobotApercu(null), true);
});

// ── Empreinte d'IP ──────────────────────────────────────────────────────────

test('empreinteIp ne laisse jamais transparaître l’IP', async () => {
  const e = await empreinteIp('81.250.12.7', 'secret-serveur', '2026-08-31');
  assert.equal(typeof e, 'string');
  assert.equal(e!.length, 16);
  assert.ok(!e!.includes('81'), 'l’empreinte ne doit pas contenir de fragment d’IP');
  assert.equal(await empreinteIp('81.250.12.7', 'secret-serveur', '2026-08-31'), e, 'stable le même jour');
  assert.notEqual(await empreinteIp('81.250.12.7', 'secret-serveur', '2026-09-01'), e, 'change de sel chaque jour');
  assert.notEqual(await empreinteIp('81.250.12.8', 'secret-serveur', '2026-08-31'), e);
});

test('empreinteIp sans secret configuré renvoie null plutôt qu’une empreinte faible', async () => {
  assert.equal(await empreinteIp('81.250.12.7', null, '2026-08-31'), null);
  assert.equal(await empreinteIp(null, 'secret-serveur', '2026-08-31'), null);
});

// ── Champs de la ligne de clic ──────────────────────────────────────────────

test('champsDuClic n’écrit jamais un canal hors nomenclature', () => {
  assert.deepEqual(
    champsDuClic(new URLSearchParams('s=ig&m=bio')),
    { platform: 'ig', medium: 'bio', content_id: null },
  );
  assert.deepEqual(
    champsDuClic(new URLSearchParams('s=yt&m=description&c=EMvwzHVjNJg')),
    { platform: 'yt', medium: 'description', content_id: 'EMvwzHVjNJg' },
  );
  // Champ vide plutôt que champ faux — même règle que lib/contentId.ts.
  assert.deepEqual(
    champsDuClic(new URLSearchParams('s=ubizenai.s.gy&m=post')),
    { platform: null, medium: null, content_id: null },
  );
  // `dm` n'est pas un canal partagé : un lien de DM ne devrait jamais passer ici.
  assert.equal(champsDuClic(new URLSearchParams('m=dm')).medium, null);
});

// ── Changement d'origine ────────────────────────────────────────────────────
//
// Scénario réel prévu : on démarre sur l'adresse Vercel, on bascule sur le domaine
// définitif avant la mise en service. La bascule se fait en relançant le script —
// encore faut-il qu'il VOIE les liens à déplacer.

const ANCIENNE = 'https://momentum-plateforme.vercel.test';
const NOUVELLE = 'https://prendre-rdv.test';

test('changer d’origine déménage le lien au lieu de l’ignorer', () => {
  const surAncienne = construireDestinationShortio(ANCIENNE, 'bio-calendly-ig', CALENDLY_BIO, PROFIL)!;
  const surNouvelle = construireDestinationShortio(NOUVELLE, 'bio-calendly-ig', surAncienne, PROFIL);

  // Le piège : sans traitement dédié, la destination n'est plus une URL Calendly,
  // donc elle tombe en « hors périmètre » et le script passe à côté EN SILENCE.
  assert.notEqual(surNouvelle, null, 'le lien doit être déplacé, pas ignoré');

  const avant = new URL(surAncienne);
  const apres = new URL(surNouvelle!);
  assert.equal(apres.origin, NOUVELLE);
  assert.equal(apres.pathname, avant.pathname);
  // Chemin et paramètres sont conservés à l'identique : seul l'hôte change.
  assert.deepEqual([...apres.searchParams].sort(), [...avant.searchParams].sort());
});

test('un lien de description déménage aussi, utm_content compris', () => {
  const surAncienne = construireDestinationShortio(ANCIENNE, 'prendre-rdv-3457', CALENDLY_DESC, PROFIL)!;
  const url = new URL(construireDestinationShortio(NOUVELLE, 'prendre-rdv-3457', surAncienne, PROFIL)!);
  assert.equal(url.origin, NOUVELLE);
  assert.equal(url.searchParams.get('utm_content'), '18056185901693457');
  assert.equal(url.searchParams.get('d'), 'christianpenkov/30min');
  assert.equal(url.searchParams.get('p'), PROFIL);
});

test('sur la MÊME origine, rien ne bouge — le script reste rejouable', () => {
  const une = construireDestinationShortio(ANCIENNE, 'bio-calendly-ig', CALENDLY_BIO, PROFIL)!;
  assert.equal(construireDestinationShortio(ANCIENNE, 'bio-calendly-ig', une, PROFIL), null);
});

test('un /r/ étranger sans `d` n’est pas pris pour une de nos redirections', () => {
  // Le chemin `/r/` seul ne prouve rien : n'importe quel site peut en avoir un.
  // Sans `d`, la route ne saurait pas où rediriger — ce n'est donc pas une des nôtres.
  assert.equal(
    construireDestinationShortio(NOUVELLE, 'x', 'https://exemple.test/r/quelque-chose?utm_medium=bio', PROFIL),
    null,
  );
});

// ── Les UTM d'une requête ne sont pas les nôtres ────────────────────────────
//
// Mesuré le 2026-09-01 sur deux vrais taps depuis la bio Instagram : la requête
// arrivait avec `utm_medium` ABSENT et `utm_content=link_in_bio`. Les préchargements
// d'Instagram, eux, arrivaient intacts — ce sont les clics HUMAINS qui étaient abîmés.

test('link_in_bio passe isValidContentId — c est ce qui rendait la corruption invisible', () => {
  // 11 caractères dans [A-Za-z0-9_-] : la forme exacte d'un identifiant de vidéo
  // YouTube. La garde de lib/contentId.ts l'aurait donc ÉCRIT dans calls.utm_content,
  // et resolveCallSource en aurait déduit la plateforme « yt » pour un clic de bio
  // Instagram. La vue utm_anomalies porte la même règle : elle n'aurait rien signalé.
  assert.equal('link_in_bio'.length, 11);
  assert.equal(estIdContenu('link_in_bio'), true, 'la forme est indiscernable — la parade ne peut pas être une liste noire');
});

test('un clic dont les UTM ont été réécrits ne produit aucune valeur fausse', () => {
  // La requête telle qu'elle est réellement arrivée : utm_medium disparu,
  // utm_content remplacé — et NOS paramètres intacts à côté.
  const recu = new URLSearchParams(
    'utm_source=ig&utm_content=link_in_bio&d=christianpenkov/30min&p=x&m=bio&s=ig&k=bio-instagram',
  );
  assert.deepEqual(champsDuClic(recu), { platform: 'ig', medium: 'bio', content_id: null });

  const url = new URL(construireDestination(recu, null)!);
  assert.equal(url.searchParams.get('utm_medium'), 'bio', 'le medium vient de nous, pas de la requête');
  assert.equal(url.searchParams.get('utm_content'), null, 'link_in_bio ne part PAS vers Calendly');
  assert.equal(url.searchParams.get('utm_campaign'), 'bio-instagram');
});

test('un contenu sur un lien de BIO est refusé par définition, quelle que soit sa forme', () => {
  // Un lien de bio ne vient d'aucun contenu : son utm_content est vide par nature
  // (docs/utm-nomenclature.md). C'est ce qui neutralise le cas observé sans avoir à
  // reconnaître la valeur fautive — y compris si un tiers écrivait `c` lui-même.
  const p = new URLSearchParams('d=x/y&m=bio&s=ig&c=link_in_bio');
  assert.equal(champsDuClic(p).content_id, null);
  assert.equal(new URL(construireDestination(p, null)!).searchParams.get('utm_content'), null);

  // Un vrai identifiant de post sur un lien de bio est refusé aussi : ce n'est pas
  // la valeur qui est en cause, c'est le canal.
  const q = new URLSearchParams('d=x/y&m=bio&s=ig&c=18386797621194807');
  assert.equal(champsDuClic(q).content_id, null);
});

test('sur une description, un contenu valide passe et un contenu inventé non', () => {
  const bon = new URLSearchParams('d=x/y&m=description&s=ig&c=18386797621194807');
  assert.equal(champsDuClic(bon).content_id, '18386797621194807');
  assert.equal(new URL(construireDestination(bon, null)!).searchParams.get('utm_content'), '18386797621194807');

  const mauvais = new URLSearchParams('d=x/y&m=description&s=ig&c=nimportequoi!');
  assert.equal(champsDuClic(mauvais).content_id, null);
});

test('aucun repli sur les utm_ reçus : sans nos paramètres, rien n est classé', () => {
  // Un lien réécrit AVANT l'introduction de `m` produit des clics non classés plutôt
  // que des clics faux. Trou honnête, refermé par la relance du script.
  const p = new URLSearchParams('utm_source=ig&utm_medium=bio&utm_content=18386797621194807&d=x/y');
  assert.deepEqual(champsDuClic(p), { platform: null, medium: null, content_id: null });
  // Et la redirection part quand même : le fail-open ne dépend pas de la classification.
  assert.equal(new URL(construireDestination(p, 'c0ffee00-0000-4000-8000-000000000000')!).origin, 'https://calendly.com');
});

test('utm_term n est jamais transmis depuis un lien partagé', () => {
  // « Qui — le prospect » : un lien partagé n'identifie personne, donc rien de
  // légitime ne peut arriver là. Le laisser passer serait recopier une valeur
  // choisie par l'appelant dans un champ d'attribution.
  const p = new URLSearchParams('d=x/y&m=bio&s=ig&utm_term=quelquun');
  assert.equal(new URL(construireDestination(p, null)!).searchParams.get('utm_term'), null);
});

// ── Mise à niveau des liens déjà réécrits ──────────────────────────────────

test('un lien réécrit avant l introduction de nos paramètres est mis à niveau', () => {
  // Ancien format : que des utm_*, pas de m/s/c/k.
  const ancien = `${ORIGINE}/r/prendre-rdv-4807?utm_source=ig&utm_medium=description&utm_campaign=calendly&utm_content=18386797621194807&d=christianpenkov%2F30min&p=${PROFIL}`;
  const neuf = construireDestinationShortio(ORIGINE, 'prendre-rdv-4807', ancien, PROFIL);
  assert.notEqual(neuf, null, 'doit être mis à niveau, pas ignoré comme « déjà réécrit »');

  const url = new URL(neuf!);
  assert.equal(url.searchParams.get('m'), 'description');
  assert.equal(url.searchParams.get('s'), 'ig');
  assert.equal(url.searchParams.get('c'), '18386797621194807');
  assert.equal(url.searchParams.get('k'), 'calendly');
  // Les utm_* restent : shortio-link-category les lit sur la destination stockée.
  assert.equal(url.searchParams.get('utm_medium'), 'description');
  assert.equal(url.searchParams.get('d'), 'christianpenkov/30min');
  assert.equal(url.searchParams.get('p'), PROFIL);
});

test('une fois à niveau, le script redevient sans effet', () => {
  const neuf = construireDestinationShortio(ORIGINE, 'bio-calendly-ig', CALENDLY_BIO, PROFIL)!;
  assert.equal(new URL(neuf).searchParams.get('m'), 'bio');
  assert.equal(construireDestinationShortio(ORIGINE, 'bio-calendly-ig', neuf, PROFIL), null);
});

test('déménagement et mise à niveau se font en un seul passage', () => {
  const ancienFormatAncienneOrigine =
    `https://ancienne.test/r/prendre-rdv-4807?utm_source=ig&utm_medium=description&utm_content=18386797621194807&d=christianpenkov%2F30min&p=${PROFIL}`;
  const url = new URL(construireDestinationShortio(ORIGINE, 'prendre-rdv-4807', ancienFormatAncienneOrigine, PROFIL)!);
  assert.equal(url.origin, ORIGINE);
  assert.equal(url.searchParams.get('m'), 'description');
  assert.equal(url.searchParams.get('c'), '18386797621194807');
});
