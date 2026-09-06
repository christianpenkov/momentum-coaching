-- ────────────────────────────────────────────────────────────────────────────
-- Un lead magnet devient autonome : son mot-clé peut répondre partout, et il
-- porte enfin ses propres messages.
--
-- Jusqu'ici, les cinq DM vivaient UNIQUEMENT sur `content_links` (posts) et
-- `story_sequences` (stories). Un mot-clé reçu hors de ces deux cas n'avait donc
-- rien à envoyer, et le webhook serait retombé sur ses textes génériques —
-- exactement ce qu'on interdit depuis le 2026-09-02.
--
-- Noms explicites, contrairement à `story_sequences` où `dm1_message` est le
-- message du lien et `dm2_story_message` la relance. Cette confusion a coûté
-- assez cher pour ne pas la reproduire dans une table neuve.
-- ────────────────────────────────────────────────────────────────────────────

alter table lead_magnets
  add column if not exists repond_partout      boolean not null default false,
  add column if not exists dm_accroche         text,
  add column if not exists dm_accroche_bouton  text,
  add column if not exists dm_lien             text,
  add column if not exists dm_lien_bouton      text,
  add column if not exists dm_relance          text;

comment on column lead_magnets.repond_partout is
  'Le mot-clé répond partout : commentaire sous un post, réponse à une story, DM direct — même quand le contenu n''est configuré nulle part. Un contenu qui porte son propre mot-clé garde la priorité.';
comment on column lead_magnets.dm_accroche is 'DM1 — premier message, sans lien.';
comment on column lead_magnets.dm_accroche_bouton is 'Libellé du bouton du DM1. Son clic est le postback qui ouvre la fenêtre de 24 h.';
comment on column lead_magnets.dm_lien is 'DM2 — texte qui accompagne le bouton du lien. Peut être vide.';
comment on column lead_magnets.dm_lien_bouton is 'Libellé du bouton du DM2, celui qui porte l''URL.';
comment on column lead_magnets.dm_relance is 'DM3 — relance envoyée 2 min après. Vide = pas de relance.';

-- ── UN MOT-CLÉ DÉSIGNE UN SEUL LEAD MAGNET ──────────────────────────────────
--
-- C'est cette contrainte qui rend la résolution déterministe : sans elle, deux
-- lead magnets portant « LM » obligeraient à départager par un ordre de liste
-- — la solution de ManyChat, et une chose de plus à maintenir.
--
-- Insensible à la casse et aux espaces de bord, comme la comparaison faite à la
-- réception d'un message.
create unique index if not exists lead_magnets_mot_cle_unique
  on lead_magnets (profile_id, upper(btrim(keyword)))
  where keyword is not null and btrim(keyword) <> '';
