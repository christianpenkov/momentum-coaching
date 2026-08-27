-- Unification des séquences DM : les stories reçoivent les trois champs qui leur
-- manquaient pour porter le même parcours que les posts.
--
-- ÉTAPE 1 sur 2 — cette migration ne change AUCUN comportement d'envoi. Le
-- webhook continue d'envoyer le parcours actuel (message avec lien, puis message
-- libre). Elle prépare seulement le terrain, pour que l'écran de réglage puisse
-- être rempli et relu avant qu'on ne bascule l'envoi.
--
-- ── Correspondance des colonnes ─────────────────────────────────────────────
--
-- Les deux colonnes existantes tombent déjà juste, aucune donnée n'a besoin de
-- bouger :
--
--   dm1_message         → « Message du lien »  (il contient déjà {{lien_lm}})
--   dm2_story_message   → « Relance »          (déjà envoyé juste après)
--
-- Il manque les trois qui composent l'étape du bouton, absente des stories :
--
--   dm_lm_message       → « Accroche », le premier message, SANS lien
--   dm_button_text      → le bouton de l'accroche, qui demande le lien
--   dm_link_button_text → le bouton du message du lien, qui l'ouvre
--
-- Mêmes noms que sur `content_links`, pour que les deux modèles se lisent
-- pareil — le décalage de numérotation de `content_links` (dm_opener_message y
-- désigne la relance) n'est PAS reproduit ici.

alter table story_sequences
  add column if not exists dm_lm_message       text,
  add column if not exists dm_button_text      text,
  add column if not exists dm_link_button_text text;

-- ── Conversion des séquences existantes ─────────────────────────────────────
--
-- Une colonne ajoutée sans backfill laisse des séquences à moitié configurées,
-- qui partiraient tronquées le jour de la bascule. On remplit donc les trois
-- nouveaux champs avec les valeurs par défaut du parcours des posts, pour toute
-- séquence qui a déjà un mot-clé — c'est-à-dire qui envoie réellement des DM.
--
-- Ces textes sont volontairement les mêmes que ceux affichés en placeholder dans
-- l'interface : une séquence convertie enverra exactement ce que l'écran montre.

update story_sequences
set
  dm_lm_message = coalesce(
    dm_lm_message,
    'Salut {{username}} ! Je t''envoie ça tout de suite 👇'
  ),
  dm_button_text = coalesce(dm_button_text, '🚀 Je veux le lien !'),
  dm_link_button_text = coalesce(dm_link_button_text, '📖 Accéder au lien')
where lm_keyword is not null
  and (dm_lm_message is null or dm_button_text is null or dm_link_button_text is null);

comment on column story_sequences.dm_lm_message is
  'Accroche — 1er message, sans lien. Porte le bouton dm_button_text.';
comment on column story_sequences.dm_button_text is
  'Libellé du bouton de l''accroche (20 car. max côté Meta). Son clic déclenche l''envoi du message du lien.';
comment on column story_sequences.dm1_message is
  'Message du lien — contient {{lien_lm}}. Malgré son nom, ce n''est PAS le premier message depuis l''unification (voir dm_lm_message).';
comment on column story_sequences.dm_link_button_text is
  'Libellé du bouton qui ouvre le lien (20 car. max côté Meta).';
comment on column story_sequences.dm2_story_message is
  'Relance — envoyée automatiquement après le message du lien. Malgré son nom, ce n''est PAS le deuxième message.';
