-- Le backfill `backfill_deals_from_calls` (20260818220631) a repris tous les
-- calls `deal_closed = true` sans filtrer `ignored`, alors que TOUS les écrans
-- de stats excluent les calls ignorés. Résultat : `deals` totalisait 8 700 €
-- quand `calls.revenue` en donnait 6 600 € — un écart de 2 100 € sur deux calls
-- résiduels d'un ancien soft-delete, sans lead ni paiement rattaché.
--
-- Cette divergence bloquait la migration des KPI vers `deals` : basculer les
-- écrans aurait fait apparaître 2 100 € de cash qui n'existe pas.
delete from deals d
using calls c
where c.id = d.call_id
  and c.ignored = true;

-- Garde-fou : un call ignoré ne doit plus jamais produire de deal, que ce soit
-- par un futur backfill ou par RapportModal sur un call ignoré après coup.
create or replace function public.reject_deal_on_ignored_call()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.call_id is not null
     and exists (select 1 from calls where id = new.call_id and ignored = true) then
    raise exception 'Deal refusé : le call % est ignoré et n''entre dans aucune statistique', new.call_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_deal_on_ignored_call on deals;
create trigger trg_reject_deal_on_ignored_call
  before insert or update of call_id on deals
  for each row execute function public.reject_deal_on_ignored_call();
