# Ventilations Short.io — arrêtées le 2026-08-28, comment les récupérer

Les colonnes `top_countries`, `top_cities`, `top_browsers`, `top_os`, `top_social`,
`top_referrers`, `utm_sources` et `utm_mediums` de `shortio_link_daily_snapshots`
**ne sont plus alimentées**. Les valeurs déjà en base sont conservées, jamais écrasées,
mais plus aucune n'est ajoutée depuis cette date.

Ce document existe pour le jour où tu voudras les récupérer. Il dit pourquoi elles se
sont arrêtées, ce que ça coûte de les relancer, et où toucher.

## Pourquoi elles se sont arrêtées

Elles venaient d'un appel `GET /statistics/link/{id}` fait **pour chaque lien, à chaque
passage du cron**. C'est précisément cet appel qui rendait le cron intenable :
82 liens × 3 élèves = 246 appels par passage, ~3 200 projetés à 40 élèves — largement
au-delà du budget de 150 s de l'Edge Function. À 3 élèves, 45 % des lignes n'étaient
déjà plus rafraîchies.

Le cron lit désormais le **flux de clics du domaine** (`last_clicks`), un ou deux appels
quelle que soit la taille du compte. Ce flux donne l'horodatage, le path, le statut HTTP
et l'indicateur humain de chaque clic — tout ce qu'il faut pour compter — mais il porte
aussi le pays, la ville, le navigateur, l'OS et les UTM, **par clic**.

Autrement dit : la donnée passe toujours par le cron, elle n'est simplement plus agrégée
ni stockée. Aucun appel supplémentaire n'est nécessaire pour la récupérer.

## Vérifié avant de couper

Aucun écran ne lisait ces colonnes. `/api/shortio/snapshots` les agrégeait et les
exposait (`topCountries`, `countries`, `utmSource`…), et rien dans `PageClientStats.tsx`
ni dans `PageLiens.tsx` ne les affichait. Elles sont toujours présentes dans la forme de
la réponse, sous forme de tableaux vides, pour ne casser aucun appelant.

## Comment les relancer

Dans `supabase/functions/poll-leads/index.ts`, fonction `snapshotLink` : les huit
paramètres `p_top_*` / `p_utm_*` sont passés à `null`, ce qui fait que la RPC conserve
la valeur existante (`coalesce`). Pour les remplir de nouveau :

1. Le flux est déjà agrégé par `agregerClics` (`lib/shortio-clicks.ts`), qui ne garde
   aujourd'hui que `human` et `total`. Étendre cette fonction pour accumuler aussi, par
   `(path, jour)`, un décompte par pays / ville / navigateur / OS / UTM — les champs
   sont sur chaque clic (`country`, `city`, `browser`, `os`, `social`, `refhost`,
   `utm_source`, `utm_medium`).
2. Passer ces décomptes à `snapshotLink`, qui les transmet à la place des `null`.
3. Côté lecture, `get_shortio_links_agreges` ne renvoie pas ces colonnes : soit les
   ajouter à la RPC (attention au volume — c'est du JSONB par ligne), soit écrire une
   requête dédiée appelée seulement quand l'écran qui les affiche est ouvert.

**Ne pas** revenir à un appel par lien. C'était la cause du problème, pas la solution.

## Un piège si tu le fais

Le flux de clics est dominé par le bruit : sur un domaine réel, 349 des 368 entrées
d'une semaine étaient des scans automatisés en 404, que Short.io marque pourtant
`human: true`. `estVraiClic` filtre déjà sur le statut HTTP et sur un path exploitable.
Toute agrégation de ventilation doit passer par ce même filtre, sinon le « top pays »
sera celui des robots.
