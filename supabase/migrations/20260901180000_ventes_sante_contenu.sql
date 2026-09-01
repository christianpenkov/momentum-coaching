-- Vue de santé : le contenu figé sur un deal dit-il la même chose que son call ?
--
-- POURQUOI ELLE EXISTE
--
-- `deals.first_touch_content_id` est une COPIE, écrite à la création du deal, du contenu
-- que porte le call. Deux lecteurs s'en servent aujourd'hui, et ils ne lisent pas la
-- même chose :
--
--   * les écrans de PAIEMENT (`payments/by-origin`, `payments/chain`,
--     `payments/deals/[id]/amount` et `/terms`) lisent la COLONNE ;
--   * Business micro attribue en repassant par le CALL, via `contenuConversion()`
--     (`lib/attribution-roles.ts`), qui lit `utm_content` puis se rabat sur
--     `prospect_links.content_id`.
--
-- Tant que les deux concordent, personne ne voit rien. Le jour où ils divergent, la
-- plateforme se coupe en deux : le même euro est crédité à deux contenus différents
-- selon l'écran, et rien ne le signale. C'est exactement le mécanisme d'`instagram_leads`
-- — une copie que personne ne confronte à sa source finit par mentir.
--
-- Cette vue confronte les deux. Elle ne corrige rien : elle rend visible.
-- Même geste que `ventes_sante_montants`, qui compare les DEUX écritures du cash.
--
-- ⚠️ `etat <> 'ok'` n'est PAS un filtre d'anomalie, comme sur toutes les vues de santé
-- du projet. `vente sans rendez-vous` est un état parfaitement normal : un upsell n'a
-- aucun call, donc aucun contenu à créditer, et il est exclu de Business micro pour
-- cette raison. Chercher les vraies anomalies avec `etat like 'ALERTE%'`.
--
-- ⚠️ La règle de repli est DUPLIQUÉE ici depuis `contenuConversion()`. Si ce repli change
-- côté TypeScript, il doit changer ici — sinon la vue signalera des écarts qui n'en sont
-- pas, ou pire, cessera d'en signaler. Même avertissement que la copie SQL de
-- `isValidContentId` dans `utm_anomalies`.

create or replace view public.ventes_sante_contenu as
select
  d.id                       as deal_id,
  d.profile_id,
  d.amount_total,
  d.status,
  c.id                       as call_id,
  c.source                   as call_source,
  c.invitee_name,
  d.first_touch_content_id   as contenu_du_deal,
  -- `contenuConversion()` en SQL : `utm_content`, sinon le contenu du lien prospect.
  -- Une chaîne d'espaces ne vaut pas un contenu, d'où le `nullif(btrim(...), '')`.
  coalesce(
    nullif(btrim(c.utm_content), ''),
    nullif(btrim(pl.content_id), '')
  )                          as contenu_du_call,
  case
    -- Un upsell n'a pas de rendez-vous, donc rien à confronter. État normal.
    when c.id is null
      then 'vente sans rendez-vous'
    -- `is not distinct from` et non `=` : deux `null` doivent concorder. C'est le cas
    -- d'un call de BIO, qui ne vient d'aucun contenu par nature — les deux côtés sont
    -- vides, et c'est juste.
    when d.first_touch_content_id is not distinct from coalesce(
           nullif(btrim(c.utm_content), ''),
           nullif(btrim(pl.content_id), '')
         )
      then 'ok'
    else 'ALERTE : le contenu du deal ne correspond pas a celui du call'
  end                        as etat
from public.deals d
left join public.calls c          on c.id  = d.call_id
left join public.prospect_links pl on pl.id = c.prospect_link_id
where d.status <> 'canceled';

comment on view public.ventes_sante_contenu is
  'Confronte deals.first_touch_content_id (lu par les ecrans de paiement) au contenu que porte le call (lu par Business micro via contenuConversion). Une divergence signifie que le meme euro est credite a deux contenus differents selon l''ecran. etat like ''ALERTE%'' pour les vraies anomalies : ''vente sans rendez-vous'' est normal (upsell).';
