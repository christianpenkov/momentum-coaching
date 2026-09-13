import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerFiletFetch, ENTETE_SIGNALEMENT, type IncidentASignaler } from './incidents.ts';
import { nettoyerCorps, retirerLigneEnEchec } from './incidentsClassement.ts';

// Lancé par `npm test`. Le filet enveloppe le `fetch` de TOUTE la plateforme : un défaut
// ici casserait chaque requête vers la base. Ces tests prouvent d'abord qu'il ne change
// RIEN à ce que l'appelant reçoit, ensuite qu'il signale ce qu'il doit.

const SUPA = 'https://exemple.supabase.co';

function fauxFetch(reponse: () => Response | Promise<Response>) {
  const appels: { input: unknown; init?: RequestInit }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    appels.push({ input, init });
    return reponse();
  }) as typeof fetch;
  return { f, appels };
}

function filet(reponse: () => Response | Promise<Response>) {
  const { f, appels } = fauxFetch(reponse);
  const signales: IncidentASignaler[] = [];
  const fetchSurveille = creerFiletFetch(f, {
    supabaseUrl: SUPA,
    source: 'test',
    signaler: async (i) => { signales.push(i); },
  });
  return { fetchSurveille, appels, signales };
}

// ── Il ne change rien ────────────────────────────────────────────────────────

test('une URL étrangère passe telle quelle, sans lecture ni signalement', async () => {
  const { fetchSurveille, appels, signales } = filet(() => new Response('ok', { status: 500 }));
  const init = { method: 'POST', body: 'x' };
  const r = await fetchSurveille('https://api.stripe.com/v1/charges', init);
  assert.equal(r.status, 500);
  assert.equal(await r.text(), 'ok');
  assert.equal(appels.length, 1);
  assert.equal(appels[0].init, init, 'les arguments d’origine sont transmis tels quels');
  assert.equal(signales.length, 0);
});

test('une réponse Supabase en échec reste LISIBLE par l’appelant après inspection', async () => {
  const corps = JSON.stringify({ code: '42703', message: 'column does not exist' });
  const { fetchSurveille, signales } = filet(() => new Response(corps, { status: 400, headers: { 'content-type': 'application/json' } }));
  const r = await fetchSurveille(`${SUPA}/rest/v1/calls`, { method: 'POST', body: '{"a":1}' });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), JSON.parse(corps), 'le corps n’a pas été consommé par le filet');
  assert.equal(signales.length, 1);
});

test('la requête d’origine part UNE seule fois, même en échec', async () => {
  const { fetchSurveille, appels } = filet(() => new Response('{}', { status: 500 }));
  await fetchSurveille(`${SUPA}/rest/v1/deals`, { method: 'PATCH', body: '{}' });
  assert.equal(appels.length, 1);
});

test('une exception réseau est relancée à l’identique', async () => {
  const boum = new TypeError('fetch failed');
  const signales: IncidentASignaler[] = [];
  const fetchSurveille = creerFiletFetch((async () => { throw boum; }) as typeof fetch, {
    supabaseUrl: SUPA, source: 'test', signaler: async (i) => { signales.push(i); },
  });
  await assert.rejects(() => fetchSurveille(`${SUPA}/rest/v1/calls`, { method: 'POST' }), (e) => e === boum);
  assert.equal(signales.length, 1);
  assert.equal(signales[0].detail.type, 'supabase_injoignable');
});

test('un signalement qui plante ne casse pas la requête', async () => {
  const { f } = fauxFetch(() => new Response('{"code":"XX000","message":"boom"}', { status: 500 }));
  const fetchSurveille = creerFiletFetch(f, {
    supabaseUrl: SUPA, source: 'test', signaler: async () => { throw new Error('base en panne'); },
  });
  const r = await fetchSurveille(`${SUPA}/rest/v1/calls`, { method: 'POST' });
  assert.equal(r.status, 500);
});

test('un succès Supabase n’est ni lu ni signalé', async () => {
  const { fetchSurveille, signales } = filet(() => new Response('[]', { status: 200 }));
  const r = await fetchSurveille(`${SUPA}/rest/v1/calls?select=id`);
  assert.equal(await r.text(), '[]');
  assert.equal(signales.length, 0);
});

test('nos propres signalements ne sont jamais regardés (pas de boucle)', async () => {
  const { fetchSurveille, signales } = filet(() => new Response('{"message":"x"}', { status: 500 }));
  await fetchSurveille(`${SUPA}/rest/v1/rpc/signaler_incident`, { method: 'POST', headers: { [ENTETE_SIGNALEMENT]: '1' } });
  await fetchSurveille(`${SUPA}/rest/v1/rpc/signaler_incident`, { method: 'POST', headers: new Headers({ [ENTETE_SIGNALEMENT]: '1' }) });
  assert.equal(signales.length, 0);
});

// ── Il signale ce qu'il doit ────────────────────────────────────────────────

test('une écriture refusée devient un incident critique avec tout le contexte, sans secret', async () => {
  const { fetchSurveille, signales } = filet(() => new Response(JSON.stringify({
    code: '23502', message: 'null value in column "provider" violates not-null constraint',
    details: 'Failing row contains (1, abc, null, IGQVJsecret)', hint: null,
  }), { status: 400 }));
  await fetchSurveille(`${SUPA}/rest/v1/integrations?on_conflict=profile_id`, {
    method: 'POST', body: JSON.stringify({ profile_id: 'p', access_token: 'IGQVJsecret', refresh_token: 'r' }),
  });
  assert.equal(signales.length, 1);
  const i = signales[0];
  assert.equal(i.gravite, 'critique');
  assert.match(i.titre, /POST integrations/);
  const texte = JSON.stringify(i.detail);
  assert.ok(!texte.includes('IGQVJsecret'), 'aucun jeton ne sort dans le détail');
  assert.equal(i.detail.code, '23502');
  assert.ok(i.detail.pile_appel, 'la pile d’appel est capturée');
});

test('la même panne donne la même empreinte d’une ligne à l’autre', async () => {
  const { fetchSurveille, signales } = filet(() => new Response(JSON.stringify({ code: '42501', message: 'permission denied for table deals' }), { status: 403 }));
  await fetchSurveille(`${SUPA}/rest/v1/deals?id=eq.11111111-1111-4111-8111-111111111111`, { method: 'PATCH' });
  await fetchSurveille(`${SUPA}/rest/v1/deals?id=eq.22222222-2222-4222-8222-222222222222`, { method: 'PATCH' });
  assert.deepEqual(signales[0].empreinte, signales[1].empreinte);
});

test('une version Graph surclassée est signalée ; une réponse normale non', async () => {
  const { fetchSurveille, signales } = filet(() => new Response('{}', { status: 200, headers: { 'facebook-api-version': 'v22.0' } }));
  await fetchSurveille('https://graph.instagram.com/v21.0/me?access_token=SECRET');
  assert.equal(signales.length, 1);
  assert.equal(signales[0].gravite, 'normale');
  assert.ok(!JSON.stringify(signales[0]).includes('SECRET'));

  const sain = filet(() => new Response('{}', { status: 200, headers: { 'facebook-api-version': 'v22.0' } }));
  await sain.fetchSurveille('https://graph.instagram.com/v22.0/me');
  assert.equal(sain.signales.length, 0);
});

// ── Nettoyage des corps ─────────────────────────────────────────────────────

test('les secrets d’un corps JSON sont retirés à toute profondeur', () => {
  const c = nettoyerCorps(JSON.stringify({ a: 1, access_token: 'X', nested: { refresh_token: 'Y', client_secret: 'Z', ok: 'garde' }, liste: [{ api_key: 'K' }] }));
  assert.ok(c);
  assert.ok(!/X|Y|Z|"K"/.test(c.replace(/\[retiré\]/g, '')));
  assert.match(c, /garde/);
});

test('un corps non JSON perd aussi ses secrets', () => {
  assert.equal(nettoyerCorps('grant_type=refresh&refresh_token=abc&client_secret=def'), 'grant_type=refresh&refresh_token=[retiré]&client_secret=[retiré]');
});

test('la ligne recopiée par Postgres dans une violation est retirée', () => {
  assert.equal(retirerLigneEnEchec('Failing row contains (1, tok_123, x).'), 'Failing row contains (…) [valeurs retirées].');
  assert.equal(retirerLigneEnEchec('Key (email)=(a@b.fr) already exists.'), 'Key (email)=(…) already exists.');
});
