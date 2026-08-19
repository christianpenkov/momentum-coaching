-- Séquence DM : textes du DM2 configurables + délai avant le DM3.
--
-- ── 1. Textes du DM2 (le message qui porte le lien) ──────────────────────────
--
-- Depuis que le DM2 utilise un template avec bouton (pour masquer l'URL), il a
-- deux parties rédactionnelles qui étaient codées en dur :
--   - le texte au-dessus du bouton (« Voici ton lien 👇 »)
--   - le libellé du bouton lui-même
--
-- Le libellé réutilisait dm_button_text, celui du DM1 — or les deux boutons
-- n'ont pas le même rôle : le premier demande le lien, le second l'ouvre.
--
-- NULL = valeur par défaut appliquée côté webhook. L'interface affiche cette
-- même valeur en placeholder gris, pour qu'un champ vide montre ce qui sera
-- réellement envoyé (constantes DM2_DEFAULT_* dupliquées des deux côtés).
ALTER TABLE public.content_links
  ADD COLUMN IF NOT EXISTS dm_link_message     text,
  ADD COLUMN IF NOT EXISTS dm_link_button_text text;

COMMENT ON COLUMN public.content_links.dm_link_message IS
  'Texte du DM2 (au-dessus du bouton du lien). NULL = défaut « Voici ton lien 👇 ».';
COMMENT ON COLUMN public.content_links.dm_link_button_text IS
  'Libellé du bouton du DM2 (celui qui ouvre le lien), max 20 car. NULL = défaut « 📖 Accéder au lien ».';

-- ── 2. Délai de 2 minutes entre le DM2 et le DM3 ─────────────────────────────
--
-- Pourquoi une file et pas une simple attente : le webhook Instagram doit
-- répondre à Meta en MOINS DE 30 SECONDES. Attendre 2 minutes dans le handler
-- ferait échouer la requête, et après 1 h d'échecs Meta DÉSABONNE l'application
-- du webhook (les DM1 s'arrêtent, réabonnement manuel requis). Le DM3 est donc
-- horodaté ici, et envoyé par la fonction send-pending-dm3.
--
-- Pourquoi 2 minutes : la personne vient de cliquer, elle attend le lien —
-- l'envoi immédiat des deux messages fait mécanique. ManyChat utilise ~3 s entre
-- messages d'un même flux ; les délais de 4-11 min recommandés ailleurs
-- concernent la prospection à froid, pas une séquence déclenchée par une action
-- de l'utilisateur. 2 minutes est le choix de Chris : assez pour que la question
-- d'ouverture arrive comme un vrai message de suivi, assez court pour rester
-- dans le fil de l'attention.
ALTER TABLE public.instagram_leads
  ADD COLUMN IF NOT EXISTS dm3_scheduled_at timestamptz;

COMMENT ON COLUMN public.instagram_leads.dm3_scheduled_at IS
  'Quand envoyer pending_dm3 (DM d''ouverture). Posé au clic du DM1 à +2 min ; le cron send-pending-dm3 dépile. NULL = rien à envoyer.';

-- Index partiel : le cron ne lit que les lignes réellement en attente, jamais
-- toute la table. Reste minuscule même à 30 élèves × centaines de leads.
CREATE INDEX IF NOT EXISTS idx_instagram_leads_dm3_due
  ON public.instagram_leads (dm3_scheduled_at)
  WHERE dm3_scheduled_at IS NOT NULL AND pending_dm3 IS NOT NULL;

-- ── 3. Cron d'envoi des DM3 différés ─────────────────────────────────────────
--
-- Toutes les minutes : le délai visé est de 2 min, une granularité à la minute
-- donne donc un envoi entre 2 et 3 min — imperceptible pour le prospect, et bien
-- plus léger qu'un cron à la seconde. Quand il n'y a rien à envoyer, la fonction
-- répond immédiatement (index partiel ci-dessus).
SELECT cron.unschedule('send-pending-dm3-1min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-pending-dm3-1min');

SELECT cron.schedule(
  'send-pending-dm3-1min',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://nvjgwtetyuatnkjihmtw.supabase.co/functions/v1/send-pending-dm3',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer a7dd5bede262bc5198178488367f2b2369c407d305ee175fb980356fd5ff078e'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
