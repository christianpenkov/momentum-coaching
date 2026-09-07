# Handoff — « Leads » compte deux fois une personne venue par deux chemins

> ## ÉTAT AU 2026-09-07 — la partie Mes Stats est FAITE.
>
> `.is('ig_lead_id', null)` est posé sur `callsYt` dans `requetesLeads`, et un test de
> caractérisation fige désormais la forme des quatre lectures — le filtre ne peut plus
> disparaître par effet de bord.
>
> Aucun chiffre n'a bougé, comme ce document l'annonçait : zéro paire concernée en base.
> ⚠️ **La dépendance tient toujours** : `handoff-fusion-auto-email.md` (chat Pipeline)
> doit atterrir pour que ces paires existent et que le filtre serve.
>
> ⚠️ Le « troisième lecteur, à vérifier » en fin de page dit qu'il y a trois appelants.
> Il y en a **six**, et l'un d'eux (`fetchAllLeadsCount`) est appelé EN BOUCLE par élève :
> ajouter une REQUÊTE dans `requetesLeads` coûterait +2 requêtes par élève sur l'accueil
> coach. Le décompte corrigé est en tête de `requetesLeads`.

**Pour le chat Mes Stats.** Décision de Chris le 2026-09-07.

⚠️ **À faire APRÈS `handoff-fusion-auto-email.md`** (chat Pipeline Leads), qui pose
la fusion automatique dont ce correctif dépend. Fait seul, celui-ci ne sert à rien ;
fait sans celui-là, il ne trouve aucune paire à dédoublonner.

---

## Le problème

`compterLeads` (`lib/salesCallStats.ts`) additionne **trois blocs sans jamais les
recouper** :

```ts
return parUsername + igDirects + youtube;
//     ↑ pseudos IG   ↑ e-mail/nom   ↑ e-mail/nom
```

Une personne qui a **demandé un lead magnet** puis **réservé depuis une bio ou une
description** compte donc **deux fois** : une fois par son pseudo Instagram, une
fois par son e-mail.

Ce n'est pas une négligence : les deux blocs n'ont pas la même clé, et
`instagram_leads` **n'a aucune colonne e-mail**. Il n'existait aucun moyen de les
rapprocher. La fusion automatique par e-mail exact en crée un.

## Ce que la fusion répare toute seule — et ce qu'elle ne répare pas

C'est le cœur de ce handoff, et la partie qui se voit mal.

**Le volet Instagram se corrige sans rien faire.** Sa requête porte déjà le bon
filtre :

```ts
const callsIg = () => supabase.from('calls')
  …
  .is('ig_lead_id', null)      ← dès qu'une fusion pose ig_lead_id,
  .like('source', 'ig\\_%')       la personne sort de ce bloc
```

Elle est alors comptée une seule fois, par `parUsername`. ✅

**Le volet YouTube, non.** Sa requête n'a pas ce filtre :

```ts
const callsYt = () => supabase.from('calls')
  …
  .like('source', 'yt%')       ← aucun filtre sur ig_lead_id
```

Un lead Instagram qui réserve depuis une **description YouTube** reste donc compté
**deux fois** après la fusion : une fois par son pseudo, une fois par son e-mail.
C'est exactement le cas que Chris a soulevé — *« et s'il book depuis YT ? »*.

## Ce qu'il faut faire

Ajouter `.is('ig_lead_id', null)` à `callsYt`, comme `callsIg` l'a déjà.

⚠️ **Ce filtre est une DÉDUPLICATION, pas une attribution.** La règle du
2026-08-29 dit que l'attribution d'un rendez-vous se lit sur `calls.source`, jamais
sur `ig_lead_id`. Elle reste vraie. Ici la question posée n'est pas « d'où vient ce
rendez-vous » mais « cette personne est-elle déjà comptée ailleurs » — et
`ig_lead_id` répond précisément à celle-là : il dit **chez qui** le call est rangé.

Ne pas ranger ce changement parmi les lecteurs d'attribution : ce serait le
supprimer à la prochaine revue.

## Ce qu'il ne faut PAS faire

**Ne pas recopier la règle de dédoublonnage.** `clefPersonne`
(`invitee_email || invitee_name || id`, en minuscules) est exportée depuis le
2026-09-07 précisément pour ça. C'est elle qui évite de compter deux fois un
prospect ayant reprogrammé son rendez-vous — Calendly crée un nouvel événement à
chaque report, et ce défaut affichait déjà **18 leads là où le pipeline en montrait
17** le 2026-08-19.

**Ne pas toucher au volet YouTube des calls ANNULÉS.** Le commentaire en place le
dit : *« un prospect qui annule reste un prospect »*. Avant le 2026-08-19, ce volet
excluait les annulés là où l'Instagram les gardait — deux plateformes, deux règles,
dans la même fonction.

---

## Le troisième lecteur, à vérifier

`compterLeads` a **trois** appelants (`fetchIgLeadsCount`, `fetchAllLeadsCount`,
`fetchLeadsCountsBatch`) : accueil élève, fiche coach, Mes Stats. Le correctif vaut
pour les trois puisqu'il vit dans `requetesLeads` — vérifier qu'aucun d'eux ne
reconstruit sa propre requête à côté.

⚠️ Un quatrième lecteur existe désormais, **et il n'utilise PAS cette fonction** :
l'entonnoir de « Gérer mes liens » (`PageLiens.tsx`, marche « Leads »), corrigé le
2026-09-07. Il compte lui aussi personnes + calls directs, avec le même angle mort,
et son commentaire le dit explicitement. Quand la fusion sera en place, vérifier
que son chiffre bouge dans le même sens — il lit `pipelineData`, pas
`salesCallStats`.

Les deux écrans **n'ont pas à afficher le même nombre** : Mes Stats compte toutes
les personnes manifestées, « Gérer mes liens » seulement celles venues du contenu
(cold DM sortant exclu). Deux questions, deux nombres. Ce qui compte, c'est
qu'aucun des deux ne compte une personne deux fois.

---

## Vérification attendue

Une personne avec un lead Instagram **et** un rendez-vous depuis une description
YouTube, même e-mail :

| | Avant | Après |
|---|---|---|
| Mes Stats — Leads | 2 | 1 |
| Accueil élève — Leads | 2 | 1 |
| Fiche coach — Leads | 2 | 1 |

**Mesuré le 2026-09-07 : 0 paire concernée en base** — sur 19 calls de vente avec
e-mail, aucun n'apparaît des deux côtés. Le correctif ne changera donc aucun
chiffre aujourd'hui. Il faut le faire quand même : la fusion automatique va créer
ces paires, et le jour où elles apparaîtront, personne ne cherchera un doublon dans
la requête YouTube.
