# Handoff — Audit « Mes Stats » : Business micro, puis Funnel & Calls

Brief de reprise pour une nouvelle session. YouTube et Instagram sont **clos**.
État arrêté au **2026-08-27**.

---

## La méthode imposée — à respecter, elle a tout trouvé

**Une métrique à la fois**, en remontant la chaîne complète **API → base → écran**, et
en recoupant avec **une réponse d'API réelle** et **une capture d'écran**. Jamais de
conclusion tirée de la lecture du code ou de la documentation seules.

Le skill `audit-metrique-bout-en-bout` (`~/.claude/skills/`) contient la méthode
complète et les six pièges récurrents. **Le charger avant de commencer.**

Ce qu'elle a produit : ~23 corrections sur YouTube, ~30 sur Instagram. À chaque fois
que j'ai conclu sans vérifier en base, je me suis trompé — au moins six fois dans la
session Instagram, dont deux affirmations données comme certaines à Chris et démenties
par la mesure cinq minutes plus tard.

### La règle qui compte le plus

> **Vérifier en base ou contre l'API avant d'affirmer. Un « ça devrait marcher » n'est
> pas un résultat.**

Trois exemples de cette session où seule la mesure a tranché, contre ma lecture du
code :

- J'ai conclu que `poll-stories` n'était déclenchée par rien. Faux : elle tourne toutes
  les 30 min. Ce qui m'a trompé, c'est l'upsert sur `snapshot_date` — « 2 lignes » ne
  veut pas dire « 2 passages » mais « 2 jours couverts ».
- J'ai décrit un « figeage » du breakdown Instagram au-delà d'un an. La vraie cause est
  tout autre : la ventilation n'existe que sur ~12 mois, ce n'est pas la largeur de la
  fenêtre qui compte mais l'ancienneté. Trouvé en testant des fenêtres de **largeur
  constante décalées dans le passé**.
- J'ai créé une table et un cron qui écrivaient... rien. `onConflict` ne peut pas viser
  un index unique **partiel**, et l'échec est **silencieux**. Sans vérification en base,
  je livrais une fonctionnalité morte en annonçant qu'elle marchait.

### Contraintes permanentes

- **Zéro maintenance** après livraison à Quennel ; robuste à **30-40 élèves**.
  Solide > rapide.
- **Aucune donnée inventée, simulée ou codée en dur.** Un `0` affirme quelque chose,
  un trou dit « on ne sait pas ».
- Réponses en **français**, explications non techniques.
- Déploiement : **`git push origin main`**. Jamais `vercel deploy --prod`.
- Edge Functions : **déploiement séparé obligatoire**, `git push` ne les emmène pas.
  `npx deno check` d'abord — `tsc` et `npm run build` ne couvrent pas `supabase/functions/`.
- **Vérifier la branche avant chaque commit**, et **stager les fichiers explicitement**
  (`git add <fichier>`, jamais `-A`) : une session parallèle de Chris tourne souvent en
  même temps et ses modifications se retrouveraient dans le commit. C'est arrivé deux
  fois.
- La review Meta est **terminée** (2026-08-27). Plus aucun gel de déploiement.

---

## Ce qui est clos

**YouTube** — `docs/youtube-scalabilite.md`. 23 corrections, capacité passée de 4 à
121 élèves.

**Instagram** — `docs/instagram-scalabilite.md` et
`docs/instagram-reach-follow-type.md`. Ce dernier contient une référence complète sur
`reach × follow_type` : rétention réelle, limites non documentées par Meta, et pourquoi
la déduplication ne s'additionne jamais entre périodes.

**Jetons Instagram** — l'alerte email était **inerte depuis le début** (les trois copies
de `getIgCreds` renvoyaient le jeton mort, donc `if (!creds)` n'était jamais vrai).
Corrigée, déplacée dans `poll-leads`, détection en moins d'une heure. Prouvé en
conditions réelles. Voir la note mémoire `reference-cronjobs`.

### Restent ouverts, non bloquants

- La première **clôture de période** (`analytics_ig_periodes`) aura lieu le
  **1er septembre**. Le mécanisme de figeage n'a jamais tourné en vrai.
- Les **stats de story** n'ont jamais été validées sur une story ayant vécu ses 24 h.
- Un **trou de collecte de story du 22 août** (05:30 → 23:57) reste inexpliqué.
- **Rdjdkz** a un jeton révoqué : Chris doit le remettre dans les testeurs Meta et
  reconnecter. Sa collecte est arrêtée.

---

## Le périmètre à auditer

### 1. Business micro — `TabShortioB`, ligne ~4745

Le plus gros composant de la page. Sources principales :
`shortio_link_daily_snapshots`, `prospect_links`, `prospect_events`,
`instagram_lead_lm_history`, plus les posts IG/YT pour croiser les contenus.

Lire **avant de commencer** :
- Note mémoire `architecture-shortio-analytics` — schéma complet, write-path,
  read-path, et les patterns IDOR / merge-JSONB / fire-and-forget.
- Note mémoire `reference-pipeline-ig-booking` — le funnel commentaire → call booké,
  avec **8 pièges connus** déjà documentés.
- `docs/checklist-scalabilite.md` — Short.io est une API externe, donc toute la
  checklist quota s'applique.

Points d'attention connus :
- `shortio_link_daily_snapshots` **n'a pas d'`archived_at`** : la contamination par un
  ancien compte Instagram y est possible et non résolue (noté comme « connu, non
  corrigé » dans un ancien document).
- Les clics des liens **archivés** sont comptés dans « Business micro » — 25 lignes,
  0 clic au moment de la mesure, donc théorique, mais c'est un choix produit à
  trancher.
- `link_category` est calculé en incluant les liens archivés.

### 2. Funnel & Calls — `TabFunnel`, ligne ~3805

Sources : `calls`, `deals`, `stripe`, `instagram_leads`, `prospect_links`,
`prospect_events`.

Lire **impérativement avant de toucher aux calls** :
- `docs/rapports-de-call.md` — le parcours de vente a **17 étapes et 5 sorties**, la
  carte n'existe nulle part ailleurs.
- `docs/calls-coach-id-piege.md` — **`calls.coach_id` n'est pas le coach humain.**
- `docs/fuseaux-horaires.md` pour tout affichage d'heure.

Deux règles de requête qui faussent tout si on les oublie (notes mémoire
`feedback-backfill-filtre-ignored` et `reference-deals-source-du-cash`) :

```sql
-- TOUTE requête sur calls doit porter ces deux filtres :
where ignored is not true
  and call_type = 'calendly'   -- vente ; 'google' = coaching
```

> **Depuis le 2026-08-20, `deals` est la source du cash.** Tous les écrans le lisent.
> `calls.revenue` n'est plus qu'une trace du rapport et sert de requête de contrôle
> pour repérer les deals manquants. Ne jamais sommer `calls.revenue` pour un chiffre
> d'affaires.

Autres pièges déjà documentés :
- `.maybeSingle()` sur `instagram_leads` sans filtre (`pipeline/advance`,
  `client/calls`) : deux lignes pour un même `ig_username` feraient échouer la requête.
- Résolution Calendly par `ig_user_id` sans borne de compte → un call du nouveau compte
  peut se rattacher à une ligne archivée.
- Marge de **24 h sur `connected_at`** pour ne pas exclure les calls bookés juste avant
  une reconnexion (note `feedback-connected-at-margin`).

---

## Comptes et outils de vérification

Profil de test principal : `a02e5927-7b39-4b7d-b112-0a43b30e9f09` (Christian,
`@chris.pkv`, 255 abonnés) — c'est le seul avec des données réelles sur toutes les
plateformes.

Identifiants navigateur : note mémoire `reference-test-accounts`.

```sql
select * from cron_runs order by ran_at desc;   -- vide = aucun incident (30j)
select * from yt_sante_donnees;                 -- 'ok' ou 'integration deconnectee'
select * from ig_sante_donnees;
```

Pour interroger une API externe avec les vrais identifiants, lire le jeton depuis
`integrations` via la clé service dans `.env.local`. Chris autorise explicitement
l'usage de ses jetons pour tester en conditions réelles.

⚠️ **Sous Windows, `curl` corrompt les accents.** Utiliser Python pour tout appel HTTP
de test (note `feedback-accents-curl-windows`).

---

## Comment livrer

Corriger directement ce qui est un bug évident. **Poser une question uniquement quand
la réponse change ce qu'on fait** — Chris veut le contexte complet et les conséquences,
pas un choix technique déguisé.

Ne jamais annoncer qu'une correction fonctionne avant de l'avoir constatée en base ou
contre l'API. Si le cron doit repasser pour le prouver, forcer `last_synced_at = NULL`
et attendre le passage : **nettoyer puis constater zéro ne prouve rien**
(note `feedback-verifier-correction-apres-passage-cron`).
