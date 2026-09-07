# Handoff — le badge « nouveaux » de la Vue générale (Mes Stats)

> ## ÉTAT AU 2026-09-07 — CLOS, et le diagnostic a été retourné.
>
> Les deux points « à creuser » sont tranchés, mais **la conclusion n'est pas celle que
> ce document anticipait** : le problème n'était pas le badge, c'était la définition du
> **chiffre principal**. Voir « Ce qui a été fait » en fin de page avant toute chose.
>
> ⚠️ **Une affirmation de ce document est devenue FAUSSE** : « les périodes sont
> additives, et c'est voulu ». Elles ne le sont plus, et c'est délibéré — voir la section
> corrigée juste en dessous.

**Origine** : question de Chris le 2026-09-07 sur la carte « Leads » de la Vue générale
(`components/analytics/PageClientStats.tsx`, `TabOverviewV2`). Deux points à creuser,
listés plus bas. Ce document ne les tranche pas — il donne ce qui est **établi** et ce
qui reste **à mesurer**, pour ne pas refaire le travail déjà fait.

---

## Ce qui est ÉTABLI (mesuré le 2026-09-07, ne pas re-vérifier)

### ~~Les périodes sont additives, et c'est voulu~~ — PLUS VRAI depuis le 2026-09-07

`compterLeads` (`lib/salesCallStats.ts`) retient, pour chaque personne, la date la
**plus ancienne** connue — toutes sources confondues — puis applique la fenêtre à
**cette** date.

Conséquence, et c'est contre-intuitif : une personne qui reprend un lead magnet dans
deux périodes différentes est comptée dans **une seule**, celle de sa première
apparition. La somme des périodes **égale** donc le all-time : ni doublon, ni perte.

Vérifié sur données réelles : `rdjdkzjd` a réclamé un lead magnet le **28/06** puis le
**15/08**. Elle compte en juin, **pas** en août, une fois en all-time.

⚠️ Chris pensait l'inverse (« comptée dans chaque période, donc 2 en additionnant »).
**Et c'est son modèle qui l'a emporté**, le 2026-09-07 : sur une période, « Leads »
compte désormais les ACTIFS, donc une personne revenue compte dans chaque période où
elle s'est manifestée. La somme des périodes DÉPASSE l'all-time, où elle reste une
personne. Le paragraphe ci-dessus décrit donc l'ancien comportement.

Ce qui reste vrai, et qui explique pourquoi la mesure du 28/06-15/08 sur `rdjdkzjd`
donnait « une seule période » : c'était bien le comportement d'alors.

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

## Ce qui a été fait (2026-09-07)

**Le diagnostic du document était juste sur les faits, faux sur la conclusion.** Le badge
n'avait pas besoin d'être corrigé : il affichait le bon nombre pour sa définition. C'est
que sa définition et celle de la carte étaient LA MÊME — d'où l'écart 0 mesuré sur quatre
mois consécutifs.

⚠️ Et le commentaire de `PageClientStats` décrivait DÉJÀ la règle voulue — « personnes
distinctes ayant donné signe de vie dans la fenêtre », « la somme des fenêtres peut
dépasser le total ». Le code avait dérivé de sa propre spécification. Le chantier l'a
restaurée plutôt qu'inventée.

| | |
|---|---|
| Carte, sur une période | `compterLeadsActifs` — nouvelle |
| Badge, sur une période | `compterLeads` — **l'ancien chiffre de la carte**, déplacé d'un cran |
| Carte, en all-time | `compterLeads` — inchangée |
| Invariant | `badge ≤ carte`, verrouillé par un test |

Le point 1 est résolu autrement que prévu : le badge ne « passe pas par `compterLeads` »
en plus, il EST `compterLeads`. Il gagne au passage les trois écarts que ce document
soupçonnait — `prospect_links` absent, dédup « date la plus ancienne » non appliquée, et
une personne présente dans deux volets comptée deux fois.

Le point 2 est confirmé par la mesure : hors all-time, le badge répétait le chiffre
principal. Écart 0 en juin, juillet, août et septembre.

**Deux défauts antérieurs trouvés en chemin**, tous deux corrigés :

- les compteurs lisaient les leads **dédupliqués en gardant la fiche la plus RÉCENTE**,
  donc la « première apparition » était la DERNIÈRE détection — `incogniton.734` datée du
  28/08 au lieu du 07/06, soit 82 jours ;
- les reprises étaient filtrées sur `keyword_matched`, colonne devenue nullable le
  2026-09-05 : une reprise sans mot-clé aurait disparu sans trace.

⚠️ **La question de `detected_at` posée au point 1 est tranchée, et dans l'autre sens** :
c'est bien la PREMIÈRE détection, gelée en base par le déclencheur `figer_detected_at`
depuis le 2026-09-03. Le commentaire de `PageLiens.tsx` qui disait « la date de sa
DERNIÈRE interaction » décrivait l'état d'avant ce correctif — il a été corrigé.

Mesure finale, avec les vraies fonctions sur les vraies lignes (profil Christian) :

| mois | ancien | actifs | badge |
|---|---|---|---|
| 2026-06 | 8 | 8 | 8 |
| 2026-07 | 0 | **2** | 0 |
| 2026-08 | 10 | **11** | 10 |
| 2026-09 | 0 | **1** | 0 |
| all-time | 18 | 18 (inchangé) | — |

Juillet affichait « 0 lead » alors que deux personnes s'étaient manifestées.

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
