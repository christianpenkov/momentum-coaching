# Isolation entre coachs — audit du 2026-09-04

**Pourquoi cet audit maintenant.** La plateforme n'a **jamais tourné avec deux coachs**.
Mesuré le 2026-09-04 : un seul coach, 5 élèves, tous les siens.

C'est le point important, et il vaut bien au-delà de ce projet : **avec un seul locataire,
un filtre oublié est invisible.** Tout ce que l'on voit nous appartient de toute façon,
donc une requête qui ne cloisonne pas a l'air parfaitement correcte — et elle fuit le
jour où un deuxième locataire existe. La livraison à Quennel crée ce deuxième locataire.

## La méthode

Trois couches, parce qu'aucune ne suffit seule :

1. **La RLS**, testée **empiriquement** et non lue — en simulant un utilisateur.
2. **Le code applicatif**, parce que `docs/security-notes.md` le dit : le motif dominant
   est `getUser()` puis `service_role`, **qui contourne la RLS et tous les GRANT**. Une
   policy parfaite ne protège rien si la route interroge en `service_role` sans
   revérifier l'ownership.
3. **Les fonctions RPC** `SECURITY DEFINER` à paramètre de profil libre.

### Comment simuler un utilisateur en SQL

Les trois instructions doivent partir **dans le même appel** : le réglage est local à la
transaction.

```sql
select set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}',true);
set local role authenticated;
select count(*) from calls;   -- ce que CET utilisateur voit
```

⚠️ **Toujours jouer le témoin positif.** Un « il ne voit rien » ne prouve rien tant que
l'instrument n'a pas prouvé qu'il voit quelque chose : le même test avec un utilisateur
légitime doit rendre des lignes. Sinon on mesure une panne du test, pas une isolation.

## Résultats

### ✅ RLS — 26 tables, cloisonnement vérifié

Un coach fictif (un `uuid` qui ne possède rien) voit **0 ligne** sur les 26 tables
sensibles : `profiles`, `clients`, `calls`, `deals`, `messages`, `tasks`, `resources`,
`instagram_leads`, `ig_conversations`, `ig_messages`, `prospect_links`,
`prospect_events`, `integrations`, `stripe_payments`, `session_reports`,
`content_links`, `lead_magnets`, `analytics_daily_snapshots`,
`shortio_link_daily_snapshots`, `weekly_metrics`, `depot_files`, `story_sequences`,
`push_subscriptions`, `client_notifications`, `prospects`, `resource_sections`.

**Témoin positif** : le vrai coach voit 384, 333, 331, 74, 21, 15, 13… lignes. L'instrument
voit donc bien, et les zéros veulent dire quelque chose.

#### Un doute levé par la mesure, pas par la lecture

La policy `ig_messages` → « suit la conversation » ne vérifie **que l'existence** de la
conversation, sans aucune condition de propriétaire :

```sql
EXISTS (SELECT 1 FROM ig_conversations cv WHERE cv.id = ig_messages.conversation_id)
```

À la lecture, ça ressemble à une porte ouverte. Ça n'en est pas une : **la RLS
s'applique aussi à l'intérieur de la sous-requête d'une policy**, donc « la conversation
existe » signifie en réalité « la conversation existe *et vous pouvez la voir* ». Prouvé :
le coach fictif voit **0** message alors que 331 existent et que les conversations
existent.

⚠️ **Ne pas « corriger » cette policy sans refaire ce test.** Elle est correcte pour une
raison qui ne se lit pas dans son texte.

### ✅ Code applicatif — le motif tient

132 routes instancient un client `service_role`. Le tri automatique en a signalé 46 sans
mention de `coach_id` ; toutes vérifiées, **aucune fuite** :

| Groupe | Verdict |
|---|---|
| `payments/deals/[id]/*` (8 routes) — identifiant de vente **fourni par l'appelant** | ✅ toutes passent par `resolveTargetProfile` puis 403 |
| `payments/by-origin`, `payments/chain` | ✅ idem |
| `client/*` (contenus, lead magnets, pipeline, stories, conversations IG) | ✅ filtrent sur `user.id`, jamais sur un profil reçu |
| `client/pipeline/fusion` | ✅ vérifie explicitement `lead.profile_id !== user.id` |
| OAuth callbacks, routes de test/debug, webhooks | hors périmètre : agissent sur l'utilisateur authentifié |
| `calls/reminders` | ✅ cron, protégée par `CRON_SECRET` |

**Toute la sûreté de la famille « paiements » tient à une seule fonction** —
`resolveTargetProfile` (`lib/stripe-account.ts`) :

```ts
if (!requestedProfileId || requestedProfileId === userId) return userId;
// sinon : il FAUT une ligne clients avec profile_id = demandé ET coach_id = appelant
```

⚠️ **C'est le point de défaillance unique du cloisonnement applicatif.** Huit routes de
paiement en dépendent. La modifier, c'est modifier huit contrôles d'accès à la fois.

### ✅ RPC `SECURITY DEFINER` — refus bruyant

Six fonctions exposent un `p_profile_id` libre à `authenticated`
(`get_shortio_clicks_by_day`, `get_shortio_clicks_by_url`, `get_ig_posts_history`,
`get_yt_videos_history`, `get_ventes_de_la_periode`, `get_encaissements_par_jour`).

Toutes vérifient `auth.uid()` en interne — et « la fonction contient `auth.uid` » ne
prouvant rien, c'est testé :

| Appelant | Profil demandé | Résultat |
|---|---|---|
| coach fictif | un profil qui ne lui appartient pas | **exception `Acces refuse`** |
| vrai coach | un de ses élèves | **563 lignes** |

⚠️ Elles **lèvent une exception** au lieu de rendre un résultat vide, et c'est le bon
choix : un vide ne se distingue pas d'une absence de données.

### ✅ Preuve finale — deux vrais coachs, cloisonnement dans les deux sens

**Le 2026-09-04, la plateforme a eu son deuxième coach** (compte de Quennel, créé par
`npm run creer-coach`). La marche qui manquait à cet audit est donc franchie : tout ce
qui précède prouvait « un inconnu ne voit rien », ce qui n'est pas la même chose que
« chaque coach ne voit que les siens ».

| Sens | Mesure |
|---|---|
| **Quennel → données de Chris** | `clients 0`, `calls 0`, `deals 0`, `messages 0`, `leads_ig 0`, `integrations 0`, `paiements 0`, `ressources 0`, **`fichiers_de_cours 0`**, `profils 1` (le sien) |
| **Chris → données de Quennel** | `profils 6` (lui + ses 5 élèves), **`dont_quennel 0`**, `clients 5`, `fichiers 14` (les siens) |

⚠️ **Ce test reste à moitié fait tant que Quennel n'a pas ses propres élèves.** Il prouve
aujourd'hui que le coach 2 ne voit rien du coach 1, et que le coach 1 ne voit pas le
coach 2. Le jour où Quennel aura des élèves et des données, **le rejouer dans ce sens-là
aussi** — c'est la seule façon de prouver que le cloisonnement est symétrique.

### ✅ La trouvaille, et son correctif — le bucket `resources` était énumérable

**Corrigé le 2026-09-04** (migrations `20260904140000` puis `20260904150000`).

**C'est le seul défaut trouvé, et il est exactement du type annoncé : invisible à un
coach, réel à deux.**

La policy `public_read_resources` sur `storage.objects` ne porte aucune condition de
propriétaire :

```sql
SELECT ... USING (bucket_id = 'resources')
```

Mesuré, en simulant un utilisateur qui ne possède rien :

| Bucket | Fichiers qu'un inconnu peut **lister** |
|---|---|
| `resources` | **14** — soit la totalité |
| `avatars` | 2 |
| `chat-medias`, `voice-messages`, `task-attachments`, `depot-files` | **0** ✅ |

Aujourd'hui c'est sans conséquence : il n'y a qu'un coach, donc les 14 fichiers sont les
siens. **Le jour où Quennel est le deuxième coach, n'importe quel autre coach — et
n'importe quel élève de n'importe quel coach — peut énumérer et télécharger la totalité
de ses supports de cours**, c'est-à-dire le produit qu'il vend.

Ce n'est pas un oubli : le bucket a été laissé public volontairement
(`docs/security-notes.md`, « contenu déjà destiné à être visible largement »). **Mais
cette décision a été prise quand il n'y avait qu'un coach.** Elle n'a jamais été un
arbitrage multi-locataire.

#### Le correctif, et pourquoi il ne casse rien

L'application n'énumère **jamais** ce bucket. Elle n'en fait que deux usages :
`getPublicUrl` (construction d'URL côté client, qui ne consulte aucune policy, le bucket
étant public) et `remove` (couvert par `coaches_delete_own_resources`, correctement
cloisonnée). La policy de lecture ne sert donc **qu'à l'énumération**, que personne ne
fait.

```sql
-- Fermer l'énumération sans toucher aux URL publiques déjà distribuées
drop policy "public_read_resources" on storage.objects;
create policy "resources lisible par le coach proprietaire et ses eleves"
on storage.objects for select using (
  bucket_id = 'resources' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from clients c
               where c.coach_id::text = (storage.foldername(name))[1]
                 and c.profile_id = auth.uid())
  )
);
```

⚠️ **Ce correctif ferme l'ÉNUMÉRATION, pas l'accès par URL.** Le bucket restant public,
une URL connue continue de servir le fichier sans authentification. Fermer aussi cela
suppose de passer le bucket en privé et de basculer sur des URL signées — comme
`chat-medias` — ce qui casserait les 4 lignes de `resources.file_url` qui portent une URL
absolue. **Deux chantiers distincts, à ne pas confondre.**

#### ⚠️ Le piège rencontré en l'appliquant — à ne pas refaire

La première version de la policy contenait `(storage.foldername(name))[1]` **non
qualifié** à l'intérieur de la sous-requête sur `clients`. Or **`clients` possède aussi
une colonne `name`**, et PostgreSQL résout un nom non qualifié au scope le **plus
interne** : la condition comparait le dossier propriétaire au *nom du client*. **La
branche « élève » était donc toujours fausse — elle avait l'air d'une protection, elle
n'en était pas une.**

Trois choses l'ont rendue invisible, et c'est le vrai enseignement :

1. **L'autre branche fonctionnait.** Le test « le coach voit ses 14 fichiers » passait,
   donc la policy avait l'air bonne.
2. **Les élèves n'en ont pas besoin** : ils lisent par URL publique, qui ne consulte
   aucune policy. Rien ne serait jamais tombé en panne.
3. **Le test manuel du prédicat, réécrit à la main, qualifiait la colonne** (`o.name`) —
   il corrigeait le défaut au moment même de le vérifier.

Ce qui l'a trouvé : **`explain`**. Le plan montrait un `InitPlan` — donc une sous-requête
**non corrélée**, alors qu'elle devait dépendre de chaque ligne — et le filtre appliqué
sur un scan de `clients`. Ni la lecture ni le test ne donnaient cet indice.

> **Deux règles à retenir.** Dans une policy, **toujours qualifier les colonnes de la
> table protégée** : une sous-requête ouvre un scope où n'importe quel nom commun
> (`name`, `id`, `created_at`, `profile_id`) peut être capturé en silence. Et pour
> vérifier une règle, **ne jamais la retaper** : l'exécuter telle qu'elle est stockée, ou
> lire son plan. Un test réécrit teste l'intention, pas le code.

#### Vérifications faites après application

| Qui | `resources` listables | Attendu |
|---|---|---|
| un inconnu | **0** | 0 ✅ |
| le coach propriétaire | **14** | 14 ✅ |
| un élève de ce coach | **14** | 14 ✅ |
| Quennel (coach 2) | **0** | 0 ✅ |

Et la non-régression qui compte le plus : une **URL publique déjà distribuée** répond
toujours — `HTTP 200`, 400 053 octets, sans authentification. Le bucket reste public,
seule l'énumération est fermée.

## Ce que cet audit ne couvre PAS

- **Les quotas partagés.** Le cloisonnement des *données* ne cloisonne pas les
  *ressources* : quota YouTube, appels Instagram, budget des crons, taille de la base
  sont communs à tous les coachs. Des élèves de test consomment le budget des élèves
  réels.
- **L'interface.** L'audit porte sur les données, pas sur ce que les écrans affichent.
  Un écran qui agrégerait sans filtrer serait tout de même bloqué par la RLS, mais
  afficherait un total faux plutôt qu'une fuite.
- **Le cloisonnement quand le coach 2 aura des DONNÉES.** Le test à deux coachs réels est
  fait, mais Quennel n'a encore ni élèves ni contenus : il prouve que le coach 2 ne voit
  rien du coach 1. **À rejouer dans l'autre sens** dès qu'il aura ses élèves.
- **L'accès par URL connue au bucket `resources`.** Le correctif ferme l'énumération, pas
  l'accès direct : le bucket reste public. Chantier distinct (bucket privé + URL signées),
  à ouvrir seulement si Quennel juge ses supports sensibles.

## À rejouer

Ce test doit être rejoué **à chaque nouvelle table, policy ou route qui touche une donnée
de coach ou d'élève**, et en entier avant la livraison. Il est intégralement dans ce
document : contexte simulé, témoin positif, les trois couches.
