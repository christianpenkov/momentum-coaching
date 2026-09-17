-- « L'historique de ce fil a été importé » devient un FAIT écrit, plus une déduction.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ LE DÉFAUT (mesuré le 2026-09-17)                                          │
-- │                                                                           │
-- │ La reprise d'historique sautait tout fil qui EXISTAIT déjà dans           │
-- │ `ig_conversations`, en supposant qu'il avait été importé. Mais un fil     │
-- │ naît aussi du webhook, au premier message reçu ou envoyé en direct — et   │
-- │ ce premier message précède toujours la fiche lead (un Cold DM crée le     │
-- │ fil par l'envoi, puis la fiche). Résultat : tout fil devenu lead après    │
-- │ coup ne recevait JAMAIS son historique.                                   │
-- │                                                                           │
-- │ Constaté sur 31 fils du compte coach : reprise relancée, « 31 fils        │
-- │ traités », zéro message importé. @gaelcreates n'affichait que le message  │
-- │ du jour, pas les sept échangés depuis mai.                                │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ⚠️ Ce n'est PAS un drapeau de visibilité — la règle porteuse du chantier (« la
--    visibilité d'un fil n'est jamais stockée ») n'est pas touchée. C'est l'état
--    d'un TRAITEMENT, comme `ig_backfill_etat.termine_le`.
--
-- ⚠️ Posé uniquement quand l'import d'un fil est allé jusqu'à la DERNIÈRE page.
--    Un import coupé par le budget de temps laisse la colonne vide, et le
--    passage suivant le reprend.
--
-- ⚠️ Aucune valeur initiale, volontairement : tous les fils existants seront
--    réimportés une fois. C'est sans risque — l'écriture absorbe les doublons par
--    (profile_id, mid_hash) — et c'est précisément ce qui répare les fils déjà
--    touchés.

alter table public.ig_conversations
  add column if not exists historique_importe_le timestamptz;

comment on column public.ig_conversations.historique_importe_le is
  'Quand la reprise d''historique a importe ce fil JUSQU''A SA DERNIERE PAGE. Null = jamais importe, meme si le fil existe (il a pu naitre d''un message recu en direct). Etat d''un traitement, pas une regle de visibilite.';
