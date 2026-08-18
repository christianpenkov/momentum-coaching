-- Nomenclature UTM : un rôle unique par champ — voir docs/utm-nomenclature.md
--
-- Constat du 2026-08-19. Les cinq paramètres de suivi ne portaient pas chacun une
-- information distincte, ce qui rendait impossible de savoir ce qu'on lisait :
--
--   utm_content mélangeait QUATRE natures : identifiant de post Instagram (9 calls),
--     identifiant de vidéo YouTube (3), pseudo du prospect (23), vide (7).
--   utm_source contenait le domaine du raccourcisseur au lieu de la plateforme sur
--     31 liens Short.io, ce qui remontait dans calls.source (fabriqué par un simple
--     collage utm_source + "_" + utm_medium dans le webhook Calendly) et produisait
--     des valeurs comme "ubizenai.s.gy_description".
--   utm_medium mélangeait le canal (bio, description, dm, story) et la nature du lien
--     (leadmagnet), alors qu'un lead magnet est envoyé PAR un canal — 16 liens de lead
--     magnet portaient medium=dm et 19 portaient medium=leadmagnet, mêmes objets.
--
-- Nomenclature retenue, chaque champ répondant à une seule question :
--   utm_source   OÙ       la plateforme          ig | yt
--   utm_medium   COMMENT  le canal               bio | description | dm | story
--   utm_campaign QUOI     la nature du lien      calendly | lm-<motclé>
--   utm_content  DEPUIS   l'identifiant du contenu d'origine (post ou vidéo), vide
--                         pour la bio qui ne vient d'aucun contenu précis
--   utm_term     QUI      le pseudo du prospect
--
-- Rappel : Calendly ne transmet que les cinq UTM standards plus salesforce_uuid, et
-- n'accepte aucun paramètre sur mesure. Chaque valeur est limitée à 255 caractères.
-- salesforce_uuid reste volontairement libre pour un besoin futur.
--
-- Sauvegarde : _backup_calls_utm_20260819 (créée avant cette migration).

-- ── 1. utm_term : la personne, jamais stockée jusqu'ici ──────────────────────
-- Le champ était pourtant déjà écrit dans les URL de 8 liens Short.io, mais aucune
-- colonne ne le recevait : l'information partait vers Calendly et se perdait.
alter table calls add column if not exists utm_term text;

comment on column calls.utm_term is
  'Pseudo du prospect (UTM). Séparé de utm_content, qui ne porte que l''identifiant du contenu d''origine. Voir docs/utm-nomenclature.md.';

-- ── 2. Déplacer les pseudos de utm_content vers utm_term ─────────────────────
-- Un identifiant de post Instagram fait 15 à 20 chiffres, un identifiant de vidéo
-- YouTube 11 caractères alphanumériques. Tout le reste est un pseudo mal rangé.
update calls
   set utm_term    = utm_content,
       utm_content = null
 where call_type = 'calendly'
   and utm_content is not null
   and utm_content !~ '^[0-9]{15,20}$'
   and utm_content !~ '^[A-Za-z0-9_-]{11}$';

-- ── 3. source : retirer le domaine du raccourcisseur ─────────────────────────
-- calls.source vaut "<plateforme>_<canal>". Quand utm_source portait le domaine, la
-- plateforme est reconstruite depuis utm_content : un identifiant de vidéo YouTube
-- (11 caractères) donne yt, sinon ig.
update calls
   set source = case
                  when utm_content ~ '^[A-Za-z0-9_-]{11}$' then 'yt_'
                  else 'ig_'
                end || coalesce(utm_medium, 'description')
 where source like '%.%';

-- Les valeurs hors nomenclature (test_bio, linkedin_post) sont laissées telles
-- quelles : ce sont des essais manuels, pas des parcours réels, et les réécrire
-- inventerait une attribution qui n'a jamais existé.
