alter table story_sequences drop constraint if exists story_sequences_cta_type_check;
alter table story_sequences drop column if exists cta_type;
