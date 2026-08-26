# TODOS

## Investiguer et optimiser le fallback fragile de résolution de compte IG dans le webhook

**Quoi** : `app/api/webhooks/instagram/route.ts:225-238` — quand le match direct entre
`entry.id` (l'ID envoyé par Meta dans le payload webhook) et `metadata.ig_account_id`
(stocké en base) échoue, le code teste **chaque** compte Instagram connecté en appelant
l'API Meta avec son token jusqu'à trouver celui qui répond correctement. C'est un scan
séquentiel O(n) sur tous les comptes connectés, potentiellement lent.

**Pourquoi** : identifié lors de la review du chantier "isolation des données Instagram
par compte connecté" (2026-07-29). La cause exacte de ce mismatch `entry.id` vs
`ig_account_id` stocké n'est pas investiguée — probablement le "Page ID" Facebook lié
plutôt que l'Instagram Business Account ID, mais non confirmé. Pas cassé par le chantier
d'archivage (aucun lien), donc traité comme un chantier séparé.

**Pour** : élimine une source de latence potentielle sur le traitement des commentaires
entrants (chaque appel Meta séquentiel ajoute de la latence) si ce cas de fallback
s'avère plus fréquent que prévu, ou si le nombre de comptes IG connectés grandit
fortement au-delà de la cible actuelle (20 élèves).

**Contre** : la fréquence réelle de ce fallback n'est jamais mesurée en prod — investir
dans l'optimisation avant de savoir si le problème se produit souvent serait prématuré.

**Contexte pour la reprise** : `app/api/webhooks/instagram/route.ts:216-238` (résolution
`resolvedMatch`). Commencer par logger/mesurer la fréquence réelle du fallback avant
d'optimiser quoi que ce soit.

**Dépend de / bloqué par** : rien, pas urgent — mesurer avant d'agir.

## Unifier les 5 copies dupliquées de `getIgCreds`

**Quoi** : la logique de résolution du token + `ig_account_id` Instagram existe en 5
copies quasi identiques : `lib/ig-fetch.ts` (canonique Vercel), `supabase/functions/_shared/ig-posts.ts`
(canonique Deno), copie locale dans `supabase/functions/poll-leads/index.ts`, copie
locale dans `supabase/functions/poll-stories/index.ts`, version simplifiée (sans refresh
token) dans `app/api/client/stories/live-refresh/route.ts`.

**Pourquoi** : identifié lors de l'investigation du bug de double DM1 (2026-07-28) et
de la review du chantier "isolation des données Instagram par compte connecté"
(2026-07-29) — chantier de dédup pur, volontairement gardé séparé du fix d'architecture
pour ne pas mélanger un refactor de déploiement (Deno import maps, bundling) avec un
changement de logique métier au moment où la prudence maximale est requise.

**Pour** : élimine le risque qu'une des 5 copies diverge silencieusement des autres
(déjà arrivé : un bug de calcul `accounts_engaged`/`total_interactions` corrigé dans
`lib/ig-fetch.ts` le 2026-07-06 n'avait jamais été répercuté dans la copie de
`poll-leads/index.ts`, découvert bien plus tard).

**Contre** : toucher aux imports Deno (`supabase/functions/poll-leads/index.ts`,
`poll-stories/index.ts`) touche à la mécanique de déploiement Edge Function — risque de
casser un déploiement si mal testé, à faire seulement une fois le chantier d'isolation
des comptes IG stabilisé en prod.

**Contexte pour la reprise** : `lib/ig-fetch.ts:32-66`, `supabase/functions/_shared/ig-posts.ts:12-40`,
`supabase/functions/poll-leads/index.ts:86-114` (copie locale), `supabase/functions/poll-stories/index.ts:37-65`
(copie locale), `app/api/client/stories/live-refresh/route.ts:14-25` (version simplifiée).

**Dépend de / bloqué par** : à faire après le chantier "isolation des données Instagram
par compte connecté" (2026-07-29) — une fois ce chantier stabilisé en prod, la dédup
devient un refactor purement mécanique, facile à vérifier sans risque de comportement.


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

## ~~Trancher la définition officielle de "call honoré"~~ — RÉSOLU (2026-07-27)

Décision produit tranchée avec Chris : un call sans rapport rempli compte comme **non honoré** (tant que le rapport n'est pas rempli, c'est comme si le call n'avait pas encore eu lieu). Vérifié avant implémentation : 0 call `call_type='calendly'` sans rapport en base à cette date → impact chiffré rétroactif nul.

Unifié dans `lib/callHonored.ts` (fonction `isCallHonored(call, now)`), réutilisée dans les 3 fichiers qui avaient chacun leur propre définition : `components/analytics/PageClientStats.tsx` (remplace `isCallHonoredStrict`/`isCallHonoredSimple`, 17 usages + 1 inline oublié), `components/pipeline/ProspectDetailModal.tsx` (remplace la condition inline ligne ~194), `components/pipeline/PagePipeline.tsx` (3 branches — leads IG, IG description/bio, YT/Autre — alignées sur la même règle pour le calcul du stage `natural` du kanban). Le badge Pipeline reste "Call booké" tant qu'aucun rapport n'est rempli, comme validé avec Chris.

Vérifié en conditions réelles après implémentation : `tsc --noEmit` propre, chiffres Analytics (Vue générale, Funnel & Calls, Performance LM, mode "Depuis connexion") strictement identiques avant/après, badge Pipeline correct sur un vrai no-show et sur les calls avec rapport rempli.

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
## Unifier les séquences DM des posts et des stories

**Quoi** : deux modèles de données pour un même concept — un post porte cinq champs
(`dm_lm_message`, `dm_button_text`, `dm_link_message`, `dm_link_button_text`,
`dm_opener_message`), une story en porte deux plus des tokens. Le même écran, la même
mécanique d'envoi, deux schémas.

**Pourquoi** : reporté pendant la refonte de « Gérer mes liens » (août 2026) pour isoler
les causes de panne — toucher au modèle pendant une refonte d'interface aurait rendu
indémêlable un bug d'affichage d'un bug d'envoi.

**Contexte pour la reprise** : voir aussi le renommage jamais fait des colonnes, ci-dessous.

**Dépend de / bloqué par** : rien depuis l'approbation Meta du 2026-08-25.

## Renommer les colonnes DM, dont la numérotation est décalée

**Quoi** : `dm_lm_message` est le DM1 (l'accroche) et `dm_opener_message` est le DM3 (la
relance) — le nom dit l'inverse de ce que la colonne contient. L'écran a été aligné sur le
vocabulaire accroche / bouton / lien / bouton / relance pendant la refonte, la base non.

**Pourquoi** : le handoff demandait le vocabulaire unifié « à l'écran ET en base ». Seul
l'écran a été fait : renommer les colonnes touche le webhook Instagram et
`send-pending-dm3`, donc des Edge Functions, ce qui sortait la refonte de son périmètre
« git push seul ».

**Contexte pour la reprise** : `components/liens/PageLiens.tsx` porte un commentaire
d'avertissement à l'endroit du mapping. Toute modification de séquence doit vérifier ce
décalage avant de toucher aux champs.

**Dépend de / bloqué par** : à faire de préférence avec l'unification ci-dessus.

## Instagram : confirmation de déconnexion, récupération des leads, alerte token révoqué

**Quoi** : trois manques spécifiés pendant la refonte mais non implémentés — une
confirmation avant de déconnecter un compte Instagram (l'action archive beaucoup de
données), la récupération des leads d'un ancien compte (trois points d'entrée), et une
alerte quand le token est révoqué (bandeau + notification push).

**Dépend de / bloqué par** : rien.

## Clics Short.io des liens archivés — choix produit à trancher

**Quoi** : un lien d'un ancien compte Instagram reste cliquable. Faut-il compter ses clics
dans les statistiques du compte courant ? Trois points en dépendent : le comptage
« Business micro », le `link_category` calculé en incluant les liens archivés
(`poll-leads`, `backfill-shortio`), et l'absence d'`archived_at` sur
`shortio_link_daily_snapshots`.

**Pourquoi** : mesuré en base le 2026-08-20 — 25 lignes concernées, **0 clic** au total.
Aucun impact constatable aujourd'hui, mais la contamination serait permanente si elle
survenait.

**Dépend de / bloqué par** : une décision de Chris, pas un développement.

## Deux requêtes fragiles sur instagram_leads, sans impact mesuré

**Quoi** : `.maybeSingle()` sur `instagram_leads` sans filtre de compte dans
`pipeline/advance` et `client/calls` — deux lignes pour un même `ig_username` feraient
échouer la requête, et le call serait créé détaché du pipeline. De même, la résolution
Calendly par `ig_user_id` n'est pas bornée par compte : un call du nouveau compte peut se
rattacher à une ligne archivée.

**Pourquoi** : vérifié en base le 2026-08-20, aucun cas présent. Théorique tant qu'un même
pseudo n'apparaît pas deux fois.

**Dépend de / bloqué par** : rien, mais mesurer avant d'agir.
