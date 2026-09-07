-- `calls` etait la SEULE table d'integration dont la cle unique oubliait le profil
--
-- ── Ce qui s'est produit le 2026-09-06 a 19 h 23 ───────────────────────────────────
--
-- Un second profil (Rdjdkz) a connecte le MEME compte Calendly qu'un premier
-- (Christian) : meme `user_uri`, meme libelle. Le sync a tourne pour le second, retrouve
-- chaque rendez-vous existant par son `calendly_event_uuid`, et l'a ECRASE avec
-- `coach_id` = le second profil.
--
-- Onze rendez-vous ont ainsi change de proprietaire. Avec eux : leurs prospects, leur
-- attribution de contenu, et les cinq ventes qui les referencaient — d'ou l'alerte
-- `ventes_sante_date` du 2026-09-07, qui ne voyait que le bout visible.
--
-- ⚠️ Ce n'est PAS une fuite de lecture. Verifie le meme jour, role `authenticated` avec
-- les claims du second profil : il ne voit que SES lignes sur `calls`, `prospects`,
-- `deals`, `instagram_leads`. La RLS tient. C'est un transfert par ECRITURE, que la RLS
-- ne peut pas voir — et c'est pour ca qu'il est passe inapercu trois semaines.
--
-- ── Pourquoi c'est un alignement et pas une invention ──────────────────────────────
--
-- Releve sur tout le schema le 2026-09-07 : chaque table alimentee par une integration
-- prefixe sa cle unique par le profil.
--
--   analytics_daily_snapshots     (profile_id, date)
--   analytics_ig_posts_history    (profile_id, post_id, snapshot_date)
--   analytics_yt_videos_history   (profile_id, video_id, snapshot_date)
--   shortio_link_daily_snapshots  (profile_id, link_id, date)
--   ig_stories                    (profile_id, ig_story_id)
--   instagram_leads               (profile_id, ig_user_id)
--   prospects                     (profile_id, email)
--   deals                         (profile_id, stripe_payment_link_id)
--
-- `calls` etait la seule exception, sur ses DEUX cles externes. `fathom_recording_id`
-- porte exactement le meme risque que `calendly_event_uuid` : deux eleves sur un meme
-- compte Fathom se voleraient leurs enregistrements de la meme facon. Les deux sont
-- corriges ici, meme si seul Calendly a fait des degats.
--
-- ── Pourquoi cette migration ne SUPPRIME rien ──────────────────────────────────────
--
-- Les anciens index restent en place. Le code deploye fait encore
-- `onConflict: 'calendly_event_uuid'` : supprimer l'index maintenant ferait echouer
-- toute synchro Calendly jusqu'au deploiement du code corrige — une panne de plusieurs
-- minutes sur le chemin qui enregistre les rendez-vous.
--
-- La sequence est donc en trois temps, et cette migration est le PREMIER :
--   1. creer les index par profil (ici) — les deux jeux coexistent, rien ne change ;
--   2. deployer le code avec le nouveau `onConflict` ;
--   3. supprimer les anciens index (migration suivante), une fois le deploiement
--      confirme.
--
-- Pendant la coexistence, l'ancien index continue d'interdire les doublons : le
-- comportement reste EXACTEMENT celui d'aujourd'hui. C'est voulu — cette migration ne
-- doit rien changer, seulement rendre l'etape 2 possible sans fenetre de panne.
--
-- ⚠️ Ne pas fusionner les etapes 1 et 3 dans une seule migration.

create unique index if not exists calls_coach_calendly_event_uuid_key
  on public.calls (coach_id, calendly_event_uuid)
  where calendly_event_uuid is not null;

create unique index if not exists calls_coach_fathom_recording_id_key
  on public.calls (coach_id, fathom_recording_id)
  where fathom_recording_id is not null;

comment on index public.calls_coach_calendly_event_uuid_key is
  'Isolation par eleve des rendez-vous Calendly. Remplace calls_calendly_event_uuid_key, unique GLOBALEMENT, qui laissait un second profil connecte au meme compte Calendly ecraser les rendez-vous du premier (2026-09-06). Meme forme que les huit autres tables d''integration.';

comment on index public.calls_coach_fathom_recording_id_key is
  'Isolation par eleve des enregistrements Fathom. Meme motif que l''index Calendly voisin : la cle externe seule laissait deux profils sur un meme compte se voler leurs lignes.';

-- Controle : les nouveaux index doivent exister ET les anciens etre encore la, sinon la
-- sequence en trois temps est rompue et le deploiement suivant tomberait dans la fenetre
-- de panne que cette migration existe pour eviter.
do $$
declare
  nouveaux int := (select count(*) from pg_class where relname in
    ('calls_coach_calendly_event_uuid_key','calls_coach_fathom_recording_id_key'));
  anciens  int := (select count(*) from pg_class where relname in
    ('calls_calendly_event_uuid_key','idx_calls_fathom_recording_id'));
begin
  if nouveaux <> 2 then
    raise exception 'Les index par profil ne sont pas tous poses (% sur 2)', nouveaux;
  end if;
  if anciens <> 2 then
    raise exception 'Un ancien index a deja disparu (% sur 2) — le code deploye va casser', anciens;
  end if;
end $$;
