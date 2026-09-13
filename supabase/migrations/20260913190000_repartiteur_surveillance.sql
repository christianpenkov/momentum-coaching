-- Le répartiteur de la surveillance entre dans pg_cron
--
-- ── Pourquoi pg_cron, et pas cron-job.org ─────────────────────────────────────────
--
-- Jusqu'au 2026-09-13, toutes les alertes partaient de `poll-leads` (cron-job.org). Si ce
-- cron mourait, la vue qui détecte sa mort n'était plus lue par personne. Le répartiteur
-- (`/api/sante/dispatch`) doit donc dépendre d'un planificateur DIFFÉRENT de ceux qu'il
-- surveille le plus : pg_cron, dans la base, sans compte tiers et sans secret dans le
-- dépôt (le secret est lu dans le Vault par `declencher_cron`).
--
-- Et si pg_cron lui-même s'arrête, ou la base, ou Vercel ? C'est le rôle du battement
-- externe (healthchecks.io, `HEALTHCHECK_PING_URL`) : le répartiteur ne l'envoie qu'après
-- un passage complet réussi, et c'est healthchecks.io qui prévient s'il cesse.
--
-- ── Pourquoi toutes les 5 minutes ──────────────────────────────────────────────────
--
-- C'est le délai maximal entre un incident critique et son e-mail. Coût mesuré sur le
-- budget d'egress (AGENTS.md, compté au NOMBRE de requêtes) : un passage sans incident
-- fait 3 requêtes (filigrane, lecture des deux passages horaire/quotidien, lecture des
-- incidents) — ~860 par jour, sur un budget de ~120 000.

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
    when 'sante-dispatch' then
      -- Route VERCEL, en GET. ⚠️ Même domaine que ci-dessus : le jour d'un changement de
      -- domaine ou de nom de projet Vercel, les DEUX lignes changent (docs/click-id.md,
      -- « La procédure complète, le jour où l'origine change »).
      v_url := 'https://momentum-plateforme.vercel.app/api/sante/dispatch';
      v_methode := 'GET';
    else
      raise exception 'declencher_cron : nom inconnu « % »', p_nom;
  end case;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'push_webhook_secret';

  -- Échouer, jamais appeler sans en-tête : un appel sans jeton recevrait un 401 que
  -- personne ne lit, et le cron mourrait en silence. Ici l'échec est journalisé par
  -- pg_cron dans cron.job_run_details — que `pgcron_sante` lit désormais.
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

-- `create or replace` avec la même signature conserve l'ACL, mais on ne s'en remet pas à
-- cette propriété : le revoke est reposé (docs/sante-plateforme.md, « Un revoke ne se
-- maintient pas »).
revoke execute on function public.declencher_cron(text) from public, anon, authenticated;

-- ── Inscrire AVANT le premier passage ──────────────────────────────────────────────
--
-- Leçon de `cron-refresh-tokens` (docs/crons.md) : une ligne absente de `crons_passages`
-- est invisible pour `crons_sante`, et un `silence_max` par défaut (2 jours) est absurde
-- pour un passage aux 5 minutes. Les trois lignes sont posées ici, avec leur cadence
-- NOMINALE et un seuil d'environ quatre cadences.
--
--   sante-dispatch   toutes les 5 min  → silence au-delà d'1 h
--   sante-horaire    toutes les heures → silence au-delà de 4 h
--   sante-quotidien  une fois par jour → silence au-delà de 30 h (8 h Paris + marge)
--
-- ⚠️ `sante-dispatch` silencieux ne peut PAS être signalé par e-mail : c'est lui qui
-- envoie. La ligne sert au diagnostic ; l'alerte, c'est healthchecks.io.
insert into public.crons_passages (nom, dernier_passage, silence_max, cadence_attendue)
values
  ('sante-dispatch',  now(), interval '1 hour',   interval '5 minutes'),
  ('sante-horaire',   now() - interval '2 hours', interval '4 hours',  interval '1 hour'),
  ('sante-quotidien', now() - interval '1 day',   interval '30 hours', interval '1 day')
on conflict (nom) do update
  set silence_max = excluded.silence_max,
      cadence_attendue = excluded.cadence_attendue;

select cron.schedule('sante-dispatch-5min', '*/5 * * * *', $job$select public.declencher_cron('sante-dispatch');$job$);
