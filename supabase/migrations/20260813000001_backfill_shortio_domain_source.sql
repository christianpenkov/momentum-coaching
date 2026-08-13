-- Backfill domain_source sur les intégrations Short.io déjà connectées avant l'introduction
-- du champ (fix du choix arbitraire de domaine — domains[0] pris sans discernement).
-- Sans ce backfill, domain_source absent est traité comme équivalent à 'auto_single' côté
-- lecture applicative — ce backfill sert seulement à rendre les données explicites.
update integrations
set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{domain_source}', '"auto_single"')
where provider = 'shortio'
  and metadata ? 'domain_id'
  and not metadata ? 'domain_source';
