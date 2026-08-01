-- Étend le statut "pas un prospect" (voir 20260801000001) aux leads YouTube/Autres,
-- qui passent par la table prospects plutôt que instagram_leads. Même sémantique :
-- exclut la ligne des stats/compteurs sans suppression, réversible.

alter table prospects add column if not exists not_a_lead boolean not null default false;

comment on column prospects.not_a_lead is 'Marqué manuellement quand un lead est un faux positif (ex: un pote, pas un prospect) — exclut la ligne de toutes les stats/compteurs. Voir instagram_leads.not_a_lead pour l''équivalent côté Instagram.';
