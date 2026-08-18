-- Index manquants sur les colonnes filtrées en permanence.
--
-- Constat (advisors Supabase, 2026-08-18) : 27 foreign keys sans index couvrant.
-- Le cas le plus grave : `messages` n'avait QUE sa clé primaire, alors que
-- `client_id` est filtré à CHAQUE ouverture de conversation
-- (PageChat.tsx:1098, PageClientMessages.tsx:1242).
--
-- Invisible aujourd'hui (324 messages -> seq scan instantané), mais à 30-40 élèves
-- sur 12 mois `messages` dépasse 100 000 lignes et chaque ouverture de conversation
-- déclenche un scan complet de la table.
--
-- Additif et réversible : aucune donnée touchée, aucun changement de schéma logique.
-- CONCURRENTLY est volontairement omis : les tables sont petites aujourd'hui, et
-- CONCURRENTLY ne peut pas tourner dans le bloc transactionnel d'une migration.

-- messages : client_id filtré à chaque ouverture de conversation, trié par created_at.
-- Index composite pour couvrir le tri en plus du filtre.
CREATE INDEX IF NOT EXISTS idx_messages_client_created
  ON public.messages (client_id, created_at);

-- messages : compteurs de non-lus (useUnreadMessagesCount, useUnreadCountsByClient)
-- filtrent sur client_id + read_at IS NULL. Index partiel = plus petit et plus rapide.
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON public.messages (client_id)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_sender
  ON public.messages (sender_id);

CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON public.messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- calls : coach_id et client_id filtrés dans SupabaseClientsContext (4 requêtes)
-- et dans sync-calendly. Composite avec scheduled_at DESC pour couvrir le tri.
CREATE INDEX IF NOT EXISTS idx_calls_coach_scheduled
  ON public.calls (coach_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_client_scheduled
  ON public.calls (client_id, scheduled_at DESC);

-- clients : coach_id filtré au chargement du contexte coach et de GlobalPresenceContext.
CREATE INDEX IF NOT EXISTS idx_clients_coach
  ON public.clients (coach_id);

CREATE INDEX IF NOT EXISTS idx_clients_profile
  ON public.clients (profile_id);

-- tasks : client_id filtré dans le contexte coach (.in(ids)).
CREATE INDEX IF NOT EXISTS idx_tasks_client
  ON public.tasks (client_id);

CREATE INDEX IF NOT EXISTS idx_tasks_created_by
  ON public.tasks (created_by);

-- session_reports : PAS d'index ajouté ici. `idx_session_reports_client_id`
-- (client_id, created_at DESC) existe déjà et couvre les requêtes filtrant sur
-- client_id seul — un index composite sert aussi son préfixe.

-- call_responses : FK sans index, jointes depuis les calls.
CREATE INDEX IF NOT EXISTS idx_call_responses_call
  ON public.call_responses (call_id);

-- resource_access : client_id filtré à l'affichage des ressources.
CREATE INDEX IF NOT EXISTS idx_resource_access_client
  ON public.resource_access (client_id);

-- client_notifications : call_id joint depuis les rappels de call.
CREATE INDEX IF NOT EXISTS idx_client_notifications_call
  ON public.client_notifications (call_id)
  WHERE call_id IS NOT NULL;

-- Index dupliqués signalés par les advisors : deux paires strictement identiques.
-- On garde le nom `idx_analytics_*` (convention majoritaire dans le schéma).
DROP INDEX IF EXISTS public.idx_ig_posts_history_profile_date;
DROP INDEX IF EXISTS public.idx_yt_videos_history_profile_date;
