-- Rappels de relance à l'élève qui n'a pas encore répondu à une invitation de
-- call Google Meet (status = 'pending_acceptance'). Deux rappels distincts (24h
-- et 2h avant le call), chacun avec son propre flag pour ne jamais être envoyé
-- deux fois par le cron poll-leads.

alter table calls add column if not exists invite_reminder_24h_sent boolean not null default false;
alter table calls add column if not exists invite_reminder_2h_sent boolean not null default false;

comment on column calls.invite_reminder_24h_sent is 'Notification de rappel envoyée à l''élève 24h avant un call Google Meet encore en pending_acceptance — empêche un double envoi au passage suivant du cron.';
comment on column calls.invite_reminder_2h_sent is 'Notification de rappel envoyée à l''élève 2h avant un call Google Meet encore en pending_acceptance — empêche un double envoi au passage suivant du cron.';
