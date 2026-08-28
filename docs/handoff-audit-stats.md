# Handoff — Audit « Mes Stats »

Brief de reprise. YouTube, Instagram et **Business micro** sont clos.
Reste **Funnel & Calls**. État arrêté au **2026-08-28**.

---

## La méthode imposée — à respecter, elle a tout trouvé

**Une métrique à la fois**, en remontant la chaîne complète **API → base → écran**, et
en recoupant avec **une réponse d'API réelle** et **une capture d'écran**. Jamais de
conclusion tirée de la lecture du code ou de la documentation seules.

Le skill `audit-metrique-bout-en-bout` (`~/.claude/skills/`) contient la méthode
complète et les six pièges récurrents. **Le charger avant de commencer.**

Ce qu'elle a produit : ~23 corrections sur YouTube, ~30 sur Instagram, et sur Business
micro le plus gros défaut trouvé jusqu'ici (**39 % de clics fantômes**, invisible à
toute lecture de la base seule).

### La règle qui compte le plus

> **Vérifier en base ou contre l'API avant d'affirmer. Un « ça devrait marcher » n'est
> pas un résultat.**

### Le septième piège, découvert le 2026-08-28

**Deux calendriers pour un même jour.** Dès qu'une API expose une fenêtre nommée
(`today`, `yesterday`, `last7`) et que le code calcule sa propre date, vérifier que les
deux définissent la journée dans le même fuseau. Sinon la même donnée est écrite sur
deux dates différentes selon l'heure d'exécution.

**Signature à chercher en base** : une même entité qui porte systématiquement des
valeurs sur **deux jours consécutifs**. C'est ce qui a permis de le voir.

### Contraintes permanentes

- **Zéro maintenance** après livraison à Quennel ; robuste à **30-40 élèves**.
  Solide > rapide.
- **Aucune donnée inventée, simulée ou codée en dur.** Un `0` affirme quelque chose,
  un trou dit « on ne sait pas ».
- Réponses en **français**, explications non techniques.
- Déploiement : **`git push origin main`**. Jamais `vercel deploy --prod`.
- Edge Functions : **déploiement séparé obligatoire**, `git push` ne les emmène pas.
  `npx deno check` d'abord — `tsc` et `npm run build` ne couvrent pas
  `supabase/functions/`.
- **Vérifier la branche avant chaque commit**, et **stager les fichiers explicitement**
  (`git add <fichier>`, jamais `-A`) : une session parallèle de Chris tourne souvent en
  même temps.

---

## Ce qui est clos

**YouTube** — `docs/youtube-scalabilite.md`. 23 corrections, capacité 4 → 121 élèves.

**Instagram** — `docs/instagram-scalabilite.md`, `docs/instagram-reach-follow-type.md`.

**Business micro** — voir la section suivante.

---

## Business micro — clos le 2026-08-28

### Ce qui était cassé, et comment on l'a su

| Défaut | Comment il a été établi |
|---|---|
| **39 % de clics fantômes** — chaque clic écrit sur deux jours consécutifs | Recoupement lien par lien avec `statistics/link?period=last30`. 13 liens sur 18 concernés. Total du profil de test : 36 → 22 clics sur 40 jours |
| **Bouton « Rafraîchir » mort depuis le 18/06** | Appel réel de la route : `synced_links: 0`, une erreur par lien (`Could not choose the best candidate function`) |
| **Cron non tenable à l'échelle** — 1 appel API par lien et par passage | 45 % des lignes déjà non rafraîchies **à 3 élèves** ; ~3 200 appels/passage projetés à 40 |
| **Graphiques All-Time bornés au mois en cours** | En-tête « All-Time », KPI 150 clics, courbe totalisant 23 |
| **Règle de catégorie en 3 copies divergentes** | La copie de `backfill-shortio` ignorait les stories |
| **Skip rate affiché à 7500 %** | `reels_skip_rate` est déjà en pourcentage (9,20 à 76,60 sur 253 posts) |

### L'architecture actuelle, et pourquoi

**Une seule règle de date** : un clic appartient au **jour Paris de son propre
horodatage**. Seul le flux de clics (`last_clicks`) porte cet horodatage — c'est
pourquoi il est devenu la source unique, pour J-0 comme pour les journées closes.

**Le cron se répare seul.** À chaque passage il relit **7 jours** de clics et réécrit
les journées closes (`p_ecraser: true`). Toute valeur fausse se corrige donc en moins
d'une semaine, sans intervention. Le jour en cours reste monotone (`GREATEST`) pour
absorber le délai d'indexation de Short.io.

**Rattrapage exceptionnel** — même code, même règle, un simple paramètre :

```bash
curl -X POST https://nvjgwtetyuatnkjihmtw.supabase.co/functions/v1/poll-leads \
  -H "Authorization: Bearer $CRON_SECRET" -H 'content-type: application/json' \
  -d '{"jours_reparation": 40}'
```

**Coût indépendant du nombre de liens** : le flux du domaine (1 à 3 pages) remplace
l'interrogation lien par lien. Le limiteur est indexé sur le **compte Short.io**, pas
global : en production chaque élève apporte son quota.

### Fichiers à connaître

| Fichier | Rôle |
|---|---|
| `lib/shortio-clicks.ts` | Lecture paginée du flux + filtrage du bruit. Partagé Node **et** Deno |
| `lib/shortio-link-category.ts` | Règle de catégorie, source unique. Testée sur cas réels |
| `lib/chart-buckets.ts` | Regroupement jour/semaine/mois des séries All-Time |
| `supabase/functions/poll-leads/index.ts` | Le cron réel |
| `lib/shortio-fetch.ts` | Bouton « Rafraîchir » (jour en cours seulement) |

Les Edge Functions importent `lib/*.ts` par chemin relatif — **vérifié : le
déploiement embarque bien ces fichiers** (`Uploading asset (poll-leads):
lib/shortio-link-category.ts`).

### Surveillance — rien à entretenir

```sql
select * from shortio_sante_donnees;   -- tout à 'ok' = rien à faire
select * from cron_runs order by ran_at desc;   -- vide = aucun incident (30j)
```

### Ce qui reste ouvert sur Business micro

- **Historique de plus de ~40 jours toujours gonflé.** Le flux de clics Short.io ne
  remonte pas assez loin pour le reconstruire. Non réparable ; à dire plutôt qu'à
  masquer.
- **Croissance de la table.** `shortio_link_daily_snapshots` grossit en
  `nb_liens × nb_jours`. Le cron n'écrit plus les journées closes sans clic, ce qui
  ralentit fortement la croissance, mais J-0 et J-1 restent écrits pour tous les liens.
  À revoir si la table dépasse quelques millions de lignes : la route
  `/api/shortio/snapshots` rapatrie les lignes brutes, les RPC agrègent déjà en SQL.
- **Comptes Short.io partagés.** Rien n'empêche deux élèves de connecter le même
  compte : chacun voit alors les clics de l'autre. C'est le cas des 3 profils de test.
  Décision produit à prendre.
- **Clics de liens de paiement Stripe** exclus de « Clics totaux » (12 en août sur le
  profil de test). Choix assumé : ce n'est pas de l'acquisition. Ils n'apparaissent
  nulle part ailleurs non plus.
- Un **taux de conversion supérieur à 100 %** reste possible (un call attribué sans
  clic tracké). Factuel, mais déroutant à l'écran.

---

## Le périmètre restant : Funnel & Calls — `TabFunnel`, ligne ~3805

Sources : `calls`, `deals`, `stripe`, `instagram_leads`, `prospect_links`,
`prospect_events`.

Lire **impérativement avant de toucher aux calls** :
- `docs/rapports-de-call.md` — le parcours de vente a **17 étapes et 5 sorties**.
- `docs/calls-coach-id-piege.md` — **`calls.coach_id` n'est pas le coach humain.**
- `docs/fuseaux-horaires.md` pour tout affichage d'heure.
- `docs/perimetre-stats-referentiel.md` — les cinq règles de périmètre.

```sql
-- TOUTE requête sur calls doit porter ces deux filtres :
where ignored is not true
  and call_type = 'calendly'   -- vente ; 'google' = coaching
```

> **`deals` est la source du cash.** `calls.revenue` n'est qu'une trace du rapport.
> Les deux **ont divergé en base** : le deal `4a8dde35` vaut 1 200 € après modification
> des modalités de vente, `calls.revenue` en dit toujours 3 000. Dans Business micro,
> tout passe désormais par `callsEff` / `callsAllTimeEff`, qui appliquent la somme des
> deals rattachés au call. **Vérifier que Funnel & Calls fait pareil.**

Autres pièges déjà documentés :
- `.maybeSingle()` sur `instagram_leads` sans filtre (`pipeline/advance`,
  `client/calls`) : deux lignes pour un même `ig_username` feraient échouer la requête.
- Résolution Calendly par `ig_user_id` sans borne de compte.
- Marge de **24 h sur `connected_at`** (note `feedback-connected-at-margin`).

---

## Comptes et outils de vérification

Profil de test principal : `a02e5927-7b39-4b7d-b112-0a43b30e9f09` (Christian,
`@chris.pkv`) — le seul avec des données réelles sur toutes les plateformes.
Son `integrations_ready_at` est le **09/06/2026** : c'est la borne de l'All-Time,
et elle diffère de `connected_at` (29/05).

Identifiants navigateur : note mémoire `reference-test-accounts`.

Pour interroger une API externe avec les vrais identifiants, lire le jeton depuis
`integrations` via la clé service dans `.env.local`. Chris autorise explicitement
l'usage de ses jetons pour tester en conditions réelles.

⚠️ **Sous Windows, `curl` corrompt les accents.** Utiliser Python pour tout appel HTTP
de test (note `feedback-accents-curl-windows`).

⚠️ Les heredocs PowerShell (`@'…'@`) ne passent pas dans l'outil Bash, et un `git commit
-m` multiligne y casse. Écrire le message dans un fichier puis `git commit -F`.

---

## Comment livrer

Corriger directement ce qui est un bug évident, **y compris quand le cas ne s'est
encore jamais produit** (demande explicite de Chris, 2026-08-28). **Poser une question
uniquement quand la réponse change ce qu'on fait.**

Ne jamais annoncer qu'une correction fonctionne avant de l'avoir constatée en base ou
contre l'API. Attention au piège inverse aussi : `GREATEST` et `ignoreDuplicates`
masquent une sous-évaluation — nettoyer puis constater zéro ne prouve rien
(note `feedback-verifier-correction-apres-passage-cron`).
