-- Une vente ne peut plus etre rattachee au rendez-vous d'un AUTRE eleve
--
-- ── Ce qui a ete constate le 2026-09-07 ────────────────────────────────────────────
--
-- CINQ ventes sur huit pointaient, par `deals.call_id`, vers un rendez-vous appartenant
-- a un autre eleve : les ventes etaient a Christian, les rendez-vous a Rdjdkz.
--
-- ── La source, dans le code ────────────────────────────────────────────────────────
--
-- `app/api/payments/links/route.ts` verifiait DEJA l'appartenance :
--
--     .eq('id', body.callId).eq('coach_id', profileId)
--
-- mais l'echec de cette verification n'avait aucune consequence : le `if (call)`
-- n'entourait que le calcul de la date, et l'insertion ecrivait `call_id: body.callId`
-- quoi qu'il arrive. Le code controlait l'appartenance, puis ecrivait quand meme le
-- rattachement non verifie. Corrige le meme jour : la route refuse desormais en 400.
--
-- ── Pourquoi une garde EN BASE en plus du correctif ────────────────────────────────
--
-- Parce que `links/route.ts` n'est pas le seul chemin possible : un script, une reprise
-- de donnees, une future route, ou une correction faite a la main peuvent ecrire dans
-- `deals`. Une regle qui ne vit que dans une route est une regle qu'un autre chemin
-- ignore — c'est exactement ce que ce depot a paye plusieurs fois cette semaine.
--
-- ── Pourquoi un trigger et pas une cle etrangere composite ─────────────────────────
--
-- La forme declarative naturelle serait
--   `foreign key (call_id, profile_id) references calls(id, coach_id)`.
-- Elle est ecartee pour une raison precise : `deals_call_id_fkey` existe deja avec
-- `on delete set null`. A la suppression d'un rendez-vous, les deux contraintes se
-- disputeraient la meme ligne — l'une voulant vider `call_id`, l'autre refusant l'etat
-- intermediaire. Un trigger `before insert or update` ne regarde que les ECRITURES et
-- laisse les suppressions au comportement deja en place.
--
-- ── Ce que le trigger ne fait PAS ──────────────────────────────────────────────────
--
-- Il ne touche pas aux lignes existantes : les cinq ventes deja mal rattachees restent
-- en l'etat jusqu'a une decision explicite (elles sont visibles dans
-- `ventes_sante_rattachement`, plus bas). Un trigger qui casserait au premier `update`
-- d'une ligne ancienne rendrait la base inutilisable sur des donnees qu'on n'a pas
-- encore choisi de corriger.
--
-- D'ou la condition `is distinct from` sur l'ANCIENNE valeur : une mise a jour qui ne
-- touche pas au rattachement passe, meme sur une ligne deja fausse. Seule une ecriture
-- qui POSE un rattachement est verifiee.

create or replace function public.verifier_vente_rattachee_au_bon_rdv()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  proprietaire uuid;
begin
  -- Rien a verifier : pas de rendez-vous rattache.
  if new.call_id is null then
    return new;
  end if;

  -- Sur un UPDATE qui ne touche pas au rattachement, on laisse passer — voir l'en-tete.
  if tg_op = 'UPDATE'
     and old.call_id is not distinct from new.call_id
     and old.profile_id is not distinct from new.profile_id then
    return new;
  end if;

  select c.coach_id into proprietaire from calls c where c.id = new.call_id;

  -- `calls.coach_id` porte le profile_id de l'ELEVE, pas du coach humain
  -- (docs/calls-coach-id-piege.md). C'est bien a `deals.profile_id` qu'il se compare.
  if proprietaire is distinct from new.profile_id then
    raise exception
      'Vente rattachee au rendez-vous d''un autre eleve : deals.profile_id=% mais calls.coach_id=% (call_id=%)',
      new.profile_id, proprietaire, new.call_id
      using hint = 'Le rendez-vous doit appartenir a l''eleve auquel la vente est rattachee. Voir app/api/payments/links/route.ts.';
  end if;

  return new;
end $$;

comment on function public.verifier_vente_rattachee_au_bon_rdv() is
  'Refuse une vente dont le rendez-vous appartient a un autre eleve. Ne verifie que les ecritures qui POSENT un rattachement — les lignes anciennes deja fausses restent modifiables. Voir ventes_sante_rattachement pour les recenser.';

drop trigger if exists deals_rdv_du_bon_eleve on public.deals;
create trigger deals_rdv_du_bon_eleve
  before insert or update on public.deals
  for each row execute function public.verifier_vente_rattachee_au_bon_rdv();

-- ── La surveillance qui NOMME la bonne cause ───────────────────────────────────────
--
-- `ventes_sante_date` voyait deja ces cinq ventes, mais sous l'etiquette « date de vente
-- hors rendez-vous » : le SYMPTOME, pas la cause. Sans rendez-vous resolu, la route
-- retombait sur l'instant de saisie, d'ou une date qui ne tombait sur aucun rendez-vous.
--
-- Une alerte qui designe la mauvaise cause coute plus cher qu'une alerte absente : elle
-- envoie corriger des dates alors qu'il faut corriger un rattachement.
create or replace view public.ventes_sante_rattachement as
select
  d.id                        as deal_id,
  d.profile_id,
  d.buyer_name,
  d.amount_total,
  d.signed_at,
  d.call_id,
  c.coach_id                  as rdv_appartient_a,
  'ALERTE vente rattachee au rendez-vous d''un autre eleve'::text as etat
from deals d
join calls c on c.id = d.call_id
where d.status is distinct from 'canceled'
  and c.coach_id is distinct from d.profile_id;

comment on view public.ventes_sante_rattachement is
  'Ventes dont `call_id` pointe vers un rendez-vous appartenant a un AUTRE eleve. Doit rendre ZERO ligne. Depuis le 2026-09-07 un trigger empeche d''en creer de nouvelles ; cette vue ne peut donc plus signaler que des lignes ANTERIEURES a cette date, ou une garde retiree. Ne pas confondre avec ventes_sante_date, qui voyait le symptome (date hors rendez-vous) et nommait la mauvaise cause.';

alter view public.ventes_sante_rattachement set (security_invoker = true);
revoke select on public.ventes_sante_rattachement from anon, authenticated;

-- ── Controle : le trigger doit REFUSER, pas seulement exister ──────────────────────
--
-- Un trigger pose et jamais eprouve est une garde qu'on croit avoir. On tente donc une
-- ecriture fautive, dans une transaction qui echouera de toute facon, et on exige
-- qu'elle soit rejetee.
do $$
declare
  un_deal   uuid;
  un_call   uuid;
  refuse    boolean := false;
begin
  select d.id into un_deal from deals d where d.call_id is null limit 1;
  select c.id into un_call from calls c
    where c.coach_id is distinct from (select profile_id from deals where id = un_deal) limit 1;

  if un_deal is null or un_call is null then
    raise notice 'Temoin non joue : aucun couple (vente sans rdv, rdv d''un autre) disponible.';
    return;
  end if;

  begin
    update deals set call_id = un_call where id = un_deal;
  exception when others then
    refuse := true;
  end;

  if not refuse then
    raise exception 'Le trigger deals_rdv_du_bon_eleve n''a PAS refuse un rattachement fautif';
  end if;
  raise notice 'Temoin positif : le trigger a bien refuse un rattachement fautif.';
end $$;
