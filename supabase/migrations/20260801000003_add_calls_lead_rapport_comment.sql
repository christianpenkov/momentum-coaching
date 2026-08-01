-- Commentaire facultatif et strictement personnel sur le rapport de call lead
-- (RapportModal.tsx — show up/no-show, qualifié, closé, montant). Distinct de
-- calls.notes (champ générique existant, affiché à la fois côté élève et côté
-- coach, mais jamais écrit par aucune route API aujourd'hui) : ce nouveau champ
-- n'est écrit et affiché QUE par la personne qui remplit le rapport (élève pour
-- l'instant, le tracking pipeline coach n'existe pas encore) — jamais montré à
-- l'autre partie.

alter table calls add column if not exists lead_rapport_comment text;

comment on column calls.lead_rapport_comment is 'Commentaire facultatif et privé sur le rapport de call lead (RapportModal), visible uniquement par l''auteur du rapport — distinct de calls.notes (champ générique legacy, non utilisé).';
