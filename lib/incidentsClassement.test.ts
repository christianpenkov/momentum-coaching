import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classerReponseSupabase, normaliserMessage, empreinte, nettoyerEntetes, nettoyerUrl,
  routeDepuisPile, versionGraphSurclassee, estBruitNavigateur, estBruitServeur, routeEstCritique,
} from './incidentsClassement.ts';

// Lancé par `npm test`. Ce module décide ce qui réveille le mainteneur : une règle
// trop large l'inonde (et il cesse de lire), une règle trop étroite le laisse dormir
// pendant une vraie panne. Les deux côtés sont testés.

const BASE = 'https://nvjgwtetyuatnkjihmtw.supabase.co';
const corps = (o: object) => JSON.stringify(o);

// ── Ce qui EST un incident ───────────────────────────────────────────────────

test('une écriture refusée est critique, même si l’appelant ne lit pas son erreur', () => {
  const c = classerReponseSupabase({
    methode: 'POST', url: `${BASE}/rest/v1/calls?on_conflict=calendly_event_uri`, statut: 400,
    corps: corps({ code: '42703', message: 'column calls.foo does not exist', details: null, hint: null }),
  });
  assert.ok(c);
  assert.equal(c.gravite, 'critique');
  assert.equal(c.cible, 'calls');
  assert.equal(c.service, 'rest');
  assert.equal(c.code, '42703');
});

test('un PATCH et un DELETE refusés sont critiques', () => {
  for (const methode of ['PATCH', 'DELETE']) {
    const c = classerReponseSupabase({ methode, url: `${BASE}/rest/v1/deals?id=eq.1`, statut: 403, corps: corps({ code: '42501', message: 'permission denied' }) });
    assert.equal(c?.gravite, 'critique', methode);
  }
});

test('un RPC en erreur est critique, même en GET (la plupart écrivent)', () => {
  const c = classerReponseSupabase({ methode: 'POST', url: `${BASE}/rest/v1/rpc/upsert_yt_ctr`, statut: 400, corps: corps({ code: 'P0001', message: 'boom' }) });
  assert.equal(c?.service, 'rpc');
  assert.equal(c?.cible, 'upsert_yt_ctr');
  assert.equal(c?.gravite, 'critique');
});

test('une lecture refusée (colonne inconnue) est un incident normal — l’écran vide qui ment', () => {
  const c = classerReponseSupabase({ methode: 'GET', url: `${BASE}/rest/v1/deal_events?select=foo`, statut: 400, corps: corps({ code: '42703', message: 'column does not exist' }) });
  assert.equal(c?.gravite, 'normale');
});

test('un 5xx sans corps JSON reste un incident, avec le début du corps', () => {
  const c = classerReponseSupabase({ methode: 'POST', url: `${BASE}/rest/v1/calls`, statut: 502, corps: '<html>Bad gateway</html>' });
  assert.ok(c);
  assert.match(c.message, /HTTP 502 — <html>Bad gateway/);
});

test('un envoi de fichier refusé au stockage est critique (le vocal Instagram de 2026-09-04)', () => {
  const c = classerReponseSupabase({ methode: 'POST', url: `${BASE}/storage/v1/object/ig-vocaux/a/b.m4a`, statut: 400, corps: corps({ statusCode: '415', error: 'invalid_mime_type', message: 'mime type video/mp4 is not supported' }) });
  assert.equal(c?.service, 'storage');
  assert.equal(c?.cible, 'ig-vocaux');
  assert.equal(c?.gravite, 'critique');
});

// ── Ce qui n'en est PAS un ───────────────────────────────────────────────────

test('les succès ne sont jamais des incidents', () => {
  assert.equal(classerReponseSupabase({ methode: 'POST', url: `${BASE}/rest/v1/calls`, statut: 201, corps: null }), null);
  assert.equal(classerReponseSupabase({ methode: 'GET', url: `${BASE}/rest/v1/calls`, statut: 206, corps: null }), null);
});

test('.single() sans ligne, doublon d’idempotence et session expirée ne réveillent personne', () => {
  assert.equal(classerReponseSupabase({ methode: 'GET', url: `${BASE}/rest/v1/profiles`, statut: 406, corps: corps({ code: 'PGRST116', message: 'no rows' }) }), null);
  assert.equal(classerReponseSupabase({ methode: 'POST', url: `${BASE}/rest/v1/stripe_payments`, statut: 409, corps: corps({ code: '23505', message: 'duplicate key' }) }), null);
  assert.equal(classerReponseSupabase({ methode: 'GET', url: `${BASE}/rest/v1/calls`, statut: 401, corps: corps({ code: 'PGRST303', message: 'JWT expired' }) }), null);
});

test('l’authentification n’est pas surveillée — un mot de passe faux n’est pas une panne', () => {
  assert.equal(classerReponseSupabase({ methode: 'POST', url: `${BASE}/auth/v1/token?grant_type=password`, statut: 400, corps: corps({ error: 'invalid_grant' }) }), null);
});

test('un fichier absent à la lecture n’est pas une panne', () => {
  assert.equal(classerReponseSupabase({ methode: 'GET', url: `${BASE}/storage/v1/object/public/avatars/x.png`, statut: 400, corps: corps({ statusCode: '404', error: 'not_found' }) }), null);
  assert.equal(classerReponseSupabase({ methode: 'GET', url: `${BASE}/storage/v1/object/sign/ig-vocaux/x`, statut: 404, corps: null }), null);
});

test('une URL illisible ou étrangère à Supabase est ignorée', () => {
  assert.equal(classerReponseSupabase({ methode: 'POST', url: 'pas une url', statut: 500, corps: null }), null);
  assert.equal(classerReponseSupabase({ methode: 'POST', url: `${BASE}/functions/v1/poll-leads`, statut: 500, corps: null }), null);
});

// ── Empreinte : même panne = même incident ──────────────────────────────────

test('deux occurrences de la même panne sur des lignes différentes gardent la même empreinte', () => {
  const a = normaliserMessage('insert or update on table "calls" violates foreign key constraint for id 3f9c1a2b-1234-4abc-9def-0123456789ab at 2026-09-13T10:00:01.123Z');
  const b = normaliserMessage('insert or update on table "deals" violates foreign key constraint for id 99999999-aaaa-4bbb-8ccc-dddddddddddd at 2026-09-14T11:22:33Z');
  assert.equal(a, b);
  assert.equal(empreinte(['x', a]), empreinte(['x', b]));
});

test('deux pannes différentes ont deux empreintes', () => {
  assert.notEqual(empreinte(['rest', 'calls', '42703']), empreinte(['rest', 'deals', '42703']));
  assert.match(empreinte(['a']), /^[0-9a-f]{16}$/);
});

// ── Aucun secret ne sort ─────────────────────────────────────────────────────

test('les en-têtes porteurs de secret sont retirés', () => {
  const e = nettoyerEntetes({ authorization: 'Bearer abc', cookie: 'sb=1', 'stripe-signature': 't=1', 'user-agent': 'Mozilla', apikey: 'k', 'x-hub-signature-256': 'sha' });
  assert.equal(e.authorization, '[retiré]');
  assert.equal(e.cookie, '[retiré]');
  assert.equal(e['stripe-signature'], '[retiré]');
  assert.equal(e.apikey, '[retiré]');
  assert.equal(e['x-hub-signature-256'], '[retiré]');
  assert.equal(e['user-agent'], 'Mozilla');
});

test('le jeton d’accès d’une URL Graph API est retiré', () => {
  assert.equal(
    nettoyerUrl('https://graph.instagram.com/v21.0/me/media?fields=id&access_token=IGQVJ123&limit=5'),
    'https://graph.instagram.com/v21.0/me/media?fields=id&access_token=[retiré]&limit=5',
  );
});

// ── Contexte ────────────────────────────────────────────────────────────────

test('la route émettrice se lit dans la pile Vercel', () => {
  const pile = `Error\n    at fetch (/var/task/.next/server/chunks/123.js:1:10)\n    at POST (/var/task/.next/server/app/api/webhooks/stripe/route.js:1:2345)`;
  assert.equal(routeDepuisPile(pile), '/api/webhooks/stripe/route');
  assert.equal(routeDepuisPile('Error\n at x (node:internal)'), null);
});

test('les routes critiques sont reconnues avec ou sans le préfixe /app', () => {
  assert.equal(routeEstCritique('/app/api/webhooks/stripe/route'), true);
  assert.equal(routeEstCritique('/api/payments/deals/[id]/cancel'), true);
  assert.equal(routeEstCritique('/r/[token]'), true);
  assert.equal(routeEstCritique('/api/youtube/stats'), false);
  assert.equal(routeEstCritique(null), false);
});

test('une version Graph surclassée par Meta est détectée, une version servie telle quelle non', () => {
  assert.deepEqual(versionGraphSurclassee('https://graph.facebook.com/v19.0/me', 'v20.0'), { demandee: 'v19.0', servie: 'v20.0' });
  assert.equal(versionGraphSurclassee('https://graph.instagram.com/v22.0/me', 'v22.0'), null);
  assert.equal(versionGraphSurclassee('https://graph.instagram.com/v22.0/me', null), null);
  assert.equal(versionGraphSurclassee('https://api.stripe.com/v1/charges', 'v20.0'), null);
});

test('le bruit du navigateur est écarté, une vraie erreur de code ne l’est pas', () => {
  assert.equal(estBruitNavigateur('ResizeObserver loop completed with undelivered notifications.'), true);
  assert.equal(estBruitNavigateur('Load failed'), true);
  assert.equal(estBruitNavigateur('ChunkLoadError: Loading chunk 123 failed.'), true);
  assert.equal(estBruitNavigateur('x', 'chrome-extension://abc/content.js'), true);
  assert.equal(estBruitNavigateur("TypeError: Cannot read properties of undefined (reading 'fond')"), false);
  assert.equal(estBruitNavigateur('Error: la vente a été canceled par Stripe'), false);
});

test('un client parti n’est pas une panne serveur', () => {
  assert.equal(estBruitServeur({ name: 'AbortError', message: 'x' }), true);
  assert.equal(estBruitServeur({ name: 'Error', message: 'socket hang up (client closed request)' }), true);
  assert.equal(estBruitServeur({ name: 'TypeError', message: 'Cannot read properties of undefined' }), false);
});
