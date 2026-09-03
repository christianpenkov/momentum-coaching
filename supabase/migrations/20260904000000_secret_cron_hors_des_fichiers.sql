-- Le secret des crons sort des fichiers de migration, et de cron.job
--
-- ⚠️ POURQUOI — l'incident du 2026-09-04
--
-- Le dépôt est PUBLIC. Deux migrations d'août portaient le `CRON_SECRET` en clair,
-- parce qu'elles inscrivaient un job pg_cron avec son en-tête `Authorization` écrit
-- littéralement dans la commande :
--
--   supabase/migrations/20260819000007_dm2_fields_and_dm3_delay.sql
--   supabase/migrations/20260819000009_webhook_queue.sql
--
-- Vérifié par la conséquence : les deux fichiers se récupéraient sans aucune
-- authentification, en HTTP 200, sur l'hébergeur du dépôt.
--
-- Or ce secret est l'UNIQUE rempart de 11 Edge Functions (toutes déployées en
-- `verify_jwt: false`) et de 21 routes Vercel, dont `/api/push/webhook`. Personne
-- n'avait écrit un secret dans un fichier de secrets : il a fui par du SQL, que
-- personne ne range dans cette catégorie. C'est pour ça que la vérification
-- habituelle (« les fichiers .env sont-ils ignorés ? ») était verte et sans rapport
-- avec la question.
--
-- ⚠️ Cette migration NE TOURNE PAS le secret — la valeur publiée reste valable tant
-- qu'elle n'a pas été remplacée aux sept endroits où elle vit (voir
-- docs/transfert-de-compte.md §5 bis). Elle ferme la CAUSE : à partir d'ici, aucun
-- fichier de migration et aucune commande de `cron.job` ne peut plus contenir le
-- secret, donc la fuite ne peut pas se reproduire.
--
-- ── Le choix : une fonction, pas une URL en paramètre ────────────────────────────
--
-- Une fonction `declencher_cron(url text)` aurait été plus souple et bien pire :
-- `SECURITY DEFINER`, elle attache le secret à l'URL qu'on lui donne. Grantée par
-- défaut à `anon` (comportement Supabase, voir docs/security-notes.md), elle aurait
-- permis à n'importe qui de se faire envoyer le secret sur son propre serveur — on
-- aurait remplacé une fuite passive par une fuite active.
--
-- Elle prend donc un NOM, et résout l'URL dans une liste fermée écrite ici. Même
-- exécutée par un appelant hostile, elle ne peut appeler que nos propres endpoints.
-- Le `revoke` ci-dessous reste posé par-dessus : les deux, pas l'un ou l'autre.
--
-- ⚠️ Le nom du secret dans le Vault reste `push_webhook_secret`, et ce nom
-- sous-décrit ce qu'il contient : c'est LA valeur partagée par les crons ET par le
-- webhook push, pas seulement par le second. Il n'est pas renommé ici parce que
-- `notify_push_on_message` et `notify_push_on_reaction` le lisent, et qu'on ne
-- touche pas à la chaîne des notifications dans la migration qui répare autre chose.
-- À renommer le jour de la rotation, où l'on touche déjà à tout.

create or replace function public.declencher_cron(p_nom text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret  text;
  v_url     text;
  v_methode text;
  v_id      bigint;
begin
  -- Liste fermée. Un nom inconnu échoue bruyamment plutôt que d'appeler quoi que ce soit.
  case p_nom
    when 'call-reminders' then
      v_url := 'https://nvjgwtetyuatnkjihmtw.supabase.co/functions/v1/call-reminders';
      v_methode := 'POST';
    when 'send-pending-dm3' then
      v_url := 'https://nvjgwtetyuatnkjihmtw.supabase.co/functions/v1/send-pending-dm3';
      v_methode := 'POST';
    when 'process-webhook-queue' then
      -- ⚠️ Route VERCEL, pas Edge Function, et en GET. Les deux ne se devinent pas.
      v_url := 'https://momentum-plateforme.vercel.app/api/cron/process-webhook-queue';
      v_methode := 'GET';
    else
      raise exception 'declencher_cron : nom inconnu « % »', p_nom;
  end case;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'push_webhook_secret';

  -- Échouer, jamais appeler sans en-tête : un appel sans jeton recevrait un 401 que
  -- personne ne lit, et le cron mourrait en silence. Ici l'échec est journalisé par
  -- pg_cron dans cron.job_run_details, et `crons_passages` cesse d'avancer.
  if v_secret is null or v_secret = '' then
    raise exception 'declencher_cron : secret « push_webhook_secret » absent du Vault';
  end if;

  if v_methode = 'GET' then
    select net.http_get(
      url := v_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret)
    ) into v_id;
  else
    select net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := '{}'::jsonb
    ) into v_id;
  end if;

  return v_id;
end;
$$;

comment on function public.declencher_cron(text) is
  'Appelle un endpoint interne avec le secret des crons lu dans le Vault. Liste d''URL fermée : le secret ne peut partir que vers nos propres endpoints. Réservée à postgres — voir la migration 20260904000000.';

-- ⚠️ Supabase grante EXECUTE à anon/authenticated par défaut sur toute nouvelle
-- fonction du schéma public (docs/security-notes.md). Sans ce revoke, n'importe qui
-- pourrait déclencher les crons depuis l'API REST publique.
revoke execute on function public.declencher_cron(text) from public, anon, authenticated;

-- Les trois jobs ne portent plus aucun secret : ils portent un nom.
select cron.schedule('call-reminders-15min',       '*/15 * * * *', $job$select public.declencher_cron('call-reminders');$job$);
select cron.schedule('send-pending-dm3-1min',      '* * * * *',    $job$select public.declencher_cron('send-pending-dm3');$job$);
select cron.schedule('process-webhook-queue-1min', '* * * * *',    $job$select public.declencher_cron('process-webhook-queue');$job$);
