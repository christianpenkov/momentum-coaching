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
  fenetreDe,
  repartirParFenetre,
  versCsv,
  cellule,
  nomFichierCsv,
  ecartEnJours,
  libelleFraicheur,
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

/* ═══ fenetreDe : la règle partagée avec sequenceFenetres ═════════════════ */

test('fenetreDe rend le jour, le lundi ou le premier du mois', () => {
  const mardi = j('2026-09-01'); // le 1er septembre 2026 est un mardi
  assert.equal(fenetreDe(mardi, 'jour'), '2026-09-01');
  assert.equal(fenetreDe(mardi, 'semaine'), '2026-08-31');
  assert.equal(fenetreDe(mardi, 'mois'), '2026-09-01');
});

test('un dimanche appartient à la semaine qui a commencé le lundi précédent', () => {
  // Norme ISO, comme date_trunc('week') côté Postgres. Le 2026-09-06 est un dimanche.
  assert.equal(fenetreDe(j('2026-09-06'), 'semaine'), '2026-08-31');
  assert.equal(fenetreDe(j('2026-09-07'), 'semaine'), '2026-09-07');
});

test('fenetreDe et sequenceFenetres tombent TOUJOURS d\'accord', () => {
  // La garantie qui compte : un élément rangé par fenetreDe doit exister dans l'axe
  // construit par sequenceFenetres. Sinon il disparaît sans bruit.
  for (const g of ['jour', 'semaine', 'mois'] as const) {
    const axe = sequenceFenetres(j('2026-06-15'), j('2026-09-01'), g);
    for (const iso of ['2026-06-15', '2026-07-04', '2026-08-31', '2026-09-01']) {
      const f = fenetreDe(j(iso), g);
      assert.ok(axe.includes(f!), `${g} : ${iso} rangé en ${f}, absent de l'axe`);
    }
  }
});

test('une date invalide n\'appartient à aucune fenêtre', () => {
  assert.equal(fenetreDe(new Date('n\'importe quoi'), 'jour'), null);
});

/* ═══ repartirParFenetre ══════════════════════════════════════════════════ */

const evt = (d: string | null) => ({ quand: d });

test('chaque élément tombe dans sa fenêtre', () => {
  const axe = sequenceFenetres(j('2026-08-30'), j('2026-09-01'), 'jour');
  const paquets = repartirParFenetre(
    [evt('2026-08-30T10:00:00Z'), evt('2026-09-01T08:00:00Z'), evt('2026-09-01T20:00:00Z')],
    e => e.quand, axe, 'jour',
  );
  assert.deepEqual(paquets.map(p => p.length), [1, 0, 2]);
});

test('un élément hors de l\'axe est écarté, jamais rangé dans la fenêtre la plus proche', () => {
  // Le ranger au plus près le compterait dans une période où il n'a pas eu lieu.
  const axe = sequenceFenetres(j('2026-08-30'), j('2026-09-01'), 'jour');
  const paquets = repartirParFenetre(
    [evt('2026-01-01T10:00:00Z'), evt('2027-01-01T10:00:00Z')], e => e.quand, axe, 'jour',
  );
  assert.deepEqual(paquets.map(p => p.length), [0, 0, 0]);
});

test('une date absente ou invalide est ignorée sans faire planter', () => {
  const axe = sequenceFenetres(j('2026-08-30'), j('2026-08-31'), 'jour');
  const paquets = repartirParFenetre(
    [evt(null), evt('pas une date'), evt('2026-08-31T10:00:00Z')], e => e.quand, axe, 'jour',
  );
  assert.deepEqual(paquets.map(p => p.length), [0, 1]);
});

test('à la semaine, sept jours se regroupent en un seul paquet', () => {
  const axe = sequenceFenetres(j('2026-08-31'), j('2026-09-06'), 'semaine');
  assert.equal(axe.length, 1);
  const paquets = repartirParFenetre(
    ['2026-08-31', '2026-09-02', '2026-09-06'].map(d => evt(d + 'T10:00:00Z')),
    e => e.quand, axe, 'semaine',
  );
  assert.equal(paquets[0].length, 3);
});

test('l\'axe reste de la bonne longueur même sans aucun élément', () => {
  const axe = sequenceFenetres(j('2026-08-30'), j('2026-09-01'), 'jour');
  assert.deepEqual(repartirParFenetre([], () => null, axe, 'jour').map(p => p.length), [0, 0, 0]);
});

/* ═══ Export CSV ══════════════════════════════════════════════════════════ */

const ligneCsv = (o: Partial<LigneEleve> = {}): LigneEleve => ({
  id: 'x', profileId: 'p', nom: 'Léa', niche: 'Danse', semaine: 6,
  abonnesIg: 1200, abonnesYt: 340, variationIg: 45, variationYt: -3,
  publications: 12, leads: 8, callsBookes: 3, cashContracte: 2400, cashCollecte: 1800,
  serie: [], etat: null, ...o,
});

test('le fichier commence par un BOM — sans lui Excel massacre les accents', () => {
  // « Léa » devient « LÃ©a » sans BOM. Sur des noms d'élèves, c'est immédiatement visible.
  assert.ok(versCsv([ligneCsv()]).startsWith('\uFEFF'));
});

test('le séparateur est le point-virgule, pas la virgule', () => {
  // Excel en français lit la virgule comme séparateur décimal : un CSV à virgules
  // s'ouvre en UNE seule colonne, et l'export ne sert à rien.
  const l = versCsv([ligneCsv()]).split('\r\n')[0];
  assert.ok(l.includes(';'), 'les colonnes doivent être séparées par des points-virgules');
  assert.ok(!l.includes(','), "l'en-tête ne doit contenir aucune virgule");
});

test('une décimale prend la virgule, un entier reste nu', () => {
  const lignes = versCsv([ligneCsv({ cashCollecte: 1234.5, cashContracte: 2000 })]).split('\r\n');
  assert.ok(lignes[1].includes('1234,50'), 'décimale à la française');
  assert.ok(lignes[1].includes(';2000;'), 'un entier ne gagne pas de décimales inutiles');
});

test('une valeur inconnue laisse la cellule VIDE, jamais zéro', () => {
  // Un zéro affirme « il ne s'est rien passé ». Le vide dit « on ne sait pas ».
  const l = versCsv([ligneCsv({ abonnesYt: null, variationYt: null, niche: null })]).split('\r\n')[1];
  assert.ok(l.includes(';;'), 'deux points-virgules collés = une cellule vide');
  assert.ok(!/;0;/.test(l.replace('Léa', '')), 'aucun zéro ne doit apparaître à la place d’un inconnu');
});

test('un nom qui commence par = est neutralisé — c’est une injection, pas une coquetterie', () => {
  // Le nom vient d'une saisie. `=1+1` ou pire, une formule qui appelle une URL, serait
  // exécutée à l'ouverture du fichier par Excel comme par LibreOffice.
  assert.equal(cellule('=1+1'), "'=1+1");
  assert.equal(cellule('+33612345678'), "'+33612345678");
  assert.equal(cellule('-truc'), "'-truc");
  assert.equal(cellule('@import'), "'@import");
  assert.equal(cellule('Léa'), 'Léa', 'un nom normal ne doit pas être touché');
});

test('un point-virgule ou un guillemet dans un nom ne casse pas la grille', () => {
  assert.equal(cellule('Dupont; Léa'), '"Dupont; Léa"');
  assert.equal(cellule('Léa "la danseuse"'), '"Léa ""la danseuse"""');
  assert.equal(cellule('Ligne\nSuivante'), '"Ligne\nSuivante"');
});

test('une ligne par élève, dans l’ordre reçu — l’export suit le tableau affiché', () => {
  const csv = versCsv([ligneCsv({ nom: 'Zoé' }), ligneCsv({ nom: 'Ana' })]);
  const lignes = csv.split('\r\n').filter(Boolean);
  assert.equal(lignes.length, 3, 'un en-tête et deux élèves');
  assert.ok(lignes[1].startsWith('Zoé'), "l'ordre affiché est conservé");
  assert.ok(lignes[2].startsWith('Ana'));
});

test('un tableau vide produit quand même son en-tête', () => {
  const csv = versCsv([]);
  assert.ok(csv.includes('Élève'), 'un fichier sans en-tête serait illisible');
  assert.equal(csv.split('\r\n').filter(Boolean).length, 1);
});

test('le nom du fichier porte la période, pour ne pas confondre deux exports', () => {
  const n = nomFichierCsv(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T00:00:00Z'));
  assert.equal(n, 'momentum-eleves_2026-08-01_2026-08-31.csv');
});

/* ═══ Dater la page ═══════════════════════════════════════════════════════ */

test("l'écart se compte en jours CALENDAIRES, pas en heures divisées par 24", () => {
  assert.equal(ecartEnJours('2026-08-31', '2026-09-02'), 2);
  assert.equal(ecartEnJours('2026-09-02', '2026-09-02'), 0);
  assert.equal(ecartEnJours('2026-09-01', '2026-09-02'), 1);
  // Le cas qui a produit le bug : le 31 août lu le 2 septembre, c'est 2 jours.
  // L'ancienne version rendait 1 l'après-midi et 2 le soir, pour la même donnée.
  assert.equal(ecartEnJours('2026-12-31', '2027-01-01'), 1, 'un changement d’année reste un jour');
});

test("le passage à l'heure d'hiver ne fabrique pas un jour de plus", () => {
  // Le 25 octobre 2026 fait 25 heures à Paris. Un calcul en millisecondes divisé par
  // 86 400 000 rendrait 0,96 jour, donc 0 après troncature.
  assert.equal(ecartEnJours('2026-10-25', '2026-10-26'), 1);
  assert.equal(ecartEnJours('2026-03-29', '2026-03-30'), 1, 'et l’heure d’été non plus');
});

test('une date illisible rend null plutôt qu’un nombre faux', () => {
  assert.equal(ecartEnJours('pas une date', '2026-09-02'), null);
  assert.equal(ecartEnJours('2026-09-02', ''), null);
  assert.equal(libelleFraicheur('n’importe quoi', '2026-09-02'), null);
});

test('le libellé de fraîcheur dit ce que le coach lit', () => {
  assert.equal(libelleFraicheur('2026-09-02', '2026-09-02'), "aujourd'hui");
  assert.equal(libelleFraicheur('2026-09-01', '2026-09-02'), 'hier');
  assert.equal(libelleFraicheur('2026-08-31', '2026-09-02'), 'il y a 2 j');
  assert.equal(libelleFraicheur('2026-08-20', '2026-09-02'), 'il y a 13 j');
});

test('sans dernier jour connu, aucun libellé — on n’invente pas une date', () => {
  assert.equal(libelleFraicheur(null, '2026-09-02'), null);
  assert.equal(libelleFraicheur(undefined, '2026-09-02'), null);
});

test('une date future rend « aujourd’hui » plutôt qu’un écart négatif', () => {
  assert.equal(libelleFraicheur('2026-09-05', '2026-09-02'), "aujourd'hui");
});
