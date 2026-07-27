# TODOS

## Documenter/vérifier l'origine exacte de `calls.ignored=true` sur les lignes historiques

**Quoi** : `calls.ignored=true` fait qu'un call ne compte nulle part (exclu explicitement des requêtes Analytics/Pipeline via `.neq('ignored', true)`, ex. `app/api/client/pipeline/route.ts:31`). Les chemins de code trouvés qui posent ce flag (grep exhaustif du 2026-07-27) sont **tous** des suppressions manuelles déclenchées depuis l'UI (route `app/api/client/pipeline/route.ts`, actions `delete-call`/`delete-prospect`/suppression de leads, ainsi que `app/api/client/calls/[id]/route.ts` et `app/api/calendly/sync/route.ts` pour le cas "prospect supprimé → call fantôme au resync"). Tous ces chemins posent `lead_deleted: true` en même temps que `ignored: true`, **sauf** la suppression de leads en masse (`pipeline/route.ts:238`, ne pose que `ignored: true`).

**Constat en base (vérifié le 2026-07-27)** : 32 calls ont `ignored=true` au total. Seulement 4 ont `lead_deleted=true` (cohérent avec les chemins de code identifiés). Les **28 autres** ont `ignored=true` mais `lead_deleted=false` — origine non confirmée avec certitude : soit via la route de suppression de leads en masse (le seul chemin de code qui ne pose pas `lead_deleted`), soit via une intervention SQL manuelle ponctuelle (nettoyage de calls de test, backfill) non tracée dans le code applicatif. Pas de mécanisme automatique trouvé qui poserait `ignored=true` pour des calls antérieurs à la date de connexion Calendly — cette hypothèse n'est pas confirmée par le code actuel.

**Pourquoi** : signalé par Chris (2026-07-27) — besoin de clarté sur pourquoi ces calls existent en base sans compter nulle part, pour ne pas s'emmêler plus tard en pensant qu'il manque des données alors qu'elles sont juste volontairement exclues.

**Pour** : évite une confusion future ("pourquoi ce call n'apparaît dans aucune stat alors qu'il est en base ?") et sécurise contre une éventuelle suppression accidentelle de ces lignes en pensant qu'elles sont un bug, alors qu'elles sont peut-être un nettoyage volontaire déjà fait.

**Contexte pour la reprise** : requête de vérification utilisée — `select * from calls where ignored = true` (32 lignes, dont 28 avec `lead_deleted=false`, principalement des calls `source='ig_description'` datés du 19 mai au 30 juin 2026, plus quelques `call_type='google'`).

**Dépend de / bloqué par** : rien — vérification ponctuelle à faire avec Chris (lui seul sait s'il a fait un nettoyage SQL manuel à cette période), pas un vrai chantier de code.

## Unifier les interfaces `Call` locales dupliquées vers le type officiel `lib/supabase/types.ts`

**Quoi** : `components/pages/client/PageClientCalls.tsx` et `components/pipeline/PagePipeline.tsx` définissent chacun leur propre `interface Call` locale, structurellement différente l'une de l'autre (nullabilité divergente sur les mêmes champs, ex. `status: string` vs `string | null` ; champs présents dans l'une absents de l'autre, ex. `call_type` seulement côté `PageClientCalls`, `utm_campaign`/`short_link_path`/`is_follow_up` seulement côté `PagePipeline`). `components/analytics/PageClientStats.tsx` a aussi son propre `CallRecord` local (voir point suivant). Aucun des trois ne réutilise le type officiel déjà existant `Call` (`lib/supabase/types.ts:102`).

**Pourquoi** : identifié lors de l'audit "Jour 6" (2026-07-27) sur la robustesse du code — signalé dans le brief initial comme "à confirmer avant de trancher", jamais traité dans l'exécution du chantier. Le type officiel `Call` existe déjà (avec le commentaire documentant `call_type` vs `calendly_event_uuid`, cf. contrainte DB `calls_call_type_uuid_consistency` — vérifiée existante en base le 2026-07-27), donc l'étape "créer une source de vérité" est déjà faite ; il ne reste que la migration des 3 fichiers vers ce type.

**Pour** : élimine un risque de divergence silencieuse — si un champ est ajouté/retiré de la table `calls`, il faut aujourd'hui penser à répercuter le changement manuellement dans 3 endroits distincts, sans garde-fou du compilateur pour le rappeler.

**Contre** : chaque interface locale ne contient que les champs réellement utilisés par son fichier — ce n'est pas un bug aujourd'hui, juste de la duplication de définition. Migrer vers le type officiel demande de vérifier champ par champ que la nullabilité du type partagé n'introduit pas de faux positifs TypeScript dans chacun des 3 fichiers (risque de régression pour un gain cosmétique tant qu'aucun bug concret ne le justifie).

**Signal de déclenchement concret** : le jour où un champ est ajouté à `calls` en base et qu'il faut le répercuter à la main dans 3 interfaces différentes pour qu'un composant y ait accès — c'est le signal qu'il est temps de migrer.

**Contexte pour la reprise** : `components/pages/client/PageClientCalls.tsx:10`, `components/pipeline/PagePipeline.tsx:43`, `components/analytics/PageClientStats.tsx:85` (interfaces locales) vs `lib/supabase/types.ts:102` (type officiel `Call`).

**Dépend de / bloqué par** : rien, mais pas urgent — aucun bug actif ne le justifie aujourd'hui.

## Trancher la définition officielle de "call honoré" (2 définitions coexistent + logique inline dupliquée ailleurs)

**Quoi** : `components/analytics/PageClientStats.tsx` factorise 17 anciennes occurrences dupliquées en 2 helpers documentés (`isCallHonoredStrict` — exige un rapport rempli, `outcome != null` + call passé ; `isCallHonoredSimple` — ne demande que `!no_show`), qui coexistent intentionnellement (voir commentaire ligne 95-104 de ce fichier). Mais `components/pipeline/ProspectDetailModal.tsx` (ligne ~194, `call.outcome === 'showed_up' || call.outcome === 'second_call' || call.deal_closed`) et `components/pipeline/PagePipeline.tsx` (ligne ~1207-1224, calcul de `natural` depuis `outcome`/`no_show`/`deal_closed`) ont chacun leur **propre** logique inline, ni l'une ni l'autre ne réutilisant les 2 helpers de `PageClientStats.tsx`. Au total, ce sont donc au moins 3-4 définitions distinctes de "call honoré"/"showed_up" réparties dans 3 fichiers, pas 2.

**Pourquoi** : identifié lors de l'audit "Jour 6" (2026-07-27). La factorisation dans `PageClientStats.tsx` était volontairement scopée à ce fichier seul ("factoriser sans rien changer") après avoir déterminé qu'une fusion complète était risquée sans d'abord trancher une décision produit — vérifié à cette date que les deux définitions donnent 0 écart chiffré sur les données réelles actuelles (les calls sans rapport restants étaient tous `ignored=true`/tests). Mais si un vrai call reste un jour longtemps sans rapport rempli, Strict et Simple (et les logiques inline de Pipeline/ProspectDetailModal) peuvent diverger silencieusement sur le même call.

**Pour** : élimine un risque de chiffres incohérents entre Analytics (Funnel & Calls) et Pipeline Leads (badges/stages) pour un même call, sans avoir à deviner laquelle des ~4 définitions fait foi.

**Contre** : nécessite une vraie décision produit (quelle est LA bonne définition de "honoré" ?) avant tout changement de code — pas un simple refactoring technique. Risque de casser des affichages existants (badges du kanban Pipeline, KPIs Analytics) si la définition choisie change des chiffres déjà visibles aux utilisateurs.

**Signal de déclenchement concret** : le jour où un call reste sans rapport rempli pendant une durée significative et qu'un coach/élève signale une incohérence entre ce qu'affiche le Pipeline et ce qu'affichent les Stats pour ce même call.

**Contexte pour la reprise** : `components/analytics/PageClientStats.tsx:95-109` (les 2 helpers + commentaire), `components/pipeline/ProspectDetailModal.tsx:194-199`, `components/pipeline/PagePipeline.tsx:1207-1224`.

**Dépend de / bloqué par** : décision produit (quelle définition officielle adopter) avant toute exécution technique.

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