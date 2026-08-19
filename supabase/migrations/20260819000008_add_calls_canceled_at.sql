-- Moment réel de l'annulation d'un call, et qui l'a annulé.
--
-- Jusqu'ici seul `cancellation_reason` était écrit, sans date : la timeline du
-- pipeline datait donc « Call annulé » à l'heure du RENDEZ-VOUS, faute de mieux.
-- Or Calendly expose bien ces informations dans l'objet `cancellation` de
-- scheduled_events (created_at, canceled_by, canceler_type, reason) — elles
-- n'étaient simplement pas récupérées. Vérifié sur l'API réelle.
--
-- Sans elles, impossible de dire « annulé 7 minutes avant le call » ou « annulé
-- par le prospect » : deux informations qui changent la lecture commerciale d'un
-- rendez-vous manqué.
--
-- Note : les calls annulés hors de la fenêtre Calendly (+60 jours) ne peuvent
-- plus être rattrapés — l'API ne les renvoie plus. Ils gardent canceled_at NULL,
-- et la timeline retombe alors sur l'heure du rendez-vous comme avant.
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_by text;

COMMENT ON COLUMN public.calls.canceled_at IS
  'Moment réel de l''annulation (cancellation.created_at côté Calendly). NULL sur les calls annulés avant l''ajout de la colonne.';
COMMENT ON COLUMN public.calls.canceled_by IS
  'Qui a annulé (cancellation.canceled_by côté Calendly) — le prospect ou l''hôte.';
