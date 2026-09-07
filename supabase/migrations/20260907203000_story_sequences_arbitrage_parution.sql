-- Renomme `stories_rattachees_le` en `stories_arbitrees_jusqua`, parce que la
-- colonne ne contient PAS ce que son premier nom annonçait.
--
-- ── Ce qui a changé, et pourquoi ce n'est pas cosmétique ─────────────────────
--
-- Créée quelques heures plus tôt le 2026-09-07, elle retenait l'heure du clic sur
-- « Les rattacher ». C'était faux, d'une façon silencieuse :
--
--   • la parution d'une story est datée par INSTAGRAM ;
--   • le clic l'est par notre serveur ;
--   • et le cron peut avoir jusqu'à une heure de retard entre les deux.
--
-- Une story publiée depuis le téléphone pendant que l'écran est ouvert sur
-- l'ordinateur n'est donc pas encore affichée au moment du clic — mais sa
-- parution précède l'heure de ce clic. Elle aurait été écartée pour toujours sans
-- avoir jamais été proposée, et rien ne l'aurait signalé.
--
-- La colonne porte désormais une PARUTION : celle, la plus récente, sur laquelle
-- le coach a effectivement tranché — rattachées et écartées réunies. On ne
-- compare plus que des `posted_at` entre eux, jamais à une horloge.
--
-- Le nom devait suivre : laissé tel quel, le prochain lecteur aurait comparé
-- cette valeur à `now()` et réintroduit le défaut.
--
-- ⚠️ Sûr à appliquer : la fonctionnalité n'avait pas encore été déployée quand ce
-- renommage a été écrit, la colonne était NULL partout. Vérifié avant exécution.
alter table story_sequences
  rename column stories_rattachees_le to stories_arbitrees_jusqua;

comment on column story_sequences.stories_arbitrees_jusqua is
  'Parution la plus récente sur laquelle le coach a tranché en rattachant des stories (rattachées ET écartées). Les stories libres publiées avant elle ne sont plus proposées : ne pas les avoir rattachées valait refus. C''est une date de PUBLICATION, jamais une heure de clic — voir la migration story_sequences_arbitrage_parution.';
