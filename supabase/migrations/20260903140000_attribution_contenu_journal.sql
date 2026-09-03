-- Le contenu credite d'un rendez-vous vient du JOURNAL quand le lien est personnel.
--
-- Il n'existe qu'un lien Calendly par personne (`prendre-rdv-<pseudo>`), grave une fois
-- avec le contenu que portait sa fiche ce jour-la, et jamais regrave. Son `utm_content`
-- n'est donc ni le premier contenu ni le dernier : c'est l'instantane d'un champ mutable
-- pris au moment ou quelqu'un a clique « generer ». Cas mesure (rdjdkzjd) : lien grave
-- le 05/07 sur GUIDE, nouveau lead magnet le 06/07, reservation le 08/07 avec l'ancien
-- lien. GUIDE recoltait la vente.
--
-- ⚠️ La regle ne vaut QUE pour le lien personnel. Un lien en description, en bio ou dans
-- une story est PORTE par un contenu : il n'en existe qu'un par contenu, donc cliquer
-- dessus prouve qu'on regardait celui-la. 11 des 18 rendez-vous du profil de test sont
-- dans ce cas. L'etendre les casserait tous.
--
-- Detail complet : docs/audit-attribution-contenu.md.

-- ── 1. La copie figee suit la meme regle ────────────────────────────────────
--
-- Une seule ligne concernee sur huit, simulation jouee avant ecriture. Rollback dans
-- docs/sauvegardes/attribution-contenu-2026-09-03.txt.
update public.deals d
set first_touch_content_id = j.contenu
from public.calls c
left join public.prospect_links pl on pl.id = c.prospect_link_id
cross join lateral (
  select coalesce(
    case when (c.utm_medium = 'dm' or c.source = 'ig_dm') then (
      select h.media_id
      from public.instagram_lead_lm_history h
      join public.instagram_leads l
        on l.ig_user_id = h.ig_user_id and l.profile_id = h.profile_id
      where l.id = c.ig_lead_id
        and h.lead_magnet_sent is not false
        and h.detected_at <= coalesce(c.booked_at, c.scheduled_at)
      order by h.detected_at desc
      limit 1
    ) end,
    nullif(btrim(c.utm_content), ''),
    nullif(btrim(pl.content_id), '')
  ) as contenu
) j
where c.id = d.call_id
  and d.status <> 'canceled'
  and d.first_touch_content_id is distinct from j.contenu;

-- ── 2. La vue de sante apprend la nouvelle regle ────────────────────────────
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
  j.contenu                  as contenu_du_call,
  case
    when c.id is null then 'vente sans rendez-vous'
    when d.first_touch_content_id is not distinct from j.contenu then 'ok'
    else 'ALERTE : le contenu du deal ne correspond pas a celui du call'
  end                        as etat
from public.deals d
left join public.calls c           on c.id  = d.call_id
left join public.prospect_links pl on pl.id = c.prospect_link_id
left join lateral (
  select coalesce(
    case when (c.utm_medium = 'dm' or c.source = 'ig_dm') then (
      select h.media_id
      from public.instagram_lead_lm_history h
      join public.instagram_leads l
        on l.ig_user_id = h.ig_user_id and l.profile_id = h.profile_id
      where l.id = c.ig_lead_id
        and h.lead_magnet_sent is not false
        and h.detected_at <= coalesce(c.booked_at, c.scheduled_at)
      order by h.detected_at desc
      limit 1
    ) end,
    nullif(btrim(c.utm_content), ''),
    nullif(btrim(pl.content_id), '')
  ) as contenu
) j on true
where d.status <> 'canceled';

comment on view public.ventes_sante_contenu is
  'Confronte deals.first_touch_content_id (lu par les ecrans de paiement) au contenu que '
  'porte le call (lu par Business micro via contenuConversion). Une divergence signifie '
  'que le meme euro est credite a deux contenus differents selon l''ecran. '
  '⚠️ La regle est DUPLIQUEE ici depuis lib/attribution-roles.ts, et cette duplication '
  'est assumee : comparer deux implementations est la raison d''etre de cette vue. Si la '
  'regle change d''un cote, elle doit changer de l''autre — sinon la vue signale des '
  'ecarts qui n''en sont pas, ou pire, cesse d''en signaler. '
  'etat like ''ALERTE%'' pour les vraies anomalies ; ''vente sans rendez-vous'' est normal.';

-- ⚠️ CORRIGE LE 2026-09-03 : cette ligne disait `to authenticated, service_role`,
-- recopiee de la migration d'origine de la vue. Elle a REOUVERT a tout compte connecte
-- une vue que la migration 20260902200000 avait fermee la veille — et comme
-- `security_invoker` vaut false par defaut, la RLS etait contournee : les ventes et
-- montants de TOUS les coachs, lisibles par n'importe quel eleve.
--
-- Aucun lecteur legitime n'est `authenticated` : `alerte-vues` et `integrations/health`
-- utilisent SUPABASE_SERVICE_ROLE_KEY. Le verrou structurel et sa surveillance sont
-- dans 20260903170000_verrou_structurel_lecture_public.sql.
grant select on public.ventes_sante_contenu to service_role;
