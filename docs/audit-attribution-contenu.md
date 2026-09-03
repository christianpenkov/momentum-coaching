# Audit — d'où vient le contenu crédité d'un rendez-vous

Fait le 2026-09-03, avant toute modification. Aucun code n'a été touché.

**La question de départ.** Le lien Calendly envoyé en DM porte un `utm_content`. Ce lien
est-il régénéré quand le prospect prend un autre lead magnet, ou reste-t-il figé ?

**La réponse.** Il est figé. Et ce qu'il contient n'est ni le premier contenu, ni le
dernier : c'est **le dernier contenu de la fiche au moment où quelqu'un a cliqué
« générer »**.

---

## 1. Ce que l'UTM est réellement

`components/liens/PageLiens.tsx:3533` décide du contenu à graver, selon un mode :

| mode | ce qui est gravé | quand |
|---|---|---|
| `lead` | `instagram_leads.media_id` — le champ **mutable**, écrasé à chaque commentaire | le coach choisit un prospect dans la liste (ligne 3691) |
| `auto` | `posts[0].id` — **le dernier post du compte** | par défaut, si la fiche n'a pas de `media_id` |
| `manual` | le post choisi à la main | choix explicite |
| `none` | rien | choix explicite |

Le mode `lead` est le chemin normal. Il fige donc **un instantané d'un champ mutable, pris
à un moment arbitraire** : le jour où le lien a été créé.

⚠️ **Le mode `auto` invente une attribution.** Si la fiche n'a pas de contenu (cold DM,
message reçu sans commentaire), le lien part avec le dernier post du compte, que le
prospect n'a jamais vu. Aucun cas en base au 2026-09-03, mais le premier cold DM à qui on
envoie un lien Calendly tombe dedans.

**Vérifié en base.** Pour les 3 liens existants, le contenu gravé égale exactement le
dernier contenu pris à la date de création du lien. Jamais mis à jour ensuite.

**Vérifié dans le code.** `lib/instagram-webhook-processor.ts:705` ne met à jour que
`calendly_link_sent`, `calendly_link_sent_at` et `last_calendly_link_sent_at` à l'envoi.
Aucun endroit du dépôt n'écrit `prospect_links.content_id` après la création.

**Un seul lien par personne.** Le chemin Short.io est `prendre-rdv-<pseudo>` : il est
nommé d'après la PERSONNE, jamais d'après le contenu. Trois lignes en base, une par
prospect, aucune archivée ni supprimée.

---

## 2. Le périmètre réel du défaut — beaucoup plus étroit qu'il n'y paraît

C'est le résultat qui compte, et il n'était pas prévisible : **l'UTM n'est douteuse que
pour le lien DM**. Partout ailleurs, elle dit vrai.

| origine | calls (2026-09-03) | l'UTM est-elle fiable ? |
|---|---|---|
| `ig_description`, `yt_description` | 10 | ✅ le contenu qui **porte** le lien est celui qui a produit le clic |
| `ig_story` | 1 | ✅ `utm_content` = id de séquence, posé par `client/story-sequences/route.ts:198` |
| `ig_bio` | 3 | ✅ `utm_content` nul — une bio ne vient d'aucun contenu, par nature |
| **`ig_dm`** | **4** | ❌ **un seul lien par personne, gravé une fois** |

**Pourquoi la différence.** Un lien de description vit DANS un contenu : il n'existe qu'un
lien par post, et cliquer dessus prouve qu'on regardait ce post. Un lien DM vit dans une
conversation : il n'existe qu'un lien par personne, et il survit à tous les contenus
qu'elle prendra ensuite.

**Conséquence pour le chantier** : ne toucher qu'au cas `utm_medium = 'dm'`. Remplacer
l'UTM partout serait une régression sur 11 calls sur 18.

---

## 3. L'impact mesuré

Sur les 4 rendez-vous venus d'un DM, **2 sont crédités au mauvais contenu** :

| prospect | réservé | crédité aujourd'hui | dernière prise avant la résa | € |
|---|---|---|---|---|
| incogniton.734 | 15/06 | 18034…572 | 18034…572 | — |
| christian_penkov | 15/06 | 18060…678 | 18060…678 | 1 000 |
| **rdjdkzjd** | 08/07 | 18034…572 | **18056…457** | **500** |
| **incogniton.734** | 15/08 | 18034…572 *(repli sur le lien de juin)* | **18056…457** | — |

Si la règle change : le contenu `18034119419716572` passe de 3 calls / 500 € à
1 call / 0 €, et `18056185901693457` de 0 à 2 calls / 500 €.

---

## 4. La carte des lecteurs

28 fichiers touchent `utm_content`. Ils ne jouent pas le même rôle, et seuls quelques-uns
sont concernés.

### Écrivains de `calls.utm_content` — recopient ce que Calendly renvoie

`app/api/webhooks/calendly/route.ts`, `app/api/calendly/sync/route.ts`,
`lib/calendly-fetch.ts`, `supabase/functions/sync-calendly/index.ts`.

Aucun ne décide de rien : ils transportent. **Rien à changer.**

### Producteurs de l'UTM — c'est là que le contenu est DÉCIDÉ

| fichier | ce qu'il grave | verdict |
|---|---|---|
| `components/liens/PageLiens.tsx:3576` | lien DM personnel | ❌ **le seul problème** |
| `app/api/client/story-sequences/route.ts:198` | id de séquence story | ✅ |
| `lib/click-redirect.ts` | liens partagés bio / description | ✅ |
| `lib/stripe-payment-links.ts` | liens de paiement | hors sujet |

### Lecteurs qui COMPTENT — ceux qu'une correction déplace

| fichier | ce qu'il fait | concerné ? |
|---|---|---|
| `lib/attribution-roles.ts:253` | `contenuConversion` — `utm_content` puis repli `prospect_links.content_id` | ✅ **le cœur** |
| `components/analytics/PageClientStats.tsx` | `matchesContent` (Ce que fait chaque contenu), Breakdown par source | ✅ via `contenuConversion` |
| `app/api/payments/links/route.ts:173` | écrit `deals.first_touch_content_id = call.utm_content` | ✅ **fige la copie** |
| `app/api/instagram/story-sequences-stats/route.ts` | `.eq('utm_content', seq.id)` | ❌ séquences, fiable |

### Lecteurs qui AFFICHENT — ils ne comptent rien

`components/pipeline/PagePipeline.tsx`, `components/pipeline/ProspectDetailModal.tsx`,
`app/api/client/pipeline/route.ts` : retrouvent le titre d'une vidéo ou d'un post pour
l'afficher, **uniquement** quand `utm_medium === 'description'` ou
`source === 'ig_description'`. Ces cas viennent de liens partagés, où l'UTM est fiable.
**Rien à changer.**

### Héritage

`app/api/client/calls/route.ts:98` : un 2ᵉ rendez-vous hérite de l'`utm_content` de son
parent. Cohérent avec la chaîne d'opportunité — **rien à changer**, mais si la règle de
conversion change, l'héritage devra suivre la même règle plutôt que de recopier l'UTM.

### Contrôles

- `utm_anomalies` (migrations du 2026-08-19) : vérifie la **forme** de l'UTM, pas son sens.
- `ventes_sante_contenu` : compare `deals.first_touch_content_id` à `contenuConversion()`.
  ⚠️ **Si `contenuConversion` change sans que la colonne soit recalculée, cette vue
  alertera sur toutes les ventes DM.** Elle est le garde-fou qui rendra la migration
  visible — à condition de la traiter dans le même mouvement.

---

## 5. Recommandation

**Faire lire le journal à `contenuConversion`, pour le seul cas DM.**

L'argument n'est pas « le dernier touch vaut mieux que le premier ». Il est que
**Conversion est le seul des trois rôles à ne pas lire le journal** :

| rôle | source | règle |
|---|---|---|
| Acquisition | `instagram_lead_lm_history` | le contenu de la prise |
| Activation | journal + horodatage | le contenu en vigueur **à cet instant** |
| **Conversion** | **`calls.utm_content`** | **un instantané pris à un moment arbitraire** |

La fonction qui répond à « quel contenu était en vigueur à tel moment » existe déjà :
`contenuActivation(historique, occurred_at)`. Conversion doit poser la même question à
`booked_at`.

Le commentaire de `attribution-roles.ts:239` dit déjà, mot pour mot : *« un contenu de
juin ne doit pas récolter une vente d'août qu'il n'a pas déclenchée »*. La correction du
2026-08-29 a retiré le repli d'acquisition mais a gardé l'UTM, qui a exactement le même
défaut. Il s'agit de finir ce qui avait été commencé.

**Ce que l'UTM garde.** Elle reste la source pour tout ce qui ne vient pas d'un DM, et le
repli pour un prospect DM sans aucune ligne au journal.

---

## 6. Ce qui reste à décider avant d'écrire

1. **La colonne `deals.first_touch_content_id`** est une copie figée, lue par quatre
   routes de paiement. Faut-il la recalculer sur l'historique, ou la laisser telle quelle
   et accepter que `ventes_sante_contenu` alerte ? Les deux se défendent : la colonne
   porte peut-être volontairement le contenu **au moment de la vente**.
2. **Le mode `auto` de Gérer mes liens** grave le dernier post du compte quand la fiche
   n'a pas de contenu. Décidé le 2026-09-03 : **ne rien graver plutôt qu'inventer**.
   À porter par la session Gérer mes liens.
3. **Le bornage mixte du Breakdown par source**, trouvé au passage et non traité ici : la
   fenêtre porte sur la date d'ENVOI du lien (`PageClientStats.tsx:8040`), alors que le
   clic est retenu quelle que soit sa date (`linkClickedByLeadId` n'a aucune borne). Un
   lien envoyé en août et cliqué en octobre compte dans les clics d'août. Chantier
   distinct.

---

## 7. Par où une vente est créée

Deux vérités différentes, et c'est la seconde qui compte quand on cherche un trou.

**En base**, un seul `insert` sur `deals` dans tout le dépôt : `/api/payments/links`.
Tout le reste est `update` ou `select`.

**Dans l'interface**, DEUX boutons y mènent :

| écran | ce qu'il envoie | attribution |
|---|---|---|
| Paiements → « Créer un lien de paiement » (`CreateLinkModal`) | `who` = prospect / client existant / hors pipeline | selon le cas |
| Rapport d'appel → « vente conclue » (`RapportModal:571`) | `callId` | passe par la règle du journal |

Le second est le chemin **principal** en pratique : la plupart des ventes naissent du
rapport d'appel, pas de la page Paiements. Il transmet `callId`, donc l'attribution y
est calculée depuis le journal, ancrée sur la réservation.

⚠️ Chercher « où crée-t-on une vente » dans la base répond à une autre question que
« où l'utilisateur en crée-t-il une ». La première a manqué le rapport d'appel, qui est
pourtant le chemin le plus emprunté.

**Ordre volontaire dans le rapport** : le deal est créé AVANT que le rapport soit
enregistré. Si Stripe refuse ou que le réseau lâche, on obtient un rapport manquant
plutôt qu'un appel marqué « vente conclue » sans deal — l'argent reste juste, seul le
drapeau manque.

---

## 8. Le piège à retenir, au-delà de ce cas

Le motif écrit dans `lib/attribution-roles.ts` — *« il réserve en rouvrant l'ancien lien
Calendly de GUIDE qui traînait dans la conversation, donc GUIDE a fait réserver »* —
repose sur une **prémisse fausse**. Il n'existe pas « le lien de GUIDE » et « le lien de
A » : il n'y a qu'un lien par personne, dont l'UTM nomme le contenu qui était courant le
jour de sa création.

Le raisonnement était cohérent, documenté, testé — et bâti sur une hypothèse jamais
vérifiée sur le mécanisme réel. **Un raisonnement juste sur une prémisse fausse produit
une règle fausse que personne ne remet en cause, précisément parce qu'elle est
documentée.** Ce même raisonnement figure dans `docs/pourquoi-ces-choix-stats.md` ; il
devra être corrigé là aussi.
