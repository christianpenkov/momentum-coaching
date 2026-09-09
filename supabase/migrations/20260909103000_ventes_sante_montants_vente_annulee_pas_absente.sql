-- Correction de 20260830151600. La vue a envoyé sa PREMIÈRE alerte le 2026-09-09,
-- et c'était un faux positif — sur les deux seules ventes annulées que la base ait
-- jamais portées.
--
-- ── Le défaut, en une phrase ───────────────────────────────────────────────────
--
-- La condition `d.status <> 'canceled'` était posée dans le LEFT JOIN. Son auteur
-- l'a écrite pour dire « ne compare pas les montants d'une vente annulée » — le
-- commentaire d'origine (20260830123114) le dit mot pour mot :
--
--     « `status <> 'canceled'` sur le deal : une vente annulée n'a pas à concorder. »
--
-- Mais dans un LEFT JOIN, une condition qui écarte la ligne de droite ne la retire
-- pas du résultat : elle la remplace par des NULL. La vente annulée arrivait donc
-- au `where` avec `d.id is null` — c'est-à-dire sous l'exacte apparence d'une vente
-- JAMAIS CRÉÉE, le seul cas que la branche `deal_manquant` signale sans condition.
--
-- ⚠️ La leçon est générale, et elle vaut pour toute vue de santé : **exclure une
-- ligne dans un LEFT JOIN, c'est la transformer en absence.** Si l'absence est
-- justement ce que l'autre branche dénonce, l'exclusion produit l'alerte qu'elle
-- croyait éteindre. Écarter se fait dans le `where`, ou par un `not exists` ; le
-- `on` ne sert qu'à apparier.
--
-- ── Pourquoi la vue, et pas le chemin d'écriture ───────────────────────────────
--
-- Les deux calls signalés portent bien `deal_closed = true` et un `revenue`, alors
-- que leur vente est annulée et intégralement remboursée. Ce n'est PAS un oubli :
-- `app/api/payments/deals/[id]/cancel/route.ts` déclare explicitement que seul un
-- geste humain déclasse un appel — « un remboursement fait dans Stripe n'y touche
-- jamais : il dit qu'un mouvement d'argent a eu lieu, pas que la vente n'a pas eu
-- lieu ». Le rapport reste la trace de ce que l'élève a déclaré ce jour-là, et
-- `deals` reste la source du cash. Toucher à ce chemin aurait défait une décision
-- prise avec son motif.
--
-- ── Mesuré avant d'écrire (2026-09-09), sur TOUTE la base ──────────────────────
--
--   deal actif présent .............................. 2
--   deal(s) existants, TOUS annulés ................. 2   ← les 2 lignes de l'alerte
--   AUCUN deal (vrai trou) .......................... 0
--
-- La branche `deal_manquant` n'a donc jamais rien détecté de réel : sa première
-- sortie était le faux positif. Elle reste inconditionnelle pour le cas qu'elle
-- vise vraiment — un call qui n'a AUCUN deal, annulé ou non.
--
-- ⚠️ `security_invoker = true` est répété ici, et ce n'est pas décoratif :
-- `create or replace view` REMPLACE les options de la vue par celles fournies.
-- L'omettre rendrait la vue `definer`, donc lisible hors RLS — exactement ce que
-- `acces_sante_lecture` surveille. L'ACL, elle, survit (pas de `drop`).

create or replace view ventes_sante_montants
with (security_invoker = true) as
select
  c.coach_id                              as profile_id,
  c.id                                    as call_id,
  c.invitee_name,
  c.source,
  c.booked_at,
  c.revenue                               as montant_rapport,
  d.amount_total                          as montant_deal,
  case
    when d.id is null then 'deal_manquant'
    else 'montant_jamais_edite_mais_divergent'
  end                                     as anomalie
from calls c
left join deals d
  on d.call_id = c.id
 and d.status <> 'canceled'
where c.deal_closed
  and c.ignored is not true
  and c.call_type in ('calendly', 'manual')
  and c.status = 'active'
  and (
    -- Du cash déclaré qu'AUCUN deal ne porte : trou réel, toujours signalé.
    --
    -- ⚠️ « aucun deal ACTIF » n'est pas « aucun deal ». Le `not exists` est la
    -- seule chose qui distingue les deux : sans lui, toute vente annulée se
    -- présente ici comme une vente jamais créée.
    (
      d.id is null
      and not exists (
        select 1 from deals dz
        where dz.call_id = c.id and dz.status = 'canceled'
      )
    )
    -- Ou un montant qui diverge SANS qu'une édition puisse l'expliquer.
    --
    -- ⚠️ `d.id is not null` n'est pas redondant. Sans lui, cette branche s'évalue
    -- sur une ligne de droite absente : `null <= null` rend NULL, et le prédicat
    -- entier vaut NULL. Le `where` ne retient pas — donc le résultat serait juste
    -- par accident, en s'appuyant sur une comparaison qui ne veut rien dire. On
    -- écrit la condition qu'on pense : comparer deux montants suppose qu'il y en
    -- ait deux.
    or (
      d.id is not null
      and coalesce(d.amount_total, 0) <> coalesce(c.revenue, 0)
      and d.updated_at <= d.created_at + interval '1 minute'
    )
  );
