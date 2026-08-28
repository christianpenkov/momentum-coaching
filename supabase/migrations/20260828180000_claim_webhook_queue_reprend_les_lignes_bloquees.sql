-- Reprise des lignes bloquees en 'processing'.
--
-- `claim_webhook_queue` ne reservait que les lignes 'pending'. Une ligne passee
-- en 'processing' par un worker qui meurt ensuite — timeout Vercel, crash,
-- connexion coupee — n'etait donc PLUS JAMAIS reprise : ni par le cron, ni par
-- un reessai, et sans qu'aucune trace ne le signale. Le commentaire etait perdu
-- definitivement, en silence. Meta n'autorisant qu'UNE reponse privee par
-- commentaire, la perte est irrattrapable.
--
-- Ce trou existait deja ; il devient plus probable maintenant que le webhook
-- reveille le worker, donc qu'il peut y avoir des invocations interrompues.
--
-- Mesure de l'anciennete : `next_retry_at` est desormais pose a `now()` AU
-- MOMENT DE LA RESERVATION. Sans ca, il valait la date de creation et ne disait
-- pas depuis quand la ligne etait tenue. Ce champ n'est lu que par cette
-- fonction, et le worker le reecrit lui-meme quand il programme un backoff :
-- l'ecraser ici ne change rien au reste du flux.
--
-- Choix des 5 minutes : le worker s'arrete de lui-meme a 45 s (TIME_BUDGET_MS)
-- et Vercel le coupe a 60 s (maxDuration). Une ligne encore 'processing' apres
-- 5 minutes n'est donc tenue par aucun worker vivant, et la reprendre ne peut
-- pas provoquer de double traitement. La marge est volontairement large : un
-- double DM1 serait pire qu'un retard.
--
-- Plafond de reprises : `attempts` est incremente a chaque reservation. Sans le
-- garde `attempts < 5`, une ligne qui fait mourir le worker a tous les coups
-- serait reprise indefiniment toutes les 5 minutes — le worker ne peut la
-- marquer 'failed' que s'il survit assez longtemps pour attraper l'erreur. La
-- valeur reprend MAX_ATTEMPTS de app/api/cron/process-webhook-queue/route.ts.
--
-- FOR UPDATE SKIP LOCKED est conserve : c'est lui qui garantit que deux workers
-- simultanes ne reservent jamais la meme ligne, y compris quand le webhook les
-- reveille en rafale.

create or replace function public.claim_webhook_queue(p_limit integer default 20)
returns setof public.webhook_queue
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return query
  update public.webhook_queue q
     set status = 'processing',
         attempts = q.attempts + 1,
         next_retry_at = now()
   where q.id in (
     select id from public.webhook_queue
      where (
              (status = 'pending' and next_retry_at <= now())
              or (
                   -- Ligne orpheline : reservee par un worker qui n'a jamais
                   -- rendu son verdict.
                   status = 'processing'
                   and next_retry_at <= now() - interval '5 minutes'
                   and attempts < 5
                 )
            )
      order by id          -- FIFO : premier arrive, premier servi
      limit p_limit
      for update skip locked
   )
  returning q.*;
end;
$function$;
