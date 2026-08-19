-- File d'attente des événements webhook Instagram.
--
-- POURQUOI : Meta exige une réponse en moins de 30 s, et DÉSABONNE l'application
-- du webhook si les échecs durent 1 h — les DM1 s'arrêtent alors complètement,
-- avec réabonnement manuel requis. Or le webhook traitait tout en synchrone :
-- 2,15 s de moyenne mais 15,55 s au pic, mesuré avec UN SEUL compte actif.
--
-- À 30 élèves, Meta envoie les commentaires en parallèle (une requête HTTP par
-- commentaire, pas de lot) : un post viral suffit à faire dépasser les 30 s.
--
-- Le webhook écrit désormais ici en < 100 ms et répond 200 immédiatement. Meta
-- est satisfait quoi qu'il arrive ensuite. Le worker
-- app/api/cron/process-webhook-queue dépile à cadence maîtrisée.
--
-- La fenêtre de private reply est de 7 JOURS côté Meta : un pic de plusieurs
-- milliers de commentaires peut s'étaler sur des heures sans rien perdre.
CREATE TABLE IF NOT EXISTS public.webhook_queue (
  id           bigserial PRIMARY KEY,
  source       text        NOT NULL DEFAULT 'instagram',
  -- Payload brut d'UN entry Meta (le webhook éclate body.entry[] en une ligne
  -- par entry : un entry lent ne retarde pas les autres).
  payload      jsonb       NOT NULL,
  status       text        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts     int         NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Quand retenter : immédiat à la création, repoussé par backoff après échec.
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- Index partiel : le worker ne lit que les lignes réellement à traiter, jamais
-- toute la table. Reste minuscule même après des milliers d'événements traités.
CREATE INDEX IF NOT EXISTS idx_webhook_queue_pending
  ON public.webhook_queue (next_retry_at, id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_webhook_queue_processed
  ON public.webhook_queue (processed_at)
  WHERE processed_at IS NOT NULL;

-- Exposée via PostgREST : RLS activée sans policy = inaccessible par l'API.
-- Le service_role (webhook, worker) contourne RLS par conception.
ALTER TABLE public.webhook_queue ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.webhook_queue IS
  'File des événements webhook Instagram. Le webhook y écrit et répond 200 en <100ms (Meta désabonne après 1h d''échecs) ; le worker process-webhook-queue dépile.';

-- ── Réservation ATOMIQUE d'un lot ────────────────────────────────────────────
--
-- `FOR UPDATE SKIP LOCKED` est le point essentiel : deux workers qui démarrent
-- en même temps (cron qui se chevauche, relance manuelle) ne peuvent pas
-- réserver la même ligne. Sans lui, un commentaire pourrait déclencher DEUX
-- DM1 — et Meta n'autorise qu'un seul private reply par commentaire,
-- définitivement.
--
-- La lecture et le marquage 'processing' se font dans la MÊME instruction :
-- aucune fenêtre entre les deux.
CREATE OR REPLACE FUNCTION public.claim_webhook_queue(p_limit int DEFAULT 20)
RETURNS SETOF public.webhook_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.webhook_queue q
     SET status = 'processing',
         attempts = q.attempts + 1
   WHERE q.id IN (
     SELECT id FROM public.webhook_queue
      WHERE status = 'pending'
        AND next_retry_at <= now()
      ORDER BY id          -- FIFO : premier arrivé, premier servi
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
END;
$$;

COMMENT ON FUNCTION public.claim_webhook_queue IS
  'Réserve atomiquement un lot d''événements (FOR UPDATE SKIP LOCKED) — empêche deux workers de traiter le même commentaire, ce qui enverrait deux DM1.';

-- ── Purge ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_webhook_queue()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n bigint;
BEGIN
  -- 7 jours : au-delà, une ligne traitée ne sert plus à rien. Les échecs
  -- définitifs sont gardés 30 jours — ce sont eux qu'on veut pouvoir consulter.
  DELETE FROM public.webhook_queue
   WHERE status = 'done' AND processed_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM public.webhook_queue
   WHERE status = 'failed' AND processed_at < now() - interval '30 days';

  RETURN n;
END;
$$;

-- ── Crons ────────────────────────────────────────────────────────────────────
--
-- Worker : route Next.js (et non Edge Function) car le traitement vit dans le
-- code Next (lib/instagram-webhook-processor.ts), non importable côté Deno.
-- Quand la file est vide, la route sort immédiatement.
SELECT cron.unschedule('process-webhook-queue-1min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-webhook-queue-1min');

SELECT cron.schedule(
  'process-webhook-queue-1min',
  '* * * * *',
  $cron$
  SELECT net.http_get(
    url := 'https://momentum-plateforme.vercel.app/api/cron/process-webhook-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer a7dd5bede262bc5198178488367f2b2369c407d305ee175fb980356fd5ff078e'
    )
  );
  $cron$
);

SELECT cron.unschedule('purge-webhook-queue-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-webhook-queue-daily');

SELECT cron.schedule(
  'purge-webhook-queue-daily',
  '35 3 * * *',
  $cron$SELECT public.purge_webhook_queue();$cron$
);
