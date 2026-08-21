-- Rappels d'échéance : J-2 (préparer l'envoi) et J+2 si toujours impayé
-- (rattraper). Deux drapeaux distincts et non un compteur : chaque rappel doit
-- pouvoir partir indépendamment, et un cron qui repasse ne doit jamais
-- renvoyer celui qu'il a déjà émis.
--
-- Pas de rappel « le jour même » : entre J-2 et J+2 il n'apporte qu'une
-- répétition, et sur 20 élèves × plusieurs deals la fatigue de notification
-- ferait ignorer les alertes qui comptent vraiment (prélèvement refusé).
alter table deal_installments
  add column if not exists reminder_before_sent_at timestamptz,
  add column if not exists reminder_late_sent_at   timestamptz;

-- Le cron balaie par date d'échéance sur les lignes non payées : cet index
-- évite un scan complet quand la table grandit.
create index if not exists deal_installments_due_pending_idx
  on deal_installments (due_on)
  where status <> 'paid';
