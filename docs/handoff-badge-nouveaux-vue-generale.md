# Handoff — le badge « nouveaux » de la Vue générale (Mes Stats)

**Origine** : question de Chris le 2026-09-07 sur la carte « Leads » de la Vue générale
(`components/analytics/PageClientStats.tsx`, `TabOverviewV2`). Deux points à creuser,
listés plus bas. Ce document ne les tranche pas — il donne ce qui est **établi** et ce
qui reste **à mesurer**, pour ne pas refaire le travail déjà fait.

---

## Ce qui est ÉTABLI (mesuré le 2026-09-07, ne pas re-vérifier)

### Les périodes sont additives, et c'est voulu

`compterLeads` (`lib/salesCallStats.ts`) retient, pour chaque personne, la date la
**plus ancienne** connue — toutes sources confondues — puis applique la fenêtre à
**cette** date.

Conséquence, et c'est contre-intuitif : une personne qui reprend un lead magnet dans
deux périodes différentes est comptée dans **une seule**, celle de sa première
apparition. La somme des périodes **égale** donc le all-time : ni doublon, ni perte.

Vérifié sur données réelles : `rdjdkzjd` a réclamé un lead magnet le **28/06** puis le
**15/08**. Elle compte en juin, **pas** en août, une fois en all-time.

⚠️ Chris pensait l'inverse (« comptée dans chaque période, donc 2 en additionnant »).
Si une évolution devait changer ça, c'est une décision produit à lui poser — pas un
détail d'implémentation.

### Le badge existe déjà et porte la bonne intention

`newLeadsCount` (~1333), affiché « **+N nouveaux** » — ou « +N ce mois » en mode
« depuis la connexion » — sous le chiffre des Leads (~1795).

Son infobulle dit déjà exactement ce que Chris demandait : *« Prospects jamais vus
avant, détectés ce mois-ci (différent des leads actifs ce mois, qui incluraient aussi
les anciens prospects réactivés) »*.

**Il n'y a donc rien à créer.** Ce qui suit porte sur sa justesse, pas son existence.

---

## À CREUSER — point 1 : le badge ne passe pas par `compterLeads`

```ts
const newLeadsCount = (sinceConnection
  ? (leads ?? []).filter(l => isNewThisMonth(l.commentedAt)).length
  : (leads ?? []).filter(l => isLeadInPeriod(l.commentedAt)).length
) + new Set(directIgCallsNew.map(prospectKeyOf)).size
  + new Set(ytBookedCallsNew.map(prospectKeyOf)).size;
```

Le premier terme compte `leads.length` — c'est-à-dire `instagram_leads` **seul**, via
`commentedAt` qui vaut `l.detected_at` (~11081). Les deux autres termes sont bien
dédoublonnés.

Deux écarts possibles avec le chiffre principal, qui lui passe par `compterLeads` :

- **Les personnes connues uniquement par `prospect_links`** sont absentes du badge.
  Mesuré : **0 personne dans ce cas aujourd'hui** sur le profil de test — donc aucun
  écart visible, mais la divergence est latente.
- **La date n'est pas la même.** `compterLeads` prend la plus ancienne entre
  `instagram_leads.detected_at` et `prospect_links.created_at` ; le badge prend
  `detected_at` seul. Vérifier ce que `detected_at` porte réellement quand une personne
  revient — `PageLiens.tsx` affirme dans un commentaire que `instagram_leads` garde « la
  date de sa DERNIÈRE interaction », ce qui, si c'est vrai, ferait diverger les deux.

⚠️ **Ne pas dupliquer la règle** en corrigeant. `compterLeads` accepte des lignes
pré-découpées par l'appelant (documenté dans sa signature) : c'est le chemin prévu pour
compter sur une sous-fenêtre sans réécrire le dédoublonnage.

## À CREUSER — point 2 : le badge répète-t-il le chiffre principal ?

Hors mode « depuis la connexion », le badge compte les leads **de la période
affichée** — ce que la carte montre déjà juste au-dessus. Le badge n'aurait alors de
sens qu'en all-time, où « nouveaux » s'oppose vraiment à « déjà connus ».

**Non vérifié** : ni à l'écran, ni en mesurant les deux valeurs côte à côte. C'est le
premier geste à faire, avant toute modification — si les deux nombres diffèrent, il n'y
a peut-être rien à corriger.

Points de départ : `leadsCount` (~1316) et `newLeadsCount` (~1333), rendus ~1794-1800.
Comparer `isLeadInPeriod` au filtre de fenêtre de `compterLeads`.

---

## Pièges

- **`PageClientStats.tsx` est édité en parallèle par une autre session.** Vérifier
  `git status` et la branche avant tout commit, ne commiter que ses propres fichiers.
- **`compterLeads` a changé le 2026-09-06** : Mes Stats comptait les personnes entrées
  dans la séquence de DM (`instagram_lead_lm_history`), il compte désormais celles qui se
  sont **manifestées**. Tout raisonnement fondé sur un commentaire antérieur à cette date
  est à re-vérifier — c'est ce changement qui a cassé la cohérence avec « Gérer mes
  liens », traitée à part dans `docs/handoff-entonnoir-mes-liens.md`.
- **Le badge et le chiffre principal n'ont PAS à être égaux** : l'un compte les nouveaux,
  l'autre tous ceux de la période. Ce qu'il faut, c'est que chacun dise ce qu'il compte —
  pas qu'ils convergent.
