# TODOS

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