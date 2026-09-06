-- ────────────────────────────────────────────────────────────────────────────
-- Une séquence « ouverte » ramasse les stories publiées après sa création.
--
-- Le lien Calendly d'une séquence n'existe qu'une fois la séquence créée, mais
-- on ne peut pas ajouter de sticker à une story DÉJÀ publiée — le code de la
-- route le disait déjà : « impossible d'insérer un lien directement dans une
-- story déjà publiée ». Il faut donc pouvoir préparer la séquence AVANT de
-- publier : on la nomme, on récupère son lien, on publie avec le sticker, puis
-- on lui rattache les stories parues.
--
-- C'est aussi la pratique standard hors Momentum : « Tag the URL before it goes
-- into Instagram. Clean tracking starts before the sticker is added. »
--
-- `closed_at` dit que le coach a fini de publier. Tant qu'il est nul, l'écran
-- propose de rattacher les stories parues depuis la création. Repli automatique
-- côté écran : au-delà de 24 h sans nouvelle story, la proposition se tait — mais
-- l'ajout manuel reste toujours possible, un lancement étalé sur trois jours ne
-- doit pas se retrouver coupé.
-- ────────────────────────────────────────────────────────────────────────────

alter table story_sequences
  add column if not exists closed_at timestamptz;

comment on column story_sequences.closed_at is
  'Clôture par le coach. NULL = séquence ouverte : l''écran propose encore de lui rattacher les stories publiées depuis sa création.';
