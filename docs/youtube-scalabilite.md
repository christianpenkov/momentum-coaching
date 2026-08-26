# YouTube — pourquoi la plateforme tenait mal la montée en charge

Mesures et corrections du **2026-08-21**. À lire avant de toucher au bloc YouTube de
`supabase/functions/poll-leads/index.ts`.

---

## Le problème, en un chiffre

`fetchYtDayMetrics` émettait ses **7 appels à chaque passage** du cron, sans aucun
garde-fou. Le cron tourne **toutes les 5 minutes**, soit 288 passages par jour.

| Élèves | Appels/jour | Quota (10 000 unités/jour) |
|---|---|---|
| 1 | 2 027 | 20 % |
| 2 *(situation réelle)* | 4 054 | 40 % |
| **5** | **10 135** | **101 % — cassé** |
| 20 *(cible)* | 40 540 | 405 % |

**La plateforme cassait entre 4 et 5 élèves.** Le mur était invisible : rien ne
l'annonçait, et la panne aurait été sournoise (voir « Échecs silencieux » plus bas).

---

## Ce qui a été corrigé

### 1. Cadence : une synchronisation par heure

Les métriques YouTube ont **2 à 3 jours de retard côté Google**. Resynchroniser toutes
les 5 minutes ne rendait donc *aucune* donnée plus fraîche — on redemandait 288 fois par
jour des chiffres qui changent une fois par jour.

Garde-fou via `last_synced_at` sur `integrations`, colonne qui existait déjà.

L'horodatage s'écrit **même en cas d'erreur**, volontairement : sinon un profil au token
révoqué relancerait ses 7 appels toutes les 5 minutes indéfiniment, brûlant le quota des
autres. Une heure de retard sur un profil en panne vaut mieux qu'un quota épuisé pour
tout le monde.

### 2. Répartitions une fois par jour

Sources de trafic, appareils, démographie et mots-clés = **4 des 7 appels**, pour des
données portant sur **30 jours glissants**. Une journée de plus ou de moins n'y déplace
quasiment rien.

Rafraîchies au premier passage d'une nouvelle journée seulement. Les 23 autres
synchronisations ne coûtent que 3 appels.

⚠️ **Deux pièges, vérifiés avant d'y aller :**

- Sauter les appels laissait des tableaux **vides**, et un tableau vide est *truthy* en
  JavaScript. Le mapping les aurait écrits par-dessus les vraies données : les quatre
  cartes se seraient vidées à la première sync horaire. Ils valent donc `null`.
- Une **erreur HTTP** produisait le même tableau vide, avec le même écrasement. Ce
  défaut-là existait déjà. Un échec laisse maintenant la colonne intacte.

### 3. Taille des lots

`videos.list` était appelé par 10 alors qu'il accepte **50** ids. Le coût d'un appel ne
dépend pas du nombre d'ids qu'il porte.

La boucle Analytics reste à **40** : son filtre `video==` est borné à **500 caractères**,
pas à un nombre d'ids. Les deux constantes sont séparées — une seule valeur pour deux
limites différentes finissait par en violer une.

### 4. Échecs silencieux

`if (res.ok)` **sans `else`**, à deux endroits. Un 403 quota laissait la boucle continuer
et le snapshot s'écrivait avec des champs vides. Puis le garde-fou d'entrée (« le
snapshot d'hier existe ») empêchait tout rattrapage : la journée restait amputée pour
toujours.

- Détails vidéo → on **interrompt** : sans ligne pour hier, le prochain passage refait le
  travail. Un trou se rattrape, une ligne fausse reste.
- Métriques par vidéo → on **trace et on continue** : c'est un complément, titre et vues
  suffisent à une ligne exploitable.

### 5. Faux zéro sur les abonnés nets

`((a ?? 0) - (b ?? 0)) ?? null` : le repli final était mort (une soustraction n'est jamais
*nullish*) et masquait un vrai défaut. Quand les deux termes manquent, la donnée est
**inconnue**, et le calcul écrivait `0` — soit « aucun mouvement d'abonnés ».

C'était la seule erreur signalée par `deno check`, présente depuis des mois et jamais vue
parce que **`tsc` ne vérifie pas ce dossier**.

---

## Résultat

| | Avant | Après |
|---|---|---|
| Appels/jour/profil | 2 027 | **82** |
| Capacité | ~4 élèves | **121 élèves** |
| 30 élèves | 608 % du quota | **24 %** |
| 40 élèves | 811 % | **32 %** |

**Gain : 24,7×.**

Le temps d'exécution n'est pas contraignant : à concurrence 5, 40 profils tiennent en
moins de 65 s même en scénario pessimiste, contre 150 s de budget.

---

## Vérifier que tout va bien

Deux requêtes, aucune installation :

```sql
-- Incidents du cron (table vide = aucun incident depuis 30 jours)
select * from cron_runs order by ran_at desc;

-- Santé des données YouTube par profil
select * from yt_sante_donnees;
```

`yt_sante_donnees` signale les jours sans abonnés, le retard de collecte, et **alerte
quand ce retard dépasse 4 jours** — au-delà, on sort de la fenêtre de rattrapage du cron
(`isoDate(3) → hier`) et les journées perdues le sont définitivement. Elle a
immédiatement trouvé six jours absents en juin sur un second profil.

`cron_runs` n'écrit **que** quand un passage échoue, et se purge seule à 30 jours.
Avant, les erreurs n'existaient que dans les logs Supabase — que personne ne consulte.

---

## Avant tout déploiement de cette fonction

```bash
npx deno check supabase/functions/poll-leads/index.ts
npx supabase functions deploy poll-leads --project-ref nvjgwtetyuatnkjihmtw --no-verify-jwt
```

**`npm run build` et `tsc` ne couvrent pas `supabase/functions/`.** Une erreur y a vécu
des mois sans être vue.

---

## Si un jour 120 élèves ne suffisent plus

L'**API Reporting** (`youtubereporting.googleapis.com`) est la voie suivante : YouTube
génère des rapports CSV quotidiens qu'on télécharge une fois, sans coût de quota par
métrique. Le rapport `channel_basic_a3` contient exactement les métriques journalières
utilisées ici (vues, watch time, abonnés, likes, commentaires, partages).

**Ce pattern est déjà implémenté dans ce projet** pour le CTR (`syncYtCtr`), avec curseur
`last_report_id` pour ne retélécharger que les nouveaux rapports. Il y a donc un modèle à
copier.

Deux limites à connaître avant de s'y lancer :
- l'historique au moment de la création du job ne remonte qu'à **30 jours** (ce qui
  suffit : le backfill actuel fait exactement 30 jours) ;
- les rapports ne sont téléchargeables que **60 jours**.

Estimation : ~51 appels/jour/profil, soit **environ 100 élèves à 51 % du quota**. Le gain
sur la situation actuelle est réel mais pas urgent — inutile d'engager ce chantier avant
d'approcher les 100 élèves.
