-- Report de la création du lien Short.io au moment du CLIC (et non du commentaire).
--
-- Le lien personnalisé n'est envoyé qu'en DM2, donc uniquement aux prospects qui
-- cliquent sur le bouton du DM1 — 30 à 50 % en pratique. Le créer dès le
-- commentaire gaspillait la moitié à deux tiers du quota d'automation Short.io
-- (1 000 liens/an en gratuit, 10 000/an en Pro : un seul post viral consommait
-- l'année entière) et ajoutait un appel réseau au chemin critique du webhook,
-- qui doit répondre à Meta en moins de 30 s sous peine de désabonnement.
--
-- Ces deux colonnes conservent, au moment du commentaire, ce qu'il faudra pour
-- construire le lien plus tard. `content_links` reste la source de vérité pour
-- lm_url/lm_keyword ; on ne fige ici que ce qui est propre à CE lead :
--   - pending_lm_content_id : le contenu commenté, pour retrouver la bonne ligne
--     content_links au moment du clic (un élève a plusieurs contenus, chacun avec
--     son lead magnet).
--   - pending_lm_media_id : l'identifiant du post, qui alimente utm_content —
--     c'est lui que « Performance par contenu » compare pour rattacher un call.
--     Doit être figé au commentaire : au moment du clic, on ne sait plus d'où
--     venait le prospect.
ALTER TABLE public.instagram_leads
  ADD COLUMN IF NOT EXISTS pending_lm_content_id text,
  ADD COLUMN IF NOT EXISTS pending_lm_media_id   text;

COMMENT ON COLUMN public.instagram_leads.pending_lm_content_id IS
  'Contenu (content_links.content_id) dont vient le lead — sert à créer le lien Short.io au clic du DM1.';
COMMENT ON COLUMN public.instagram_leads.pending_lm_media_id IS
  'media_id du post commenté, figé au commentaire — alimente utm_content du lien créé au clic.';
