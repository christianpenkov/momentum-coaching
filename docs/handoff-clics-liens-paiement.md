# Handoff — afficher les clics sur les liens de paiement

> ## ✅ TRAITÉ le 2026-08-29 par le chantier Paiements
>
> L'affichage existait déjà quand ce handoff est arrivé : il avait été construit en
> parallèle, à partir de la même intention côté maquettes. Les trois états sont en
> place sur la fiche client, dans l'onglet Relances et dans l'écran de modification
> du montant.
>
> **Ce qui manquait vraiment, et qui a été ajouté :** la DATE de première ouverture.
> Les deux specs la demandaient, aucune des deux ne l'avait obtenue. « Il a ouvert
> sans payer » se discute ; « il a ouvert le 26 août sans payer » se relance.
>
> **Les trois pièges, un par un :**
> - *Piège 1 (`shortio_link_id` nul)* — aucun cas en base aujourd'hui (5 liens, 5
>   suivis), mais le cas est traité : l'étiquette dit « ouverture non suivie », jamais
>   un zéro.
> - *Piège 2 (zéro clic ≠ zéro ouverture)* — l'écran n'écrit nulle part « jamais
>   ouvert ». Il parle d'envoi, pas d'absence d'ouverture.
> - *Piège 3 (`link_category`)* — vérifié en base : les 5 liens de paiement sont bien
>   `null`. Rien ne leur en attribue.
>
> **Un écart avec la lecture proposée ici :** une seule requête pour tous les liens de
> la page, dans `/api/payments`, plutôt qu'un aller-retour par vente. Même donnée,
> même filtre `human_clicks`, un appel au lieu de N.
>
> Le reste du document est conservé tel quel : il documente la donnée et ses pièges.

Écrit le 2026-08-29 par le chantier « audit Business micro », à destination du chantier
Paiements. Rien à faire côté Short.io ni côté cron : **la donnée est déjà en base**, il
ne manque que l'affichage.

## Ce qu'on cherche à répondre

Une seule question, et elle a une conséquence commerciale directe :

> Le client a-t-il **ouvert** le lien de paiement qu'on lui a envoyé ?

- **Jamais ouvert** → le message est passé à côté. Renvoyer le lien suffit.
- **Ouvert, pas payé** → il a vu le montant et n'a pas payé. C'est une objection :
  un message personnel vaut mieux qu'une relance automatique.

Aujourd'hui l'écran ne distingue pas les deux, et les deux appellent pourtant des
gestes opposés. C'est exactement la raison pour laquelle la couche Short.io a été
posée sur les liens de paiement — voir le commentaire dans
[`lib/stripe-payment-links.ts`](../lib/stripe-payment-links.ts), section
« Couche Short.io : le tracking du clic ».

## La donnée existe déjà

Vérifié en base le 2026-08-29 :

| | |
|---|---|
| Liens de paiement portant un `shortio_link_id` | 4 |
| Ceux qui ont des lignes de clics en base | 4 (100 %) |
| Clics humains cumulés | 3 |
| Couverture | du 2026-08-19 à aujourd'hui |

Le cron `poll-leads` lit le flux de clics du **domaine entier** : il ne fait aucun tri
par catégorie, donc les liens de paiement sont collectés au même titre que les autres,
sans un seul appel d'API supplémentaire.

## Où c'est stocké

Deux colonnes portent l'identifiant du lien court, selon le type de paiement :

- `deals.shortio_link_id` — paiement en une fois
- `deal_installments.shortio_link_id` — chaque échéance d'un paiement en N fois

Elles pointent vers `shortio_link_daily_snapshots.link_id`, qui donne une ligne par
lien **et par jour** avec :

- `human_clicks` — clics réels, bots déjà exclus par le cron
- `total_clicks` — bots compris
- `date` — jour de Paris

`human_clicks` est le bon compteur. Le filtrage du bruit est déjà fait à l'écriture
(`estVraiClic` dans `lib/shortio-clicks.ts`) : sur un domaine réel, 349 des 368 entrées
d'une semaine étaient des scans automatisés que Short.io marque pourtant `human: true`.
Ne pas refaire ce filtre, ne pas s'en passer non plus.

## Ce qu'il reste à écrire

**Une lecture.** Rien d'autre.

```sql
-- Par lien de paiement : a-t-il été ouvert, et quand pour la première fois ?
select s.link_id,
       sum(s.human_clicks)                                as clics,
       min(s.date) filter (where s.human_clicks > 0)      as premier_clic
from shortio_link_daily_snapshots s
where s.link_id = any($1)          -- les shortio_link_id du deal et de ses échéances
group by s.link_id;
```

Un seul aller-retour pour tous les liens d'un deal. Ne pas passer par
`/api/shortio/snapshots` : cette route agrège **tous** les liens du profil pour
alimenter Business micro, c'est disproportionné pour afficher trois pastilles.

Côté écran, l'état d'une échéance devient un choix entre trois, et non deux :

| État | Condition | Ce que ça veut dire |
|---|---|---|
| Payé | le paiement Stripe existe | rien à faire |
| Ouvert, pas payé | `clics > 0` | objection — message personnel |
| Jamais ouvert | `clics = 0` | le lien n'est pas arrivé — le renvoyer |

## Trois pièges

**1. `shortio_link_id` peut être `null`, et c'est normal.** Sans Short.io connecté,
`shortenUrl` échoue en silence et l'URL Stripe brute est envoyée : on encaisse quand
même, on perd seulement le tracking. Dans ce cas l'écran doit dire « non suivi », pas
« jamais ouvert » — un `0` affirmerait quelque chose de faux.

**2. Zéro clic n'est pas forcément zéro ouverture.** Un lien ouvert hors navigateur
(aperçu Instagram, certains clients mail) ne produit pas toujours de clic tracé. C'est
le même phénomène qui fait dépasser 100 % certains taux de conversion dans Business
micro. Formuler « aucune ouverture détectée » plutôt que « jamais ouvert ».

**3. Ne pas donner de `link_category` à ces liens.** Ils sont volontairement classés
`null` dans `lib/shortio-link-category.ts` : ils ne relèvent pas de l'acquisition et
n'entrent pas dans « Clics totaux ». Leur en attribuer une les ferait entrer dans les
chiffres de Business micro et fausserait le taux de conversion de l'élève.

## Pourquoi ce n'est pas fait ici

Le chantier Business micro touchait `components/analytics/` ; l'affichage relève de
`components/payments/`, sur lesquels un autre chantier travaillait en parallèle. Rien
d'autre ne bloque.
