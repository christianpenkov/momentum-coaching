# Conversations Instagram

Le coach lit et annote les conversations Instagram de son élève depuis la fiche client ;
l'élève retrouve ces annotations dans son propre onglet « Conversations DM ». Le coach
**n'envoie jamais** : il rédige une suggestion, l'élève l'envoie depuis son téléphone.
Décidé le 2026-09-04 avec Chris, après mesure contre l'API réelle.

**Rien de ce document n'est une supposition sur l'API.** Chaque limite annoncée par Meta
a été rejouée contre `graph.instagram.com` avec les jetons du projet ; les mesures et leur
date sont dans la section « Ce que l'API rend vraiment ». Deux d'entre elles contredisent
la documentation officielle.

---

## Ce qui rend ce chantier peu coûteux

**On ne va rien chercher.** Le webhook est abonné à `comments,messages` depuis
`app/api/oauth/instagram/callback/route.ts:292`, et Meta pousse déjà **tout** :

- les messages entrants,
- les messages sortants, avec `is_echo: true` — y compris ceux que l'élève tape depuis
  son téléphone,
- les accusés de lecture (`read`).

Preuve, relevée dans `webhook_queue` le 2026-09-04 (le même message, vu des deux comptes,
parce que les deux sont connectés à l'app) :

```json
{ "id": "17841410050226823", "messaging": [ { "sender": { "id": "17841410050226823" },
  "recipient": { "id": "994032013431986" },
  "message": { "mid": "aWdfZAG1faXRlbTox…", "text": "…", "is_echo": true },
  "timestamp": 1788287281767 } ] }
```

Le coût API du régime permanent est donc **nul**. On arrête simplement de jeter ce qui
arrive. Les seuls appels sortants sont le backfill initial et l'URL d'une pièce jointe
qu'on regarde.

---

## Ce que l'API rend vraiment (mesuré le 2026-09-04)

### La limite des « 20 derniers messages » est FAUSSE

La doc de Meta (page *Conversations API*) affirme : *« you can only get details about the
20 most recent messages in the conversation »*. Prise pour argent comptant, elle fermait
l'option du backfill.

Rejoué sur `graph.instagram.com/v23.0`, jetons du projet :

| Mesure | Résultat |
|---|---|
| `GET /{ig-id}/conversations?platform=instagram&fields=id,updated_time,participants` | ✅ 164 conversations, pages de **50** (`limit=100` est plafonné à 50) |
| `participants` | ✅ rend `username` **et** `id` — aucun appel supplémentaire pour nommer l'interlocuteur |
| `GET /{conv-id}?fields=messages{id,created_time,from,to,message}` | ✅ **21** messages en première page |
| pagination `paging.next` | ✅ **jusqu'au premier message du fil** — 28 messages sur 3 pages, remontée au 27/06 |
| détail du message n°20 | ✅ rendu, `attachments` compris |
| `message_count` sur une conversation | ❌ champ non supporté |

**Conclusion : le backfill d'historique est possible.** La borne qu'on se donne est un
choix produit, pas une contrainte Meta.

⚠️ **Ne pas re-tester ceci sans nouvelle raison**, et ne pas rétablir la limite de 20 en
lisant la doc — c'est la doc qui a tort. Même famille de piège que
`docs/instagram-api-limitations.md` : une limitation crue à tort ne produit aucun
symptôme, puisqu'on ne construit pas la chose.

### ⚠️ `participants` désigne l'élève par son `entry.id`, PAS par `ig_account_id`

Piège attrapé le 2026-09-04 par un test de bout en bout, et il aurait cassé
l'implémentation en silence.

```
integrations.metadata.ig_account_id      = 26886602587671296
participants[] pour le MÊME compte       = 17841410050226823  (@chris.pkv)
```

C'est le même défaut Meta que sur le webhook (`entry.id ≠ ig_account_id`), qui frappe
ici à un endroit neuf. **Conséquence si on compare naïvement à `ig_account_id`** :
l'élève lui-même est classé comme interlocuteur, chaque conversation produit un fil
« avec soi-même », et le sens des messages s'inverse.

**La règle** : l'interlocuteur est le participant qui n'appartient **ni** à
`ig_account_id`, **ni** à l'`entry.id` du compte — mapping déjà tenu par la table
`ig_entry_id_mapping`, qui existe précisément pour ça. Ne pas réinventer la résolution.

### Ce que la mesure dit du volume réel

Test du 2026-09-04 sur les trois comptes, après correction du piège ci-dessus :

| Profil | Leads en base | Conversations | Leads retrouvés |
|---|---|---|---|
| `a02e5927` | 6 | 50+ | **6 sur 6** |
| `e6825b3e` | 2 | 2 | **2 sur 2** |
| `dc6f6aec` | 2 | 4 | 1 sur 2 |

**La jointure `(profile_id, ig_user_id = peer_id)` fonctionne** — les identifiants des
webhooks de commentaire et de messagerie vivent bien dans le même espace de nommage.

⚠️ **Mais elle doit tolérer les ratés.** Le lead non retrouvé porte un `ig_user_id`
scopé à un AUTRE compte : un identifiant Instagram est propre au couple (personne,
compte). `rdjdkzjd` en porte trois en base, un par compte connecté. **Ne jamais traiter
`peer_id` comme l'identité d'une personne** ni joindre dessus sans `profile_id`.

⚠️ **Et le rapport de volume valide la quarantaine** : 6 leads pour 50 conversations,
soit ~12 %. Sans quarantaine, on stockerait huit fois plus que ce que le coach peut
voir.

### Les autres cotes mesurées

| Grandeur | Valeur | D'où elle vient |
|---|---|---|
| Longueur moyenne d'un message | **40 caractères** | 28 messages d'un fil réel |
| Longueur d'un `mid` | **164 caractères** | idem |
| Part des messages sans texte (pièce jointe) | **14 %** (4 sur 28) | idem |
| Débit messaging | **2 appels/s par compte IG** | doc Meta, rate limits |
| Réponses privées à un commentaire | 750/h | idem |

### Pourquoi la plateforme n'envoie AUCUN message de coach

Meta borne l'envoi à 24 h après le dernier message entrant ; le tag `HUMAN_AGENT` porte
cette fenêtre à 7 jours, au prix d'une App Review supplémentaire, et Meta **interdit ce tag
sur un message automatisé et le détecte** — or la plateforme envoie déjà DM1/DM2/DM3.

Ce n'est pourtant pas la raison de la décision. **La raison est produit** (Chris,
2026-09-04) : un coach qui répond à la place de son élève engage l'élève sans avoir tout le
contexte, et personne ne peut plus dire qui a dit quoi. On supprime la classe de problème
plutôt que de la gérer.

**Conséquences, toutes bénéfiques :**

- aucune fenêtre de 24 h à calculer, à afficher, ni à faire basculer ;
- aucune permission supplémentaire à demander à Meta, donc les 4 permissions actuelles ne
  sont jamais mises dans la balance d'une revue ;
- un seul chemin d'action, qui marche **toujours**, quel que soit l'âge du fil ;
- un seul accord à demander à l'élève, au lieu de deux.

Le coach rédige une **suggestion**. Elle se pose dans le fil, visuellement distincte d'un
vrai message. L'élève la copie et ouvre Instagram par
`https://ig.me/m/<username>`.

⚠️ `ig.me` **ne pré-remplit pas le texte** (limite Meta) et **dégrade en page de profil sur
le web desktop**. Le bouton « Copier » n'est donc pas un confort : c'est la condition pour
que le geste fonctionne, et le libellé doit le dire.

### `last_inbound_at` reste écrit, pour une autre raison

La colonne ne sert plus à autoriser un envoi. Elle sert à trier : un fil où le prospect a
écrit **après** le dernier message de l'élève est un fil qui attend une réponse. C'est le
seul signal d'urgence de l'écran, et il ne coûte aucun appel — le webhook le donne.

---

## Les décisions, et ce qu'elles excluent

| Sujet | Décision | Ce qu'on renonce à faire |
|---|---|---|
| Périmètre reçu | tout l'inbox (on n'a pas le choix, l'abonnement est au compte) | — |
| Périmètre **stocké** | uniquement si l'élève a accordé la lecture | pas d'accord = pas une ligne en base |
| Périmètre **affiché** | les fils dont l'interlocuteur est un lead non exclu | le coach ne voit jamais la vie privée |
| Vue élève | onglet **« Conversations DM »**, même périmètre que le coach | la plateforme n'est pas un client de messagerie |
| Plateforme | **ordinateur seulement**, des deux côtés (`DesktopOnly`) | pas de fil à faire tenir sur 390 px |
| Quarantaine | un fil hors lead est gardé **30 jours**, invisible ; s'il devient un lead, il bascule à 12 mois **avec son historique** | pas de bac à trier, pas d'historique perdu |
| Historique initial | backfill des fils actifs sur **90 jours** | pas de reprise intégrale |
| Rétention | **12 mois** glissants sur les fils de leads | pas de mémoire longue |
| Exclusion | « Ce n'est pas un lead » **purge** les messages du fil et arrête d'en stocker | pas de masquage sans suppression |
| Accord | **un seul**, révocable : la lecture | plus d'accord d'écriture — l'écriture n'existe pas |
| Retrait d'accord | purge complète immédiate | pas de délai de grâce |
| Action du coach | **suggestion uniquement**, posée dans le fil | la plateforme n'envoie jamais de DM de coach |
| Notes | par fil et par message, des deux côtés, **toujours visibles par l'élève** | pas de notes privées du coach |
| Pièces jointes | marqueur typé, média redemandé à la vue | rien n'est ré-hébergé |
| Notification | compteur calculé à l'ouverture de la fiche | pas de Realtime, pas de minuteur |

### Pourquoi la quarantaine de 30 jours existe

Sans elle, « stocker tout l'inbox, n'afficher que les leads » gardait les conversations
privées de l'élève **12 mois**, invisibles mais présentes, et il n'aurait eu aucun moyen
de le savoir puisqu'il ne voit pas la liste.

| | Stocker tout 12 mois | Quarantaine 30 j |
|---|---|---|
| Base à l'équilibre, 40 élèves | ~550 Mo/an | **~170 Mo, stable** |
| Plan gratuit (500 Mo, 61 Mo occupés au 2026-09-04) | mort avant la fin de l'année 1 | tient ~2 ans |
| Vie privée conservée | 12 mois | 30 jours |

Le plan gratuit doit tenir **plusieurs mois après la livraison** (décision de Chris,
2026-09-04, dans `AGENTS.md`). La quarantaine est ce qui rend cette fonctionnalité
compatible avec cette décision.

⚠️ **La bascule quarantaine → lead ne demande aucun traitement.** La visibilité est
*dérivée* d'un `exists` sur `instagram_leads`, jamais stockée — corollaire de la règle
posée par la refonte du pipeline : *l'issue n'est jamais stockée*. Le jour où la personne
devient un lead, le fil et ses 30 jours d'historique apparaissent d'eux-mêmes.

---

## Schéma

### `ig_conversations`

```sql
create table public.ig_conversations (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  ig_account_id     text not null,          -- compte de l'élève au moment du fil
  peer_id           text not null,          -- IGSID de l'interlocuteur
  peer_username     text,
  first_message_at  timestamptz,
  last_message_at   timestamptz not null,
  last_inbound_at   timestamptz,            -- pilote la fenêtre de 24 h
  note              text,                   -- note d'en-tête du coach, vue par l'élève
  note_le           timestamptz,
  archived_at       timestamptz,            -- bascule de compte IG
  cree_le           timestamptz not null default now(),
  unique (profile_id, ig_account_id, peer_id)
);
```

⚠️ **Aucune colonne `statut` ni `lead_id`.** Les deux seraient des copies d'une vérité qui
vit dans `instagram_leads`, et une copie que personne ne confronte à sa source finit par
mentir — c'est exactement le mécanisme documenté pour `ventes_sante_contenu`. La
qualification se lit par jointure `(profile_id, peer_id) ↔ instagram_leads(profile_id,
ig_user_id)`, colonne renseignée à **100 %** (11/11 au 2026-09-04).

⚠️ **`archived_at`, pas un filtre `ig_account_id` à la lecture.** Règle établie du projet :
l'isolation d'un compte Instagram se fait par archivage à la bascule OAuth, jamais par un
filtre au moment de lire.

### `ig_messages`

```sql
create table public.ig_messages (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null references public.profiles(id) on delete cascade,
  conversation_id    uuid not null references public.ig_conversations(id) on delete cascade,
  mid_hash           bytea not null,        -- substring(digest(mid,'sha256') from 1 for 16)
  mid                text,                  -- ⚠️ SEULEMENT si pièce jointe (voir plus bas)
  sortant            boolean not null,      -- true = envoyé par l'élève (is_echo)
  texte              text,
  type_piece_jointe  text,                  -- null | image | video | audio | share | story_reply | template
  envoye_a           timestamptz not null,
  note               text,                  -- note du coach sur CE message, vue par l'élève
  note_le            timestamptz,
  cree_le            timestamptz not null default now(),
  unique (profile_id, mid_hash)
);

create index on public.ig_messages (conversation_id, envoye_a desc);
create index on public.ig_messages (profile_id, envoye_a);

-- Liste des fils : ordonnée par activité, dans le compte de l'élève.
create index on public.ig_conversations (profile_id, last_message_at desc);

-- Rend le test « cet interlocuteur est-il un lead visible ? » gratuit.
-- Index PARTIEL : il ne porte que les lignes que la lecture veut, donc il reste
-- petit même quand instagram_leads grossit.
create index on public.instagram_leads (profile_id, ig_user_id)
  where not_a_lead = false and archived_at is null;
```

### ⚠️ La RLS garde, la requête filtre — les deux, jamais l'un à la place de l'autre

À 40 élèves, un élève peut porter **2 000 conversations dont 300 seulement sont des
leads**. Si la lecture s'en remet à la RLS pour filtrer, Postgres parcourt les fils par
date décroissante et en rejette la grande majorité avant d'en trouver trente à afficher.
Le fil s'ouvre lentement, et de plus en plus lentement à mesure que la quarantaine se
remplit.

**La requête de liste doit donc porter le même prédicat explicitement** — jointure sur
`instagram_leads` avec `not_a_lead = false and archived_at is null` — pour que le
planificateur puisse attaquer l'index partiel ci-dessus. La RLS reste, inchangée : elle
n'est pas là pour aller vite, elle est là pour qu'une requête mal écrite ne rende rien
d'interdit.

⚠️ **Ne pas retirer le prédicat de la requête en constatant que la RLS fait déjà le
travail.** Elle le fait correctement et lentement. Les deux ont des rôles différents.

### La pagination du fil n'est pas optionnelle

Un fil de vente peut porter plusieurs centaines de messages. Charger tout d'un coup fait
grandir la réponse **et** le temps de rendu avec l'ancienneté de la relation — donc l'écran
ralentit précisément pour les élèves les plus avancés.

**50 messages par page**, du plus récent vers le plus ancien, chargement à la remontée.
L'index `(conversation_id, envoye_a desc)` est fait pour ça.

⚠️ **`mid` n'est renseigné que pour les messages à pièce jointe** (14 % des cas), parce
que c'est le seul cas où on doit redemander quelque chose à Meta. Un `mid` fait
**164 caractères** : le stocker partout ferait peser la clé quatre fois la donnée (texte
moyen : 40 caractères). La déduplication passe par `mid_hash`, 16 octets.

Effet mesuré sur la ligne : **~250 octets** au lieu de ~600. C'est le facteur qui décide
si la fonctionnalité tient sur le plan gratuit.

⚠️ **`unique (profile_id, mid_hash)` n'est pas décoratif.** Quand deux comptes connectés à
la plateforme se parlent, Meta livre **le même message deux fois** — une fois par compte,
avec et sans `is_echo`. Observé en base le 2026-09-04. L'insertion doit être
`on conflict do nothing`.

### L'accord, sur `clients`

```sql
alter table public.clients
  add column ig_dm_lecture_accordee_le timestamptz;
```

Une date, pas un booléen : `null` dit « jamais accordé », et la date sert de preuve le jour
où quelqu'un demande depuis quand. Même choix que partout ailleurs dans le projet.

⚠️ **Il n'y a qu'un accord, parce qu'il n'y a qu'une capacité.** Une version antérieure de
ce plan en prévoyait deux — lecture et écriture — avec une contrainte pour que la seconde
implique la première. L'écriture ayant été retirée le 2026-09-04, la colonne et sa
contrainte n'ont pas lieu d'être : **ne pas les rajouter « au cas où »**. Le jour où
l'écriture reviendrait, c'est toute la section « Pourquoi la plateforme n'envoie AUCUN
message de coach » qu'il faudrait rouvrir d'abord.

### `ig_suggestions` — atterrissage 3 seulement

⚠️ **Ne pas créer cette table dans la migration de l'atterrissage 1.** Elle n'a aucun
lecteur avant l'atterrissage 3, et une table vide sans usage est une table dont personne ne
vérifie les politiques.

```sql
create table public.ig_suggestions (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ig_conversations(id) on delete cascade,
  profile_id      uuid not null,        -- l'élève, pour la RLS et la purge
  auteur_id       uuid not null,        -- le coach
  texte           text not null,
  cree_le         timestamptz not null default now(),
  copie_le        timestamptz,          -- l'élève a cliqué « Copier »
  traite_le       timestamptz           -- l'élève l'a marquée comme envoyée
);
create index on public.ig_suggestions (conversation_id, cree_le desc);
```

⚠️ **`copie_le` et `traite_le` ne prouvent pas qu'un message est parti.** L'envoi a lieu
dans Instagram, hors de notre portée. Ce sont des marqueurs d'intention, pas des accusés —
les nommer autrement (`envoye_le`) ferait affirmer à l'écran quelque chose qu'il ne sait
pas, ce que la règle du projet interdit.

En revanche, si l'élève envoie vraiment le texte, le webhook nous le renverra en `is_echo`
et il apparaîtra dans le fil comme n'importe quel message. **C'est la seule preuve
d'envoi, et elle arrive toute seule.**

### `ig_backfill_etat`

```sql
create table public.ig_backfill_etat (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  curseur        text,            -- paging.after de la liste des conversations
  fils_traites   int  not null default 0,
  demarre_le     timestamptz not null default now(),
  termine_le     timestamptz
);
```

Une ligne par élève, écrasée. La table ne grossit jamais, aucune purge à prévoir — même
modèle que `crons_passages`.

---

## RLS

Le motif du projet est établi (`instagram_leads`, `ig_stories`, `prospect_links`) : une
politique propriétaire, une politique coach par `exists` sur `clients`. On y ajoute **la
condition d'accord** et **la condition de qualification**, de sorte que la règle produit
soit portée par la base et non par le code appelant.

**La règle de visibilité n'est écrite qu'UNE fois**, sur `ig_conversations`. Celle des
messages s'y délègue.

```sql
alter table public.ig_conversations enable row level security;
alter table public.ig_messages      enable row level security;

-- ── ig_conversations : la règle vit ICI, et nulle part ailleurs ──────────────
create policy "owner access" on public.ig_conversations for all
  using (profile_id = (select auth.uid()));

create policy "coach lit les fils de leads accordes" on public.ig_conversations for select
  using (
    exists (
      select 1 from public.clients c
       where c.profile_id = ig_conversations.profile_id
         and c.coach_id   = (select auth.uid())
         and c.ig_dm_lecture_accordee_le is not null
    )
    and archived_at is null
    and exists (
      select 1 from public.instagram_leads l
       where l.profile_id  = ig_conversations.profile_id
         and l.ig_user_id  = ig_conversations.peer_id
         and l.not_a_lead  = false
         and l.archived_at is null
    )
  );

-- ── ig_messages : se contente de suivre sa conversation ──────────────────────
create policy "owner access" on public.ig_messages for all
  using (profile_id = (select auth.uid()));

create policy "suit la conversation" on public.ig_messages for select
  using (exists (
    select 1 from public.ig_conversations cv where cv.id = ig_messages.conversation_id
  ));
```

⚠️ **Pourquoi la délégation plutôt que le prédicat recopié** (décision du 2026-09-04) : la
version recopiée écrivait la même règle sur deux tables. Deux copies d'une règle divergent
toujours — c'est le mécanisme que `ventes_sante_contenu` surveille ailleurs dans ce projet —
et le jour de la divergence, un message reste lisible alors que sa conversation ne l'est
plus. Effet secondaire gratuit : la condition lourde s'évalue **une fois par conversation**
au lieu d'une fois par message, donc un fil de 500 messages ne la paie pas 500 fois.

⚠️ **Cette délégation repose sur un comportement de Postgres : la RLS d'une table
référencée dans la politique d'une autre s'applique bien.** C'est vrai, il n'y a aucun
cycle ici (`ig_messages` → `ig_conversations` → `clients` + `instagram_leads`), mais on ne
s'y fie pas sur parole.

### ✅ Témoins joués le 2026-09-04 — la délégation est PROUVÉE

Cinq témoins, sur données 100 % synthétiques, en se faisant passer pour chaque rôle
(`set local role` + `request.jwt.claims`), puis base remise à son état exact.

| Témoin | Attendu | Obtenu |
|---|---|---|
| **positif** — coach avec accord, interlocuteur = lead | visible | ✅ 1 conversation, **1 message** |
| **négatif 1** — le lead passe en `not_a_lead = true` | invisible | ✅ 0 / 0 |
| **négatif 2** — l'accord est retiré | invisible | ✅ 0 / 0 |
| **négatif 3** — un autre utilisateur authentifié | invisible | ✅ 0 / 0 |
| **négatif 4** — `anon`, sans aucune session | invisible | ✅ 0 / 0 |

⚠️ **Le « 1 message » du témoin positif est le résultat qui compte.** `ig_messages` ne
porte aucune règle sur les leads ni sur l'accord : il n'a vu ce message **que** parce que la
RLS d'`ig_conversations` s'applique à la sous-requête de sa propre politique. La cascade est
donc démontrée, pas supposée — et le repli vers le prédicat recopié n'a pas lieu d'être.

**Rejouer ces cinq témoins si l'une des deux politiques est modifiée un jour.** Ils tiennent
en une requête chacun, et ils sont la seule chose qui distingue « la règle restreint » de
« la règle a l'air de restreindre ».

### ✅ La RPC aussi

| Contrôle | Obtenu |
|---|---|
| Doublon Meta (même `mid` deux fois) | ✅ **1 seule ligne** — le `on conflict` absorbe |
| `last_inbound_at` posé sur un entrant | ✅ |
| `mid_hash` | ✅ 16 octets |
| `mid` brut sur un message texte | ✅ omis (renseigné seulement si pièce jointe) |
| **Sans accord : la RPC écrit-elle quelque chose ?** | ✅ **rien du tout** — pas même la conversation |
| `acces_sante_lecture` après création des tables | ✅ vide |

⚠️ **Ne pas remplacer ces `exists` par un `.eq()` côté application.** Un `profile_id` est
public depuis le 2026-08-31 — il est inscrit dans la destination de chaque lien Calendly
partagé. La règle du projet est : authentifier, puis vérifier l'appartenance, jamais
filtrer sur un identifiant reçu.

### `ig_suggestions`

Trois politiques, et la troisième est celle qu'on oublie :

```sql
-- L'élève lit les suggestions qui le concernent.
create policy "eleve lit" on public.ig_suggestions for select
  using (profile_id = (select auth.uid()));

-- L'élève marque « copiée » / « traitée » — et RIEN d'autre.
create policy "eleve marque" on public.ig_suggestions for update
  using (profile_id = (select auth.uid()));

-- Le coach écrit et relit les siennes, si la lecture lui est accordée.
create policy "coach ecrit" on public.ig_suggestions for all
  using (exists (
    select 1 from public.clients c
     where c.profile_id = ig_suggestions.profile_id
       and c.coach_id   = (select auth.uid())
       and c.ig_dm_lecture_accordee_le is not null
  ));
```

⚠️ **La politique d'`update` de l'élève ne borne pas les colonnes** — Postgres ne sait
pas le faire en RLS. Un élève mal intentionné pourrait réécrire `texte`. Le risque est
faible (il ne se ment qu'à lui-même) mais il doit être borné côté route, pas côté
politique : l'écriture de l'élève passe par un endpoint qui n'accepte que `copie_le` et
`traite_le`.

⚠️ **Vérifier après création** que ces trois tables n'apparaissent pas dans
`acces_sante_lecture`. Supabase pose des privilèges par défaut sur `public` : `create
table` suffit à exposer, sans qu'aucun `grant` n'apparaisse dans le diff.

### Le Realtime ne s'active pas tout seul — vérifié

```sql
select schemaname||'.'||tablename from pg_publication_tables where pubname='supabase_realtime';
--  public.calls · public.client_notifications · public.messages
```

La publication est **explicite**, pas globale : une table nouvelle n'y entre pas d'elle-même.
Les trois tables de ce chantier resteront donc hors Realtime **sans rien faire**, ce qui
est la décision prise — le Realtime pesait récemment 45 % de l'egress.

⚠️ **Ne jamais les ajouter à cette publication** « pour que ça se rafraîchisse tout
seul ». Un fil ouvert publierait chaque message entrant à chaque onglet.

---

## Chemin d'écriture — le webhook

Dans `lib/instagram-webhook-processor.ts`, boucle `for (const messaging of entry.messaging
|| [])`, ligne ~665. Le traitement actuel (réponse d'accroche, Cold DM, DM2/DM3) reste
**strictement inchangé** ; on ajoute un seul appel en tête.

### Une seule requête, pas quatre — `enregistrer_message_ig()`

L'écriture naïve coûtait quatre allers-retours par message : vérifier l'accord, upserter la
conversation, insérer le message, mettre à jour les dates. **À 40 élèves, ~6 000 événements
DM par jour × 4 = 24 000 requêtes/jour ajoutées, sur un budget mesuré à ~66 000/jour pour
tenir sous 5 Go.** Une seule fonctionnalité aurait mangé plus du tiers du budget — or
l'egress se paie au NOMBRE de requêtes, jamais à leur poids.

Tout part donc dans **une fonction Postgres**, sur le modèle des deux RPC que ce même
fichier appelle déjà (`upsert_prospect_event_by_lead`, `insert_prospect_event_relance`) :

```sql
create or replace function public.enregistrer_message_ig(
  p_profile_id      uuid,
  p_ig_account_id   text,
  p_peer_id         text,
  p_peer_username   text,      -- null si pas encore résolu
  p_mid             text,
  p_sortant         boolean,
  p_texte           text,
  p_type_piece_jointe text,
  p_envoye_a        timestamptz
) returns uuid                  -- l'id de la conversation, null si aucun accord
language plpgsql security definer set search_path to 'public' as $$
-- 1. accord ?  2. upsert conversation  3. insert message  4. dates
$$;

revoke execute on function public.enregistrer_message_ig from anon, authenticated;
grant   execute on function public.enregistrer_message_ig to   service_role;
```

⚠️ **`revoke` ET `grant`, jamais l'un ou l'autre.** Supabase accorde `EXECUTE` à `anon` par
défaut : sans le `revoke`, n'importe qui sur Internet pourrait écrire des messages dans les
conversations de n'importe quel élève. C'est le motif déjà posé pour `declencher_cron`, et
la raison en est écrite dans `AGENTS.md`.

⚠️ **L'accord est vérifié DANS la fonction, pas avant l'appel.** C'est le point qui rend la
règle durable : aucun appelant futur ne peut l'oublier. Elle vit dans la base, pas dans la
mémoire de la prochaine personne qui touchera le webhook.

⚠️ Elle est aussi **atomique** : plus de conversation créée sans son message quand
l'insertion échoue à mi-chemin.

### Ce que le TypeScript garde

1. Résoudre le profil — le mécanisme existe déjà, y compris le cas
   `entry.id ≠ ig_account_id` (bug Meta non documenté, résolu par `ig_entry_id_mapping`).
2. Décider `sortant` : `is_echo`, ou expéditeur appartenant au compte de l'élève sous
   **l'une ou l'autre** de ses deux formes.
3. Résoudre le `username` de l'interlocuteur **une seule fois par fil** via
   `GET /{peer_id}?fields=username` — il n'est pas dans la charge utile du webhook. Ne le
   redemander que si la conversation n'en porte pas déjà un.
4. Appeler la RPC.

⚠️ **Un événement `read` n'est pas un message** : il n'a pas de `message.mid`. Ne pas
l'envoyer à la RPC.

⚠️ **Le webhook doit rester rapide.** Meta exige une réponse en moins de 30 s et désabonne
l'application après une heure d'échecs — ce qui arrêterait les DM1. Ces écritures se font
dans le **worker** (`app/api/cron/process-webhook-queue`), pas dans la route d'entrée, qui
se contente déjà de mettre en file et de répondre 200.

---

## Backfill

### ⚠️ Il ne peut PAS vivre dans `poll-leads` — la place n'existe pas

Une première version de ce plan l'y mettait. C'était faux, et le fichier le dit lui-même
(`supabase/functions/poll-leads/index.ts:86-89`) :

> *« Mesure du 2026-08-31 : une passe complète prend 14 à 18 s pour 5 profils traités
> ensemble. À 40 élèves, cela fait 8 vagues de 5, soit 112 à 144 s — contre les 150 s du
> Edge Runtime. La marge disparaît exactement à la cible du projet. »*

Et le mode de panne du dépassement est décrit juste en dessous : le runtime coupe, les
profils non traités n'écrivent rien, et **comme l'ordre de la requête est stable, ce sont
toujours les mêmes élèves qui sont sacrifiés**, sans erreur nulle part.

Argument de fond, indépendant du budget : **le backfill est un événement unique par élève**,
déclenché par un geste humain — accorder la lecture. Une chose ponctuelle n'a rien à faire
dans une boucle qui tourne toutes les 5 minutes pour toujours.

### Où il tourne : une route, réveillée — motif déjà en production ici

`app/api/instagram/backfill-conversations`, sur le modèle **exact** de `reveillerLeWorker()`
(`app/api/webhooks/instagram/route.ts:38-50`) :

```
accord accordé par l'élève
        │
        ▼
  route de consentement ──► POST /api/instagram/backfill-conversations
                                   │
                                   ├─ lit UNE page (limit=50), filtre 90 j
                                   ├─ pour chaque fil : pagine et appelle la RPC
                                   ├─ écrit ig_backfill_etat.curseur
                                   └─ after() ──► se rappelle elle-même
                                                    │
                                          … jusqu'à termine_le
        ┌──────────────────────────────────────────┘
        │  (si un réveil se perd)
        ▼
poll-leads : UNE lecture par passage
  « existe-t-il un backfill inachevé ? » → si oui, réveiller la route
```

⚠️ **poll-leads ne fait qu'UNE lecture, jamais la boucle.** Une requête ajoutée toutes les
5 minutes, pas 100. Son budget de temps n'est pas touché, et le filet de rattrapage existe
quand même.

⚠️ **Aucun cron externe à créer.** `AGENTS.md` rappelle que ni l'URL ni la cadence des jobs
cron-job.org ne se lisent dans le dépôt : chaque job de plus est une chose de plus à
recréer à la main le jour du transfert chez Quennel. Ce montage n'en ajoute aucun.

### Budget

~50 fils actifs sur 90 jours par élève, ~2 pages chacun → **~100 appels par élève**, soit
moins d'une minute à 2 appels/s. Pour 40 élèves : **~12 Mo** en base. C'est la borne des
90 jours qui rend ce poste négligeable ; sans elle il pesait ~500 Mo.

⚠️ **Ne PAS lancer 40 backfills en parallèle** le jour où plusieurs élèves accordent la
lecture ensemble. Un seul profil à la fois, choisi par `ig_backfill_etat`, sinon les
appels Meta se concurrencent et la limite de 2 appels/s par compte est franchie sur
plusieurs comptes à la fois.

---

## Purges

Une seule fonction SQL pure, un seul job pg_cron, sur le modèle des sept existantes —
aucune route HTTP à exposer.

```sql
create or replace function public.purge_ig_messages()
returns table(motif text, supprimes bigint)
language plpgsql security definer set search_path to 'public' as $$
declare n bigint;
begin
  -- 1. Fils de leads : rétention 12 mois.
  delete from ig_messages m
   where m.envoye_a < now() - interval '12 months'
     and exists (select 1 from ig_conversations cv
                   join instagram_leads l
                     on l.profile_id = cv.profile_id and l.ig_user_id = cv.peer_id
                  where cv.id = m.conversation_id and l.not_a_lead = false);
  get diagnostics n = row_count;
  motif := 'lead_12_mois'; supprimes := n; return next;

  -- 2. Quarantaine : 30 jours pour tout le reste (inconnus ET exclus).
  delete from ig_messages m
   where m.envoye_a < now() - interval '30 days'
     and not exists (select 1 from ig_conversations cv
                       join instagram_leads l
                         on l.profile_id = cv.profile_id and l.ig_user_id = cv.peer_id
                      where cv.id = m.conversation_id and l.not_a_lead = false);
  get diagnostics n = row_count;
  motif := 'quarantaine_30_jours'; supprimes := n; return next;

  -- 3. Conversations devenues vides.
  delete from ig_conversations cv
   where not exists (select 1 from ig_messages m where m.conversation_id = cv.id);
  get diagnostics n = row_count;
  motif := 'fils_vides'; supprimes := n; return next;
end; $$;
```

Job pg_cron à **4 h 15**, après `degrossir-historiques-analytics-daily` (4 h 05).

**Trois purges immédiates**, qui ne doivent pas attendre le cron parce qu'elles répondent
à un geste explicite :

| Geste | Où | Effet |
|---|---|---|
| « Ce n'est pas un lead » | `app/api/client/pipeline/route.ts`, branche `ig_username` du `PATCH` (ligne ~245) | supprime les messages du fil, et le webhook cesse d'en stocker (la règle est déjà dérivée) |
| Retrait de l'accord de lecture | route des réglages de l'élève | supprime **tout** : conversations, messages, état de backfill |
| Déconnexion / bascule du compte Instagram | callback OAuth existant | `archived_at`, comme le reste |

⚠️ **La branche `not_a_lead` est indexée par `ig_username`, les conversations par
`peer_id`.** La suppression doit donc passer par `instagram_leads` pour traduire l'un en
l'autre — et non deviner. Une fusion de fiches peut faire diverger username et
identifiant : c'est un piège déjà payé sur l'attribution.

---

## Vue de santé

Sans elle, une collecte qui s'arrête est indiscernable d'un élève qui n'a pas de
conversation. C'est la règle du projet : un mécanisme n'est « zéro maintenance » que quand
son **silence** est détectable.

```sql
create view public.ig_dm_sante with (security_invoker = true) as …
```

Trois états à couvrir :

| État | Ce qu'il veut dire |
|---|---|
| `ALERTE collecte muette` | un élève avec accord de lecture, dont `instagram_leads` a bougé depuis 7 jours, mais dont aucun message n'a été écrit sur la même période — le webhook ne stocke plus |
| `ALERTE backfill bloque` | `ig_backfill_etat.termine_le is null` et `demarre_le` a plus de 24 h |
| `ALERTE purge muette` | des messages hors lead de plus de 31 jours existent encore — le job pg_cron ne tourne plus |

⚠️ **Ajouter la vue au tableau `SURVEILLANCES` de `/api/sante/alerte-vues`**, sinon elle
est muette exactement comme les dix vues qui l'ont précédée : elle attendrait qu'on pense
à la consulter, ce qui est de la documentation, pas de la surveillance.

### ⚠️ Ajouter `ig_messages` à `base_sante_taille` — sinon l'alerte part trop tard

`base_sante_taille` est **la seule alerte qui prévient avant que le plafond de stockage ne
fasse échouer les écritures d'un coup**. Elle mesure la croissance de tables nommées une par
une. `ig_messages` sera la table qui grossit le plus vite du projet : si elle n'y figure
pas, la vue projette une date de saturation fausse et rassurante.

C'est exactement le défaut corrigé le 2026-08-31, quand `link_clicks` y a été ajoutée —
`AGENTS.md` en donne la raison en une phrase : *« une table qui grossit sans être comptée
fait partir l'alerte trop tard »*. Ne pas refaire l'erreur sur une table plus grosse.

⚠️ **Le dimensionnement dépend d'une inconnue** : combien de DM un vrai élève échange par
jour. Toutes les projections de ce document (~170 Mo à l'équilibre) supposent ~150
événements par élève et par jour. Un élève à 500/jour triple le chiffre. **On ne cherche pas
à deviner** : la vue mesure la croissance réelle et alerte à 90 puis 30 jours du plafond,
ce qui laisse le temps de raccourcir la rétention ou de passer en Pro. Le mécanisme existe,
il suffit de ne pas l'aveugler.

⚠️ **`security_invoker = true`, et aucun `grant`** — sinon `acces_sante_lecture` la
signalera, à raison.

---

## Interface

### Le principe qui règle « ça prend de plus en plus de place »

Ce qui vit **dans** la fiche a une hauteur **constante**, indépendante du nombre de
conversations. Toute la croissance part dans un conteneur qui défile pour son compte.
La fiche gagne 140 px, une fois, pour toujours.

### Le rendu du fil — à extraire, pas à réécrire

`components/liens/PageLiens.tsx:871-990` contient déjà un rendu Instagram **coté sur une
capture réelle** : palette de marque (`IG.bulle`, `IG.violet1/2`, `IG.gris`), `IgAvatar`
avec l'anneau story, `IgRecu` (bulle grise, avatar sur la **dernière** bulle du groupe
seulement — l'oublier trahit la maquette), `IgEnvoye` (dégradé diagonal, pas un aplat),
un facteur d'échelle `sc`, et un mode `sansCadre` déjà prévu.

À extraire vers `components/ig/FilInstagram.tsx`, sans cadre de téléphone.

⚠️ **Le sens est inversé entre les deux écrans.** Dans PageLiens, la bulle grise est le
message du coach et le dégradé la réponse du prospect. Ici on rend depuis le compte de
l'élève : **grise = le prospect, dégradé = l'élève**. Ce sont des primitives
gauche/droite, mais s'y tromper produit une maquette qui a l'air juste et raconte
l'inverse.

⚠️ **PageLiens.tsx fait 6 452 lignes et peut porter le travail d'une autre session.**
Vérifier avant l'extraction ; ne pas commiter le code en cours d'autrui.

### Le défilement du fil

Reprendre le motif `column-reverse` de `PageChat.tsx:1312-1385`. Ce n'est pas une
préférence : c'est la refonte qui a réglé le saut de scroll au premier tap après un
démarrage à froid, dont la cause était le reflow des polices (`display:swap`) — invisible
à toute instrumentation. Réécrire un défilement « classique » ferait revenir ce bug.

### Ordinateur seulement, des deux côtés

Un fil de messagerie annotable ne tient pas sur 390 px : la liste, le fil et les notes se
disputeraient la même largeur. Décision de Chris, 2026-09-04 — on n'essaie pas.

`components/ui/DesktopOnly.tsx` existe et porte déjà cette décision pour cinq écrans, dont
`PageClientStats`, qui est justement l'écran de l'élève le plus proche de celui-ci. Le
message de repli est déjà rédigé.

⚠️ **La fiche client du coach, elle, N'EST PAS desktop-only.** La carte y est donc rendue
sur mobile — trois chiffres tiennent parfaitement — mais son bouton est remplacé par
« Consultation sur ordinateur ». Masquer la carte ferait croire à un coach mobile que la
fonctionnalité n'existe pas.

La modale s'ouvre via `components/ui/ModalShell.tsx` en `variant='centered'` : le variant
`sheet` et toute la gestion du clavier mobile (`useHauteurClavier`) ne servent plus ici.

### Les notes, et le geste qui les pose

Une note d'en-tête par fil, une note attachable à n'importe quel message **des deux
côtés**. Seul le coach écrit ; l'élève lit. **Toujours visibles par l'élève** (décision de
Chris).

Le geste, sur ordinateur uniquement : **survol de la bulle → une pastille apparaît**, et
**clic droit → menu contextuel** au même endroit. Les deux ouvrent la même chose.

Le menu porte **deux entrées, et pas trois** : « Ajouter une note » et « Copier le
message ».

⚠️ **Pas de « Rédiger une suggestion » dans ce menu** (décision de Chris, 2026-09-04). Une
suggestion répond à la conversation *telle qu'elle est maintenant* ; l'accrocher à un
message d'il y a trois semaines ne veut rien dire. Elle vit donc au niveau du fil, dans le
champ du bas — un seul endroit, une seule sémantique.

⚠️ `preventDefault()` sur `contextmenu` est obligatoire, sinon le menu du navigateur se
superpose au nôtre. Et le menu doit se fermer sur `Escape` et sur un clic ailleurs — sans
quoi il survit au défilement du fil et flotte sur un autre message.

⚠️ **Mode d'échec à surveiller en usage réel** : un coach qui sait que son élève lit tout
n'écrit plus ce qu'il pense. Si les notes deviennent tièdes, c'est ce mécanisme-là, et le
correctif est un partage explicite par note — pas une reformulation de l'écran.

### La barre d'action : un seul état

Un champ « Rédiger une suggestion pour <prénom de l'élève> », toujours disponible, quel que
soit l'âge du fil. Pas de fenêtre, pas de bascule, pas de message d'indisponibilité.

La suggestion se pose **en bas du fil concerné, et nulle part ailleurs** (décision de
Chris, 2026-09-04), dans un bloc qui ne ressemble pas à une bulle Instagram — parce qu'elle
n'a pas été envoyée. L'élève la voit au même endroit, avec « Copier le texte » et « Ouvrir
dans Instagram ».

⚠️ **Pas de notification push, et c'est délibéré.** L'onglet de l'élève est réservé à
l'ordinateur ; une push arrivant sur son téléphone le mènerait à l'écran « Disponible sur
ordinateur ». Une notification qui dérange sans permettre d'agir est le début d'une
notification qu'on n'ouvre plus — même raisonnement que les seuils de `crons_sante`.

Le signal est donc **une pastille sur l'entrée de menu**, comme celle qui existe déjà pour
« Messages » (`components/layout/SidebarClient.tsx:64`) : elle apparaît là où l'action est
possible, et seulement là.

⚠️ **Conséquence à assumer** : une suggestion peut rester non vue plusieurs jours si l'élève
ne se met pas devant un ordinateur. Le coach dispose de la messagerie Momentum s'il veut le
prévenir — c'est son geste, pas un automatisme de la plateforme.

### « Ouvrir la discussion » tombe sur le BON fil, y compris sur ordinateur

C'est la trouvaille du 2026-09-04, et elle supprime tout le compromis qui précédait.

`ig.me/m/<username>` dégrade en page de profil sur Instagram web — donc inutilisable sur
ordinateur. Mais **l'identifiant de conversation que rend l'API contient le numéro de fil
d'Instagram**, et `instagram.com/direct/t/<numéro>` ouvre directement la bonne
conversation. **Vérifié en session connectée par Chris.**

```
id API :  aWdfZAG06MzQwMjgyMzY2ODQxNzEwMzAxMjQ0MjU5MDcyODQwODUzNzU5NDMw
          └── préfixe ──┘└──────────── base64 du numéro ─────────────────┘
décodé :  340282366841710301244259072840853759430
lien   :  https://www.instagram.com/direct/t/340282366841710301244259072840853759430/
```

**Aucun appel supplémentaire** : le numéro se dérive de l'identifiant qu'on stocke déjà.

#### La règle, et pourquoi elle est mesurée et non déduite

Ce format n'est **documenté nulle part par Meta**. Il a donc été vérifié sur
**l'intégralité des conversations des trois comptes connectés** :

| | |
|---|---|
| Conversations examinées | **170** |
| Décodées en nombre pur | **170 — 100 %** |
| Préfixes distincts rencontrés | **un seul** : `aWdfZAG06` |
| Longueur du nombre | **39 chiffres**, sans exception |

```js
const PREFIXE = 'aWdfZAG06';
function lienDiscussion(conversationId, peerUsername) {
  if (conversationId.startsWith(PREFIXE)) {
    const n = Buffer.from(conversationId.slice(PREFIXE.length), 'base64').toString('utf8');
    if (/^\d+$/.test(n)) return `https://www.instagram.com/direct/t/${n}/`;
  }
  return `https://ig.me/m/${peerUsername}`;   // repli, jamais un lien fabriqué
}
```

⚠️ **Le repli n'est pas une précaution de style : c'est ce qui rend la règle acceptable.**
On s'appuie sur un encodage non documenté, que Meta peut changer sans prévenir. Si le
préfixe change ou si le décodage ne rend pas un nombre, on retombe sur `ig.me` — jamais sur
un lien fabriqué qui mènerait ailleurs. **Ne jamais retirer ces deux gardes** en trouvant
qu'elles ne servent jamais : leur inutilité actuelle est exactement leur raison d'être.

⚠️ **Ne pas stocker le numéro en colonne.** Il se dérive en une ligne d'un identifiant déjà
en base ; une colonne serait une copie de plus à maintenir cohérente, pour rien.

⚠️ **Non vérifié : le comportement sur téléphone.** `instagram.com/direct/t/<n>` ouvre
peut-être l'application par lien universel, ou peut-être le web mobile. Tant que ce n'est
pas mesuré, viser `ig.me/m/<username>` sur mobile — il y fonctionne, c'est établi.

Et si l'élève préfère son téléphone, il retape le message — friction acceptée par Chris,
qui ne justifie aucun mécanisme supplémentaire.

### Les photos de profil — déjà résolues, ne rien reconstruire

`fetchAndStoreAvatar()` (`lib/instagram-webhook-processor.ts:191`) fait déjà tout :
`GET graph.instagram.com/v22.0/{igsid}?fields=profile_pic`, téléchargement, dépôt dans le
bucket public `instagram-avatars` sous `{igUserId}.jpg`, et l'URL publique atterrit dans
`instagram_leads.avatar_url`.

⚠️ **Ne pas ajouter de colonne `peer_avatar_url` sur `ig_conversations`.** Le fichier est
nommé par l'identifiant Instagram de la personne, qui EST notre `peer_id`, et la
conversation est déjà jointe à `instagram_leads` pour décider de sa visibilité. Une
troisième copie de la même URL divergerait le jour où quelqu'un change de photo — c'est le
mécanisme de `ventes_sante_contenu`, encore.

Mesures du 2026-09-04 :

| | |
|---|---|
| Poids moyen d'un avatar | **~6 Ko** (43 Ko pour 7 fichiers) |
| Déduplication | par couple **(personne, compte)** — voir l'avertissement ci-dessous |
| Projection 40 élèves × 500 fils | **~120 Mo** sur 1 Go gratuit |
| Couverture réelle | **8 leads sur 11** — le repli n'est pas théorique |

⚠️ **Correction d'une première lecture.** Ce tableau annonçait « dédupliqué par
personne ». C'est faux : le fichier est nommé par l'identifiant Instagram, qui est
**scopé au compte**. La même personne écrivant à trois élèves produit trois fichiers.
Les 7 fichiers pour 8 leads venaient de deux lignes portant le même `ig_user_id`, pas
d'une déduplication entre comptes. La projection de stockage tient quand même — elle
comptait déjà un avatar par fil, pas par personne.

**Le repli existe aussi** : `components/ui/Avatar.tsx`, dont le commentaire précise qu'il
gère les `@handles` de leads Instagram. Couleur dérivée du **nom**, jamais de la position
dans la liste — pour que la même personne ait la même pastille sur tous les écrans.

⚠️ **Pas d'anneau de story dégradé autour de l'avatar**, contrairement à `IgAvatar` de
PageLiens. Instagram ne l'affiche que si la personne a une story active, et nous ne le
savons pas. Le dessiner sur tout le monde serait une donnée inventée — l'interdit premier
du projet.

### L'onglet « Conversations DM » de l'élève

Nouvelle route `/client/conversations`, dans `components/layout/SidebarClient.tsx` **juste
après « Pipeline Leads »** — c'est le même entonnoir, et le voisinage est ce qui rend
l'entrée compréhensible sans explication. Icône `instagram`, déjà présente dans
`components/ui/Icon.tsx:200`.

⚠️ **Utiliser cette icône plutôt qu'un carré dégradé fabriqué à la main.** Le glyphe officiel
(contour arrondi, cercle, point) est déjà dans le projet ; une approximation colorée se
remarque immédiatement et fait passer l'écran pour un brouillon.

Même maître-détail que le coach, à trois différences près :

| | Coach | Élève |
|---|---|---|
| Poser une note | oui | non — il les lit |
| Rédiger une suggestion | oui | non |
| Agir sur une suggestion | non | « Copier » + « Ouvrir dans Instagram » |

**Même périmètre exactement** : les fils de prospects, pas l'inbox complet. Pour le reste,
l'élève a Instagram. C'est ce qui préserve la quarantaine de 30 jours — et donc le plan
gratuit.

### Le compteur

Calculé par la requête qui charge déjà la fiche (`fetchClientDetail`, un `select` de plus
dans le `Promise.all` existant). **Pas de Realtime, pas de minuteur.** Le Realtime pesait
récemment 45 % de l'egress Supabase, et un onglet ouvert coûte à chaque battement : ici,
une ouverture de fiche = une requête, et zéro en régime permanent.

---

## Les mots

### Le coach porte son prénom, **partout**

Règle posée par Chris le 2026-09-04, et elle vaut sur **tous** les écrans du chantier — pas
seulement les réglages : l'onglet de l'élève, les notes, les suggestions, les
notifications push.

| Ne jamais écrire | Écrire |
|---|---|
| « Mon coach peut lire mes conversations » | « **Quennel** peut lire mes conversations Instagram DM » |
| « Note du coach » | « **Note de Quennel** » |
| « Ton coach t'a laissé une suggestion » | « **Quennel** t'a laissé une suggestion » |

⚠️ **Le prénom vient de la base**, du coach réellement rattaché à cet élève —
`clients.coach_id → profiles`. Jamais une chaîne codée en dur, jamais « ton coach ». Une
plateforme livrée à quelqu'un d'autre afficherait sinon le mauvais nom, en silence : c'est
la même famille de défaut que les valeurs codées en dur listées dans
`docs/transfert-de-compte.md`.

⚠️ **Prévoir le cas où le prénom manque.** Un élève sans coach rattaché, ou un profil sans
nom, ne doit pas produire « peut lire mes conversations » sans sujet. Le repli est le nom
complet, puis « ton coach » en tout dernier ressort — jamais l'inverse.

### « Instagram DM », jamais « conversations » tout court

L'élève a **deux** messageries : celle de Momentum avec son coach, et ses DM Instagram.
Un libellé qui ne dit pas laquelle lui fait croire qu'il accorde l'accès à celle qu'il
utilise déjà tous les jours.

---

## Tests

`npm test` (node --test, aucune dépendance) couvre les fonctions pures de `lib/*.test.ts`.
Quatre fonctions de ce chantier y appartiennent, et ce ne sont pas des tests de confort :
**trois d'entre elles encodent un piège Meta qui a déjà coûté du temps au projet.**

```
lib/igConversations.ts                         lib/igConversations.test.ts
├── lienDiscussion(convId, username)           [★★★] préfixe attendu → lien direct
│   └── décode un format NON documenté               préfixe autre    → repli ig.me
│                                                    décodage non numérique → repli ig.me
│                                                    username absent  → pas de lien du tout
│
├── estSortant(messaging, igAccountId, entryId)[★★★] is_echo true            → sortant
│   └── LE piège entry.id ≠ ig_account_id            sender = ig_account_id  → sortant
│                                                    sender = entry_id       → sortant  ⟵ le cas qui casse
│                                                    sender = interlocuteur  → entrant
│
├── interlocuteur(participants, ig, entry)     [★★★] soi sous forme entry.id → exclu  ⟵ le cas qui casse
│   └── même piège, côté API conversations           soi sous forme ig_account_id → exclu
│                                                    aucun autre participant → null, pas une erreur
│
└── typePieceJointe(message)                   [★★ ] image / video / audio / share / story_reply
                                                     texte seul → null
                                                     type inconnu Meta → 'autre', jamais une exception
```

⚠️ **Le test qui compte le plus est `sender = entry_id → sortant`.** Sans lui, la seule
chose qui protège du piège `entry.id ≠ ig_account_id` est le souvenir de la personne qui
relit. C'est un piège déjà payé deux fois dans ce projet ; un test le fige.

⚠️ **`lienDiscussion` doit être testé sur son REPLI autant que sur son chemin nominal.** Le
repli ne se déclenchera jamais tant que Meta ne change rien — donc seule une assertion
prouve qu'il fonctionne le jour où il servira. Sans test, il sera supprimé comme code mort
à la première relecture.

**Ce qui ne se teste pas en unitaire, et comment c'est couvert à la place :**

| Chemin | Couverture |
|---|---|
| `enregistrer_message_ig()` — accord, upsert, on-conflict | les deux témoins RLS de l'atterrissage 1, puis `ig_dm_sante` |
| Les purges 30 j / 12 mois | `ig_dm_sante` état `purge muette` |
| Le backfill se termine | `ig_dm_sante` état `backfill bloque` |
| La collecte ne s'arrête pas | `ig_dm_sante` état `collecte muette` |

C'est le motif du projet : ce qui n'est pas testable en unitaire doit laisser une **ligne
en base** qu'une vue peut interroger, jamais un log — les logs Vercel ont une heure de
rétention sur le plan Hobby et rendent une absence indiscernable d'une ignorance.

---

## Ordre d'exécution

**Trois atterrissages** (décision du 2026-09-04), pour que chaque étage se prouve avant que
le suivant s'y appuie. Un défaut de collecte découvert après la construction des écrans se
diagnostique mal — et la quarantaine de 30 jours rend la donnée manquante irrécupérable.

### ✅ Atterrissage 1 — LIVRÉ le 2026-09-04

Cinq commits, de `0bafbef` à `2e631ba`. Migrations : `conversations_instagram`,
`conversations_instagram_purges_sante`,
`enregistrer_message_ig_signale_le_pseudo_manquant`,
`base_sante_taille_compte_ig_messages`.

**Vérifié sur le code déployé, pas en local :** deux événements mis en file dans
`webhook_queue`, traités par le worker de production. Résultat — deux messages écrits, une
seule conversation, `ig_account_id` résolu à sa forme **canonique** et non à l'`entry.id`
reçu, `is_echo` classé sortant, `last_inbound_at` posé, `mid` omis sur un texte, empreinte
à 16 octets. Base remise à zéro ensuite.

⚠️ **Le pseudo n'a pas pu être résolu pendant le test** : l'identifiant de l'interlocuteur
était fictif, donc Meta a refusé. C'est le repli attendu (pas de pseudo, pas de plantage),
mais **la résolution nominale n'a jamais tourné en réel**. C'est le seul chemin de
l'atterrissage 1 que le premier vrai DM éprouvera pour la première fois.

### ✅ Atterrissage 2 — LIVRÉ le 2026-09-04

Écrans coach et élève, extraction des primitives, vue `ig_conversations_visibles`.

**Ce que le lancement réel a corrigé, et qu'aucune relecture n'aurait montré :**

| Défaut | Comment il s'est révélé |
|---|---|
| Le curseur de page perdait le reste d'une page à la coupure du budget | « 3 fils traités sur 164, terminé » — un succès qui ment |
| Backfill 90 j vs quarantaine 30 j : deux tiers des messages importés partaient à la purge suivante | **`ig_dm_sante` l'a signalé d'elle-même** — une vue de santé détecte aussi une incohérence entre deux décisions, pas seulement une panne |
| Le fil s'ouvrait sur le message le plus ANCIEN | visible seulement à l'écran |
| La pastille de note se collait au bord de la modale | visible seulement à l'écran |
| 122 messages = 122 requêtes | le N+1 que j'avais condamné côté webhook, laissé passer côté backfill |

⚠️ **Leçon à garder** : les types prouvent la forme, les tests prouvent les règles qu'on a
pensé à écrire, et **seul le lancement réel prouve les quantités**. Comparer au volume
attendu, pas seulement à l'absence d'erreur.

**Vérifié en conditions réelles, connecté en coach** : carte à **161 px** de hauteur,
4 fils suivis / 1 actif / 1 en attente, modale ouverte sur les vrais échanges, avatars
réels, sens des bulles correct. Backfill : 4 fils importés = **exactement** les 4 leads
visibles, zéro lead exclu, zéro alerte de santé.

### ✅ Atterrissage 3 — LIVRÉ le 2026-09-04

Table `ig_suggestions`, composeur côté coach, bloc dans le fil, boutons côté élève,
pastille sur l'entrée de menu.

**Vérifié en conditions réelles** : suggestion rédigée et envoyée depuis l'interface du
coach, écrite en base, affichée dans le fil.

⚠️ **Trois faux négatifs pendant la vérification, tous dus à la SONDE et non au code.**
`innerText` ignore les `placeholder` et rend le texte **après** `text-transform` : chercher
« Rédiger une suggestion » (un placeholder) ou « pas encore envoyée » (rendu en majuscules)
rendait « absent » sur une interface parfaitement fonctionnelle. **Une sonde qui peut
rapporter une absence doit rendre, dans la même mesure, la preuve qu'elle aurait su voir la
présence** — un extrait du contenu observé, jamais un simple booléen.

Reste de l'atterrissage 1, à faire :

### Atterrissage 1 — la plomberie, invisible (~6 fichiers)

1. Migration : `ig_conversations`, `ig_messages`, `ig_backfill_etat`,
   `clients.ig_dm_lecture_accordee_le`, les index (dont l'index partiel sur
   `instagram_leads`), les politiques RLS déléguées, `enregistrer_message_ig()` avec son
   `revoke`.
2. **Jouer les deux témoins RLS** — positif ET négatif. Le négatif décide : s'il échoue,
   revenir au prédicat recopié avant d'aller plus loin.
3. Vérifier `acces_sante_lecture` : les deux tables ne doivent pas y apparaître.
4. Écran d'accord côté élève (**un** interrupteur, au nom réel du coach) + route de retrait
   avec purge complète.
5. Appel de la RPC dans le worker de webhook.
6. Route de backfill + réveil, et la lecture unique de rattrapage dans `poll-leads`.
7. Purge SQL + job pg_cron 4 h 15 + les trois purges immédiates.
8. `ig_dm_sante`, inscription dans `SURVEILLANCES`, **et `ig_messages` ajoutée à
   `base_sante_taille`**.
9. Tests unitaires des quatre fonctions pures.

**Puis on laisse tourner 2 à 3 jours.** `ig_dm_sante` prouve que la collecte marche, et de
vrais messages s'accumulent — les écrans se construiront sur de la donnée réelle, pas sur
des fixtures.

### Atterrissage 2 — les écrans (~7 fichiers)

10. **Extraction de `FilInstagram.tsx` depuis PageLiens, en un commit isolé qui ne change
    aucun comportement** — on déplace, on vérifie que PageLiens rend à l'identique, on
    commite. Puis seulement on construit dessus.
11. Carte dans `PageClientDetail` (hauteur fixe, bouton désactivé sur mobile) + modale
    maître-détail, `DesktopOnly`, pagination 50 messages, menu contextuel survol/clic droit.
12. Onglet `/client/conversations` — mêmes composants, sans les gestes d'annotation.

⚠️ **Vérifier `git status` sur `PageLiens.tsx` avant l'étape 10.** Le fichier fait
6 452 lignes et a déjà porté le travail en cours d'une autre session. Ne pas commiter le
code d'autrui.

### Atterrissage 3 — les suggestions (~3 fichiers)

13. Table `ig_suggestions` + ses trois politiques.
14. Composition côté coach, bloc dans le fil, boutons « Copier » et « Ouvrir la discussion »
    côté élève, pastille sur l'entrée de menu.

---

## Ce qui reste ouvert, et qui ne se code pas

1. ~~**L'unsend.**~~ **FERMÉ le 2026-09-04.**

   ⚠️ **Ce point était FAUX, et il a tenu plusieurs heures.** Il affirmait qu'aucun webhook
   ne signale un message annulé et que la rétention en était la seule borne. La doc
   officielle de Meta dit l'inverse : le champ **`messages`** — auquel ce projet est abonné
   **depuis toujours** — porte `is_deleted: true` quand une personne retire un message.
   **L'événement arrivait déjà dans `webhook_queue` ; le worker le jetait.**

   L'erreur venait d'une lecture unique d'une page qui énumérait les CHAMPS d'abonnement
   sans détailler leurs charges utiles. **Deuxième cas du même piège dans la même journée**,
   après la fausse limite des « 20 derniers messages » qui aurait fait renoncer au backfill.
   Une limitation crue sur une seule lecture ne produit aucun symptôme : on ne construit
   simplement pas la chose qu'elle interdit.

   `supprimer_message_ig()` efface **réellement** — un message gardé « masqué » reste un
   message gardé — emporte la note du coach qui y était attachée, et recalcule les dates du
   fil pour que la liste n'affiche plus comme dernier message un texte disparu.

   ⚠️ **Aucune garde d'accord sur ce chemin**, contrairement à l'écriture : une suppression
   doit aboutir même si l'accord a été retiré entre-temps.

   ⚠️ **Comparaison stricte à `true`** : Meta envoie `is_deleted: false` sur des messages
   ordinaires, et une comparaison souple ferait supprimer un message vivant.
2. **La politique de confidentialité, pas l'App Review.**

   ⚠️ **Correction du 2026-09-04.** Ce document annonçait un risque d'App Review, au motif
   que l'usage déclaré était l'automatisation de leads. **C'est faux** : les quatre
   permissions sont obtenues en **accès avancé** (confirmé par Chris), donc la capacité de
   lire les messages est autorisée. Il n'y a rien à redemander à Meta.

   Ce qui reste dû est la contrepartie du grant : Meta exige que le traitement soit décrit
   **tel qu'il est fait** dans la politique de confidentialité. Relevé sur
   `ubizenai.com/privacy.html` le 2026-09-04, deux écarts précis :

   | Ce que dit la politique | Ce que fait la plateforme |
   |---|---|
   | messages directs « nécessaires à **l'automatisation des envois de ressources** » | ils sont aussi conservés pour être **relus** |
   | partage : uniquement des sous-traitants techniques (Supabase, Vercel, Stripe, Meta) | **le coach y accède en lecture**, sur autorisation de l'élève |

   Deux paragraphes à ajouter, dont le contenu est déjà vrai dans le code (consentement
   explicite, purge à la révocation, rétentions 12 mois / 30 jours) — rédaction proposée
   dans la session du 2026-09-04. **Rien à changer côté plateforme.**
3. **`human_agent` — écarté, et pas seulement reporté.** La question ne se pose plus : sans
   écriture, il n'y a pas de fenêtre à étendre. Elle ne reviendrait que si l'on rouvrait la
   décision produit de la section « Pourquoi la plateforme n'envoie AUCUN message de
   coach » — dans cet ordre, jamais l'inverse.

---

## NOT in scope

Étudié pendant la revue, écarté volontairement, avec le motif :

| Écarté | Motif |
|---|---|
| Écriture directe du coach dans les DM | décision produit — on supprime la classe de problème « qui a dit quoi » plutôt que de la gérer |
| Permission `human_agent` (fenêtre 7 j) | sans écriture, aucune fenêtre à étendre ; mettrait les 4 permissions dans une revue Meta pour rien |
| Ré-hébergement des médias | 1 Go gratuit rempli en 9 jours ; l'URL fraîche à la demande coûte zéro |
| Realtime sur les fils | pesait 45 % de l'egress récemment ; la lecture à la demande suffit |
| Notification push d'une suggestion | mènerait à un écran « disponible sur ordinateur » ; pastille de menu à la place |
| Version mobile des fils annotés | les notes sur 390 px ne tiennent pas ; `DesktopOnly` des deux côtés |
| Backfill intégral (au-delà de 90 jours) | ~500 Mo d'un coup, tuerait le plan gratuit à la première connexion |
| Webhook `message_reactions` / `messaging_seen` | aucun lecteur ; s'abonner ajoute du volume sans usage |
| Détection de l'unsend | aucun webhook Meta ne l'expose ; la rétention est la seule borne, écart assumé |

## What already exists — et que le plan réutilise

| Existant | Rôle ici |
|---|---|
| Abonnement webhook `comments,messages` (`oauth/instagram/callback:292`) | livre déjà tous les DM, dans les deux sens — coût API nul |
| `ig_entry_id_mapping` | résout `entry.id ≠ ig_account_id`, des deux côtés (webhook ET `participants`) |
| `fetchAndStoreAvatar()` (`instagram-webhook-processor.ts:191`) | photos de profil, bucket `instagram-avatars` |
| `components/ui/Avatar.tsx` | repli initiales + couleur stable ; gère déjà les `@handles` |
| `PageLiens.tsx:871-990` | rendu Instagram coté sur capture réelle, mode `sansCadre` prévu |
| `PageChat.tsx:1312-1385` | scroll `column-reverse` — le correctif du saut au cold start |
| `components/ui/ModalShell.tsx` | modale, pièges clavier déjà traités |
| `components/ui/DesktopOnly.tsx` | porte déjà cette décision pour 5 écrans dont `PageClientStats` |
| `reveillerLeWorker()` (`webhooks/instagram/route.ts:38`) | motif de réveil repris tel quel pour le backfill |
| `instagram_leads.not_a_lead` + `pipeline/route.ts` PATCH | geste d'exclusion, aucun écran neuf à construire |
| 7 purges pg_cron en SQL pur | motif de la purge 30 j / 12 mois |
| `SURVEILLANCES` de `/api/sante/alerte-vues` | l'alerte e-mail d'`ig_dm_sante` |
| `base_sante_taille` | l'alerte de plafond de stockage — **à étendre à `ig_messages`** |
| RPC du webhook (`upsert_prospect_event_by_lead`…) | modèle d'`enregistrer_message_ig()` |
| `push_subscriptions` + `/api/push/send` | disponible, **volontairement pas utilisé** ici |

## Modes de panne

| Chemin | Panne réaliste | Test | Erreur visible ? |
|---|---|---|---|
| `enregistrer_message_ig()` | l'accord est retiré entre deux messages | témoins RLS | la fonction rend `null`, rien n'est écrit — correct |
| Direction du message | `sender` sous forme `entry.id` classé comme entrant | **test unitaire** | sans le test : silencieux, le fil raconte l'inverse |
| `lienDiscussion()` | Meta change le préfixe | **test unitaire du repli** | repli sur `ig.me`, jamais un lien faux |
| Backfill | un réveil se perd | — | rattrapé par `poll-leads` ; `ig_dm_sante` alerte au-delà de 24 h |
| Collecte | le webhook cesse d'écrire | — | `ig_dm_sante` état `collecte muette` |
| Purge | le job pg_cron meurt | — | `ig_dm_sante` état `purge muette` |
| Stockage | `ig_messages` grossit plus vite que prévu | — | `base_sante_taille` alerte à 90 puis 30 jours du plafond |
| Pièce jointe | l'URL Meta a expiré | — | ⚠️ **à traiter** : dire « média expiré », jamais un cadre cassé |

**Aucun trou critique** : chaque panne a soit un test, soit une vue qui la rend visible.
La seule ligne à écrire côté produit est le message d'expiration d'une pièce jointe.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | codex non installé |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 4 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | maquette publiée en artifact |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | N/A | produit non destiné aux développeurs |

- **UNRESOLVED :** 0
- **VERDICT :** ENG CLEARED — prêt à implémenter, atterrissage 1 en premier.
