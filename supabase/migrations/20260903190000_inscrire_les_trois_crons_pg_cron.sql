-- Les trois crons pg_cron qui declenchent un appel HTTP entrent dans la surveillance.
--
-- ── Pourquoi ils manquaient ────────────────────────────────────────────────
-- Ils sont declenches par `net.http_post`, qui est ASYNCHRONE : il met la requete en
-- file et rend son identifiant immediatement. `cron.job_run_details` enregistre donc
-- le succes de l'INSTRUCTION SQL, jamais celui de l'appel HTTP.
--
-- Mesure du 2026-09-03, avant correction :
--   call-reminders-15min          724 passages, 100 % succeeded, message « 1 row »
--   send-pending-dm3-1min      10 858 passages, 100 % succeeded, message « 1 row »
--   process-webhook-queue-1min 10 858 passages, 100 % succeeded, message « 1 row »
--
-- « 1 row » est la valeur de retour de net.http_post. Si la cible etait supprimee,
-- repondait 500, ou si son secret ne correspondait plus, ces lignes diraient
-- EXACTEMENT la meme chose. Leur silence etait donc indetectable.
--
-- `net._http_response` porte les vrais codes HTTP mais pg_net la purge : 5 h 58
-- d'historique au moment de la mesure. Bonne pour corroborer une enquete a chaud,
-- inutilisable pour une alerte quotidienne.
--
-- ── Pourquoi INSCRIRE avant de deployer ────────────────────────────────────
-- `marquer_passage_cron` fait un upsert : au premier passage elle creerait la ligne
-- avec le `silence_max` PAR DEFAUT de 2 jours — absurde pour un cron a la minute, et
-- surtout une surveillance qui ne signalerait rien pendant deux jours. Le piege s'est
-- deja produit sur `cron-refresh-tokens` : instrumente mais jamais inscrit, donc pas
-- surveille.
--
-- ── Le seuil ───────────────────────────────────────────────────────────────
-- Regle du projet : environ quatre cadences, jamais moins de deux heures. Les trois
-- tombent donc sur le plancher. Un planificateur saute un passage de temps en temps,
-- et une alerte qui crie pour un passage manque est une alerte qu'on apprend a
-- ignorer.
--
-- `dernier_passage` a maintenant : le code instrumente part dans la foulee, et ces
-- crons tournent a la minute ou au quart d'heure. Si le deploiement echouait, l'alerte
-- partirait dans deux heures — c'est le comportement voulu.
--
-- ── Verifie par un passage REEL, pas par un raisonnement ───────────────────
-- Le 2026-09-03 a 17:00 UTC, les trois se sont marques seuls :
--   call-reminders        17:00:02  empreinte 47afa99fe15efa29
--   send-pending-dm3      17:00:00  empreinte 7c0268bf583fc300
--   process-webhook-queue 17:00:00  pas d'empreinte — route Vercel, par conception :
--     elle part avec `git push` et ne peut donc pas etre plus vieille que le depot.
--     La passer en Edge Function lui CREERAIT le probleme qu'elle n'a pas.
--
-- Temoin positif, dans la foulee : filigrane de call-reminders recule de 5 heures ->
-- `crons_sante` a bien dit SILENCIEUX, puis `ok` apres restauration. Une vue qui ne
-- montre rien n'a rien prouve.

insert into public.crons_passages (nom, dernier_passage, silence_max)
values
  ('call-reminders',        now(), interval '2 hours'),
  ('send-pending-dm3',      now(), interval '2 hours'),
  ('process-webhook-queue', now(), interval '2 hours')
on conflict (nom) do update set silence_max = excluded.silence_max;
