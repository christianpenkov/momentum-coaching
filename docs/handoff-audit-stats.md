# Handoff — Audit « Mes Stats »

Brief de reprise. **Les quatre périmètres sont clos** : YouTube, Instagram, Business
micro et **Funnel & Calls**. Pour Business micro il ne reste qu'un constat à faire le
31 août, aucune correction en attente. État arrêté au **2026-08-29**.

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

**Funnel & Calls** — clos le 2026-08-29, voir la section « Funnel & Calls » plus bas.

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

### Volume et passage à l'échelle — tranché le 2026-08-28

**Aucune purge.** La question posée était « la table grossit, faut-il supprimer les
lignes à zéro ? ». Vérification faite, la réponse est non : le disque n'est pas le mur.
À 40 élèves, ~3 000 lignes/jour, ~750 Mo/an — des années de marge.

**Le mur était la lecture**, et il est levé. `/api/shortio/snapshots` rapatriait une
ligne par lien ET par jour : ~110 000 lignes pour un All-Time à 3 ans, soit
~110 allers-retours. La RPC `get_shortio_links_agreges` renvoie **une ligne par lien**,
quelle que soit la profondeur de l'historique. Les trois lectures de cette table
agrègent désormais en SQL.

Pourquoi pas la purge, mesuré avant de trancher :
- sur une période ancienne, **64 liens visibles, 3 survivraient** — la liste des liens
  est reconstruite à partir de ces lignes ;
- `pipeline/advance` retrouve l'identité d'un lien par sa ligne la plus récente, sans
  borne de date : un lien jamais cliqué deviendrait introuvable.

Un trigger de purge aurait donc été une chose à surveiller, pour un problème qui
n'arrive pas. L'agrégation SQL ne demande aucun entretien.

### Ce qui reste ouvert sur Business micro

État au **2026-08-29, fin de chantier**. Une seule chose, et ce n'est pas une
correction en attente.

- **La première clôture de période Instagram n'a jamais tourné** — voir « Le rendez-vous
  du 31 août » plus bas. C'est le seul point qui exige encore une action : constater.

Et une chose qui n'est pas un défaut mais qu'il faut savoir :

- **Le détail des clics (pays, ville, navigateur, OS, réseau) n'est plus collecté**
  depuis le passage au flux de clics. Aucun écran ne le lit. Décision de Chris :
  documenter plutôt que relancer. Le pourquoi, le où toucher et le piège à éviter sont
  dans `docs/shortio-pays-ville-navigateur-des-clics.md`. **Rien à faire tant que
  personne ne le demande.**

### Trois points d'affichage traités le 2026-08-29

Ils figuraient comme ouverts jusqu'à ce jour. Ce qui a été corrigé, c'est la
**lisibilité** ; les deux premiers faits sous-jacents, eux, restent vrais et sont
normaux.

- **Un taux de conversion peut dépasser 100 %** — un call attribué sans clic tracké
  (lien ouvert hors navigateur, ou transmis à la main). Le chiffre n'est pas plafonné :
  plafonner masquerait de l'information. Au-dessus de 100 % le badge **sort de l'échelle
  de couleur** (« vert = bien, rouge = mal » n'a plus de sens) et porte une infobulle
  qui explique le phénomène.
- **La colonne « Clics / Liens » mélange deux unités** — des clics sur les lignes de
  contenu, des liens envoyés ou des leads uniques sur les lignes DM. Les deux unités
  restent différentes, c'est inhérent au tableau ; **chaque ligne écrit désormais la
  sienne**. C'est aussi ce qui explique que cette colonne ne réconcilie jamais avec
  « Clics totaux ».
- **Avertissement Recharts `width(-1) and height(-1)`** — isolé à la mesure : 0 sur
  l'onglet par défaut, exactement 1 au clic sur Business micro. `ResponsiveContainer`
  mesurait son parent avant que l'observateur de taille n'ait livré ses dimensions.
  Corrigé par `initialDimension` (Recharts 3.8). **Vérifié après déploiement : 0
  occurrence.**

### Ce qui a été fermé le 2026-08-29

- Historique gonflé du profil de test : lignes antérieures au 19/07 supprimées.
  All-Time passé de 151 à 17 clics, chacun vérifié contre l'API.
- Domaine partagé : le sélecteur affiche désormais un avertissement. Vérifié en
  production — `dc6f6aec` renvoie « 2 autres élèves », `a02e5927` ne renvoie rien, et
  trois profils partagent bien `ubizenai.s.gy` en base.
- Noms trompeurs : `total_clicks` des RPC (qui contenait des clics humains) devient
  `clics_humains` ; `clicks30d` / `humanClicks30d` deviennent `clicsAvecBots` /
  `clicsHumains`. Le suffixe « 30d » était faux — la fenêtre est celle demandée.
- Icônes de colonne posées sur les trois tableaux
  (`components/analytics/IconesColonnes.tsx`).
- **Clics des liens de paiement Stripe** : traité par le chantier Paiements. Les trois
  états sont sur la fiche client, l'onglet Relances et l'écran de modification du
  montant — avec la **date de première ouverture**, que ni le handoff ni le plan
  n'avaient obtenue. Vérifié en base : 5 liens, 5 suivis, `link_category` à `null`
  partout. Voir `docs/handoff-clics-liens-paiement.md`.

### Le rendez-vous du 31 août

La toute première clôture de période Instagram tombe le lundi 31 août (semaine du
24-30), la mensuelle le 1er septembre par le même code. **Une routine cloud est
programmée** pour vérifier et rapporter :
https://claude.ai/code/routines/trig_013FSi3fHa8nTV977c8jWxKf

La dépendance critique a été testée le 29 août : l'appel Meta que fera la clôture
répond correctement pour les trois profils, avec une arithmétique exacte
(`abonnés + non-abonnés = total`), y compris le cas où Meta omet une catégorie vide.
Ce qui reste non testé, c'est l'écriture `delete + insert` avec `figee = true`.

---

## Funnel & Calls — clos le 2026-08-29

Brief d'origine : `docs/handoff-audit-funnel-calls.md`.
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

### Ce qui était cassé, et comment on l'a su

| Défaut | Comment il a été établi |
|---|---|
| **All-Time : sept fenêtres sur huit restaient bornées au mois en cours.** Carte « Calls bookés 17 » ouvrant une courbe qui n'en totalisait que 9 ; reach d'août (145) divisé par des calls all-time (14), d'où un taux de passage affiché à **175 %** côté Instagram et **300 %** côté YouTube ; en-tête « 1 août – 31 août » sous un bandeau « All-Time depuis le 09/06 » | En basculant sur All-Time et en **ouvrant la modale** de chaque carte. Invisible en SQL : les deux chiffres étaient justes, c'est la fenêtre de l'un qui ne valait pas celle de l'autre. Même défaut que celui corrigé dans Business micro la veille — la correction n'avait pas été propagée |
| **Deux règles de journée dans le même écran.** Les modales du hero comparaient `new Date('YYYY-MM-DD')` — lu en **UTC** — à des jours produits par `parisDateStr` ; celles du tableau d'efficacité découpaient sur le **préfixe UTC de `scheduled_at`**, la date du rendez-vous, alors que le périmètre filtre sur `booked_at` | Lecture croisée des deux fonctions, puis démonstration par un test : un call réservé à 00:30 heure de Paris tombe la veille en UTC. Aucun cas en base ce jour-là (les 19 calls de vente sont tous réservés entre 06 h et 23 h) — corrigé quand même |
| **Un taux à dénominateur nul valait `0`.** Sur un mois à cinq jours d'activité, la modale « Close rate » montrait 26 jours plats à « 0 % de closing » | Ouverture de la modale. Le code (`den > 0 ? … : 0`) est correct au sens du typage et passe toutes les relectures |
| **La modale « Rev / call » affichait une série fabriquée** : la moyenne de toute la période posée sur les jours à honoré, `0` partout ailleurs | Lecture du code après avoir constaté une courbe en créneau parfaitement plate |
| **Les totaux du hero valaient `igBookes + ytBookes`** alors que leur sous-titre dit « toutes sources », et que le numérateur du taux de no-show, lui, portait sur toutes les sources : le taux pouvait dépasser 100 % | Lecture, puis comptage en base — **0 call hors `ig_*`/`yt_*` sur les 70 lignes**, donc aucun cas aujourd'hui |
| **La table des calls libellait « Honoré » un call passé sans rapport**, avec un ✓ en colonne No-show, pendant que le compteur juste au-dessus l'excluait : **8 lignes « Honoré » pour un compteur à 7** | Lecture ligne à ligne de la capture d'écran. Le call `fcf5d214` (21 août, `outcome` null) est le cas |
| Colonne Source affichée « Ig » / « Yt » — la casse machine du champ — trois centimètres sous un filtre qui dit « Instagram » / « YouTube » | Capture d'écran |
| Table tronquée à 20 lignes sans le dire, sous un résumé qui les compte toutes | Lecture du code, confirmé par le passage en All-Time (19 lignes, à la limite) |
| Axes : graduation à **−1** sur un compteur de calls, à **−12 %** et **112 %** sur un taux. Les six autres axes du fichier avaient déjà la garde `Math.max(0, …)` | Capture d'écran des deux modales |
| Avertissements `width(-1) and height(-1)` au montage des deux modales | Console du navigateur après correction — la régression que le skill dit de chercher |
| **Coach : les calls annulés passés entraient dans `history`**, donc dans « Coachings » ET dans « Annulés ». « Historique (22) » et « Coachings (22) » pour 19 calls réels | Compté à l'écran puis en base : 19 non annulés + 3 annulés = 22. La page élève filtrait déjà les annulés — c'est elle qui avait raison |
| **Coach : `upcoming.filter(isCallCanceled)` était toujours vide** (`isCallJoinable` rend faux pour un annulé), donc un rendez-vous annulé **avant** d'avoir eu lieu n'apparaissait dans aucun onglet | Lecture. Aucun cas en base |
| Coach : les demandes en attente d'acceptation étaient affichées deux fois — section dédiée **et** onglet « À venir » | Lecture, l'élève les excluait déjà |
| Coach : « **J−1 · Demain** » pour un call prévu le soir même. `Math.ceil(diff / 24 h)` contre `daysUntil` côté élève | Deux calculs pour le même badge sur deux écrans |
| Élève : le bouton « Rapport » testait `no_show === null` alors que le marqueur unique documenté est `outcome` — et que `pendingRapports`, dix lignes plus haut **dans le même fichier**, utilise déjà `outcome` | `docs/rapports-de-call.md` § 3 |
| **`.neq('ignored', true)` dans 23 lectures de `calls`.** PostgREST le traduit par `ignored <> true`, qui vaut NULL — donc faux — dès que la colonne est NULL : la ligne disparaît de **tous** les écrans, sans erreur | Schéma : la colonne était `nullable`. 0 ligne à NULL au 2026-08-29 |

### Ce qui a été livré

Corrigé dans `PageClientStats.tsx` (TabFunnel), `PageClientCalls.tsx`, `PageCalls.tsx`.

La règle de découpage jour par jour vit désormais **une seule fois**, dans
`lib/callSeries.ts` (`callDayKey`, `bucketCallsByBookedDay`, `parisDayRange`,
`tauxOuTrou`), avec `lib/callSeries.test.ts`. Le test qui compte : *la somme des
seaux jour par jour égale le total sur la fenêtre couvrant les données* — et sa
contre-épreuve, qui montre que la même courbe bornée au mois en cours n'en rend que
2 sur 5. C'est l'invariant qui a sauté, c'est lui qui est verrouillé.

`daysUntilLocal` est passé dans `lib/callFormat.ts`, partagé par les deux pages Calls.

**Migration `20260829180000`** : `calls.ignored`, `calls.call_type` et `calls.status`
passent `NOT NULL`. Les trois avaient un défaut et zéro ligne à NULL. C'est la classe
d'échec silencieux traitée **à la racine**, une fois, plutôt qu'à chacun des 23
endroits qui lisent la table — une écriture qui poserait NULL échoue désormais
bruyamment.

### Deux pistes du brief qui étaient FAUSSES

Le brief prévenait qu'il fallait s'y attendre. Pour mémoire, afin que personne ne les
rouvre :

- **« Un deal annulé laisse-t-il un revenu périmé ? »** Non. Les deux chemins
  d'annulation (`payments/deals/[id]/cancel` et `.../declare-refund` avec
  `finaliserAnnulation`) écrivent déjà `revenue: 0, deal_closed: false,
  outcome: 'lost'` sur le call. Le repli de `callsEff` sur `calls.revenue` rend donc
  bien 0.
- **« `deals` est la source du cash — vérifier que Funnel & Calls fait pareil. »**
  Il le faisait déjà : `TabFunnel` reçoit `callsEff`, pas `callsRaw`. Le deal
  `4a8dde35` s'affiche bien à 1 200 € et non 3 000.

### Ce qui reste ouvert volontairement

- **Le reach de l'entonnoir somme les jours (502 en All-Time) au lieu d'utiliser la
  mesure de période dédupliquée de Meta.** Les deux chiffres coexistent déjà à
  l'écran dans l'onglet Instagram : « Reach · personnes 30j **145** » (somme des
  jours) et « du 1 au 31 août — Reach total = **122** » (`analytics_ig_periodes`).
  L'écart est de 19 % sur un mois et croît avec la durée. Non corrigé parce que
  `analytics_ig_periodes` ne porte que le mois et la semaine **en cours** : basculer
  l'entonnoir dessus casserait toutes les périodes antérieures et l'All-Time.
  Décision produit à prendre.
- **Un taux de passage supérieur à 100 % reste possible, et légitime** : 14 calls
  bookés pour 10 clics Calendly tracés en All-Time. Il ne dit pas « super
  conversion » mais « le suivi de clics rate 4 de mes 14 réservations ». Il s'affiche
  pourtant en vert, comme un excellent CTR, parce que `FunnelHorizontal` applique le
  même barème de couleur (`<1 % rouge, <5 % ambre, sinon vert`) à toutes les étapes.
- **Les modales de taux deviennent des points isolés** sur un mois peu actif,
  maintenant que les jours sans mesure sont des trous et non des zéros. C'est
  honnête, mais visuellement pauvre. Relier les points réinventerait les valeurs
  intermédiaires — d'où le choix de ne pas le faire.
- **Les calls `call_type = 'manual'` n'existent sur aucun écran.** Deux chemins en
  créent : `RapportModal` quand on saisit à la main la date d'un appel reporté ou
  d'un 2ᵉ call (il n'envoie pas de `call_type`, la route retombe sur `'manual'`), et
  le geste « avancer vers RDV pris » du pipeline. Or **toutes** les lectures de vente
  filtrent `call_type = 'calendly'` : pipeline, Mes Stats, `salesCallStats`, page
  Calls élève. Un tel call est écrit en base et n'apparaît nulle part, ne compte
  nulle part, et ne peut pas recevoir de rapport. **0 ligne en base** — le chemin n'a
  jamais été exercé. Non corrigé : décider si un call manuel est un call de vente
  change des chiffres sur toute la plateforme.

### Trouvé au passage, hors périmètre

**`get_ig_posts_history` est cassée en production.** La fonction déclare et
sélectionne `p.video_duration_sec`, une colonne qui n'existe pas sur
`analytics_ig_posts_history`. Tout appel échoue :

```
ERROR: 42703: column p.video_duration_sec does not exist
```

Aucun fichier du dépôt ne mentionne ce nom, et aucune migration versionnée ne le
crée : la fonction a été modifiée hors du dépôt. Côté application l'échec est
silencieux — un `console.error` dans `PageClientStats`, et rien à l'écran. **Non
touchée** : ressemble à un chantier en cours (fonction déjà modifiée, migration de
colonne pas encore appliquée).

Autres pièges déjà documentés, à garder en tête :
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
