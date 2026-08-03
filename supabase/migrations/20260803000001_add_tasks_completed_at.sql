-- Timestamp fiable de complétion d'une tâche, distinct de updated_at (qui est
-- réécrit par n'importe quel champ modifié — deadline, priority, label — pas
-- seulement le passage de done à true, et n'est même pas garanti écrit sur
-- tous les call sites d'update actuels). Rempli explicitement uniquement
-- quand done passe de false à true, remis à null si repassé à false — sert à
-- calculer "tâche complétée à temps vs en retard" (comparaison à deadline).

alter table tasks add column if not exists completed_at timestamptz;

comment on column tasks.completed_at is 'Horodatage du passage de done à true, remis à null si redéfini à false — distinct de updated_at, non fiable pour cet usage.';
