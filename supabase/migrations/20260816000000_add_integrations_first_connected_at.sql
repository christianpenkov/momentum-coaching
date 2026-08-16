-- first_connected_at : référence stable de la première connexion d'une intégration,
-- jamais réécrite (contrairement à connected_at qui saute à chaque reconnexion OAuth).
-- Sert à filtrer les calls Calendly générés par le pipeline Momentum : un call réservé
-- (booked_at) avant la première connexion ne peut pas venir de ce pipeline.
alter table integrations
  add column if not exists first_connected_at timestamptz;

update integrations
  set first_connected_at = connected_at
  where first_connected_at is null and connected_at is not null;
