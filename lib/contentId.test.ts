import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidContentId, resolveUtmContent, resolveCallSource, resolveUtmMedium } from './contentId.ts';

// Ces règles décident de l'attribution d'un rendez-vous — quel contenu est crédité,
// et à quelle plateforme. Elles n'avaient aucun test jusqu'au 2026-09-09 : l'alias
// `@/lib/ytId` empêchait `node --test` de charger le fichier.

// ── La forme ne peut pas trancher, et c'est le cœur du sujet ────────────────

test('un pseudo de 11 caractères est INDISCERNABLE d’un identifiant YouTube', () => {
  // C'est un fait, pas un défaut à corriger : un vrai identifiant YouTube EST
  // exactement 11 caractères de [A-Za-z0-9_-]. Le test existe pour qu'on cesse de
  // vouloir resserrer la regex.
  assert.equal(isValidContentId('EMvwzHVjNJg'), true, 'vraie vidéo');
  assert.equal(isValidContentId('leroymerlin'), true, 'pseudo de prospect, même forme');
  assert.equal(isValidContentId('link_in_bio'), true, 'valeur injectée par Instagram, même forme');
  assert.equal('leroymerlin'.length, 11);
});

test('resolveCallSource ne déduit PLUS « yt » de la forme du contenu', () => {
  // Le cas réel : lien de DM d'avant la nomenclature du 19 août, portant le pseudo
  // dans utm_content, et le domaine Short.io dans utm_source.
  assert.equal(
    resolveCallSource('ubizenai.s.gy', 'dm', 'leroymerlin'),
    undefined,
    'un pseudo de 11 caractères ne doit pas produire une source YouTube',
  );
  // Même valeur, mais la plateforme est DITE : elle fait autorité.
  assert.equal(resolveCallSource('ig', 'dm', 'leroymerlin'), 'ig_dm');
  assert.equal(resolveCallSource('yt', 'description', 'EMvwzHVjNJg'), 'yt_description');
});

test('la déduction « ig » sur des chiffres est conservée : elle est non ambiguë', () => {
  // Asymétrie assumée. Un identifiant de post Instagram n'est que des chiffres, et
  // même un pseudo entièrement numérique donnerait « ig » — la bonne réponse, un
  // pseudo ne se trouvant que sur un lien Instagram.
  assert.equal(resolveCallSource('ubizenai.s.gy', 'description', '18056185901693457'), 'ig_description');
  assert.equal(resolveCallSource('ubizenai.s.gy', 'dm', '1234567890'), 'ig_dm');
});

test('sans plateforme résoluble, aucune source — jamais une source fausse', () => {
  assert.equal(resolveCallSource('ubizenai.s.gy', 'dm', 'christian-penkov'), undefined);
  assert.equal(resolveCallSource('ubizenai.s.gy', 'bio', null), undefined);
  assert.equal(resolveCallSource(null, 'bio', '18056185901693457'), undefined);
  // ⚠️ L'appelant doit alors OMETTRE la clé, jamais écrire null par-dessus une
  // valeur correcte — garde posée dans calendly-fetch.ts et sync-calendly.
});

// ── Champ vide plutôt que champ faux ───────────────────────────────────────

test('resolveUtmContent n’écrit jamais une valeur invalide, même sur un champ vide', () => {
  assert.equal(resolveUtmContent('un-pseudo', null), undefined);
  assert.equal(resolveUtmContent('un-pseudo', '18056185901693457'), '18056185901693457',
    'la valeur déjà en base est conservée plutôt que remplacée par une invalide');
  assert.equal(resolveUtmContent('18056185901693457', null), '18056185901693457');
  assert.equal(resolveUtmContent(null, null), undefined);
});

test('resolveUtmMedium n’accepte que la nomenclature fermée', () => {
  for (const m of ['bio', 'description', 'dm', 'story']) assert.equal(resolveUtmMedium(m), m);
  assert.equal(resolveUtmMedium('post'), undefined);
  assert.equal(resolveUtmMedium('leadmagnet'), undefined);
  assert.equal(resolveUtmMedium(null), undefined);
});

test('un identifiant de séquence story reste un contenu valide', () => {
  // La copie SQL de utm_anomalies avait oublié cette branche, et signalait à tort
  // tout rendez-vous venu d'une story (2026-08-19).
  assert.equal(isValidContentId('d1ad9817-7369-4a52-b66e-6465644ef83a'), true);
});
