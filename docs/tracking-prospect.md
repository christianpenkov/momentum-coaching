# Tracking prospect — qui porte quelle vérité

Ce document fixe le rôle de chaque table du tracking prospect et les règles qui en
découlent. Il existe parce que ces rôles n'étaient écrits nulle part, ce qui a produit
plusieurs bugs de statistiques difficiles à diagnostiquer (taux à 133 % et 150 %, appels
en « Autre / non catégorisé », historique commercial effacé par une suppression de lien).

---

## Les trois tables et leur rôle

| Table | Ce qu'elle décrit | Nature | Survit à quoi |
|---|---|---|---|
| `prospect_events` | Ce qui **s'est passé** | Journal, ajout uniquement | Survit à la suppression d'un lien ou d'un call (clés étrangères en `SET NULL`) |
| `prospect_links` | L'**état courant** d'un lien | Modifiable | Ne survit pas à la suppression du prospect depuis le pipeline |
| `instagram_leads` | L'**état courant** d'un prospect | Modifiable, écrasé à chaque interaction | Ne survit pas à la suppression du prospect |

La règle qui découle de ce tableau : **pour savoir si quelque chose a eu lieu, lire les
événements. Pour savoir dans quel état on est aujourd'hui, lire les deux autres.**

### `prospect_events` — le journal

Une ligne par fait daté. Types existants :

| Type | Signification | Posé par |
|---|---|---|
| `lm_sent` | Lead magnet envoyé | webhook Instagram |
| `hook_replied` | Le prospect a répondu au message d'accroche | webhook Instagram, avancement manuel du pipeline |
| `lm_clicked` | Clic sur le lien du lead magnet | cron `poll-leads`, `syncLmClickStream` |
| `calendly_link_sent` | Lien Calendly envoyé en DM | webhook Instagram (echo Meta), avancement manuel du pipeline |
| `link_clicked` | Clic sur le lien Calendly | cron `poll-leads`, `syncLmClickStream`, avancement manuel |
| `call_booked` | Rendez-vous pris | webhook Calendly, `sync-calendly` |

Des index uniques garantissent qu'un même fait ne peut pas être enregistré deux fois :

- `prospect_events_lm_clicked_unique` — un seul `lm_clicked` par prospect
- `prospect_events_link_clicked_uidx` — un seul `link_clicked` par lien
- `prospect_events_ig_lead_hook_replied_key` — un seul `hook_replied` par prospect
- `prospect_events_call_event_uidx` — un seul événement par call et par type

Conséquence directe : **un prospect qui clique dix fois compte pour un.** Les taux
d'activation sont donc bornés par construction, ils ne peuvent pas dépasser 100 %.

### `prospect_links` — l'état d'un lien

Porte l'URL Short.io, mais aussi des colonnes d'historique :

| Colonne | Rôle |
|---|---|
| `short_url` | L'URL courte, `NOT NULL` |
| `calendly_link_sent` | Le lien a-t-il été envoyé au prospect |
| `calendly_link_sent_at` | Date du **premier** envoi, jamais réécrite |
| `last_calendly_link_sent_at` | Date du **dernier** envoi, mise à jour à chaque renvoi |
| `first_click_at` | Date du **premier** clic, jamais réécrite |
| `min_stage_reached` | Étape la plus avancée atteinte dans le pipeline |
| `source_at_creation` | Source figée à la création, car `instagram_leads.source` est écrasée |
| `deleted_at` | Date de retrait depuis Gérer mes liens. `NULL` = actif |

Le mélange état + historique dans une même table est la cause racine de plusieurs bugs.
Il n'a pas été démêlé : `calendly_link_sent` reste ici, mais les lectures savent
désormais aller chercher la vérité ailleurs quand cette colonne est absente ou fausse.

---

## Règle 1 — Un clic prouve l'envoi

Le webhook ne pose `calendly_link_sent` que s'il reçoit l'echo Meta du DM contenant
l'URL. Quand cet echo n'arrive pas, le lien reste marqué non envoyé alors que le
prospect l'a bien reçu.

Personne ne peut cliquer un lien qu'il n'a jamais reçu. Un clic vaut donc preuve
d'envoi. Les stats utilisent deux fonctions uniques, définies en haut de
`components/analytics/PageClientStats.tsx` :

```ts
wasCalendlyLinkSent(pl, linkClickedByLeadId?)  // le lien a-t-il été envoyé ?
calendlySentAt(pl, linkClickedByLeadId?)       // à quelle date ?
```

`wasCalendlyLinkSent` répond oui si l'une de ces trois conditions est vraie :

1. `calendly_link_sent` est vrai — le cas normal
2. `first_click_at` est renseigné — le clic prouve l'envoi
3. un événement `link_clicked` existe pour ce prospect — **le critère le plus solide**,
   car les événements survivent à la suppression du lien

**Ne jamais réécrire `if (!pl.calendly_link_sent)` en dur.** Ce test était dupliqué à
huit endroits ; chaque copie était une occasion de diverger, et c'est précisément ce qui
a produit les taux supérieurs à 100 %.

---

## Règle 2 — Numérateur inclus dans le dénominateur

Un pourcentage ne peut dépasser 100 % que si l'on compare deux populations différentes.
Deux cas réels :

**« Réponses accroche LM DM » affichait 133 %** (4 réponses / 3 lead magnets envoyés).
Le dénominateur comptait les prospects ayant reçu un lead magnet ; le numérateur comptait
toutes les réponses, y compris celle d'un contact en démarchage à froid qui n'avait par
définition jamais reçu de lead magnet.

**« Taux d'activation Calendly » affichait 150 %** (3 clics / 2 liens envoyés). Le
dénominateur comptait des **liens**, le numérateur des **prospects**.

Règle : avant d'écrire un ratio, vérifier que tout élément du numérateur appartient
nécessairement au dénominateur. Si ce n'est pas le cas, le ratio est faux.

---

## Règle 3 — La suppression d'un lien ne détruit pas l'historique

Le bouton « Supprimer ce lien prospect » de Gérer mes liens faisait un `DELETE`, ce qui
effaçait aussi le parcours commercial du prospect.

Cas réel (`rdjdkzjd`, constaté le 2026-08-18) :

1. 08/07 — le prospect clique sur son lien et prend rendez-vous
2. ~14/08 — le lien est supprimé depuis Gérer mes liens, puis régénéré
3. 15/08 — la nouvelle ligne repart vierge

Symptômes : son appel tombait en « Autre / non catégorisé » dans le détail par source,
et il sortait du dénominateur du taux d'activation.

Depuis la migration `20260818000000_prospect_links_soft_delete` :

- Supprimer pose `deleted_at` au lieu d'effacer la ligne
- Régénérer un lien pour un prospect qui en avait un retiré **réactive** sa ligne
  (`deleted_at` remis à `NULL`) au lieu d'en créer une seconde, ce qui préserve son
  historique
- La route `GET /api/client/prospect-links` accepte `?activeOnly=1` :
  - **avec** le paramètre — liste des liens actifs, utilisée par Gérer mes liens
  - **sans** — historique complet, utilisé par Mes Stats

Le défaut est volontairement l'historique complet : une lecture qui oublie le paramètre
voit trop de liens, ce qui est visible et corrigeable, plutôt que trop peu, ce qui
fausserait silencieusement les statistiques.

---

## Ce qu'il reste à surveiller

**La suppression depuis le pipeline reste destructive.** `app/api/client/pipeline/route.ts`
efface le prospect et tout ce qui s'y rattache. C'est un geste différent, assumé comme
tel (« ce n'est pas un lead »), mais qui mériterait le même traitement si un cas de
suppression accidentelle se présente.

**L'événement `calendly_link_sent` reste dépendant de l'echo Meta.** La règle 1 comble le
trou côté lecture, mais l'événement lui-même n'est toujours pas posé quand l'echo
n'arrive pas. Le poser au moment de l'envoi effectif du DM, sans attendre l'echo, serait
la correction de fond.

**Deux profils partageant un domaine Short.io** produisent des lignes de snapshots
concurrentes. Voir `docs/shortio-api.md`, piège n°2.
