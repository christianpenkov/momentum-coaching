-- `step_index` compte désormais les questions RÉPONDUES, pas le rang de l'étape
-- courante.
--
-- POURQUOI : la carte affichait « Commencé · étape 2/2 » alors qu'il restait une
-- question à répondre — on croyait le rapport terminé. Compter les réponses données
-- donne « 1/2 » à ce moment-là, ce qui dit la vérité.
--
-- Conséquence : zéro devient une valeur légitime. Un brouillon peut exister avant
-- qu'une seule question ait été validée, dès qu'un champ libre est saisi (montant,
-- commentaire, notes).

alter table public.call_rapport_drafts
  drop constraint if exists call_rapport_drafts_step_index_check;

alter table public.call_rapport_drafts
  add constraint call_rapport_drafts_step_index_check check (step_index >= 0);

alter table public.call_rapport_drafts
  alter column step_index set default 0;

comment on column public.call_rapport_drafts.step_index is
  'Nombre de questions RÉPONDUES (pas le rang de l''étape courante), pré-calculé par le client. Sert au libellé "Commencé · étape N/M" des cartes sans lire le payload. 0 = brouillon commencé mais aucune question validée.';
