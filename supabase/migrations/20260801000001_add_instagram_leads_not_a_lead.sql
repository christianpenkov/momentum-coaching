-- Statut "pas un prospect" pour les faux positifs Cold DM (ex: un pote détecté
-- comme lead après un simple DM manuel). Contrairement à pipeline_overrides.stage
-- = 'dismissed' (filtre d'affichage kanban uniquement), not_a_lead exclut la ligne
-- de toutes les statistiques/compteurs ET bloque la recréation automatique d'une
-- nouvelle fiche Cold DM pour ce même ig_user_id. Un futur lead légitime (commentaire
-- matché, lien bio avec UTM) sur la même personne n'est pas affecté : le check
-- not_a_lead ne s'applique qu'à la voie Cold DM (handleColdDmCandidate).

alter table instagram_leads add column if not exists not_a_lead boolean not null default false;

comment on column instagram_leads.not_a_lead is 'Marqué manuellement quand un Cold DM est un faux positif (ex: un pote, pas un prospect) — exclut la ligne de toutes les stats/compteurs et bloque la recréation automatique d''une fiche Cold DM pour ce ig_user_id. N''affecte pas un futur lead créé via un canal tracké (commentaire/bio).';
