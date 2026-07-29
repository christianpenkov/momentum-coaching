alter table analytics_ig_posts_history add column if not exists deleted_at timestamptz;
comment on column analytics_ig_posts_history.deleted_at is 'Posé quand un post n''apparaît plus dans la réponse Instagram /media (supprimé côté Instagram) — filtre uniquement "Gérer mes liens" (deleted_at is null), ne supprime jamais l''historique de stats utilisé par les analytics/rapports passés.';
