# Click ID — relier un rendez-vous au clic qui l'a produit

Ce document décrit le mécanisme qui rend le taux **clic → call** exact sur les liens
Calendly **partagés**. Il existe parce que ce taux était jusqu'ici une comparaison entre
deux ensembles qui ne se recouvrent pas.

---

## Le problème

Deux familles de liens Calendly coexistent, et elles n'ont pas le même problème.

| Famille | Exemples | Personne identifiée ? |
|---|---|---|
| **Personnalisés** | lien envoyé en DM à un prospect | **Oui** — `prospect_links.ig_lead_id` |
| **Partagés** | bio Instagram, description IG/YT, story | **Non** |

Un lien partagé est cliqué par plusieurs personnes. Un rendez-vous qui en vient ne
pouvait donc pas être relié au clic qui l'a produit : l'écran comparait « les clics de
la période » aux « calls de la période ».

Mesuré en base sur le profil de test, tout l'historique :

- **5 calls sur 13** issus de liens partagés n'avaient **aucun clic antérieur** enregistré.
- Les snapshots Short.io sont agrégés **au jour**, pas à la minute : deux clics le 18/08
  et un call le 18/08 sont impossibles à apparier.
- Un call créé à la main n'est né d'aucun clic, mais toute règle « dernier clic
  antérieur » lui en attribuerait un.

**Ce qui n'est PAS visé :** identifier une personne. Le même humain qui clique deux fois
produit deux identifiants, et c'est voulu. Sur un lien partagé l'unité utile est le
clic : combien de clics il faut pour produire un rendez-vous, c'est la mesure de
l'effort, et elle est juste.

---

## La chaîne

```
Instagram / YouTube
  → lien Short.io
  → 302 → <domaine Momentum>/r/<chemin>?utm_…&d=<chemin Calendly>&p=<profil>
  → 302 → calendly.com/<chemin>?utm_…&salesforce_uuid=<click_id>
  → réservation → webhook Calendly → calls.click_id + calls.clicked_at
```

L'historique d'avant le déploiement reste anonyme, définitivement. Rien n'est rattrapable.

---

## Les pièces

| Pièce | Rôle |
|---|---|
| `lib/click-redirect.ts` | Toutes les fonctions pures. **Aucune dépendance** : chargée par la route edge, par le script Node et par `npm test`. |
| `app/r/[token]/route.ts` | La redirection. Runtime edge, répond avant d'écrire. |
| `link_clicks` | Un clic. Purgée à 400 jours. |
| `calls.click_id` / `calls.clicked_at` | L'attribution, recopiée au moment de la réservation. |
| `scripts/reecrire-liens-shortio.mjs` | Réécrit les destinations Short.io existantes. |
| `clics_sante_redirection` | Vue à deux compteurs. |

---

## Les décisions, et leur raison

### `salesforce_uuid`, pas un paramètre sur mesure

Calendly ne transmet **que** les cinq UTM standards plus `salesforce_uuid`. Un
`utm_click_id` serait purement et simplement supprimé. `docs/utm-nomenclature.md`
réservait ce champ, et il résiste mieux aux redirections que les UTM — ce qui compte
ici, puisque ce mécanisme **ajoute** une redirection.

`utm_term` porte « **qui** — le prospect » et n'est pas touché : un champ, une question.

**En base la colonne s'appelle `click_id`**, jamais `salesforce_uuid` : le nom décrit ce
que la donnée est, pas le champ qui l'a transportée.

### La destination vit dans l'URL, jamais en base

```
/r/<chemin Short.io>?utm_source=ig&utm_medium=bio&utm_campaign=…&d=<chemin Calendly>&p=<profil>
```

- **`d` ne porte que le chemin.** L'hôte est écrit en dur dans `HOTES_AUTORISES`.
  Aucune valeur de `d` ne peut donc sortir de `calendly.com` : ce n'est pas un open
  redirect. `d` est assaini (`[A-Za-z0-9/_-]` seulement, `..` refusé).
- **Aucune lecture en base sur le chemin normal.** C'est ce qui rend le fail-open
  réellement tenable : une panne de la base ne peut pas empêcher un prospect de
  réserver. Reconstruire la destination depuis `integrations` aurait mis une lecture
  en base sur le chemin critique — c'est exactement le mode de défaillance à interdire.
- **`p` porte le profil**, pour que la ligne de clic s'écrive en un seul `INSERT`, sans
  `SELECT` préalable. Voir l'encadré ci-dessous : c'est le seul point de ce chantier qui
  change une propriété du système entier.
- **Le token est le chemin Short.io.** Il sert à **identifier** le lien pour la ligne de
  clic et la vue de santé, **pas** à résoudre la destination. Il n'est donc pas opaque,
  et c'est sans conséquence : le deviner crée une ligne de clic de plus, jamais une fuite.

### ⚠️ Depuis ce chantier, un `profile_id` est une donnée PUBLIQUE

Le paramètre `p` inscrit l'identifiant du profil dans la destination de chaque lien
partagé. Ces liens sont en bio Instagram et en description de vidéos : **n'importe qui
peut lire un `profile_id`.** Ce n'était pas vrai avant le 2026-08-31.

**Conséquence, permanente et sans exception : aucune route ne doit traiter un
`profile_id` comme une preuve d'identité.** Connaître un identifiant ne prouve rien —
ni qu'on est cette personne, ni qu'on a le droit de lire ses données.

La règle était déjà respectée partout au moment de l'écriture, et c'est ce qui a permis
de valider ce choix plutôt que de le supposer sans risque. Vérifié le 2026-08-31 sur
`/api/shortio/snapshots`, `/api/instagram/stats` et `/api/client/prospect-links` : les
trois authentifient d'abord (`auth.getUser()` → 401), puis contrôlent la propriété
(`.eq('coach_id', user.id)`). Aucune ne se contente de l'identifiant reçu.

Le motif à ne jamais écrire :

```ts
// ❌ le profil vient de la requête, donc de l'extérieur — il ne prouve rien
const { profileId } = await request.json();
const { data } = await supa.from('calls').select('*').eq('coach_id', profileId);
```

La RLS ne s'appuie jamais sur un `profile_id` fourni par l'appelant, et rien ne doit
l'y ramener. Cette contrainte tient même si la route `/r/` disparaît un jour : les
liens déjà publiés, eux, ne disparaissent pas.

### ⚠️ Les UTM sont reportés à l'identique — condition de non-régression

Ce n'est pas une commodité. `lib/shortio-link-category.ts` classe chaque lien en lisant
`utm_medium`, `utm_campaign` et `utm_source` **sur la destination Short.io** (lignes
94-96). Une destination nue casserait la catégorisation de **deux** façons, toutes deux
silencieuses :

- `utm_medium = null` → la branche `bio` ne matche plus, le résolveur tombe sur
  `return null`, et **les clics de bio disparaissent de « Clics totaux »**. C'est la
  régression déjà mesurée le 2026-08-28 (9 clics sur 15 effacés).
- Pire, la branche `dm` attrape `medium === null && path.includes('prendre-rdv')`. Or
  les liens de **description** s'appellent `prendre-rdv-3457`, `prendre-rdv-jNJg`… Ils
  seraient **reclassés en `calendly_dm_prospect`** et iraient grossir la ligne
  « Cold DM » du Breakdown.

Le résolveur n'a donc **aucune modification à subir**, et c'est voulu : c'est une
fonction pure et testée, la remplacer par une lecture en base ajouterait une dépendance
là où il n'y en a aucune.

Deux tests verrouillent la règle dans `lib/shortio-link-category.test.ts` : l'un vérifie
que toute destination réécrite rend exactement la même catégorie, l'autre démontre la
régression qu'une destination nue produirait — pour que la raison de la règle reste
vérifiable, pas seulement écrite en commentaire.

### Empreinte d'IP, jamais l'IP

`sha256(ip | secret serveur | sel du jour)`, tronqué à 16 caractères. Sert à repérer les
doubles déclenchements des navigateurs intégrés. **L'IP brute n'est jamais écrite.** Le
sel change chaque jour : l'empreinte n'est pas comparable d'un jour à l'autre, donc elle
ne permet pas de reconstituer un visiteur — ce n'est pas le but.

Sans `CLICK_IP_HASH_SECRET`, la colonne reste vide. Un champ vide dit « on ne sait
pas » ; une empreinte non salée mentirait sur ce qu'elle protège.

### Pas de cookie de visiteur

Depuis 2026, les six navigateurs majeurs appliquent la *bounce tracking protection* : un
domaine qui n'apparaît **que** dans des chaînes de redirection voit son stockage purgé
automatiquement. La route `/r/` est exactement ce cas. Un identifiant passé dans l'URL
n'est pas concerné — il ne stocke rien chez le visiteur. **Ne pas tenter de reconstituer
un visiteur.**

### Purge sans perte d'attribution

Au moment de la réservation, le webhook recopie `click_id` **et** `clicked_at` sur le
call. La ligne de clic devient alors jetable : `purge_link_clicks()` supprime à 400 jours
sans jamais perdre une attribution.

### Aucune contrainte d'unicité sur `calls.click_id`

Une reprogrammation fait hériter l'attribution du premier contact : l'ancien rendez-vous
passe en `canceled` et le nouveau reçoit **le même** `click_id`. Deux lignes portent donc
légitimement le même clic.

La restreindre aux rendez-vous actifs a été écarté aussi : les trois chemins d'écriture
annulent l'ancien avant d'insérer le nouveau, mais une course entre deux d'entre eux
ferait échouer l'upsert — donc **perdre une réservation** pour protéger un invariant de
confort. Le funnel passe avant.

Ce que la contrainte aurait attrapé se vérifie à la demande :

```sql
select click_id, count(*) from calls
 where click_id is not null and status <> 'canceled' and ignored is not true
 group by 1 having count(*) > 1;
```

---

## Trois chemins d'écriture, pas un

La même règle vit à trois endroits. Corriger le webhook seul donne une fausse impression
de sécurité : le prochain « Rafraîchir » ou le prochain passage du cron écraserait.
C'est déjà ce qui était arrivé à `utm_term` avant la migration du 2026-08-19.

| Chemin | Fichier | Déclencheur |
|---|---|---|
| Temps réel | `app/api/webhooks/calendly/route.ts` | chaque réservation |
| Cron | `supabase/functions/sync-calendly/index.ts` | toutes les 30 min |
| Manuel | `lib/calendly-fetch.ts` | bouton « Rafraîchir » |

L'Edge Function ne peut pas importer `lib/click-redirect.ts` (pas d'import
cross-runtime) : elle garde une copie de `resolveClickId`, signalée par un commentaire
pointant vers l'original. Même contrainte que `isValidContentId`.

**Reprogrammation** : `click_id` et `clicked_at` héritent comme `source`, `utm_medium`,
`utm_campaign` et `utm_term`. La valeur héritée prime sur celle du nouveau clic — c'est
le contenu d'origine qui a créé l'opportunité. Toute divergence entre ces lignes recrée
des rendez-vous contradictoires.

---

## Les liens à venir, pas seulement ceux d'aujourd'hui

Le script de migration ne traite que l'existant. Sans plus, chaque nouveau contenu
publié recréerait un lien pointant droit sur Calendly : la mesure s'éroderait toute
seule, sans que rien ne le signale.

Les trois points de génération de liens Calendly partagés passent donc par
`construireDestinationShortio` :

| Point de génération | Fichier |
|---|---|
| Bio + description (POST et repli 409) | `app/api/shortio/links/route.ts` |
| Séquence story | `app/api/client/story-sequences/route.ts` |

⚠️ Le repli 409 de `PageLiens.tsx` **doit transmettre `path`** au PATCH. Sans lui, le
serveur ne peut pas construire l'URL de redirection, et ce repli réécrirait un lien déjà
instrumenté en lien direct.

`construireDestinationShortio` renvoie `null` — la destination reste alors directe,
exactement comme avant ce chantier — dans quatre cas : domaine de redirection non
configuré, hôte hors liste blanche, canal non partagé (`dm`), destination déjà réécrite.

---

## Configuration

| Variable | Rôle | Absente ? |
|---|---|---|
| `MOMENTUM_REDIRECT_ORIGIN` | Origine qui sert `/r/` — **`https://prendre-rdv.app`** | **Rien n'est réécrit**, tout fonctionne comme avant. Pas de Click ID. |
| `CLICK_IP_HASH_SECRET` | Sel serveur de l'empreinte d'IP | `ip_hash` reste vide. |

Le domaine retenu est **`prendre-rdv.app`** (décidé le 2026-08-31, pas encore acheté à
cette date). Il est **neutre à dessein** : c'est le seul domaine que voit le prospect
dans le funnel d'un coach, et y afficher le nom de la plateforme ferait apparaître un
outil là où le coach doit être seul en scène. Un domaine unique partagé par tous les
élèves, jamais un sous-domaine par coach — à 40 élèves ce serait autant de domaines à
brancher et renouveler, ce qui contredit l'objectif zéro maintenance.

`MOMENTUM_REDIRECT_ORIGIN` est **volontairement distincte** de
`NEXT_PUBLIC_PLATFORM_URL` : elle est inscrite dans la destination de chaque lien
Short.io, donc en changer oblige à rejouer le script de migration. Elle ne doit pas
bouger quand l'URL de l'application bouge.

Il n'y a **aucun repli automatique** sur `NEXT_PUBLIC_PLATFORM_URL`. Un repli
commencerait à inscrire une adresse `*.vercel.app` dans des liens de bio publiés, et
ces liens casseraient le jour où cette adresse changerait.

⚠️ Les valeurs de `.env.local` sont **entre guillemets** ; le script les retire. Sur
Vercel, poser la variable avec `printf`, jamais `echo` — `echo` ajoute un `\n` qui
corrompt la valeur.

---

## Déploiement — l'ordre n'est pas négociable

1. Déployer la route `/r/` et **la vérifier** en production.
2. Poser `MOMENTUM_REDIRECT_ORIGIN` (et `CLICK_IP_HASH_SECRET`).
3. Réécrire **par lots**, en simulation d'abord :

```bash
node scripts/reecrire-liens-shortio.mjs --limite 5              # liste, n'écrit rien
node scripts/reecrire-liens-shortio.mjs --limite 5 --appliquer
select * from clics_sante_redirection where etat like 'ALERTE%';   -- entre chaque lot
```

Réécrire avant que la route soit en ligne ferait pointer tous les liens de bio vers un
404 pendant la fenêtre de déploiement.

**La vue divergera pendant la migration** : les liens pas encore réécrits ne produisent
aucune ligne de clic. C'est attendu, et ce n'est une anomalie que si la divergence
persiste une fois tous les lots passés.

⚠️ **Deux profils peuvent partager un domaine Short.io** (`docs/shortio-api.md`, piège
n°2). Le script suit alors le propriétaire écrit en base (`content_links`,
`story_sequences`). Les liens de **bio** n'ont pas de propriétaire en base : un conflit
est **signalé et le lien n'est pas réécrit**. `--profil <uuid>` permet de trancher.

---

## Vue de santé

```sql
select * from clics_sante_redirection;   -- 'ok' partout
```

Short.io compte les clics de son côté, la route du sien. Une divergence durable signifie
que la route est cassée, ou qu'un lien pointe encore droit sur Calendly.

⚠️ **Cette vue détecte une PANNE, pas une parité exacte**, et c'est délibéré : Short.io
applique son propre filtre à robots, la route applique le sien, les deux ne classeront
jamais identiquement. Prétendre à l'égalité produirait une alerte permanente que
personne ne regarderait plus.

⚠️ `etat <> 'ok'` n'est **pas** un filtre d'anomalie — même convention que
`yt_sante_donnees` et `integrations_sante`. `lien non redirige` dit seulement que la
réécriture n'a pas encore atteint ce lien.

Deux choix de périmètre, tous deux nécessaires pour que la vue puisse un jour afficher
« ok partout » :

1. **Le périmètre se lit sur `original_url`, pas sur `link_category`.** Cette colonne
   porte la catégorie figée au moment du snapshot : de vieux liens lead magnet y sont
   classés `calendly_story`, et ne seront jamais réécrits. S'y fier laissait 39 lignes
   en alerte permanente.
2. **La comparaison ne porte que sur les journées où le lien était déjà réécrit.** Sans
   ça, chaque lien passerait 30 jours en alerte après sa réécriture, à cause des
   journées d'avant — où l'absence de ligne de clic était normale.

C'est aussi cette vue qui rend l'échec d'écriture non silencieux : on ne peut pas
journaliser une panne de base **dans** la base, et c'est précisément ce que le second
compteur couvre.

---

## Robots d'aperçu de lien

Instagram, WhatsApp, Slack et consorts déréférencent un lien pour en afficher l'aperçu.
Ces requêtes arrivent jusqu'à la route. Elles sont **marquées** (`is_bot`), **jamais
jetées** : sans la ligne, on ne pourrait ni mesurer le bruit ni expliquer un écart avec
le compteur de Short.io.

⚠️ **« Instagram » dans le User-Agent n'est PAS un robot** : c'est le navigateur intégré
de l'application, donc un humain. Seul `facebookexternalhit` est le crawler de Meta. Le
confondre effacerait la quasi-totalité des vrais clics. Verrouillé par un test.

Second signal : l'en-tête `Sec-Purpose: prefetch`, que les navigateurs et proxys posent
en pré-chargeant une URL que personne n'a demandée.

---

## Croissance de la base

Une ligne mesure **176 octets** de données (`pg_column_size`), soit ≈ **300 octets** une
fois les en-têtes de tuple et les deux index comptés.

| Trafic | Par jour | Par an | Régime stable (400 j) |
|---|---|---|---|
| 40 élèves × 1 clic/jour (rythme observé sur le profil de test : 28 clics en 30 j) | 12 Ko | 4,4 Mo | ≈ 5 Mo |
| 40 élèves × 20 clics/jour (élèves qui percent) | 240 Ko | 88 Mo | ≈ 96 Mo |

La borne haute n'est pas négligeable sur le **plan gratuit** (500 Mo). D'où :
`link_clicks` **entre dans le calcul de `base_sante_taille`**. Sans ça, la vue aurait
sous-estimé la croissance et l'alerte e-mail (90 puis 30 jours du plafond) serait partie
trop tard. Une table qui grossit sans être comptée est exactement le trou que cette vue
existe pour fermer.

---

## Hors périmètre

- **Les liens de DM** (`prospect_links`) : déjà instrumentés par `first_click_at` et
  l'événement `link_clicked`. Ne pas y toucher. Le script les protège explicitement, en
  plus du filtre sur `utm_medium`.
- **Les liens lead magnet partagés** (`lm-bio-ig`, `lm-desc-*`) : eux aussi anonymes,
  mais non traités. `link_clicks` les accueillera sans modification — un lead magnet
  n'est qu'un autre `medium`. La seule chose à étendre est la **liste blanche de
  hosts**, écrite comme une constante nommée pour que ce soit l'ajout d'une ligne.
- **Ne pas ajouter d'index unique sur `prospect_links`** : la régénération de lien est
  légitime, et `onConflict` de Supabase JS ne fonctionne pas avec les index partiels.

---

## Vérification

1. Cliquer un lien réécrit : on arrive bien sur Calendly, et mesurer le temps ajouté par
   le saut supplémentaire.
2. Réserver : `calls.click_id` est rempli et correspond à la ligne `link_clicks`,
   `calls.clicked_at` porte l'heure du clic.
3. Reprogrammer : `click_id` et `clicked_at` ont bien été hérités.
4. Simuler une panne de base : la redirection part quand même.
5. Faire passer un robot d'aperçu : la ligne existe avec `is_bot = true`.
6. `select * from clics_sante_redirection;` → `'ok'` partout.
7. `npm test`, et `npx deno check supabase/functions/sync-calendly/index.ts`.
