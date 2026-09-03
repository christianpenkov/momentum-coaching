-- Deux index STRICTEMENT identiques sur deal_installments (advisor duplicate_index,
-- relevé au peigne fin du 2026-09-04) : même colonne, même prédicat partiel. Chaque
-- écriture d'échéance payait deux mises à jour d'index pour un seul service rendu.
-- On garde le nom le plus descriptif (due_pending_idx).
drop index if exists public.deal_installments_due_idx;
