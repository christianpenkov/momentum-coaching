import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METRIQUES,
  agreger,
  granulariteDe,
  intituleColonneCourbe,
  libelleComparaison,
  semaineAccompagnement,
  ancienneteEnJours,
  trierLignes,
  filtrerLignes,
  formaterValeur,
  formaterVariation,
  tauxCollecte,
  sequenceFenetres,
  type LigneEleve,
} from './statsClients.ts';

// Lancé par `npm test`. Fonctions pures : ni React, ni réseau, ni base.

function ligne(p: Partial<LigneEleve> = {}): LigneEleve {
  return {
    id: 'c1', profileId: 'p1', nom: 'Alice Martin', niche: 'Nutrition',
    semaine: 10, abonnesIg: 1000, abonnesYt: 100,
    variationIg: 10, variationYt: 1, publications: 3, leads: 5, callsBookes: 2,
    cashContracte: 1000, cashCollecte: 500, serie: [], etat: null,
    ...p,
  };
}

/* ═══ agreger : la règle qui évite les erreurs d'un facteur sept ═══════════ */

test('niveau : la DERNIÈRE valeur connue, pas la somme', () => {
  // Sommer des abonnés sur sept jours donnerait sept fois le nombre d'abonnés.
  assert.equal(agreger([250, 252, 255], 'niveau'), 255);
});

test('niveau : les trous sont sautés, pas pris pour la dernière valeur', () => {
  // yt_subscribers peut être nul les derniers jours avant le passage du cron. Prendre
  // bêtement la plus récente rendrait null pour un élève qui a des abonnés.
  assert.equal(agreger([250, 255, null, null], 'niveau'), 255);
});

test('flux : la somme', () => {
  assert.equal(agreger([16, 28, 3], 'flux'), 47);
});

test('flux : les trous ne comptent pas pour zéro dans la somme', () => {
  assert.equal(agreger([10, null, 5], 'flux'), 15);
});

test('tout inconnu reste inconnu — jamais un zéro', () => {
  // Un 0 affirme qu'il ne s'est rien passé. Un null dit qu'on ne sait pas.
  assert.equal(agreger([null, null], 'flux'), null);
  assert.equal(agreger([], 'niveau'), null);
});

test('un vrai zéro est une donnée et se distingue de l\'inconnu', () => {
  assert.equal(agreger([0, 0], 'flux'), 0);
  assert.equal(agreger([0], 'niveau'), 0);
});

test('les abonnés sont des niveaux, tout le reste des flux', () => {
  assert.equal(METRIQUES.abonnesIg.nature, 'niveau');
  assert.equal(METRIQUES.abonnesYt.nature, 'niveau');
  for (const cle of ['vues', 'publications', 'clics', 'leads', 'callsBookes', 'ventes', 'cashCollecte'] as const) {
    assert.equal(METRIQUES[cle].nature, 'flux', cle + ' devrait être un flux');
  }
});

test('seul le cash porte une unité', () => {
  assert.equal(METRIQUES.cashCollecte.unite, '€');
  assert.equal(METRIQUES.vues.unite, '');
});

/* ═══ La période gouverne les libellés ════════════════════════════════════ */

test('granularité : au jour sur une période, au mois en All-Time', () => {
  assert.equal(granulariteDe(7, false), 'jour');
  assert.equal(granulariteDe(30, false), 'jour');
  assert.equal(granulariteDe(7, true), 'mois');
});

test("l'intitulé de la colonne courbe est calculé, jamais écrit en dur", () => {
  assert.equal(intituleColonneCourbe(7, false), 'Cette semaine');
  assert.equal(intituleColonneCourbe(30, false), 'Ce mois');
  assert.equal(intituleColonneCourbe(7, true), "Depuis l'arrivée");
  assert.equal(intituleColonneCourbe(30, true), "Depuis l'arrivée");
});

test('la comparaison suit la période — jamais « vs semaine » sur un mois', () => {
  assert.equal(libelleComparaison(7, false), 'vs semaine précédente');
  assert.equal(libelleComparaison(30, false), 'vs mois précédent');
  assert.equal(libelleComparaison(7, true), 'vs mois précédent');
});

/* ═══ Semaine d'accompagnement ════════════════════════════════════════════ */

const LE_1ER_SEPT = new Date('2026-09-01T12:00:00Z');

test('S1 dès le premier jour, pas S0', () => {
  assert.equal(semaineAccompagnement('2026-09-01T09:00:00Z', LE_1ER_SEPT), 1);
  assert.equal(semaineAccompagnement('2026-08-26T12:00:00Z', LE_1ER_SEPT), 1); // 6 jours
});

test('S2 au septième jour', () => {
  assert.equal(semaineAccompagnement('2026-08-25T12:00:00Z', LE_1ER_SEPT), 2); // 7 jours
});

test('une arrivée dans le futur ne rend pas une semaine négative', () => {
  assert.equal(semaineAccompagnement('2026-12-01T12:00:00Z', LE_1ER_SEPT), null);
});

test('sans date d\'arrivée, on ne sait pas', () => {
  assert.equal(semaineAccompagnement(null, LE_1ER_SEPT), null);
  assert.equal(semaineAccompagnement('pas une date', LE_1ER_SEPT), null);
  assert.equal(ancienneteEnJours(null, LE_1ER_SEPT), null);
});

test('ancienneté en jours entiers', () => {
  assert.equal(ancienneteEnJours('2026-08-28T12:00:00Z', LE_1ER_SEPT), 4);
});

/* ═══ Tri ═════════════════════════════════════════════════════════════════ */

test('la variation trie en VALEUR ABSOLUE — une chute pèse autant qu\'une montée', () => {
  const L = trierLignes([
    ligne({ nom: 'Monte', variationIg: 120 }),
    ligne({ nom: 'Chute', variationIg: -300 }),
    ligne({ nom: 'Plat', variationIg: 5 }),
  ], 'varIg', 'desc');
  assert.deepEqual(L.map(l => l.nom), ['Chute', 'Monte', 'Plat']);
});

test('les inconnus finissent en bas, dans les DEUX sens', () => {
  // « On ne sait pas » n'est pas « le plus petit » : un élève sans donnée ne doit pas
  // coiffer la liste en tri croissant.
  const entree = [
    ligne({ nom: 'Inconnu', cashCollecte: 0, variationIg: null }),
    ligne({ nom: 'Petit', variationIg: 10 }),
    ligne({ nom: 'Grand', variationIg: 900 }),
  ];
  assert.deepEqual(trierLignes(entree, 'varIg', 'desc').map(l => l.nom), ['Grand', 'Petit', 'Inconnu']);
  assert.deepEqual(trierLignes(entree, 'varIg', 'asc').map(l => l.nom), ['Petit', 'Grand', 'Inconnu']);
});

test('à égalité, le nom départage — l\'ordre ne saute pas d\'un rendu à l\'autre', () => {
  const L = trierLignes([
    ligne({ nom: 'Zoé', leads: 5 }),
    ligne({ nom: 'Adam', leads: 5 }),
    ligne({ nom: 'Marc', leads: 5 }),
  ], 'leads', 'desc');
  assert.deepEqual(L.map(l => l.nom), ['Adam', 'Marc', 'Zoé']);
});

test('le tri par nom respecte les accents du français', () => {
  const L = trierLignes([
    ligne({ nom: 'Zoé' }), ligne({ nom: 'Émile' }), ligne({ nom: 'Adam' }),
  ], 'nom', 'asc');
  assert.deepEqual(L.map(l => l.nom), ['Adam', 'Émile', 'Zoé']);
});

test('trierLignes ne mute pas le tableau reçu', () => {
  // `sort` mute en place : sans copie, l'ordre de la liste d'élèves changerait sous les
  // pieds de l'appelant à chaque rendu.
  const entree = [ligne({ nom: 'Zoé', leads: 1 }), ligne({ nom: 'Adam', leads: 9 })];
  const avant = entree.map(l => l.nom);
  trierLignes(entree, 'leads', 'desc');
  assert.deepEqual(entree.map(l => l.nom), avant);
});

test('IG et YT se trient séparément', () => {
  const L = [
    ligne({ nom: 'ForteIg', abonnesIg: 9000, abonnesYt: 10 }),
    ligne({ nom: 'ForteYt', abonnesIg: 10, abonnesYt: 9000 }),
  ];
  assert.equal(trierLignes(L, 'aboIg', 'desc')[0].nom, 'ForteIg');
  assert.equal(trierLignes(L, 'aboYt', 'desc')[0].nom, 'ForteYt');
});

/* ═══ Recherche ═══════════════════════════════════════════════════════════ */

test('la recherche porte sur le nom ET la niche, sans tenir compte de la casse', () => {
  const L = [ligne({ nom: 'Alice Martin', niche: 'Nutrition' }), ligne({ nom: 'Bob Durand', niche: 'Fitness' })];
  assert.equal(filtrerLignes(L, 'alice').length, 1);
  assert.equal(filtrerLignes(L, 'NUTRI').length, 1);
  assert.equal(filtrerLignes(L, 'martin').length, 1);
});

test('une recherche vide ou en espaces ne filtre rien', () => {
  const L = [ligne(), ligne({ nom: 'Bob' })];
  assert.equal(filtrerLignes(L, '').length, 2);
  assert.equal(filtrerLignes(L, '   ').length, 2);
});

test('une niche absente ne fait pas planter la recherche', () => {
  const L = [ligne({ nom: 'Sans niche', niche: null })];
  assert.equal(filtrerLignes(L, 'sans').length, 1);
  assert.equal(filtrerLignes(L, 'nutrition').length, 0);
});

/* ═══ Affichage ═══════════════════════════════════════════════════════════ */

test("l'inconnu s'affiche en tiret cadratin, jamais en zéro", () => {
  assert.equal(formaterValeur(null, ''), '—');
  assert.equal(formaterValeur(0, ''), '0');
});

test('le cash porte son unité, le reste non', () => {
  // ⚠️ `toLocaleString('fr-FR')` sépare les milliers par une espace FINE INSÉCABLE
  // (U+202F), pas une espace ordinaire. Figé ici parce que ça ne se voit pas à l'œil :
  // toute comparaison de chaîne écrite avec une espace normale échouera sans qu'on
  // comprenne pourquoi.
  assert.equal(formaterValeur(1500, '€'), '1 500 €');
  assert.equal(formaterValeur(1500, ''), '1 500');
});

test('la variation porte un vrai signe moins, pas un trait d\'union', () => {
  // Le trait d'union se confondrait avec le « — » de l'inconnu, dans la même colonne.
  assert.equal(formaterVariation(120), '+120');
  assert.equal(formaterVariation(-300), '−300');
  assert.equal(formaterVariation(0), '+0');
  assert.equal(formaterVariation(null), '—');
});

test('le taux de collecté est plafonné à 100 %', () => {
  // Sans plafond, un trop-perçu vient effacer la dette d'une autre vente dans le total.
  assert.equal(tauxCollecte(500, 1000), 50);
  assert.equal(tauxCollecte(1200, 1000), 100);
});

test('aucun contracté : pas de taux, et surtout pas une division par zéro', () => {
  assert.equal(tauxCollecte(0, 0), null);
  assert.equal(tauxCollecte(500, 0), null);
});

/* ═══ Suite des fenêtres ══════════════════════════════════════════════════ */

const j = (s: string) => new Date(s + 'T12:00:00Z');

test('au jour : une entrée par jour, bornes incluses', () => {
  assert.deepEqual(
    sequenceFenetres(j('2026-08-29'), j('2026-09-01'), 'jour'),
    ['2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01'],
  );
});

test('au jour : un changement de mois ne casse pas la suite', () => {
  const s = sequenceFenetres(j('2026-01-30'), j('2026-02-02'), 'jour');
  assert.deepEqual(s, ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
});

test('au mois : le premier jour du mois, comme date_trunc côté base', () => {
  assert.deepEqual(
    sequenceFenetres(j('2026-06-15'), j('2026-09-02'), 'mois'),
    ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'],
  );
});

test('à la semaine : le lundi, comme date_trunc(week) en norme ISO', () => {
  // Le 2026-09-01 est un mardi ; sa semaine commence le lundi 31 août.
  const s = sequenceFenetres(j('2026-09-01'), j('2026-09-08'), 'semaine');
  assert.equal(s[0], '2026-08-31');
  assert.equal(s[1], '2026-09-07');
});

test('un lundi reste son propre lundi', () => {
  assert.equal(sequenceFenetres(j('2026-08-31'), j('2026-08-31'), 'semaine')[0], '2026-08-31');
});

test('une borne de fin avant le début rend une suite vide', () => {
  assert.deepEqual(sequenceFenetres(j('2026-09-01'), j('2026-08-01'), 'jour'), []);
});

test('une date invalide ne fait pas boucler sans fin', () => {
  assert.deepEqual(sequenceFenetres(new Date('n\'importe quoi'), j('2026-09-01'), 'jour'), []);
  assert.deepEqual(sequenceFenetres(j('2026-09-01'), new Date('n\'importe quoi'), 'jour'), []);
});

test('une borne aberrante est plafonnée plutôt que de produire des millions d\'entrées', () => {
  const s = sequenceFenetres(j('1990-01-01'), j('2090-01-01'), 'jour');
  assert.equal(s.length, 400);
});
