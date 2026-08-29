-- ────────────────────────────────────────────────────────────────────────────
-- Les séquences de stories portaient d'autres textes par défaut que les posts.
--
-- « Salut {{username}} ! Je t'envoie ça tout de suite 👇 » et
-- « 👋 Merci {{username}} ! Voici ton lien : {{lien_lm}} » étaient les valeurs
-- proposées côté story, là où un post proposait « 👋 Voici le lien comme promis ! »
-- et « Voici ton lien 👇 ». Les deux variables SONT bien remplacées à l'envoi,
-- mais à l'écran elles se lisent comme des trous — et surtout, deux écrans
-- proposaient deux départs différents pour la même séquence.
--
-- On ne touche QUE les valeurs qui contiennent encore une variable : c'est la
-- signature d'un texte jamais réécrit par le coach. Une accroche personnalisée
-- qui n'en contient pas est laissée telle quelle.
--
-- Volontairement sans filtre sur l'expiration des stories : une séquence dont
-- les stories sont périmées garde ses messages, et resservira telle quelle à la
-- prochaine story qu'on lui ajoutera.
-- ────────────────────────────────────────────────────────────────────────────

update story_sequences
   set dm_lm_message = '👋 Voici le lien comme promis !',
       updated_at    = now()
 where dm_lm_message is not null
   and (dm_lm_message ilike '%{{username}}%' or dm_lm_message ilike '%{{lien_lm}}%');

update story_sequences
   set dm1_message = 'Voici ton lien 👇',
       updated_at  = now()
 where dm1_message is not null
   and (dm1_message ilike '%{{username}}%' or dm1_message ilike '%{{lien_lm}}%');

-- La relance et les deux libellés de bouton ne sont pas touchés : ils ne
-- portaient aucune variable, et la relance est un texte que le coach écrit.
