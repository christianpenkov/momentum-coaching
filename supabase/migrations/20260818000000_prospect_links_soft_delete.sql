-- Suppression non destructive des liens prospects — voir docs/tracking-prospect.md
--
-- Problème constaté le 2026-08-18 sur rdjdkzjd. Une ligne prospect_links ne porte pas
-- que l'URL du lien Short.io : elle porte aussi l'historique commercial du prospect
-- (calendly_link_sent, calendly_link_sent_at, first_click_at, min_stage_reached).
-- Le bouton « Supprimer ce lien prospect » de Gérer mes liens faisait un DELETE, donc
-- effaçait ce parcours en même temps que l'URL.
--
-- Chronologie du cas réel :
--   08/07  le prospect clique sur son lien puis book un call
--   ~14/08 le lien est supprimé depuis Gérer mes liens, puis régénéré
--   15/08  la nouvelle ligne repart vierge (calendly_link_sent = false)
-- Conséquences visibles : le call tombait en « Autre / non catégorisé » dans le
-- breakdown par source, et le prospect sortait du dénominateur du taux d'activation
-- Calendly, qui affichait 150 % (3 clics / 2 liens).
--
-- deleted_at rend la suppression réversible et non destructive :
--   - les lectures « quels liens actifs ai-je ? » filtrent .is('deleted_at', null)
--   - les lectures d'historique (stats, pipeline, attribution) ne filtrent pas, et
--     voient donc toujours le parcours complet du prospect
--
-- short_url reste NOT NULL et conserve sa valeur : le lien Short.io peut rester actif
-- côté Short.io même après retrait de l'interface, et son path sert encore à rattacher
-- les clics entrants (syncLmClickStream fait un LIKE sur short_url).

alter table prospect_links add column if not exists deleted_at timestamptz;

comment on column prospect_links.deleted_at is
  'Date de retrait du lien depuis Gérer mes liens. NULL = lien actif. Les lectures de liens actifs doivent filtrer deleted_at IS NULL ; les lectures d''historique (stats, pipeline, attribution) l''ignorent volontairement pour ne jamais perdre le parcours du prospect.';

-- Les lectures « liens actifs » filtrent sur (profile_id, deleted_at) : index partiel
-- sur les seules lignes actives, plus compact qu'un index complet et suffisant ici.
create index if not exists prospect_links_active_idx
  on prospect_links (profile_id)
  where deleted_at is null;
