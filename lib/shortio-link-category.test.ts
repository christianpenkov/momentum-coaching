import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinkCategoryResolver, BUSINESS_CATEGORIES, CATEGORY_GROUPS } from './shortio-link-category.ts';

// Références réelles du profil de test a02e5927 (content_links + prospect_links),
// relevées en base le 2026-08-28.
const refs = {
  contentLinks: [
    { platform: 'IG', desc_calendly_short_url: null, desc_lm_short_url: 'https://link.ubizenai.com/tunnel-closing-1891', lm_short_url: 'https://link.ubizenai.com/tunnel-publication-instagra' },
    { platform: 'IG', desc_calendly_short_url: 'https://ubizenai.s.gy/prendre-rdv-4807', desc_lm_short_url: null, lm_short_url: null },
    { platform: 'IG', desc_calendly_short_url: 'https://ubizenai.s.gy/prendre-rdv-3457', desc_lm_short_url: 'https://ubizenai.s.gy/lm-ubizen-ai-3457', lm_short_url: 'https://ubizenai.s.gy/lm-publication-instagra' },
    { platform: 'IG', desc_calendly_short_url: null, desc_lm_short_url: 'https://ubizenai.s.gy/tunnel-closing-6572', lm_short_url: 'https://ubizenai.s.gy/lm-guide-6572' },
    { platform: 'IG', desc_calendly_short_url: 'https://link.ubizenai.com/prendre-rdv-9699', desc_lm_short_url: null, lm_short_url: null },
    { platform: 'YT', desc_calendly_short_url: 'https://ubizenai.s.gy/prendre-rdv-jNJg', desc_lm_short_url: null, lm_short_url: null },
  ],
  prospectShortUrls: [
    'https://ubizenai.s.gy/prendre-rdv-christian-penkov',
    'https://ubizenai.s.gy/prendre-rdv-incogniton-734',
    'https://link.ubizenai.com/prendre-rdv-rdjdkzjd',
  ],
};

const resolve = createLinkCategoryResolver(refs);

// Chaque cas vient d'une ligne réelle de shortio_link_daily_snapshots.
const CAS: [path: string, shortUrl: string, originalUrl: string, attendu: string | null][] = [
  // ── Bio ──────────────────────────────────────────────────────────────────
  ['bio-calendly-ig', 'https://ubizenai.s.gy/bio-calendly-ig', 'https://calendly.com/christianpenkov/30min?utm_source=ig&utm_medium=bio&utm_campaign=bio-instagram', 'calendly_bio_ig'],
  ['bio-calendly-yt', 'https://ubizenai.s.gy/bio-calendly-yt', 'https://calendly.com/christianpenkov/30min?utm_source=yt&utm_medium=bio&utm_campaign=bio-youtube', 'calendly_bio_yt'],
  // utm_source vaut le domaine Short.io sur les liens créés avant 2026-07 :
  // c'est utm_campaign qui doit trancher la plateforme.
  ['bio-ig', 'https://ubizenai.s.gy/bio-ig', 'https://calendly.com/christianpenkov/30min?utm_source=ubizenai.s.gy&utm_medium=bio&utm_campaign=bio-instagram', 'calendly_bio_ig'],
  ['bio-yt', 'https://ubizenai.s.gy/bio-yt', 'https://calendly.com/christianpenkov/30min?utm_source=ubizenai.s.gy&utm_medium=bio&utm_campaign=bio-youtube', 'calendly_bio_yt'],
  ['lm-bio-ig', 'https://ubizenai.s.gy/lm-bio-ig', 'https://ubizenai.com/?utm_source=ig&utm_medium=bio&utm_campaign=lm-bio-ig', 'lm_bio_ig'],
  ['lm-bio-yt', 'https://ubizenai.s.gy/lm-bio-yt', 'https://ubizenai.com/?utm_source=yt&utm_medium=bio&utm_campaign=lm-bio-yt', 'lm_bio_yt'],
  // Le path ne commence pas par "lm-" mais la campagne dit "lm-bio-ig" :
  // l'ancienne heuristique de path renvoyait calendly_bio_ig (clic de lead magnet
  // compté comme une prise de rendez-vous).
  ['tunnel-closing-ig', 'https://ubizenai.s.gy/tunnel-closing-ig', 'https://google.com/?utm_source=ig&utm_medium=bio&utm_campaign=lm-bio-ig', 'lm_bio_ig'],
  ['tunnel-closing-yt', 'https://ubizenai.s.gy/tunnel-closing-yt', 'https://google.com/?utm_source=yt&utm_medium=bio&utm_campaign=lm-bio-yt', 'lm_bio_yt'],

  // ── Description (présent dans content_links) ──────────────────────────────
  ['prendre-rdv-3457', 'https://ubizenai.s.gy/prendre-rdv-3457', 'https://calendly.com/christianpenkov/30min?utm_source=ig&utm_medium=description&utm_campaign=calendly&utm_content=18056185901693457', 'calendly_desc_ig'],
  ['prendre-rdv-jNJg', 'https://ubizenai.s.gy/prendre-rdv-jNJg', 'https://calendly.com/christianpenkov/30min?utm_source=yt&utm_medium=description&utm_campaign=calendly&utm_content=EMvwzHVjNJg', 'calendly_desc_yt'],
  ['lm-ubizen-ai-3457', 'https://ubizenai.s.gy/lm-ubizen-ai-3457', 'https://ubizenai.com/?utm_source=ig&utm_medium=description&utm_campaign=lm-desc', 'lm_desc_ig'],

  // ── Description ABSENT de content_links (contenu supprimé, lien régénéré,
  //    ou changement de domaine) : ne doit plus retomber sur null. ───────────
  ['prendre-rdv-3257', 'https://ubizenai.s.gy/prendre-rdv-3257', 'https://calendly.com/christianpenkov/30min?utm_source=ubizenai.s.gy&utm_medium=description&utm_campaign=calendly&utm_content=181002804771032', 'calendly_desc_ig'],
  ['prendre-rdv-abcd', 'https://ubizenai.s.gy/prendre-rdv-abcd', 'https://calendly.com/christianpenkov/30min?utm_source=yt&utm_medium=description&utm_campaign=calendly&utm_content=xyz', 'calendly_desc_yt'],

  // ── DM prospect ──────────────────────────────────────────────────────────
  ['prendre-rdv-incogniton-734', 'https://ubizenai.s.gy/prendre-rdv-incogniton-734', 'https://calendly.com/christianpenkov/30min?utm_source=ig&utm_medium=dm&utm_campaign=prospect', 'calendly_dm_prospect'],

  // ── Lead magnet DM auto ──────────────────────────────────────────────────
  ['lm-publication-instagra', 'https://ubizenai.s.gy/lm-publication-instagra', 'https://ubizenai.com/?utm_source=ig&utm_medium=leadmagnet&utm_campaign=lm', 'lm_dm_auto'],
  ['beau-grand-pirouettes-vag', 'https://ubizenai.s.gy/beau-grand-pirouettes-vag', 'https://ubizenai.com/', 'lm_dm_auto'],

  // ── Story ────────────────────────────────────────────────────────────────
  // Cas que la copie de backfill-shortio renvoyait à null faute de branche story.
  ['story-calendly-s-quence-test-webhook', 'https://ubizenai.s.gy/story-calendly-s-quence-test-webhook', 'https://calendly.com/christianpenkov/30min?utm_source=ig&utm_medium=story&utm_campaign=s-quence-test-webhook&utm_content=d1ad9817', 'calendly_story'],
  ['lm-story-storytest-incogniton.734', 'https://ubizenai.s.gy/lm-story-storytest-incogniton.734', 'https://ubizenai.com/?utm_source=ig&utm_medium=story&utm_campaign=lm-story-storytest&utm_content=incogniton.734', 'calendly_story'],

  // ── Hors périmètre acquisition : doit rester null ─────────────────────────
  ['yI6wBQ', 'https://link.ubizenai.com/yI6wBQ', 'https://buy.stripe.com/test_9B600j1OB1t4dti1jk7Vm04?utm_source=ig&utm_medium=payment&utm_campaign=deal-4a8dde35', null],
  ['KdBBRS', 'https://ubizenai.s.gy/KdBBRS', 'https://drive.google.com/file/d/1nJlxee9N_78OwwleT4gkvx5mH8F8juFi/view?usp=sharing', null],
];

test('resolveLinkCategory — cas réels relevés en base', () => {
  for (const [path, shortUrl, originalUrl, attendu] of CAS) {
    assert.equal(resolve(path, shortUrl, originalUrl), attendu, `path=${path}`);
  }
});

test('un lien sans URL de destination ne fait pas planter le résolveur', () => {
  assert.equal(resolve('bio-calendly-ig', 'https://x.gy/bio-calendly-ig', ''), null);
  assert.equal(resolve('', '', ''), null);
});

test('les groupes du graphique couvrent exactement BUSINESS_CATEGORIES', () => {
  const dansGroupes = new Set(Object.values(CATEGORY_GROUPS).flat());
  for (const c of BUSINESS_CATEGORIES) {
    assert.ok(dansGroupes.has(c), `${c} est comptée dans « Clics totaux » mais n'apparaît dans aucun filtre du graphique`);
  }
  for (const c of dansGroupes) {
    assert.ok((BUSINESS_CATEGORIES as readonly string[]).includes(c), `${c} apparaît dans un filtre du graphique mais n'est pas comptée dans « Clics totaux »`);
  }
});
