alter table prospect_links add column if not exists source_at_creation text;
comment on column prospect_links.source_at_creation is 'Source du lead figée au moment de la création du lien (instagram_leads.source à cet instant précis) — jamais réécrite ensuite, contrairement à instagram_leads.source qui est un état courant écrasé à chaque nouvelle interaction.';
