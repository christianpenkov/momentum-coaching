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

test('construireDestination reporte les UTM et pose le Click ID', () => {
  const p = new URLSearchParams('utm_source=ig&utm_medium=bio&utm_campaign=bio-instagram&d=christianpenkov/30min');
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

test('construireDestination tronque une valeur d’UTM à la limite Calendly', () => {
  const p = new URLSearchParams({ d: 'x/y', utm_campaign: 'c'.repeat(400) });
  const url = new URL(construireDestination(p, null)!);
  assert.equal(url.searchParams.get('utm_campaign')!.length, 255);
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
    champsDuClic(new URLSearchParams('utm_source=ig&utm_medium=bio')),
    { platform: 'ig', medium: 'bio', content_id: null },
  );
  assert.deepEqual(
    champsDuClic(new URLSearchParams('utm_source=yt&utm_medium=description&utm_content=EMvwzHVjNJg')),
    { platform: 'yt', medium: 'description', content_id: 'EMvwzHVjNJg' },
  );
  // Champ vide plutôt que champ faux — même règle que lib/contentId.ts.
  assert.deepEqual(
    champsDuClic(new URLSearchParams('utm_source=ubizenai.s.gy&utm_medium=post')),
    { platform: null, medium: null, content_id: null },
  );
  // `dm` n'est pas un canal partagé : un lien de DM ne devrait jamais passer ici.
  assert.equal(champsDuClic(new URLSearchParams('utm_medium=dm')).medium, null);
});
