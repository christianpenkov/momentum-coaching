# À déployer après la Meta review

Ce fichier liste ce qui est **écrit mais pas encore actif** en production, faute de
pouvoir déployer pendant la procédure de review Meta (App ID 1662261888152926,
soumise le 2026-08-13). Il se supprime une fois tout déployé et vérifié.

Contexte de la contrainte : la page « Gérer mes liens », le Pipeline Leads et Mes
Stats figurent dans le parcours filmé pour Meta. Voir le PDF du dossier à la racine
du projet parent.

---

## 1. Edge Functions — `supabase functions deploy` requis

Ces trois correctifs sont dans le code mais **n'ont aucun effet tant que les
fonctions ne sont pas redéployées** : `git push` ne les déploie pas.

```bash
supabase functions deploy poll-stories --no-verify-jwt
supabase functions deploy poll-leads   --no-verify-jwt   # embarque _shared/ig-posts.ts
```

> `--no-verify-jwt` : ces fonctions sont appelées par cron-job.org avec un
> `CRON_SECRET` maison, pas un JWT Supabase.

### `poll-stories/index.ts` — expiration à tort, corruption **irréversible**
Les stories d'un compte Instagram précédent sont absentes de l'API du compte
courant, donc elles étaient marquées `expired_at`. Comme `expired_at` n'est jamais
remis à `null`, revenir sur l'ancien compte les désarchive sans jamais les
« désexpirer ». Filtres `ig_account_id` + `archived_at` ajoutés.

**C'est le plus urgent des trois** : les deux autres produisent des données fausses,
celui-ci détruit définitivement de la donnée.

### `_shared/ig-posts.ts` — l'`UPDATE` neutralisait son propre `SELECT`
Le `SELECT` filtrait soigneusement `ig_account_id` + `archived_at`, l'`UPDATE` qui
suivait ne filtrait que `post_id` : un post présent dans deux comptes voyait les
lignes des deux marquées supprimées.

### `_shared/ig-posts.ts` — garde d'idempotence sans filtre de compte
Les lignes archivées d'un compte précédent portant la même `snapshot_date` faisaient
croire le snapshot déjà pris → **trou d'un jour** dans l'historique du nouveau compte.

### Vérification après déploiement
```sql
-- Aucune story ne doit être expirée alors qu'elle est active et récente
select count(*) from ig_stories
where archived_at is null and expired_at is not null
  and posted_at > now() - interval '48 hours';

-- Aucun post actif marqué supprimé sur le compte connecté
select count(*) from analytics_ig_posts_history
where archived_at is null and deleted_at is not null
  and published_at > now() - interval '7 days';
```

---

## 2. Déjà appliqué en base — ne pas refaire

Ces deux migrations **sont actives en production** (appliquées le 2026-08-20). Elles
sont listées ici pour mémoire, pas pour être rejouées.

- `get_ig_posts_history_filtre_archived_at` — la fonction SQL ignorait `archived_at`,
  invisible au code (elle n'existait dans aucune migration du dépôt).
- `prospect_links_archived_at` — colonne + index partiel + backfill (0 ligne
  concernée). Le code qui l'alimente, lui, **attend le déploiement** : voir §3.

---

## 3. Code applicatif — part au prochain `git push`

Rien de spécial à faire, mais à vérifier une fois en ligne :

- `app/api/oauth/instagram/callback` — étape 3 qui archive/désarchive
  `prospect_links` en suivant l'état de ses leads. **Sans ce code, la colonne
  ajoutée en §2 reste vide à jamais.**
- `app/api/oauth/instagram/disconnect` — `prospect_links` ajoutée à `IG_TABLES`.
- 8 lectures qui filtrent désormais `archived_at` (Mes Stats, liste des élèves,
  fiche élève coach, comptage de stories, mots-clés, lead magnets).

### Refonte UI « Gérer mes liens » (branche `refonte-liens`)

Toute la refonte est du code applicatif : elle part au `git push`, aucune
migration, aucune Edge Function. Deux points à vérifier une fois en ligne :

- `app/api/client/prospect-links` (GET) renvoie désormais un champ `clicks` par
  lien, sommé depuis `shortio_link_daily_snapshots` sur `human_clicks`. Une
  requête de plus par appel, bornée par `.in('short_url', …)` sur les liens déjà
  chargés. Vérifier que la pastille affiche bien un nombre et non `0` partout :
  ```sql
  select pl.ig_username, coalesce(sum(s.human_clicks),0) clics
  from prospect_links pl
  left join shortio_link_daily_snapshots s
    on s.short_url = pl.short_url and s.profile_id = pl.profile_id
  where pl.deleted_at is null group by 1 order by 2 desc;
  ```
- L'onglet **Stats** lit des champs que le mapping de `PageLiens` jetait
  auparavant (`reach`, `saves`, `shares`, `profile_visits`, `follows` côté Meta ;
  `avgViewPct`, `watchTime30d`, `ctr` côté YouTube). Aucune requête ajoutée — les
  deux API les renvoyaient déjà. `profile_visits`/`follows` ne sont peuplés qu'à
  ~25 % : le tiret affiché à leur place est le comportement voulu, pas un bug.

---

## 4. Connu, non corrigé — vérifié sans impact mesurable

À traiter plus tard, avec mesure préalable. Aucun de ces points n'a d'effet
constatable sur les données actuelles (vérifié en base le 2026-08-20).

| Point | Mesure | Décision |
|---|---|---|
| `not_a_lead` non appliqué à `instagram_lead_lm_history` | 2 leads marqués, **0** avec historique LM | Théorique. Nécessiterait une jointure ou une dénormalisation |
| Clics Short.io de liens archivés comptés dans « Business micro » | 25 lignes, **0 clic** au total | Choix produit à trancher : un lien d'un ancien compte reste cliquable, faut-il compter ses clics ? |
| `link_category` calculé en incluant les liens archivés (`poll-leads`, `backfill-shortio`) | Contamination permanente si elle survient — `shortio_link_daily_snapshots` n'a pas d'`archived_at` | Dépend de la décision ci-dessus |
| Résolution Calendly par `ig_user_id` sans borne de compte | Aucun cas | Un call du nouveau compte peut se rattacher à une ligne archivée → orphelin d'affichage |
| `.maybeSingle()` sur `instagram_leads` sans filtre (`pipeline/advance`, `client/calls`) | Aucun cas | Deux lignes pour un même `ig_username` feraient échouer la requête, et le call serait créé détaché du pipeline |

---

## 5. Chantier suivant, décidé mais non commencé

- **Unifier les séquences DM posts et stories** — deux modèles de données pour un
  même concept (5 champs contre 2 + tokens). Reporté pour isoler les causes de
  panne pendant la refonte UI.
- **Confirmation de déconnexion Instagram** + **récupération des leads d'un ancien
  compte** (3 points d'entrée) + **alerte token révoqué** (bandeau + push).
  Spécifiés dans le plan de la refonte.
