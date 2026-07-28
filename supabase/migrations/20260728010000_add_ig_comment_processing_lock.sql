create table if not exists ig_comment_processing_lock (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  ig_user_id text not null,
  media_id text not null,
  locked_at timestamptz not null default now(),
  unique (profile_id, ig_user_id, media_id)
);

comment on table ig_comment_processing_lock is 'Verrou applicatif pour empêcher le traitement en double d''un même commentaire Instagram quand Meta envoie 2 notifications webhook quasi simultanées pour le même événement (double delivery). Une ligne existante avec locked_at récent bloque le traitement concurrent — une nouvelle interaction (nouveau commentaire, même mot-clé) après expiration du verrou (quelques minutes) est autorisée à repasser.';
