# Notes de sécurité — audit 21/07 → 24/07/2026

Décisions non-évidentes issues de l'audit de sécurité en deux temps (5 failles Critique le 22/07, ~15 points Majeur le 24/07). Pas un compte-rendu chronologique — un aide-mémoire pour comprendre *pourquoi* certains bouts de code/DB sont comme ils sont, à consulter avant de toucher aux zones concernées.

Pour le détail technique du passage des buckets storage en privé (le point le plus complexe), voir `docs/architecture-messagerie.md` §24.

## Pattern d'ownership coach/élève

La quasi-totalité des correctifs suivent le même schéma, réutilisé partout dans le repo : une table `clients` fait le lien `coach_id` (auth.users.id du coach) ↔ `profile_id` (auth.users.id de l'élève). Toute route ou fonction qui touche une donnée liée à une conversation/relation coach-élève doit vérifier `clients.coach_id = auth.uid() OR clients.profile_id = auth.uid()` — copier ce pattern plutôt que d'en inventer un nouveau. Référence la plus propre : `app/api/messages/upload-file/route.ts`.

**Piège récurrent** : `calls.client_id` n'est PAS toujours un `clients.id` — pour les calls Calendly c'est bien `clients.id`, mais `app/api/calls/[id]/rapport/route.ts` compare `call.client_id === user.id` (donc traite parfois `client_id` comme un `auth.users.id` direct). Incohérence documentée en commentaire dans ce fichier, jamais corrigée (seul le coach utilise cette route en pratique aujourd'hui — confirmé, pas un bug actif). **Ne pas supposer que `client_id` a le même sens partout dans la table `calls`** sans vérifier le flux (Calendly vs Google Meet) concerné.

## RLS vs service-role : deux mondes qui ne se croisent jamais

Le repo n'a pas de `lib/supabaseAdmin.ts` centralisé — chaque route qui a besoin d'un accès large instancie son propre client `service_role` inline. **Le service-role bypass RLS et tous les GRANT/REVOKE par construction.** Concrètement :
- Activer RLS sur une table, ou faire un `REVOKE EXECUTE` sur une fonction, ne casse **jamais** les crons/routes qui utilisent déjà `service_role` — c'est vérifié systématiquement avant chaque migration de ce type, mais bon réflexe à garder.
- À l'inverse, une policy RLS bien pensée ne protège **rien** si la route qui l'entoure interroge quand même via `service_role` sans revérifier l'ownership en code applicatif (le pattern « `getUser()` pour l'auth, puis bascule vers `service_role` pour la vraie requête, avec un `.eq()` posé à la main » est dominant dans ce repo — RLS est un filet de sécurité contre l'accès direct à l'API REST publique, pas la seule ligne de défense).

## Fonctions Postgres `SECURITY DEFINER` exposées en RPC

Toutes les fonctions `SECURITY DEFINER` de ce projet sont grantées EXECUTE à `anon`/`authenticated` par défaut à la création (comportement Supabase, pas une erreur volontaire) — donc **toute nouvelle fonction `SECURITY DEFINER` est publique par défaut**, à restreindre explicitement.

Deux familles bien distinctes, à ne pas traiter pareil :
- **Fonctions qui se protègent en interne** (`clear_message_reaction`, `set_message_reaction`, `client_can_read_section`, `client_has_resource_access`) — vérifient `auth.uid()` dans leur propre corps avant toute action. Rester exécutables par `anon` est **sans danger** : un appel anonyme a `auth.uid() = null`, échoue systématiquement la vérification interne. Ne pas les REVOKE inutilement.
- **Fonctions sans aucun contrôle interne** (`upsert_yt_ctr`, `get_shortio_clicks_by_day`/`by_url` avant fix) — le paramètre `p_profile_id` était totalement libre côté appelant. Deux façons de corriger selon l'usage réel :
  - Si appelée **uniquement server-side** (`service_role`, jamais depuis le navigateur) → `REVOKE EXECUTE FROM anon, authenticated` suffit (cas `upsert_yt_ctr`).
  - Si appelée **depuis le navigateur** (`supabase.rpc(...)` dans un composant React) → un `REVOKE` casse l'usage légitime. Il faut ajouter un check `auth.uid()` interne (cas `get_shortio_clicks_by_day`/`by_url`, appelées par `components/analytics/PageClientStats.tsx`). **Toujours grep `.rpc('nom_fonction'` dans `app/`/`components/` avant de choisir l'approche.**
- **Fonctions trigger** (`notify_push_on_message`, `notify_push_on_reaction`, `tasks_restrict_student_update`) — jamais censées être appelées en RPC direct, seulement déclenchées par le moteur Postgres sur INSERT/UPDATE. `REVOKE EXECUTE FROM anon, authenticated` est sans risque : un trigger continue de s'exécuter indépendamment des GRANT explicites sur la fonction sous-jacente (vérifié en usage réel après coup : messages/réactions continuent de notifier).

## Secrets

Le secret du webhook push (`x-webhook-secret`, comparé à `CRON_SECRET` dans `app/api/push/webhook/route.ts`) était codé en clair dans le corps SQL de `notify_push_on_message`/`notify_push_on_reaction` — visible par quiconque a un accès direct à la base (dashboard, MCP), pas via l'API publique (le corps des fonctions n'est pas exposé par PostgREST). Déplacé dans Supabase Vault (`vault.decrypted_secrets`, nom `push_webhook_secret`), lu dynamiquement dans les deux fonctions au lieu d'être en dur. **Si ce secret doit être rotaté un jour, le faire aux deux endroits** : `CRON_SECRET` (env var Vercel) et `vault.create_secret`/update en base — ils doivent rester identiques, rien ne les synchronise automatiquement.

## Middleware — le matcher ne suit pas automatiquement les nouvelles routes

`middleware.ts` protège les routes coach/élève par une liste explicite dans `config.matcher` — **ajouter une nouvelle route sous `app/(coach)/` ne la protège pas automatiquement**, il faut l'ajouter manuellement au matcher. Piège déjà rencontré une fois : le matcher listait `/resources` (anglais) alors que la vraie route s'appelle `/ressources` (français), laissant la vraie route et 5 autres (`/tasks`, `/ai`, `/metrics`, `/api-debug`, `/ig-live`) sans aucune protection serveur. `app/(coach)/layout.tsx` ne fait aucune redirection de secours (juste un state client `useUser()`), donc l'absence au matcher = shell HTML complet servi à un visiteur anonyme (les données restent protégées par RLS, mais pas la structure d'UI). **Toute nouvelle route coach doit être ajoutée au matcher dans le même commit.**

## Buckets Storage — public par défaut, à décider consciemment

Buckets restés publics volontairement (contenu déjà destiné à être visible largement) : `avatars`, `resources`, `instagram-avatars`, `instagram-post-thumbnails`. Buckets passés privés (conversations/documents privés coach-élève) : `chat-medias`, `voice-messages`, `task-attachments` — voir `docs/architecture-messagerie.md` §24 pour le détail de la migration et le piège rencontré (policy SELECT à remplacer, pas juste à supprimer).

**Pour tout nouveau bucket** : décider explicitement public/privé à la création plutôt que de laisser le défaut Supabase (souvent public). Un bucket privé nécessite une policy `SELECT` pour `authenticated` scoped par ownership (voir le pattern `task_attachments_access` / `chat-medias select own conversation`) — sans elle, ni la lecture directe ni `createSignedUrl()` ne fonctionnent pour un utilisateur non service-role.

## Table `sw_logs`

Logs techniques du service worker (`public/sw.js`, `components/PushInit.tsx`), écrits en clair depuis le navigateur avec la clé anon (normal, c'est le pattern Supabase côté client). Pas de colonne `profile_id` — impossible de scoper par utilisateur. INSERT laissé ouvert à `anon` (nécessaire, ces logs sont émis avant qu'une session authentifiée existe forcément), SELECT retiré (plus personne ne doit pouvoir lire les logs d'un autre appareil via l'API publique). Si besoin de consulter ces logs un jour, passer par le dashboard Supabase (`service_role`), pas par l'API REST.
