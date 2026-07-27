# TODOS

## Corriger la construction de `short_link_path` (bare slug vs path complet)

**Quoi** : `short_link_path` sur `calls` est aujourd'hui dérivé de `utm_content` (`app/api/webhooks/calendly/route.ts`, `app/api/calendly/sync/route.ts`, `supabase/functions/sync-calendly/index.ts` — même valeur, jamais le path Short.io complet avec préfixe). Résultat : pour tout call issu de Calendly, `short_link_path` vaut par exemple `christian-penkov` (bare), alors que `components/pipeline/PagePipeline.tsx` (lignes ~279-285, ~1190-1203) compare ce champ contre `new URL(prospect.short_url).pathname.slice(1)`, qui vaut `prendre-rdv-christian-penkov` (path complet). Ce matching échoue systématiquement pour tous les calls DM, déjà avant tout autre changement.

**Pourquoi** : découvert lors du chantier "utm_content = pseudo au lieu du post ID" (2026-07-27, voir plan `briefing-jour-1-cryptic-wigderson.md` si encore présent). Défaut préexistant et distinct du bug `utm_content` — pas corrigé ni aggravé par ce chantier (il était déjà cassé, il reste cassé de la même façon). Concerne spécifiquement la résolution "prospect sans lead (cold DM pur)" dans `PagePipeline.tsx` (commentaire ligne ~1202).

**Pour** : corrige un vrai trou d'attribution pour les cold DM sans `ig_lead_id` — actuellement invisibles/mal résolus dans le Pipeline malgré un lien Short.io correctement créé et un call bien booké.

**Contre** : touche les 3 mêmes fichiers de sync Calendly déjà modifiés une fois pour la garde anti-écrasement `utm_content` (voir chantier ci-dessus) — risque de complexifier encore ce code partagé sans plan clair pour l'instant sur la bonne source de vérité (stocker le path complet dans un nouveau champ ? Changer la comparaison côté `PagePipeline.tsx` pour reconstituer le bare slug plutôt que l'inverse ?).

**Contexte pour la reprise** : voir la section "5. short_link_path" de l'audit du chantier `utm_content` (2026-07-27) pour le détail complet des 3 logiques incohérentes déjà en place.

**Dépend de / bloqué par** : rien, mais à traiter après une nouvelle revue — pas un correctif d'une ligne comme le chantier `utm_content`.

## Corriger le second site utm_content = pseudo (lead magnet envoyé en DM sur commentaire)

**Quoi** : `app/api/webhooks/instagram/route.ts` ligne ~767 (`destUrl.searchParams.set('utm_content', cleanUsername)`) a exactement le même défaut que celui corrigé dans `components/liens/PageLiens.tsx` (2026-07-27) — pose le pseudo au lieu du `mediaId` (disponible dans la fonction, ligne ~698, déjà utilisé pour chercher le `content_link`).

**Pourquoi** : identifié lors de l'audit du chantier `utm_content`, volontairement écarté du périmètre. Ce lien (lead magnet envoyé automatiquement en DM après un commentaire matchant un mot-clé) ne génère jamais de `calls.utm_content` — ce n'est pas un lien Calendly. Son tracking de clics passe déjà par `link_category = 'lm_dm_auto'` (colonne dédiée sur les snapshots Short.io) et son attribution au lead par `lmClickedByLeadId` (via `ig_lead_id`, jamais `utm_content`). Corriger ce site n'apporterait donc aucun bénéfice mesurable dans les stats actuelles (`components/analytics/PageClientStats.tsx`) — seulement un risque de toucher un flux automatisé qui fonctionne aujourd'hui, sans qu'aucun lecteur n'exploite cette valeur.

**Pour** : cohérence de convention (`utm_content` = toujours un ID de contenu ou absent, jamais un pseudo, partout dans le repo) si un futur chantier venait à exploiter `utm_content` sur ce type de lien pour du "Performance par contenu" côté lead magnets DM.

**Contre** : aucun bénéfice mesurable aujourd'hui — changement pour la forme, pas pour un bug visible actuellement.

**Contexte pour la reprise** : voir `app/api/webhooks/instagram/route.ts` lignes 687-769 (le flux complet : recherche `content_link` par `mediaId`, matching keyword, construction du lien Short.io).

**Dépend de / bloqué par** : rien, priorité basse — appliquer seulement si un futur besoin business apparaît.

## Unifier le calcul de date "Paris" entre poll-leads (Deno) et le reste du repo (Next.js)

**Quoi** : remplacer la table de fuseau horaire codée en dur dans `supabase/functions/poll-leads/index.ts` (`lastSundayOfMonth`/`parisOffsetHours`, règle UE recalculée manuellement) par le même mécanisme que `lib/period.ts` (`Intl.DateTimeFormat` avec `timeZone: 'Europe/Paris'`), ou au minimum documenter clairement pourquoi les deux existent séparément et s'assurer qu'ils restent testés en synchronisation.

**Pourquoi** : identifié lors du chantier "trous silencieux dans la collecte YouTube" (2026-07-26). Le fuseau horaire a été écarté comme cause des trous par vérification numérique (simulation comparant les deux mécanismes sur toutes les heures des dates concernées, zéro divergence) — donc pas un bug aujourd'hui. Mais c'est une duplication de logique sensible (règles DST) entre deux runtimes (Deno pour l'edge function, Node/Next.js pour le reste), dupliquée uniquement parce qu'un import cross-runtime n'est pas possible entre les deux. Si les règles DST européennes changent un jour (rare mais déjà arrivé historiquement), il faudrait se souvenir de mettre à jour les deux implémentations séparément.

**Pour** : élimine un risque de divergence future silencieuse entre deux calculs de la même date, sans changer le comportement actuel (déjà vérifié identique).

**Contre** : `Intl.DateTimeFormat` avec support de fuseaux horaires n'est pas garanti disponible dans tous les runtimes Deno Edge (à vérifier avant de migrer) — si indisponible, il faudra soit garder la table maison, soit trouver un tiers mécanisme compatible Deno Edge. Effort de vérification avant tout changement, pas un simple copier-coller.

**Contexte pour la reprise** : voir `supabase/functions/poll-leads/index.ts` lignes ~21-46 (`lastSundayOfMonth`, `parisOffsetHours`, `isoDate`) vs `lib/period.ts` lignes ~30-45 (`parisDateParts`, utilisant `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', ... })`).

**Dépend de / bloqué par** : rien, mais pas urgent — vérifié sans impact fonctionnel actuel.

## Mettre en place un framework de tests automatisés

**Quoi** : installer Vitest (recommandé pour Next.js) et écrire les premiers tests, à commencer par les policies RLS critiques (permissions messages, isolation coach/élève).

**Pourquoi** : le projet n'a aujourd'hui aucun test automatique — tout est vérifié à la main. Les règles de sécurité (comme les policies RLS ajoutées pour éditer/supprimer les messages) sont exactement le genre de chose qui casse silencieusement sans un filet de test : une modification future de la policy pourrait réintroduire une faille sans que personne ne s'en aperçoive avant un vrai incident en prod.

**Pour** : protection durable et automatique contre les régressions de sécurité et de logique métier, sans effort manuel répété à chaque changement.

**Contre** : gros travail d'infrastructure initial — configurer Vitest, mettre en place un environnement Supabase de test séparé (pour ne pas polluer la prod), simuler l'authentification coach/élève dans les tests. Une fois cette base posée, écrire de nouveaux tests devient rapide.

**Contexte pour la reprise** : identifié lors de la revue du chantier "éditer/supprimer les messages façon WhatsApp" (voir `~/.claude/plans/ok-parfait-maintenant-on-peppy-firefly.md` si encore présent, sinon voir l'historique de conversation autour du 2026-07-05). La vérification actuelle de ce chantier se fait via un test d'intrusion manuel documenté dans le plan — ce TODO vise à automatiser ce type de vérification pour l'avenir.

**Dépend de / bloqué par** : rien, peut être fait à tout moment indépendamment des autres chantiers.

## Créer un vrai DESIGN.md pour le projet

**Quoi** : formaliser dans un fichier `DESIGN.md` la palette de couleurs déjà en place (`app/globals.css` — fond crème `#fbfbf7`, encre `#1a1815`, vert sauge `#3f8a52`, rouge terracotta `#cd5b3f`, ambre doré `#b58025`), les composants standards réutilisables (KPI cards, modals type `RapportModal`), et les conventions visuelles déjà suivies implicitement.

**Pourquoi** : le projet a déjà un style cohérent et distinctif (pas un SaaS bleu/violet générique), mais rien ne le documente. Chaque revue design doit redécouvrir la palette en lisant le CSS à chaque fois, et un nouveau contributeur (ou une IA) pourrait involontairement introduire des couleurs/patterns qui cassent la cohérence sans repère écrit.

**Pour** : accélère toute future revue design ou contribution — la palette et les conventions deviennent explicites au lieu d'être déduites à chaque fois. Protège la cohérence visuelle déjà acquise.

**Contre** : effort de rédaction initial (probablement via `/design-consultation`), et un DESIGN.md mal maintenu peut devenir obsolète s'il n'est pas mis à jour quand le style évolue.

**Contexte pour la reprise** : identifié lors de la revue design du chantier "dates dans Business micro + détail prospect + éditer/supprimer messages" (2026-07-05). Voir le plan associé si encore présent pour la palette déjà extraite durant cette revue.

**Dépend de / bloqué par** : rien, peut être fait indépendamment. Idéalement via la skill `/design-consultation`.

## Backfiller l'historique accounts_engaged/total_interactions à la connexion OAuth Instagram

**Quoi** : étendre `fetchIgBackfill30d` (`lib/ig-fetch.ts`) pour aussi récupérer `ig_accounts_engaged`/`ig_total_interactions` sur les 30 derniers jours au moment de la connexion OAuth initiale, via un vrai appel Meta `period=day` daté par jour (30 appels API séquentiels ou parallèles, un par jour) — même pattern que `fetchIgDayMetrics`, mais répété 30 fois au lieu d'une fois.

**Pourquoi** : `fetchIgBackfill30d` laisse actuellement ces deux colonnes à `null` pour tout l'historique de 30j du backfill initial (documenté dans le code comme "non backfillable rétroactivement en un seul appel" — Meta ne fournit ces métriques qu'en agrégat sur toute la fenêtre, jamais en vraie série quotidienne, sauf en interrogeant un jour à la fois). Un nouveau coach/élève qui vient de connecter Instagram verra donc "Interactions posts"/"Taux d'engagement" à 0 en navigation historique (S-1, S-2...) jusqu'à ce que le cron ait tourné suffisamment de jours pour reconstituer l'historique naturellement.

**Pour** : historique complet et cohérent dès la première connexion, pas de trou de données visible en navigation historique pour un nouveau profil.

**Contre** : 30 appels Meta supplémentaires au moment de la connexion (risque de timeout sur la route de callback OAuth si synchrone, ou de rate-limit Graph API si combiné à tous les autres appels déjà faits pendant le backfill) — à faire en fire-and-forget/asynchrone comme le backfill actuel, et à tester avec un vrai compte pour valider qu'on ne dépasse pas les quotas Meta.

**Contexte pour la reprise** : identifié lors du chantier "Interactions posts à 0 en vue période actuelle" (2026-07-07, voir `~/.claude/plans/ok-parfait-maintenant-on-peppy-firefly.md`, section "Chantier séparé — Interactions posts / Taux d'engagement à 0"). Ce chantier a résolu le problème pour les comptes déjà connectés (extension du cron + lecture 100%-DB), mais délibérément pas backfillé l'historique des nouvelles connexions.

**Dépend de / bloqué par** : rien, peut être fait indépendamment — mais bénéficie d'être fait après le chantier ci-dessus (cron écrivant déjà ces métriques quotidiennement), pour ne pas dupliquer deux fois la même logique `fetchIgDayMetrics` par jour.

## Permettre de dissocier un lead magnet (posts ET séquences stories)

**Quoi** : ajouter un bouton "Dissocier" dans `TabLm` (posts, `PageLiens.tsx`) et dans le futur `TabStoryLeadMagnet` (séquences) qui retire le lead magnet associé sans en choisir un nouveau — retour à l'état "aucun LM configuré".

**Pourquoi** : `TabLm` permet déjà de changer de LM (re-sélection), mais aucun endroit du produit ne permet de revenir à "pas de LM du tout" une fois qu'un LM a été associé à un post ou une séquence. Asymétrie déjà présente sur les posts avant ce chantier, identifiée en revue en préparant `TabStoryLeadMagnet` (qui reproduira la même limitation par cohérence).

**Pour** : cohérence produit — un coach qui a associé un LM par erreur, ou qui veut arrêter une campagne, peut revenir à un état neutre sans devoir associer un LM factice ou vide.

**Contre** : aucun signal qu'un client ait rencontré ce besoin jusqu'ici — pure hypothèse d'usage futur, pas un bug bloquant.

**Contexte pour la reprise** : identifié lors de la revue `/plan-eng-review` du chantier "Refonte du modèle CTA des séquences stories" (2026-07-26, voir `~/.claude/plans/ok-nous-ici-on-proud-rocket.md`). Concerne `components/liens/PageLiens.tsx` — fonctions `TabLm` (existant) et `TabStoryLeadMagnet` (à créer par ce chantier).

**Dépend de / bloqué par** : rien, mais logique à faire après la refonte `TabStoryLeadMagnet` pour traiter les deux composants ensemble.