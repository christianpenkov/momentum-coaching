// Tests des deux décisions pures de la collecte Instagram.
//
//   npx deno test supabase/functions/_shared/ig-posts.test.ts
//
// ⚠️ `npm test` (node --test) ne couvre PAS supabase/functions/ — il ne voit que
// lib/*.test.ts. Ce fichier se lance séparément, comme `deno check`.
//
// Pourquoi ces deux-là et pas le reste : ce sont les seules décisions du module
// dont une erreur ne produirait AUCUN symptôme. Une cadence divisée par deux, ou
// une clôture de journée décalée de quatre heures, ne lève rien, n'écrit rien dans
// cron_runs, et ne se voit sur aucun écran — seulement des chiffres légèrement
// faux, tous les jours.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { datesDuSnapshot, debutCreneauMs, decalageProfilMinutes } from './ig-posts.ts';

const MIN = 60_000;
const H = (h: number, m = 0) => (h * 60 + m) * MIN;

/** Rejoue une journée entière minute par minute et rend les minutes où la garde
 *  de cadence laisse passer un vrai passage. */
function passagesDUneJournee(profileId: string): number[] {
  const passages: number[] = [];
  let dernierPassageMs: number | null = null;
  for (let m = 0; m < 24 * 60; m++) {
    const ms = m * MIN;
    const debut = debutCreneauMs(profileId, ms);
    if (ms < debut) continue;
    if (dernierPassageMs !== null && dernierPassageMs >= debut) continue;
    passages.push(m);
    dernierPassageMs = ms;
  }
  return passages;
}

Deno.test('cadence : exactement 6 passages par jour, espacés de 4 h', () => {
  for (let i = 0; i < 300; i++) {
    const id = `profil-${i}-${(i * 7919).toString(16)}`;
    const p = passagesDUneJournee(id);
    assertEquals(p.length, 6, `${id} : ${p.length} passages au lieu de 6`);
    const ecarts = p.slice(1).map((v, k) => v - p[k]);
    assertEquals(ecarts, [240, 240, 240, 240, 240], `${id} : écarts ${ecarts}`);
  }
});

Deno.test('cadence : le premier passage tombe dans l heure qui suit minuit Paris', () => {
  // C'est ce qui garantit que la clôture de la veille reste possible (elle exige
  // d'être dans le premier créneau, avant 04 h).
  for (let i = 0; i < 300; i++) {
    const id = `profil-${i}-${(i * 7919).toString(16)}`;
    const premier = passagesDUneJournee(id)[0];
    assertEquals(premier, decalageProfilMinutes(id), `${id} : 1er passage à ${premier} min`);
    assertEquals(premier < 55, true, `${id} : 1er passage à ${premier} min après minuit`);
  }
});

Deno.test('cadence : le décalage est stable et ne dépend d aucun état', () => {
  const id = 'a02e5927-7b39-4b7d-b112-0a43b30e9f09';
  const d = decalageProfilMinutes(id);
  for (let i = 0; i < 50; i++) assertEquals(decalageProfilMinutes(id), d);
  // Deux identifiants différents ne doivent pas tous retomber sur la même minute :
  // c'est tout l'intérêt de l'étalement.
  const minutes = new Set(Array.from({ length: 200 }, (_, i) => decalageProfilMinutes(`p-${i}`)));
  assertEquals(minutes.size > 30, true, `étalement trop faible : ${minutes.size} minutes distinctes`);
});

const A = '2026-08-31', HIER = '2026-08-30';
const dates = (ms: number, premier: boolean, hierExiste: boolean) =>
  datesDuSnapshot({ aujourdhui: A, hier: HIER, msDepuisMinuit: ms, premierPassageDuJour: premier, ligneHierExiste: hierExiste });

Deno.test('clôture : le premier passage du jour fige la veille', () => {
  assertEquals(dates(H(0, 11), true, true), [A, HIER]);
  assertEquals(dates(0, true, true), [A, HIER]);
  assertEquals(dates(H(3, 59), true, true), [A, HIER]);
});

Deno.test('clôture : les passages suivants ne touchent JAMAIS la veille', () => {
  // Le défaut de l'ancien code : une ligne du 26 août réécrite le 27 à 12 h 10 par
  // un clic sur « Actualiser », donc gonflée de 12 h de trafic du 27.
  assertEquals(dates(H(4, 11), false, true), [A]);
  assertEquals(dates(H(12, 11), false, true), [A]);
  assertEquals(dates(H(20, 11), false, true), [A]);
  assertEquals(dates(H(23, 59), false, true), [A]);
  // Même quand le cron est resté muet depuis minuit : passé 04 h, la valeur que la
  // ligne d'hier porte déjà (dernier passage d'hier) est plus juste que celle d'un
  // relevé pris aujourd'hui.
  assertEquals(dates(H(14), true, true), [A]);
  assertEquals(dates(H(4), true, true), [A]);
});

Deno.test('clôture : jamais de trou quand la ligne d hier n existe pas', () => {
  assertEquals(dates(H(15), true, false), [A, HIER]);
  assertEquals(dates(H(9), true, false), [A, HIER]);
  assertEquals(dates(H(12), false, false), [A, HIER]);
});

Deno.test('clôture : exactement une par jour et par profil', () => {
  for (let i = 0; i < 200; i++) {
    const id = `p-${i}-${(i * 104729).toString(36)}`;
    let premier = true, clotures = 0;
    for (const m of passagesDUneJournee(id)) {
      if (dates(m * MIN, premier, true).length === 2) clotures++;
      premier = false;
    }
    assertEquals(clotures, 1, `${id} : ${clotures} clôtures dans la journée`);
  }
});
