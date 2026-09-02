-- Enregistrements Fathom d'un call — une ligne par (call, compte qui a enregistré)
-- ============================================================================
--
-- LE PROBLÈME QUE ÇA RÈGLE
--
-- Coach et élève connectent chacun leur compte Fathom. Sur un call de coaching,
-- les DEUX bots rejoignent la réunion et Fathom produit DEUX enregistrements
-- distincts, avec deux `recording_id` différents et la même `meeting_url`.
--
-- `calls.fathom_recording_id` est une colonne unique : elle ne peut en porter
-- qu'un. Le second webhook ne trouvait donc plus rien à rattacher — toutes les
-- requêtes de matching filtrent `fathom_recording_id IS NULL` — et tombait dans
-- `fathom_unmatched`, à traiter à la main. Sur CHAQUE call de coaching, pour
-- toujours. C'est cette corvée-là qu'on supprime.
--
-- CE QUE LA TABLE APPORTE, au-delà de ne plus polluer
--
-- Elle dit QUI a enregistré quoi. Deux conséquences directes :
--   • chacun lit le replay depuis SON compte quand il en a un (l'appel à Fathom
--     se fait avec son propre jeton, pas celui de l'autre) ;
--   • si l'un des deux déconnecte Fathom plus tard, les replays des calls
--     communs survivent par le compte de l'autre. Sans cette table, ils
--     mourraient tous avec le seul `recording_id` stocké.
--
-- CE QUI RESTE SUR `calls`
--
-- Le résumé, la transcription et les points clés NE bougent pas. Deux bots dans
-- la même réunion enregistrent la même conversation : dupliquer ce contenu par
-- compte n'apporterait rien et obligerait à réécrire le chemin de lecture de
-- cinq écrans. `calls.fathom_*` reste la version affichée — le premier
-- enregistrement arrivé, jamais écrasé ensuite pour que l'affichage soit stable.
-- Cette table ne sert qu'à savoir OÙ aller chercher la vidéo.

CREATE TABLE IF NOT EXISTS public.call_recordings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id              uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  profile_id           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  fathom_recording_id  text NOT NULL,
  fathom_share_url     text,
  recorded_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.call_recordings IS
  'Un enregistrement Fathom par (call, compte qui a enregistré). Quand coach et élève ont tous les deux Fathom, un call de coaching en a deux. Le contenu (résumé, transcript) reste sur calls.fathom_* ; ici on ne stocke que de quoi aller chercher la vidéo.';

COMMENT ON COLUMN public.call_recordings.profile_id IS
  'Compte dont le Fathom a enregistré, résolu via recorded_by.email. NULL quand on ne sait pas : lignes reprises de l''existant, ou personne extérieure à la plateforme. NULL ne vaut pas "aucun accès" — il fait retomber sur l''ancien comportement (essayer le jeton de chaque participant), ce qui est exactement ce qu''on faisait avant cette table.';

COMMENT ON COLUMN public.call_recordings.fathom_share_url IS
  'Lien de partage propre à CET enregistrement. Public seulement si le compte qui a enregistré a « Anyone with the link can view » dans ses réglages Fathom — d''où la consigne affichée dans les Réglages de la plateforme (components/ui/FathomSetupHint.tsx).';

-- Idempotence des webhooks : Fathom réémet, et le webhook comme le cron peuvent
-- traiter le même enregistrement. C'est cet index qui remplace la vérification
-- « ce recording_id est-il déjà sur un call ? », devenue insuffisante dès lors
-- qu'un call peut en porter plusieurs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_recordings_recording
  ON public.call_recordings (fathom_recording_id);

-- Un compte n'enregistre qu'une fois une réunion donnée. Garde-fou contre un
-- doublon si Fathom changeait d'identifiant entre deux émissions.
-- Index partiel : NULL n'est pas comparable en SQL, la contrainte ne mordrait
-- pas sur les lignes sans profil connu — autant l'écrire explicitement.
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_recordings_call_profile
  ON public.call_recordings (call_id, profile_id)
  WHERE profile_id IS NOT NULL;

-- Chemin de lecture : « les enregistrements de ce call », à chaque ouverture de
-- la modale d'un call enregistré.
CREATE INDEX IF NOT EXISTS idx_call_recordings_call
  ON public.call_recordings (call_id);

-- Exposée via PostgREST : RLS activée sans policy = inaccessible par l'API.
-- Le service_role (webhook, cron, route de téléchargement) contourne RLS par
-- conception. Le contrôle « qui a le droit de voir ce replay » est écrit une
-- seule fois, dans lib/replayAccess.ts, et testé — le redire en policy SQL le
-- dupliquerait, donc garantirait la divergence.
ALTER TABLE public.call_recordings ENABLE ROW LEVEL SECURITY;

-- ── Reprise de l'existant ───────────────────────────────────────────────────
--
-- Chaque call déjà rattaché reçoit sa ligne, avec profile_id à NULL : on ne
-- stockait nulle part qui avait enregistré, et le deviner à partir du seul
-- compte Fathom connecté aujourd'hui serait un pari qui deviendrait faux dès le
-- deuxième compte connecté. NULL est la réponse honnête, et elle est déjà
-- gérée : elle reproduit le comportement actuel (essayer chaque participant).
INSERT INTO public.call_recordings (call_id, profile_id, fathom_recording_id, fathom_share_url, recorded_at)
SELECT c.id, NULL, c.fathom_recording_id, c.fathom_share_url, c.fathom_matched_at
FROM public.calls c
WHERE c.fathom_recording_id IS NOT NULL
ON CONFLICT (fathom_recording_id) DO NOTHING;
